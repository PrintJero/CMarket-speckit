# Data Model: Account Profile and Shared-Community Member Profiles

No new entity, no new column, no migration. Every field below is derived at request time from `Account`, `Membership`, `Listing`, `Transaction`, and `Review` — all reused unchanged from 002-013. This document describes the two response shapes `profileService.ts` assembles (`SelfProfileView`, `PublicProfileView`) and the access algorithm that decides a public profile's visibility.

## Current membership *(derived, not stored)*

Both views are built on the same primitive: for a given `accountId`, the set of communities it **currently** belongs to.

| Field | Derivation |
| --- | --- |
| `communityId` | `Membership.communityId` |
| `communityName` | `Membership.community.name` |
| `role` | `Membership.role` (`ADMINISTRATOR` \| `MEMBER`) |
| `memberSince` | `Membership.createdAt` |

**"Currently"**: a `Membership` row counts only when its own `operationalEpoch` equals its `Community`'s *current* `operationalEpoch` — the identical rule already independently implemented by `getCurrentAccount()`, `listMyListings()`, and `listMyThreads()` (009-platform-administration, research.md #8 there). A membership predating a community's most recent restoration does not count (spec.md Assumptions, Edge Cases).

## Self Profile View *(derived, not stored — `getSelfProfile(accountId)`'s response shape)*

| Field | Derivation | Notes |
| --- | --- | --- |
| `displayName` | `Account.displayName` | May be `null` (006-user-display-names placeholder rule applies in rendering, not here). |
| `email` | `Account.email` | **Only ever included here** — never on `PublicProfileView` (FR-008). |
| `accountCreatedAt` | `Account.createdAt` | (FR-002). |
| `averageRating`, `reviewCount` | `getReputationSummary(accountId)` (012, unchanged) | Global (FR-003, FR-018). |
| `completedTransactionCount` | `Transaction` rows where `accountId` is `buyerId` or `sellerId` and `state = "ACCEPTED"` | Global (FR-004, FR-018, FR-021) — identical query 012's prior `getProfile()` already used. |
| `communities` | One entry per **current** membership (see above), each carrying `communityId`, `communityName`, `role`, `memberSince`, and `listings` | Every current community, not filtered (FR-005, FR-026) — this is the one profile type with no shared-community restriction. |
| `communities[].listings` | `Listing` rows where `ownerId = accountId`, `communityId` = that entry's community, `status = "ACTIVE"`, current `operationalEpoch` | Both `kind`s (FR-006); each entry carries `id`, `title`, `kind`, `priceCents` (price or budget, per 011's existing convention), `stockQuantity`, `coverPhotoId` — no `status` field (FR-007). |

Never includes a password, password hash, session identifier, or authentication token (FR-009) — none of those columns exist on `Account` in the first place; this row simply confirms no such field is ever selected.

## Public Profile View *(derived, not stored — `getProfile(accountId, viewerAccountId)`'s response shape)*

| Field | Derivation | Notes |
| --- | --- | --- |
| `accountId` | The viewed account's id | |
| `displayName` | `Account.displayName` | May be `null`. |
| `averageRating`, `reviewCount` | `getReputationSummary(accountId)` | Global, identical to the self profile's own (FR-011, FR-018). |
| `completedTransactionCount` | Same global `ACCEPTED`-only count as the self profile | (FR-011, FR-021). |
| `communities` | One entry per community in `currentMemberships(viewerAccountId) ∩ currentMemberships(accountId)` | The intersection — never a superset, never anything supplied by the caller (FR-013, FR-014). |
| `communities[].communityId`, `.communityName` | From the intersected `Membership` | |
| `communities[].memberSince` | The **viewed account's own** `Membership.createdAt` for that community — not the viewer's | (FR-013). |
| `communities[].listings` | The viewed account's active `FOR_SALE`/`WANTED` listings in that one community, same shape as the self profile's | Scoped strictly to that shared community (FR-013, FR-016). |

Never includes email, phone, physical address, authentication data, an individual `Review` row, or any per-community reputation breakdown (FR-012, FR-019, FR-020) — the only reputation fields present are the three global aggregates above, identical in shape to the self profile's own.

**No non-shared community ever appears** — not its name, not its id, not a count of "N other communities," nothing (FR-015). The response's `communities` array simply has no entry for it; there is no separate "hidden count" field either, since spec.md's own Out of Scope list and FR-015 both treat even a bare count as unnecessary disclosure beyond what the feature calls for.

## Access algorithm (`getProfile(accountId, viewerAccountId)`)

1. Look up `Account.displayName` for `accountId`. If no such account exists, return `{ ok: false, reason: "not_found" }`.
2. Compute `currentMemberships(viewerAccountId)` and `currentMemberships(accountId)` (two independent queries, each using the "Current membership" definition above).
3. Compute `shared = communities present in both sets`. If `shared` is empty, return `{ ok: false, reason: "not_found" }` — **the same reason as step 1**, so a stranger cannot distinguish "this account doesn't exist" from "this account exists but shares nothing with me" (research.md #2).
4. Otherwise, assemble the `Public Profile View` above, scoped to exactly the communities in `shared`.

No step here consults the URL's own `communityId` path segment — it plays no role in this algorithm (research.md #1). The `communityId` gate present in 012's prior implementation (viewer must belong to that one specific community; target must too) is retired; its effect is fully subsumed by step 3's intersection check, which is strictly equivalent-or-broader in the cases that still succeed and strictly more correct in the case 012 got wrong (a target who left that one specific community but still shares a *different* one with the viewer).

## Self-profile assembly (`getSelfProfile(accountId)`)

No access gate beyond "this is the signed-in caller's own `accountId`," enforced by the route itself calling `getSelfProfile(currentAccount.accountId)` — never with a caller-supplied id. Assembles the `Self Profile View` above directly from `accountId`'s own current memberships (no intersection, no second account involved).

## Reused, unmodified

- **`getReputationSummary(accountId)`** (012, `reviewService.ts`) — called by both views, verbatim.
- **Global completed-transaction count query** — the exact `prisma.transaction.count(...)` shape 012's prior `getProfile()` already used, now shared by both views (previously only the public one had it).
- **`Listing`, `Transaction`, `Review`, `Membership`, `Account`, `Community` models** — no field added, no field removed, no migration.
