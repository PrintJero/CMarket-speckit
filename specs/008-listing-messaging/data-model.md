# Data Model: Listing Messaging

Two new entities. No existing entity gains a new field (`Listing`, `Account`, `Community` are referenced, not modified — spec.md Key Entities).

## MessageThread *(new)*

A conversation between exactly one listing's owner and one interested buyer, tied to that one listing (FR-002).

| Field       | Type            | Notes                                                                                     |
| ----------- | --------------- | ------------------------------------------------------------------------------------------ |
| `id`        | identifier      | Primary key                                                                                 |
| `listingId` | identifier (FK) | The listing this thread is about. `onDelete: Cascade` — deleting the listing deletes the thread (FR-015) |
| `buyerId`   | identifier (FK) | The interested buyer — never the listing's owner (FR-013, enforced at creation, not by a DB constraint since owner can change is not a concern but self-reference is an app-level check) |
| `createdAt` | timestamp       | Thread creation time                                                                        |
| `lastMessageAt` *(added, 2026-07-17 amendment)* | timestamp | The `createdAt` of this thread's most recent `Message`. Set to the creation timestamp when the thread (and its first message) is created, then updated every time a further message is appended. Exists solely so Chats (FR-020) and the per-community inbox can `orderBy` it directly in the database — no in-memory sort. |

