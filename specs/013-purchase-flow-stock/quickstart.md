# Quickstart: Purchase Flow with Stock and Dual Transaction History

Validates the feature end-to-end once implemented. See [data-model.md](./data-model.md) for the schema and [contracts/purchase-flow-api.md](./contracts/purchase-flow-api.md) for the routes.

## Prerequisites

- PostgreSQL running and migrated with this feature's Prisma schema change (`prisma migrate deploy`) — evolves the existing `transactions` table (renamed/added columns, new `TransactionState` enum) and adds `Listing.stockQuantity`; no new table.
- A `Community` with a `FOR_SALE`, `ACTIVE` listing owned by account S with `stockQuantity` set to `10`, and a co-member buyer account B who is not S.

## Scenario 1 — Buyer proposes, seller accepts (Story 1 + 2)

1. Sign in as B. Open S's listing and tap "Buy."
   - Expect the proposal to be pre-filled with quantity `1` and total equal to the listing's price; the screen states CMarket does not process, hold, or guarantee the payment.
2. Increase quantity to `3` and submit.
   - Expect the total to have recalculated to price × 3 before submission, and a new `PENDING` transaction to exist naming B, S, the listing, quantity `3`, and that total. The listing's `stockQuantity` is still `10`.
3. Sign in as S. Open the pending proposal.
   - Expect to see B's display name, quantity `3`, and the total, with Accept/Reject actions.
4. Accept it.
   - Expect the listing's `stockQuantity` to become `7`, the transaction to become `ACCEPTED`, and the record to now appear in both B's purchase history and S's sales history (`GET /transactions?state=ACCEPTED` for each).
5. As either B or S, attempt to change the transaction's quantity, total, or any other core field (there is no edit endpoint — confirm by inspecting the contract: no PATCH/PUT route exists for a `Transaction`).
   - Expect no such capability to exist at all.

## Scenario 2 — Seller rejects; stock and histories are untouched (Story 2)

1. As B, submit a second proposal against the same listing for quantity `2`.
2. As S, reject it.
   - Expect `stockQuantity` to remain `7` (unchanged from Scenario 1), the transaction to become `REJECTED`, and no record in either party's history.
3. As S, attempt to accept or reject the same transaction again.
   - Expect `409 not_pending`.

## Scenario 3 — Buyer cancels a pending proposal (Story 4)

1. As B, submit a third proposal for quantity `1`.
2. As B, view their proposals list.
   - Expect the new proposal to show as `PENDING` alongside the earlier `ACCEPTED` and `REJECTED` ones.
3. As B, cancel it.
   - Expect it to become `CANCELLED`, `stockQuantity` unchanged, and S can no longer accept or reject it (`409 not_pending`).

## Scenario 4 — Stock and status integrity (Story 3)

1. As S, edit the listing's `stockQuantity` down to `2`.
2. As B, attempt to propose quantity `5`.
   - Expect `409 exceeds_stock`, no transaction created.
3. As B, propose quantity `2` (succeeds, `PENDING`). As S, pause the listing (`status → PAUSED`).
4. As S, accept the still-`PENDING` proposal from step 3.
   - Expect it to succeed — pausing does not retroactively block an in-flight proposal (FR-014, Clarifications).
5. As a different buyer B2 (co-member), attempt to propose against the now-`PAUSED` listing.
   - Expect `409 listing_not_active`.
6. As S, attempt to set the listing's `stockQuantity` to `-1`.
   - Expect `400 invalid_input`; `stockQuantity` unchanged.

## Scenario 5 — Cross-community rejection (Story 3)

1. Have B's membership in the community removed, then attempt to propose against S's listing as B.
   - Expect `403 not_a_member`.
2. With a `PENDING` proposal already created while both were members, remove S's (the seller's) membership, then attempt to accept it as S.
   - Expect `403 not_a_member` — the proposal itself is untouched, still `PENDING`.
3. Suspend the community (009-platform-administration), then attempt to *propose* a new purchase.
   - Expect `403 not_a_member` (creation requires `ACTIVE`, research.md #4/#6).
4. With the community still `SUSPENDED`, accept a `PENDING` proposal created before suspension.
   - Expect it to succeed (research.md #6 — acceptance tolerates `SUSPENDED`, unlike creation).

## Scenario 6 — Listing deletion cancels pending proposals but not accepted ones (Edge Cases, FR-028)

1. As B, propose a purchase against S's listing (`PENDING`).
2. As S, delete the listing.
   - Expect the `PENDING` proposal from step 1 to become `CANCELLED`.
3. Separately, with an already-`ACCEPTED` transaction from Scenario 1, delete that listing.
   - Expect the `ACCEPTED` transaction to remain unchanged and still visible in both histories, per FR-028.

## Scenario 7 — Reputation regression check (012-profiles-reputation, FR-029/FR-030/SC-010)

1. With Scenario 1's `ACCEPTED` transaction in place, open S's public profile from any community both B and S share.
   - Expect the confirmed-transaction count to include this transaction, exactly as it would have for a `CONFIRMED` transaction under 010's prior model.
2. As B, leave a 1-5 star review for S referencing that transaction.
   - Expect it to succeed, identical to 012's existing review-creation behavior, now reading `state === "ACCEPTED"` instead of `confirmationState === "CONFIRMED"`.
3. As B, attempt to leave a review referencing the `PENDING`/`REJECTED`/`CANCELLED` transactions from Scenarios 2–3.
   - Expect `403`/`409 transaction_not_confirmed`-equivalent rejection for each — only `ACCEPTED` is reviewable, exactly as only `CONFIRMED` was before.

## Scenario 8 — No contact data anywhere (Story 5, FR-026)

1. Across every screen and response touched in Scenarios 1–7 (proposal form, accept/reject/cancel actions, both history views, transaction detail), grep the rendered pages and JSON bodies for the counterpart's email and phone number.
   - Expect zero matches; only display names ever appear.
