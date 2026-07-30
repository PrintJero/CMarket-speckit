# Data Model: User Profiles and Reputation

One new entity, `Review`. No existing entity gains a new field (`Account`, `Community`, `Membership`, `Listing`, `Transaction` are referenced, not modified — spec.md Key Entities). `Account` and `Transaction` gain new back-relations only, to support `Review`'s own required foreign keys.

## Review *(new)*

A single 1-5 star rating one participant of a `CONFIRMED` transaction leaves about the other (FR-010, FR-012). No written comment or other free-text field exists (FR-021, Clarifications). Immutable once created (FR-022) — no function in `reviewService.ts` updates or deletes a row.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | identifier | Primary key. |
| `reviewerId` | identifier (FK → `Account`) | The account that created this rating. |
| `reviewedId` | identifier (FK → `Account`) | The other participant of `transactionId`, derived server-side (research.md #3) — never client-supplied. |
| `transactionId` | identifier (FK → `Transaction`) | The `CONFIRMED` transaction this rating is about (FR-012). Real relation — `Transaction` rows are never deleted (010-transaction-logging). |
| `rating` | integer | 1 through 5 inclusive (FR-020); validated in application code (mirrors `listingService.ts`'s `isValidPriceCents()` pattern), not a database `CHECK` constraint. |
| `createdAt` | timestamp | Set once at creation; one of the immutable core facts. |

**Deliberately absent** (research.md #2, #8): no `communityId` column, no relation to `Community`, no `operationalEpoch`. Community only matters transiently at creation time (the live co-membership gates below), derived by joining through `transactionId → Transaction.communityId`; nothing about community is ever stored on the row itself, so nothing about it can later leak (FR-011).

**Constraints**:

- `@@unique([reviewerId, transactionId])` — enforces FR-017 (at most one rating per reviewer per transaction) at the database level; `createReview()` still checks for an existing row first (mirrors `messageService.ts`'s existing `listingId_buyerId` check-then-create pattern for `MessageThread`) and treats the constraint itself as a backstop, not a specially-caught race path.
- `@@index([reviewedId])` — supports `getReputationSummary()`'s aggregate query (research.md #5).

**Lifecycle**: Created once by `createReview()`. Never updated, never deleted, by any user action or by an administrator (FR-022). A transaction may accumulate up to two `Review` rows total — one per participant — created independently of each other (FR-016, FR-018).

## Reputation summary *(derived, not stored)*

`getReputationSummary(accountId)` computes, fresh on every call:

| Field | Derivation |
| --- | --- |
| `averageRating` | `number \| null` — the mean of `rating` across every `Review` where `reviewedId = accountId`, across every community (research.md #5); `null` when the account has received none yet (FR-002 Acceptance Scenario 3). Never stored on `Account` (FR-023). |
| `reviewCount` | The count of those same rows (FR-024). Never stored on `Account`. |

Both numbers are global by design (Clarifications) — no `communityId` filter is ever applied (research.md #5).

## Profile *(derived, not stored — the response shape `getProfile()` assembles)*

| Field | Derivation | Scope |
| --- | --- | --- |
| `displayName` | `Account.displayName` | Identity, not community-scoped. |
| `memberSince` | `Membership.createdAt` for `(accountId, communityId)` | Scoped to the community being viewed (FR-007, research.md #1). |
| `activeListings` | `Listing` rows where `ownerId = accountId`, `communityId` = the viewed community, `status = "ACTIVE"`, current `operationalEpoch` | Scoped to the community being viewed (FR-007). Either `kind` (005/011), each labeled exactly as the community's own feed labels it. |
| `confirmedTransactionCount` | Count of `Transaction` rows where `accountId` is `recorderId` or `counterpartId` and `confirmationState = "CONFIRMED"` | **Global** (FR-009, Clarifications) — no `communityId` filter. |
| `averageRating`, `reviewCount` | `getReputationSummary(accountId)` (above) | **Global** (FR-008, Clarifications). |

No field here is a list of individual `Review` rows (FR-010) — only the two aggregate numbers ever reach a profile response.

## Creation gates (`createReview(communityId, transactionId, reviewerAccountId, rating)` — all MUST hold, in this order, no row persisted if any fails)

1. `rating` MUST be an integer from 1 to 5 inclusive (FR-020) — otherwise `invalid_rating`. Checked first; no database access needed to fail this case.
2. `reviewerAccountId` MUST currently hold membership in `communityId`, `SUSPENDED` tolerated (research.md #4) — otherwise `not_a_member`.
3. `transactionId` MUST resolve to an existing `Transaction` whose `communityId` matches — otherwise `not_found`.
4. `reviewerAccountId` MUST be either that transaction's `recorderId` or `counterpartId` — otherwise `not_a_participant` (FR-015). The reviewed account is whichever one `reviewerAccountId` is not (research.md #3) — structurally never equal to the reviewer (FR-016 is therefore a consequence of this derivation, not a separate runtime branch).
5. The transaction's `confirmationState` MUST currently be `CONFIRMED` — otherwise `transaction_not_confirmed` (FR-014).
6. The derived reviewed account MUST currently hold membership in `communityId`, `SUSPENDED` tolerated (research.md #4) — otherwise `reviewed_not_a_member` (mirrors 010's distinct `counterpart_not_a_member` reason, FR-019).
7. No existing `Review` row for `(reviewerAccountId, transactionId)` — otherwise `duplicate_review`, and the existing row is left untouched (FR-017).

## Profile-access gates (`getProfile(communityId, accountId, viewerAccountId)` — all MUST hold, no data returned if any fails)

1. `viewerAccountId` MUST currently hold membership in `communityId` — otherwise `not_a_member` (FR-006).
2. `accountId` MUST currently hold membership in `communityId` — otherwise `not_found` (research.md #1; this is a refinement over spec.md's initial edge-case wording, forced by `Membership` having no soft-delete column to source a member-since date from once a row is gone).

Both checks use the existing `requireCommunityMembership()` (005-product-listings) unchanged; no new authorization primitive is introduced.

## Access rules (not stored — evaluated per request)

| Actor | Can view a profile? | Can create a rating? |
| --- | --- | --- |
| Any current co-member of the community being viewed, viewing another current co-member's profile | Yes | N/A (viewing, not rating) |
| Either participant of a `CONFIRMED` transaction, currently a co-member of its community | N/A | Yes, once, for the other participant (FR-010, FR-017) |
| The same participant, a second time for the same transaction | N/A | No — `duplicate_review` |
| A third account, not a participant of the transaction | N/A | No — `not_a_participant` |
| Either party once the transaction is `UNCONFIRMED` | N/A | No — `transaction_not_confirmed` |
| A community administrator, viewing/rating outside their own participation | Same as any other current co-member — no extra authority | Same as any other non-participant — no extra authority |
| A MASTER platform operator | No special access — holds no community `Membership` (Constitution Principle IX) | No special access |

## Prisma schema changes

One new model, plus back-relations on the existing `Account` and `Transaction` models. No change to any existing column.

```prisma
/// A single 1-5 star rating one participant of a CONFIRMED transaction
/// (010-transaction-logging) leaves about the other (012-profiles-reputation).
/// No comment/free-text field (FR-021). No communityId — reputation is
/// computed globally and must never disclose which community a rating came
/// from (FR-011, research.md #2); community only matters transiently at
/// creation, derived through transactionId.
model Review {
  id            String   @id @default(cuid())
  reviewerId    String
  reviewedId    String
  transactionId String
  rating        Int
  createdAt     DateTime @default(now())

  reviewer    Account     @relation("ReviewsWritten", fields: [reviewerId], references: [id], onDelete: Cascade)
  reviewed    Account     @relation("ReviewsReceived", fields: [reviewedId], references: [id], onDelete: Cascade)
  transaction Transaction @relation(fields: [transactionId], references: [id], onDelete: Cascade)

  @@unique([reviewerId, transactionId])
  @@index([reviewedId])
  @@map("reviews")
}
```

`Account` gains:

```prisma
reviewsWritten  Review[] @relation("ReviewsWritten")
reviewsReceived Review[] @relation("ReviewsReceived")
```

`Transaction` gains:

```prisma
reviews Review[]
```

*Note*: `onDelete: Cascade` on all three relations is Prisma's required-relation default and is never actually exercised in practice — `Account` rows are soft-deleted (`deletedAt`), never hard-deleted, and `Transaction` rows are retained forever (010-transaction-logging). It is declared only because Prisma requires an explicit `onDelete` action on a required relation, mirroring the exact same rationale already documented for `Transaction`'s own relations (010, data-model.md).

## Atomicity

Creating a `Review` is a single-row insert — no `$transaction` needed, mirroring `Transaction`'s own creation (010, data-model.md). The `@@unique([reviewerId, transactionId])` constraint is the backstop against a genuine race between two concurrent identical requests; `createReview()`'s own check-then-create is not itself race-proof, exactly like `sendMessageToListingOwner()`'s existing `listingId_buyerId` check for a `MessageThread`'s first message (008-listing-messaging) — consistent with, not a regression from, this codebase's existing standard for this shape of uniqueness guarantee.

`getReputationSummary()` and the confirmed-transaction count are both read-only aggregate queries; no write path touches them (FR-023, FR-024) — they are recomputed from `Review`/`Transaction` on every `getProfile()` call, never cached.
