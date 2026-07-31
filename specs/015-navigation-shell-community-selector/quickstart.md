# Quickstart: Navigation Shell and Community Selector

Validates the feature end-to-end once implemented. See [data-model.md](./data-model.md) for the schema and [contracts/navigation-shell-api.md](./contracts/navigation-shell-api.md) for the routes.

## Prerequisites

- PostgreSQL running and migrated with this feature's Prisma schema change (`prisma migrate deploy`) — adds `Session.activeCommunityId` (nullable FK to `Community`); no new table.
- Two communities, A and B, each with at least one `FOR_SALE` listing and one `WANTED` post owned by different members. A member M belongs to both A and B; a member N belongs to only A.

## Scenario 1 — First sign-in of a session shows the selector (Story 1)

1. Sign in as M (fresh session).
   - Expect a community-selection screen listing exactly A and B — nothing else, no browse/directory/join control anywhere on it.
2. Select A.
   - Expect to land on A's main view (`GET /communities/{A}`), search bar and A's own "For sale" feed visible.
3. Sign in as N (fresh session).
   - Expect the selection screen to list exactly A (N's only membership) — not skipped automatically (FR-005).

## Scenario 2 — Zero-membership empty state (Story 1, Principle I)

1. Sign in as a member of zero communities.
   - Expect the defined empty state ("you don't belong to any community yet") — never an error, and no directory/browse/join control anywhere on the screen (FR-004/SC-002).

## Scenario 3 — Returning to the entry point remembers the active community (Story 1, FR-001a/SC-001a)

1. As M (still signed in from Scenario 1, active community A), navigate to `/` again (e.g. click the CMarket wordmark).
   - Expect to land directly back on A's main view — the selection screen is not shown again.
2. Sign out, then sign back in as M.
   - Expect the selection screen to appear again (a new session has no remembered active community, FR-001/Assumptions).

## Scenario 4 — Community isolation across the switch (Story 3 — REQUIRED automated coverage)

1. As M with A active, search, view the feed, and toggle to "Wanted."
   - Expect every result to belong to A only — never any of B's listings/wanted posts, even though M belongs to both.
2. As M, switch the active community to B via the sidebar (Story 4).
   - Expect the search term and prior results to reset (FR-008); the feed, search, and toggle now return only B's data.
3. As N (member of A only), repeat the search/feed/toggle checks.
   - Expect results scoped to A even though no other community exists to leak from (FR-009's guarantee is explicit, not incidental).

## Scenario 5 — Sidebar switcher (Story 4)

1. As M with A active, tap the active community's name in the sidebar.
   - Expect exactly B to appear in the revealed list (A itself is excluded, FR-013).
2. Select B.
   - Expect B to become active and the main view to now show B's data (FR-014).
3. As N (member of A only), view the sidebar's active-community control.
   - Expect it to indicate there is nothing else to switch to, rather than a broken or silently empty expansion (FR-015).

## Scenario 6 — Consolidated navigation, unchanged surfaces (Story 5)

1. From any screen, open Chats, My listings, Transactions, and Account from the sidebar.
   - Expect each to reach its existing, unmodified surface (008/005/013/006+002) — same behavior as before this feature.
2. Use "Sign out."
   - Expect the session to end exactly as it does today.

## Scenario 7 — Admin entry point (Story 6, Principle VI)

1. As an administrator of A (and not of B), with A active, view the sidebar.
   - Expect exactly one "Admin" entry directly above "Account."
2. Switch the active community to B (which this member does not administer).
   - Expect the "Admin" entry to disappear.
3. Inspect the Admin entry itself.
   - Expect it to expose no member's contact data, chat content, or transaction detail — it is a link only (FR-021).

## Scenario 8 — Trust-visible cards (design direction, Mandate #2)

1. As any member viewing a community's main view, inspect a listing card whose owner has prior reviews.
   - Expect the card to show the owner's display name, a "verified member" badge (current membership in the active community, not merely historical), and their rating/review count sourced from `getReputationSummaries()` (research.md #2) — never mocked, never contact data.
2. Inspect a card whose owner has zero reviews.
   - Expect the reputation area to render as "no reviews yet" (or omitted), never a misleading "0 stars."
