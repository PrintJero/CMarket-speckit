# Data Model: Wanted Posts

No new entity. `Listing` (005-product-listings) is extended in place; `ListingPhoto`, `MessageThread`, `Message`, `Account`, `Community`, `Membership` are referenced, not modified (spec.md Key Entities).

## `Listing` *(extended)*

| Field | Type | Notes |
| --- | --- | --- |
| `kind` *(new)* | enum `ListingKind` | `FOR_SALE` (default) or `WANTED`. Set once at creation (research.md #5); no route or function can change it afterward. |
| `priceCents` *(changed: `Int` → `Int?`)* | integer, nullable | Required and validated at creation when `kind = FOR_SALE` (unchanged rule from 005). Optional — a budget ceiling — when `kind = WANTED`; if present, still validated as a non-negative integer by the same `isValidPriceCents()` check. |
| `status` *(existing enum, gains one value)* | enum `ListingStatus` | `ACTIVE` \| `PAUSED` \| `FULFILLED` *(new)*. `FULFILLED` is reachable only when `kind = WANTED` (FR-005) and only by the owner, in either direction (research.md #3). |
| every other field | unchanged | `id`, `communityId`, `ownerId`, `title`, `description`, `coverPhotoId`, `createdAt`, `updatedAt`, `operationalEpoch` — no change. |

**New enum**:

```prisma
enum ListingKind {
  FOR_SALE
  WANTED
}
```

**Migration note**: `priceCents` drops its `NOT NULL` constraint; every existing row already has a non-null value, so no backfill is needed for that column. `kind` is added `NOT NULL DEFAULT 'FOR_SALE'`, so every existing row backfills automatically with no data loss and no behavior change (research.md #1).

## Creation gates (`createListing`, extended)

1. `title`/`description` MUST be non-blank — unchanged.
2. If `kind = FOR_SALE` (the default when omitted): `priceCents` MUST be present and a valid non-negative integer — unchanged rule, `invalid_input` otherwise.
3. If `kind = WANTED`: `priceCents` MAY be omitted; if present, MUST be a valid non-negative integer — `invalid_input` otherwise.
4. Membership/display-name gates — unchanged from 005.

## Status-transition gates (extended)

| Function | Who | Precondition on current status | Effect |
| --- | --- | --- | --- |
| `pauseListing()` | Owner, or that community's administrator | Current status MUST NOT be `FULFILLED` unless caller is the owner (research.md #3) | → `PAUSED` |
| `reactivateListing()` | Owner, or that community's administrator | Current status MUST NOT be `FULFILLED` unless caller is the owner (research.md #3) | → `ACTIVE` |
| `fulfillListing()` *(new)* | Owner only — never an administrator | `kind` MUST be `WANTED` (`not_a_wanted_post` otherwise) | → `FULFILLED` |

All three are idempotent by construction (setting a status a listing is already in is a no-op, unchanged from 005) and require the community to allow existing-content actions (`communityAllowsExistingContent()`, unchanged).

## Discovery (`listListings`, extended)

- `ListListingsOptions` gains `kind?: "FOR_SALE" | "WANTED"`. Added to the same `where` clause carrying `communityId`, `status: "ACTIVE"`, keyword search, and price range (research.md #4) — never a second query.
- Every returned row now also carries `kind` and a nullable `priceCents`, so the feed/detail UI can render the correct label and price-or-budget text.
- Omitting `kind` returns both kinds, interleaved, in the same newest-first order already established by 007 — no ordering change.

## Access rules (unchanged from 005/007/008)

| Actor | Create | View/search (own community) | Pause/Reactivate (status ≠ FULFILLED) | Pause/Reactivate (status = FULFILLED) | Fulfill/Un-fulfill | Edit content | Delete |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Owner | Yes (any kind) | Yes | Yes | Yes | Yes (WANTED only) | Yes | Yes |
| That community's administrator | N/A | Yes | Yes | **No** *(new)* | **No** *(new)* | No | No |
| Any other account | No | No | No | No | No | No | No |

## Prisma schema changes

```prisma
enum ListingKind {
  FOR_SALE
  WANTED
}

enum ListingStatus {
  ACTIVE
  PAUSED
  FULFILLED
}

model Listing {
  id            String        @id @default(cuid())
  communityId   String
  ownerId       String
  title         String
  description   String
  priceCents    Int?
  kind          ListingKind   @default(FOR_SALE)
  status        ListingStatus @default(ACTIVE)
  coverPhotoId  String?       @unique
  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt
  operationalEpoch Int        @default(1)

  community  Community      @relation(fields: [communityId], references: [id], onDelete: Cascade)
  owner      Account        @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  photos     ListingPhoto[] @relation("ListingPhotos")
  coverPhoto ListingPhoto?  @relation("ListingCoverPhoto", fields: [coverPhotoId], references: [id], onDelete: SetNull)
  threads    MessageThread[]

  @@index([communityId, status, createdAt])
  @@index([communityId, kind, status, createdAt])
  @@index([ownerId])
  @@map("listings")
}
```

The new composite index `[communityId, kind, status, createdAt]` supports the new `kind`-filtered feed query at the same performance characteristics as the existing unfiltered one; the original `[communityId, status, createdAt]` index is retained since the unfiltered (both-kinds) feed query still uses it.

## Atomicity

No new multi-step write is introduced. `createListing()` remains a single `create` call; `pauseListing()`/`reactivateListing()`/`fulfillListing()` each remain a single `update` call, guarded by the read-then-check pattern already established (not a race risk, since only the acting account's own authorization is being checked, mirroring 005's existing `pauseListing()`/`reactivateListing()`).