**Owner** is not a stored column — it is always the referenced listing's `ownerId` (a listing's owner never changes, 005-product-listings), read via `include: { listing: { select: { ownerId: true, communityId: true, status: true } } }` (research.md #1).

**Constraints**:

- `@@unique([listingId, buyerId])` — exactly one thread per (listing, buyer) pair (FR-002, research.md #2).
- `@@index([buyerId])` — supports "threads I started as buyer" lookups.
- `@@index([lastMessageAt])` *(added, amendment)* — supports ordering Chats/the inbox by recent activity without an in-memory sort.

**Lifecycle**: Created on a buyer's first message to a listing's owner, subject to gates below. Never updated. Deleted only as a cascade side effect of its listing being deleted (FR-015) — no direct deletion capability exists for a thread itself.

**Creation gates** (all MUST hold, checked in this order, no thread or message persisted if any fails):

1. `buyerId` MUST currently hold membership in the listing's community (FR-008) — `not_a_member`.
2. `buyerId` MUST NOT equal the listing's `ownerId` (FR-013) — `cannot_message_own_listing`.
3. The listing MUST be `ACTIVE` (FR-016, research.md #4) — `listing_paused`. Only checked when a new thread is being created; irrelevant once a thread exists.
4. The first message itself MUST pass the Message validation rules below.

## Message *(new)*

A single text message within a thread (FR-003).

| Field       | Type            | Notes                                                                                |
| ----------- | --------------- | --------------------------------------------------------------------------------------- |
| `id`        | identifier      | Primary key                                                                              |
| `threadId`  | identifier (FK) | The thread this message belongs to. `onDelete: Cascade`                                 |
| `senderId`  | identifier (FK) | The account that sent it — the thread's `buyerId` or the thread's listing's `ownerId`   |
| `body`      | string          | Text content, 1–2,000 characters after trimming (FR-012, Clarifications)                |
| `createdAt` | timestamp       | Send time — the sole ordering key (FR-003, FR-004)                                      |

**Constraints**:

- `@@index([threadId, createdAt])` — supports fetching one thread's messages in order.

**Lifecycle**: Append-only. No edit, no delete (spec Out of Scope). Deleted only as a cascade side effect of its thread being deleted, which itself only happens via the thread's listing being deleted (FR-015).

**Validation rules** (enforced once, in the single function that creates a `Message` row — research.md #5):

- `body`, after trimming leading/trailing whitespace, MUST be non-empty (FR-012) — `invalid_message`.
- `body` (trimmed) MUST be 2,000 characters or fewer (FR-012, Clarifications) — `invalid_message`.
- The sender's `Account.displayName` MUST be non-null (FR-010) — `display_name_required`. If the sender has no display name, no `Message` row (and, for a first message, no `MessageThread` row) is created.

## Access rules (not stored — evaluated per request)

| Actor                                        | Can view a thread?                                  | Can send in it?                                                     |
| --------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------- |
| The thread's `buyerId`                        | Yes, iff currently a member of the listing's community (FR-006, FR-009) | Yes, subject to the Message validation rules above |
| The thread's listing's `ownerId`               | Yes, iff currently a member of the listing's community (FR-005, FR-009) | Yes, subject to the Message validation rules above |
| Any other account, including a community administrator | No (FR-007, Clarifications) | No |

Membership is checked per-actor at the moment of the request, not cached from thread-creation time (research.md #3) — this is what makes FR-009's immediate revocation guarantee real.

## Prisma schema changes

Two new models, plus back-relations on the existing `Listing` and `Account` models (`threads`, `Listing`'s new relation; `messageThreadsAsBuyer`, `messagesSent`, `Account`'s new relations). No change to any existing column.

```prisma
model MessageThread {
  id            String   @id @default(cuid())
  listingId     String
  buyerId       String
  createdAt     DateTime @default(now())
  lastMessageAt DateTime @default(now()) // amendment: kept current by insertMessage()

  listing  Listing   @relation(fields: [listingId], references: [id], onDelete: Cascade)
  buyer    Account   @relation(fields: [buyerId], references: [id], onDelete: Cascade)
  messages Message[]

  @@unique([listingId, buyerId])
  @@index([buyerId])
  @@index([lastMessageAt])
  @@map("message_threads")
}

model Message {
  id        String   @id @default(cuid())
  threadId  String
  senderId  String
  body      String
  createdAt DateTime @default(now())

  thread MessageThread @relation(fields: [threadId], references: [id], onDelete: Cascade)
  sender Account       @relation(fields: [senderId], references: [id], onDelete: Cascade)

  @@index([threadId, createdAt])
  @@map("messages")
}
```

## Chats and My listings *(new — conceptual read shapes, amendment; not stored entities)*

**MyThreadsResult** (`listMyThreads(callerAccountId)`, FR-017–FR-020): a flat list, computed by one query, of every thread where `callerAccountId` is the thread's `buyerId` OR the thread's listing's `ownerId`, restricted to `listing.communityId IN (callerAccountId's current Membership community ids)`, ordered by `lastMessageAt` descending — all three (scope, membership restriction, order) expressed in the query itself, per spec.md's Assumptions. Each element carries: `id`, `communityId`, `communityName`, `listingId`, `listingTitle`, `role` (`"owner"` if `listing.ownerId === callerAccountId` else `"buyer"` — computed at read time, FR-019, never stored), `counterpartDisplayName`, `lastMessageAt`, `lastMessagePreview`. The Chats page groups this already-scoped, already-ordered array by `communityId` purely to render community sections (FR-018) — no additional filtering, re-sorting, or counting happens outside the query.

**MyListingsResult** (`listMyListings(callerAccountId)`, FR-021–FR-022): a flat list, computed by one query, of every `Listing` where `ownerId = callerAccountId`, restricted to `communityId IN (callerAccountId's current Membership community ids)`, in any `status`. Each element carries: `id`, `communityId`, `communityName`, `title`, `status`, `threadCount` (a Prisma `_count` aggregate on the `threads` relation — computed by the database, not by fetching threads and counting them in application code).

**Validation rules**: Neither function accepts any input beyond `callerAccountId` — there is no caller-suppliable filter to validate, since both are always "everything the caller is entitled to see," scoped entirely from their own session-verified identity (mirrors the two-query shape `getCurrentAccount()` already uses: fetch the caller's own current memberships, then filter by that set — never a second account's).

## Atomicity

Creating a new thread's first message is a single logical operation (create `MessageThread` + create its first `Message`) and MUST run inside one `prisma.$transaction` so a thread can never exist with zero messages, and a race between two rapid first-messages from the same buyer is resolved by the `@@unique([listingId, buyerId])` constraint (research.md #2) rather than left to an application-level check. Every subsequent reply is a single-row `Message` insert — no transaction needed. Listing deletion's cascade to `MessageThread`/`Message` is handled entirely by `onDelete: Cascade`, exactly as `deleteListing()` already relies on for `ListingPhoto` — no `$transaction` needed there either.

*(Amendment)* Every `Message` insert (both the new-thread and reply paths) is immediately followed by a `MessageThread.lastMessageAt` update to that message's own `createdAt`, inside the same `insertMessage()` helper — one write path keeps the two always in sync, so no separate "backfill" or "repair" step is ever needed.
