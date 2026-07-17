# Data Model: Product Listings

Derived from [spec.md](./spec.md) Key Entities and Functional Requirements, and [research.md](./research.md) decisions.

## ListingStatus (enum) — *new*

- `ACTIVE` — visible in the community's listing feed, the default on creation (FR-005).
- `PAUSED` — hidden from the community's listing feed; set by the owner or that community's administrator (FR-007, FR-009).

A native Prisma/Postgres enum (project convention, e.g. `MembershipRole`) — never a bare boolean or free-text string (FR-004).

## Listing *(new)*

A product offered for sale within exactly one `Community` (research.md #3, #5).

| Field         | Type            | Notes                                                                                          |
| ------------- | --------------- | ------------------------------------------------------------------------------------------------ |
| `id`          | identifier      | Primary key                                                                                       |
| `communityId` | identifier (FK → Community) | Required, immutable — a listing never moves between communities (FR-001, FR-011)      |
| `ownerId`     | identifier (FK → Account)   | The account that created it; only this account (or, for pause/reactivate only, that community's administrator) may act on it (FR-006–FR-010) |
| `title`       | string          | Required (FR-002)                                                                                 |
| `description` | string          | Required (FR-002)                                                                                 |
| `priceCents`  | integer         | Required; a simple fixed amount in the smallest currency unit — no scheduling/dynamic adjustment (FR-002, FR-013) |
| `status`      | `ListingStatus` | Defaults to `ACTIVE` on creation (FR-005)                                                          |
| `createdAt`   | timestamp       |                                                                                                     |
| `updatedAt`   | timestamp       | Updated on every edit/pause/reactivate                                                            |

**Validation rules**:

- `communityId` MUST reference an existing `Community` and MUST NEVER change after creation (FR-001, FR-011).
- Creation requires the caller to hold a `Membership` (any role) in `communityId` — checked via `requireCommunityMembership()` before any write (FR-001, Edge Cases).
- `title`, `description` MUST be non-blank; `priceCents` MUST be a non-negative integer (FR-002).
- Editing title/description/price is permitted only for `ownerId` (FR-006, FR-010) — regardless of `status`.
- Pausing/reactivating (`status` transition) is permitted for `ownerId` OR the administrator of `communityId` (FR-007, FR-009, FR-010) — both converge on the same target status idempotently (research.md #3).
- Deletion is permitted only for `ownerId` (FR-008, FR-010) — never by an administrator, even of the same community.
- Every read (single listing, or a community's listing feed) MUST be scoped by `communityId` and MUST require the caller to hold a `Membership` (any role) in that community (FR-011, FR-012).

**State transitions**: `ACTIVE ⇄ PAUSED` (owner or that community's administrator, either direction, idempotent no-op if already in the target state) → terminal `deleted` (owner only, hard delete, cascades to `ListingPhoto`; not a `status` value — see research.md #3).

## ListingPhoto *(new)*

An image attached to exactly one `Listing` (FR-003).

| Field        | Type       | Notes                                                                 |
| ------------ | ---------- | ---------------------------------------------------------------------- |
| `id`         | identifier | Primary key                                                             |
| `listingId`  | identifier (FK → Listing) | Required; cascades on `Listing` deletion (FR-008, SC-006)  |
| `data`       | bytes      | Raw image bytes (research.md #1) — never exposed directly, only streamed via the photo route |
| `mimeType`   | string     | One of `image/jpeg`, `image/png`, `image/webp` (research.md #1)          |
| `sizeBytes`  | integer    | ≤ 5,242,880 (5MB) — enforced at upload, not just documented (research.md #1) |
| `position`   | integer    | Display order among a listing's photos, 0-based                         |
| `createdAt`  | timestamp  |                                                                          |

**Validation rules**:

- A `Listing` MAY have zero photos at any time (FR-003, Edge Cases) — no minimum enforced.
- A `Listing` MUST NOT exceed 6 photos; an attempt to add a 7th MUST be rejected with a clear error (research.md #1).
- Adding a photo is permitted only for the listing's `ownerId` (FR-006) — same authorization as editing other fields.
- Removing a photo is permitted only for the listing's `ownerId`. Removal leaves a gap in `position` for the remaining photos — positions are never renumbered; display order sorts by `position` ascending and values need not be contiguous.
- Deleting a `Listing` cascades to delete all its `ListingPhoto` rows (`onDelete: Cascade`) — zero orphaned rows (FR-008, SC-006).

## Community *(existing, from 003-community-creation — referenced, not modified)*

The tenancy every `Listing` and its photos belong to. This feature never creates, renames, or deletes a `Community` row.

## Account *(existing, from 002-accounts-authentication — referenced, not modified)*

The identity that owns a `Listing`. This feature never creates, modifies, or deletes an `Account` row.

## Membership *(existing, from 003/004 — referenced, not modified)*

Determines who may view/create a listing in a community (any role, via `requireCommunityMembership()`) and who may moderate one (`ADMINISTRATOR` role only, own community only, via the existing `requireCommunityAdministrator()` from 004-invitations-membership).

## Atomicity

Unlike 004's invitation-consumption and last-admin-count operations, no operation in this feature has a concurrent-race safety property to prove (research.md #3) — every write here is a single-row `update`/`create`/`delete` keyed by `id`, requiring no `prisma.$transaction` wrapping. The one multi-row effect (deleting a `Listing`'s photos) is handled by the schema's own `onDelete: Cascade`, not application-level transaction logic.
