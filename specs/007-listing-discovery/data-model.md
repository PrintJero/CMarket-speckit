# Data Model: Listing Discovery

This feature adds no new entity and no new field. It extends how the existing `Listing` entity (005-product-listings, plus an already-shipped cover-photo/display-name amendment) is queried.

## Listing *(existing — extended with one index, no field change)*

| Field         | Type            | Notes                                                                                          |
| ------------- | --------------- | ------------------------------------------------------------------------------------------------ |
| `id`          | identifier      | Primary key — used as the deterministic pagination tie-breaker (research.md #1)                   |
| `communityId` | identifier (FK) | Every discovery query's mandatory scope (FR-001)                                                  |
| `ownerId`     | identifier (FK) | Unchanged — not queried by this feature                                                           |
| `title`       | string          | Searched via case-insensitive substring match (FR-004)                                            |
| `description` | string          | Searched via case-insensitive substring match (FR-004)                                            |
| `priceCents`  | integer         | Filtered via inclusive `gte`/`lte` range (FR-005)                                                  |
| `status`      | `ListingStatus` | Every discovery query filters to `ACTIVE` only (FR-002)                                           |
| `coverPhotoId`| identifier, optional (existing, from a separate amendment) | Passed through unchanged in discovery results — not searched/filtered on |
| `createdAt`   | timestamp       | Default sort key, newest-first (FR-003)                                                           |

**Schema change**: replace `@@index([communityId])` with `@@index([communityId, status, createdAt])` on `Listing` in `prisma/schema.prisma` (research.md #6) — a new migration, no new column, no data loss (the new index is a strict superset).

## DiscoveryQuery *(new — conceptual input shape, not a stored entity)*

The parameters a caller supplies to a discovery request. Never persisted (satisfies the "no saved searches" exclusion, FR-009).

| Field            | Type              | Notes                                                                                   |
| ---------------- | ----------------- | ------------------------------------------------------------------------------------------ |
| `communityId`    | identifier        | Required — the community to scope every other field to (FR-001)                        |
| `callerAccountId`| identifier        | Required — checked against `Membership` before any query runs (FR-001)                 |
| `search`         | string, optional  | Matched against `title` OR `description`, case-insensitive substring (FR-004); omitted/empty behaves as no search filter |
| `minPriceCents`  | integer, optional | Inclusive lower bound (FR-005)                                                          |
| `maxPriceCents`  | integer, optional | Inclusive upper bound (FR-005); MUST NOT be less than `minPriceCents` when both are present — rejected as `invalid_input` otherwise |
| `page`           | integer, optional | 1-based; defaults to `1`; values below `1` are clamped to `1`                            |
| `pageSize`       | integer, optional | Defaults to `DEFAULT_PAGE_SIZE` (20); clamped to a maximum of `MAX_PAGE_SIZE` (50), never rejected for being too large |

**Validation rules**:

- `communityId` MUST resolve to a `Membership` (any role) for `callerAccountId`, else `{ ok: false, reason: "not_a_member" }` — checked before any other validation or query (FR-001).
- `minPriceCents > maxPriceCents` (when both provided) → `{ ok: false, reason: "invalid_input" }`, no query executed (FR-005, Edge Cases).
- Every other combination of `search`/`minPriceCents`/`maxPriceCents`/`page`/`pageSize` is valid, including all-omitted (equivalent to an unfiltered, first-page browse) and any combination together (FR-006).

## DiscoveryResult *(new — conceptual output shape, not a stored entity)*

| Field      | Type       | Notes                                                                                     |
| ---------- | ---------- | -------------------------------------------------------------------------------------------- |
| `listings` | array      | Zero or more `ACTIVE` listings matching every supplied filter, for the current page only (FR-002, FR-007, FR-008). Each element keeps its existing `coverPhotoId`/`ownerDisplayName` fields (research.md #7) alongside the discovery-specific ones. |
| `page`     | integer    | The (clamped) page actually served                                                            |
| `pageSize` | integer    | The (clamped) page size actually applied                                                      |
| `hasMore`  | boolean    | Whether a subsequent page has at least one more matching listing (derived by requesting `pageSize + 1` rows in the same query and slicing to `pageSize` — no separate `COUNT(*)` query, research.md #1) |

**State transitions**: None — this feature is read-only over listings; it introduces no lifecycle of its own.

## Atomicity

Every discovery request is a single read-only `findMany` query (research.md #4) — no write, no multi-step operation, and therefore nothing to wrap in a transaction.
