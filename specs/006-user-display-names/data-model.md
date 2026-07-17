# Data Model: User Display Names

Derived from [spec.md](./spec.md) Key Entities and Functional Requirements, and [research.md](./research.md) decisions.

## Account *(existing, from 002-accounts-authentication — extended by this feature)*

Gains exactly one new attribute.

| Field         | Type      | Notes                                                                                          |
| ------------- | --------- | ------------------------------------------------------------------------------------------------ |
| `displayName` | `String?` | Absent (`null`) by default. Never unique, never verified/moderated (FR-003). Max 50 characters after trimming (FR-012). |

**Validation rules**:

- `displayName`, wherever submitted, MUST be non-blank after trimming leading/trailing whitespace and MUST NOT exceed 50 characters (FR-012); a blank or whitespace-only submission is rejected, never stored as an empty string (Edge Cases).
- Only the account identified by the caller's own session may have its `displayName` written — the write path (research.md #5) never accepts a target account id from the client, so this holds by construction, not by a permission check that could be bypassed (FR-002).
- Population from a federated (Google) sign-in is conditional on the account not already having a `displayName` (FR-005/FR-006) and on the provider having supplied a name at all (FR-004) — see research.md #1 for exactly where this write happens.
- `displayName` is never renamed to reflect a specific community; it is read identically regardless of which community's context it is being shown within (FR-014).

**Who may read it**: any signed-in account (its own value, via `getCurrentAccount()`/the account settings page) and — via the derived, resolved form only (never the raw email as a substitute) — any fellow member of a community the account belongs to, wherever that account is shown to them (FR-009–FR-011).

## Derived data: resolved display name (not a stored value)

Nothing new is stored beyond `Account.displayName` itself. Two service functions already returning listing data are extended to also return the owner's raw, possibly-`null` `displayName` (`ownerDisplayName`), exactly the same shape as the existing `coverPhotoId: string | null` precedent (005):

- `listListings()` — each returned listing gains `ownerDisplayName: string | null`.
- `getListing()` — the returned listing gains `ownerDisplayName: string | null`.

Presentation (the placeholder for `null`) is resolved at render time by a shared helper (research.md #4), never inside these service functions — keeping the service's contract about data, not presentation, consistent with `coverPhotoId`.

## Community *(existing, from 003-community-creation — unaffected)*

Unaffected by this feature.

## Membership *(existing, from 003/004 — unaffected)*

Unaffected by this feature. In particular, the community-administrator member list (spec 004) continues reading `Account.email` for its own administrator-only view — this feature adds a column to no existing query there and does not touch that page (FR-015).

## Listing / ListingPhoto *(existing, from 005-product-listings — unaffected structurally)*

No new or changed fields. `createListing()` gains one additional precondition (research.md #3): it is rejected with `{ ok: false, reason: "display_name_required" }` when the calling account's `Account.displayName` is `null`, regardless of any other input — enforced before a `Listing` row is created, not after.

## Atomicity

- Setting `Account.displayName` (via the account-settings endpoint) is a single-row `update` keyed by `id` — no `$transaction` required, matching this schema's other single-column account updates (e.g., `emailVerifiedAt`).
- The federated-sign-in population (research.md #1) is a single-row conditional `update` (`WHERE id = ... AND displayName IS NULL`) performed inside the `events.linkAccount` hook, guarding against a theoretical double-fire the same way `linkAccount`'s existing FR-018 logic already guards its own writes — not a new atomicity concern this feature introduces.
- `createListing()`'s new precondition is a read-then-branch check on the already-loaded caller `Account` row within the same function call that performs the existing membership check — no additional query beyond what already runs to look up the caller's own account for other purposes in this flow.
