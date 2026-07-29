# Quickstart: Transaction Logging

Validates the feature end-to-end once implemented. See [data-model.md](./data-model.md) for the schema and [contracts/transactions-api.md](./contracts/transactions-api.md) for the four routes.

## Prerequisites

- PostgreSQL running and migrated with this feature's Prisma schema change (`prisma migrate deploy`) — adds the `transactions` table, no existing table altered.
- A `Community` with an `ACTIVE` listing owned by account O, and an existing 008-listing-messaging thread on it started by buyer B (i.e., B has already sent at least one message to O about that listing).

## Scenario 1 — Either participant records the transaction, the other confirms (Story 1 + 2)

1. Sign in as B (or O — either side may record it). From the existing thread with O, trigger "Record transaction."
   - Expect a new log to appear, `UNCONFIRMED`, naming the other party as counterpart, the correct listing, community, and `paymentPath: "OFF_PLATFORM"`.
2. Sign in as the other party (the one named as counterpart). View the same thread, or the community's `transactions` list.
   - Expect the log to be visible, still `UNCONFIRMED`.
3. As the counterpart, confirm it.
   - Expect `confirmationState` to become `CONFIRMED`, with a `confirmedAt` timestamp set.
4. As either party, attempt to alter any core fact of the confirmed log (there is no edit UI or endpoint — confirm this by inspecting the API contract directly: no PATCH/PUT route exists for a `Transaction`).
   - Expect no such capability to exist at all.
5. As the *recorder*, attempt to confirm their own log.
   - Expect `403 not_a_counterpart`.

## Scenario 2 — Ineligible pairs are rejected (Story 1, Edge Cases)

1. As B, attempt to record a transaction against a listing/thread where B is not a participant (a different buyer's thread on the same listing).
   - Expect `403 not_a_participant`.
2. As B, attempt to name a counterpart via a listing where no thread exists at all between B and that listing's owner (confirm the record route only ever takes a `threadId`, never a `counterpartId` — there is no way to attempt this through the UI, only by calling the API directly with a nonexistent `threadId`).
   - Expect `404 not_found`.

## Scenario 3 — Cross-community and non-member rejection (Story 3)

1. Have B's membership in the community removed, then attempt to record a transaction on the existing thread as O.
   - Expect `409` (the derived counterpart, B, is no longer a member) — no log is created.
2. With a confirmed-eligible `UNCONFIRMED` log already created while both were members, remove the counterpart's membership, then have the counterpart attempt to confirm it.
   - Expect `403 not_a_member` — the log itself is untouched, still `UNCONFIRMED`.
3. Suspend the community (009-platform-administration), then attempt to *create* a new log on an existing thread.
   - Expect `409 community_not_active`.
4. With the community still `SUSPENDED`, confirm an `UNCONFIRMED` log created before suspension.
   - Expect it to succeed (research.md #4 — confirmation tolerates `SUSPENDED`, unlike creation).

## Scenario 4 — The non-intermediary disclosure is always shown (Story 4)

1. Open the "Record transaction" action on a thread.
   - Expect the non-intermediary disclosure text to be visibly present before submission.
2. Open the "Confirm" action on an `UNCONFIRMED` log.
   - Expect the same disclosure to be visibly present before submission.

## Scenario 5 — A log outlives its listing (Edge Cases, FR-017)

1. With a `CONFIRMED` log already recorded against listing L's thread, delete listing L as its owner.
   - Expect the deletion to succeed (the owner's unconditional right, 005-product-listings FR-008) and the thread to be deleted along with it (008 FR-015).
2. As either party to the log, visit `GET /communities/{communityId}/transactions`.
   - Expect the log to still appear, unchanged, with its `listingTitle` snapshot intact, even though the listing and thread it referenced no longer exist.

## Scenario 6 — No contact data, ever (FR-015, Principle VI)

1. As any party, inspect every response from all four routes in this feature.
   - Expect no field anywhere containing an email address, phone number, or other contact data — only `displayName` values.

## Scenario 7 — Repeat transactions between the same pair (Edge Cases)

1. With one log already `CONFIRMED` between O and B on the same listing's thread, record a second transaction on the same thread.
   - Expect a second, independent `UNCONFIRMED` log to be created — the first log is untouched.

## Scenario 8 — Automated test suite

1. Run `npm run test:unit` — Vitest contract tests covering `transactionService.ts` (thread-derived eligibility, self-transaction impossibility, live co-membership at creation and confirmation, cross-community rejection, the confirmation state machine, confirmed-log immutability, non-exposure of contact data, and listing-deletion survival) must pass, written and confirmed failing (red) first, alongside the full existing 002-009 contract suite unmodified. Per Constitution Principle VIII, this is a named critical flow.
2. Run `npm run test:e2e` — Playwright specs driving the "Record transaction" and "Confirm" actions on the thread page, the `transactions` list/detail pages, and the non-intermediary disclosure text must pass, alongside the full existing suite (no regressions).
