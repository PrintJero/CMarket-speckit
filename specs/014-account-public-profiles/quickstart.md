# Quickstart: Account Profile and Shared-Community Member Profiles

Validates the feature end-to-end once implemented. See [data-model.md](./data-model.md) for the response shapes and [contracts/account-profiles-api.md](./contracts/account-profiles-api.md) for the routes. No migration is required — this feature ships with zero schema changes.

## Prerequisites

- Three communities, C, D, and E.
- Account O is a current member of C and D (not E).
- Account V ("viewer") is a current member of C and D as well (the same two O belongs to) — plus E, which O does not belong to.
- Account X is a current member of E only — no community in common with O.
- O owns at least one active `FOR_SALE` listing in C and one active `WANTED` post in D.
- At least one `ACCEPTED` transaction (013-purchase-flow-stock) involving O, and a separate one involving O in a different community, so O's completed-transaction count is provably global (≥ 2).

## Scenario 1 — Self profile via "Account" (User Story 1)

1. Sign in as O and click "Account" in the navigation.
   - Expect O's own display name, email address, account creation date, global average rating, global rating count, and global completed-transaction count.
   - Expect a section for both C and D, each showing that community's name, O's role there, O's member-since date, and O's own active listings in it (the `FOR_SALE` listing in C, the `WANTED` post in D).
   - Expect no password, session token, or other authentication-internal data anywhere on the page or its underlying data.
2. Click C's community name.
   - Expect navigation to C's listings feed.
3. Click O's own listing card shown in C's section.
   - Expect navigation to that listing's detail page.
4. Sign in as a brand-new account with no memberships and open "Account."
   - Expect the page to render normally with a defined empty state for communities/listings — no error.

## Scenario 2 — Public profile aggregates every shared community (User Story 2)

1. Sign in as V. From a listing, thread, or transaction where O is the counterpart, click O's display name.
   - Expect O's display name, global average rating, global rating count, and global completed-transaction count.
   - Expect **two** community sections — C and D — each with O's member-since date there and O's active listings there.
   - Expect community E to be named nowhere on the page or in the underlying API response — not its name, not a count, not an id.
2. Click C's community name from O's profile.
   - Expect navigation to C's listings feed.
3. Click one of O's listing cards shown in C's section.
   - Expect navigation to that listing's detail page.
4. Inspect a shared community's section where O happens to own no active listings there.
   - Expect a defined empty state for listings, not an error and not an omitted section.

## Scenario 3 — No shared community means no profile (User Story 2, FR-017)

1. Sign in as X (shares nothing with O) and call `GET /api/communities/{any-community-id}/members/{O's accountId}` directly.
   - Expect `404 Not Found`, body `{ "ok": false, "reason": "not_found" }` — no display name, no reputation numbers, nothing.
2. Call the same route for an `accountId` that does not exist at all.
   - Expect the identical `404`/`not_found` response as step 1 — a caller cannot tell the two cases apart (research.md #2).

## Scenario 4 — Reaching a profile from every surface (User Story 3)

1. From a listing owned by O (in a community V shares with O), click O's display name.
   - Expect O's shared-community profile (Scenario 2's view) to open.
2. From a chat thread with O, click O's display name.
   - Expect the same profile to open.
3. From the Transactions page's Buying or Selling row naming O as the counterpart, click O's display name.
   - Expect the same profile to open.

## Scenario 5 — Reputation stays global and unbroken-down (unchanged from 012)

1. As V, on O's profile, confirm the average rating, rating count, and completed-transaction count include O's activity from every community O belongs to (C, D, and any other), not only the ones V shares with O.
2. Confirm nothing on the page or in the underlying response reveals which community contributed which rating, or lists an individual `Review` row.

## Scenario 6 — Viewing your own public-profile link (Edge Case)

1. Sign in as O and open O's own public-profile link (e.g., as it would appear from O's own transaction with someone else).
   - Expect the identical shared-community aggregation logic to apply (trivially, every one of O's own current communities is "shared" with themselves) — and expect no email address to appear, since this is the public-profile code path, not "Account."

## Scenario 7 — No contact data, ever (Principle VI)

1. As any account, inspect every response from both routes in this feature.
   - Expect no field anywhere containing another account's email address, phone number, physical address, or authentication data.
   - Expect the self-profile response to contain the caller's *own* email — and never another account's.

## Scenario 8 — Automated test suite

1. Run `npm run test:unit` — Vitest contract tests covering `profileService.ts`'s rewritten `getProfile()` (intersection with one shared community, several, zero, self-viewing-self) and new `getSelfProfile()` (own email/creation date/role/all current communities, never another account's email), alongside the full existing 002-013 contract suite unmodified.
2. Run `npm run test:e2e` — Playwright specs driving the self-profile page, the multi-community public profile, clickable community names and listing cards, and the zero-shared-community rejection, alongside the full existing suite (no regressions beyond this feature's own intentionally-changed `404` vs. `403` behavior, documented in contracts/account-profiles-api.md).
