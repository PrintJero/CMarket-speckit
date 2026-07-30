# Quickstart: User Profiles and Reputation

Validates the feature end-to-end once implemented. See [data-model.md](./data-model.md) for the schema and [contracts/profiles-reputation-api.md](./contracts/profiles-reputation-api.md) for the two routes.

## Prerequisites

- PostgreSQL running and migrated with this feature's Prisma schema change (`prisma migrate deploy`) — adds the `reviews` table, no existing table altered.
- Two communities, C and D. Account O is a current member of both. Account B is a current member of C only.
- At least one `CONFIRMED` transaction (010-transaction-logging) between O and B in community C, and a separate `CONFIRMED` transaction between O and a third account in community D.

## Scenario 1 — View a member's profile (Story 1)

1. Sign in as B. From the listing, thread, or transaction O and B share in community C, open O's profile.
   - Expect O's display name, member-since date for C, and O's active listings in C.
   - Expect no email address, phone number, physical address, or authentication data anywhere in the page or its underlying response.
2. As B, inspect O's profile when O owns no active listings in C.
   - Expect a defined empty state for listings, not an error.

## Scenario 2 — Leave a rating after a confirmed transaction (Story 2)

1. Sign in as either O or B on their shared `CONFIRMED` transaction in C. Submit a rating of 1-5.
   - Expect a `Review` to be created naming the submitter as reviewer, the other as reviewed, referencing that transaction.
   - Expect the reviewed account's profile (Scenario 1) to immediately reflect the new rating in its average and count.
2. As the other party, independently submit their own rating on the same transaction.
   - Expect a second, separate `Review` — neither blocks nor requires the other.
3. Attempt to submit a rating that is not a whole number from 1 to 5.
   - Expect `400 invalid_rating`, no `Review` created.
4. Inspect the API contract directly for any edit/delete route on a `Review`.
   - Expect none to exist at all (FR-022).

## Scenario 3 — Fraudulent reputation is rejected (Story 3)

1. As a third account, C, not a participant of O and B's transaction, attempt to submit a rating for it.
   - Expect `403 not_a_participant`, no `Review` created.
2. On a transaction still `UNCONFIRMED`, attempt a rating from either participant.
   - Expect `409 transaction_not_confirmed`.
3. Having already rated a transaction once, attempt to rate the same transaction again as the same reviewer.
   - Expect `409 duplicate_review`, the existing `Review` unchanged.
4. Remove B's membership in C, then attempt a new rating naming B (from either side) on a transaction in C.
   - Expect `409 reviewed_not_a_member` (if B is the derived reviewed account) or `403 not_a_member` (if B is the caller) — no `Review` created.

## Scenario 4 — Global reputation, never broken down by community (Story 4)

1. As B (a member of C only, not D), open O's profile from community C.
   - Expect the confirmed-transaction count, average rating, and review count to include O's activity from **both** C and D.
   - Expect nothing on the page or in the underlying API response to name, list, or otherwise reveal that community D exists or contributed to those numbers.
2. As an account with no ratings received anywhere, open its own profile.
   - Expect a defined neutral state (e.g., "No ratings yet"), never an error or a misleading zero.

## Scenario 5 — A profile requires current co-membership on both sides (research.md #1)

1. Remove B's membership in C entirely, then have O (still a member of C) attempt to open B's profile from C.
   - Expect `404 not_found` — B's `Membership` row for C no longer exists, so there is no member-since date to render.
2. As B (no longer a member of C), attempt to open O's profile from C.
   - Expect `403 not_a_member`.

## Scenario 6 — Display names are clickable from every surface named in FR-005

1. From a listing's feed card and detail page, click the owner's display name.
   - Expect navigation to that owner's profile, scoped to the listing's own community.
2. From a message thread (the counterpart's name and, for a specific message, its sender's name), a thread-list row, and the standalone `/chats` view, click a display name.
   - Expect navigation to that person's profile, scoped to that thread's own community.
3. From a transaction's list row and detail page, click the counterpart's display name.
   - Expect navigation to that person's profile, scoped to that transaction's own community.

## Scenario 7 — Viewing your own profile (Story 1, FR-004)

1. Sign in as O and open your own profile from community C.
   - Expect the identical presentation used when B views O's profile in Scenario 1 — no extra editing affordance introduced by this feature.

## Scenario 8 — No contact data, ever (FR-003, Principle VI)

1. As any account, inspect every response from both routes in this feature.
   - Expect no field anywhere containing an email address, phone number, physical address, or authentication data — only `displayName`, dates, listing summaries, and the three reputation numbers.

## Scenario 9 — Automated test suite

1. Run `npm run test:unit` — Vitest contract tests covering `reviewService.ts` (participant/confirmed-state/self-rating/duplicate/live-co-membership gates, immutability) and `profileService.ts` (dual live-membership access gate, community-scoped listings/member-since, global reputation numbers, non-disclosure of contributing communities) must pass, alongside the full existing 002-011 contract suite unmodified. Not a Constitution Principle VIII critical flow, but required by this spec's own Success Criteria (plan.md, Testing).
2. Run `npm run test:e2e` — Playwright specs driving profile viewing (from a listing, thread, and transaction), rating submission, and the clickable-display-name navigation must pass, alongside the full existing suite (no regressions).
