---
description: "Task list for Purchase Flow with Stock and Dual Transaction History"
---

# Tasks: Purchase Flow with Stock and Dual Transaction History

**Input**: Design documents from `/specs/013-purchase-flow-stock/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/purchase-flow-api.md](./contracts/purchase-flow-api.md), [quickstart.md](./quickstart.md)

**Tests**: This feature is transaction logging's direct successor, explicitly named in Constitution Principle VIII's critical-flow list; it also extends `Listing` (005-product-listings), itself a named critical flow. Tests are MANDATORY, MUST be written before their corresponding implementation, and MUST be confirmed failing (red) before that implementation is written — for both the stock-on-listing work and the purchase-flow work, with no exception for "small" foundational tasks. CI enforcement of this gate is a known pre-existing repository gap (plan.md's Constitution Check) — not introduced or fixed by this feature.

**Organization**: Tasks are grouped by user story (spec.md priorities P1/P1/P1/P2/P2/P3). Every story extends the same `transactionService.ts`, so stories are sequenced (not parallel) to avoid repeated merge conflicts on that one file — same rationale as 010's own tasks.md.

**Migration sequencing note**: This feature evolves the existing `Transaction` entity (research.md #1; data-model.md's "Prisma migration shape" describes the final, single-migration end state) as an **expand → contract** pair of physical migrations, not one destructive migration, specifically so 010's `recordTransaction()`/`confirmTransaction()` keep compiling and working — untouched — through Phases 1-3 while the new `proposePurchase()`/`acceptProposal()` are built and TDD'd alongside them. The **contract** migration (dropping the old columns/enum/functions/routes, and only then updating 012-profiles-reputation's `profileService.ts`/`reviewService.ts`) happens in Phase 4/T019, once `acceptProposal()` exists to build 012's replacement test fixtures with. This is a task-sequencing refinement of plan.md's Technical Context and Constitution Check (which describe the migration and the 012 fix as a single change) needed to satisfy Principle VIII's strict test-first ordering per new function; the end state matches data-model.md exactly.

## Path Conventions

Single existing Next.js/Prisma project (extends 002-012), per plan.md's Structure Decision — no new top-level project.

---

## Phase 1: Setup (Shared Infrastructure)

- [X] T001 **Expand migration**: in `prisma/schema.prisma`, add `Listing.stockQuantity Int?` (fully additive/nullable, research.md #8); add enum `TransactionState { PENDING ACCEPTED REJECTED CANCELLED }`; add to `Transaction`: `buyerId String?`, `sellerId String?`, `quantity Int?`, `totalCents Int?`, `state TransactionState?`, `resolvedAt DateTime?` (all nullable/optional so existing rows and 010's untouched `recorderId`/`counterpartId`/`confirmationState`/`confirmedAt` columns keep working unchanged). Add back-relations `transactionsAsBuyer`/`transactionsAsSeller` on `Account` (alongside the existing `transactionsRecorded`/`transactionsAsCounterpart`, both present during this transition). Run `prisma migrate dev --name expand_purchase_flow_fields` and `prisma generate`. Never edit the database by hand (constitution: Migrations & Backups).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Listing-side stock support every later story needs. This is an extension of the "product listing" critical flow (Constitution Principle VIII) — tests are mandatory here too, written and confirmed red before their implementation, same as every other phase in this file.

### Tests ⚠️ Write first, confirm red

- [X] T002 [P] Add a new `describe("stockQuantity ...")` block to `tests/contract/test_listings.ts` (in place of a separate unit-test file — matches the established precedent that `isValidPriceCents()` is likewise never unit-tested directly, only through `createListing()`/`updateListing()` contract tests): `createListing()`/`updateListing()` persist a valid `stockQuantity`; both reject `stockQuantity: -1` and `stockQuantity: 1.5` with `invalid_input`, writing nothing; a listing created with no `stockQuantity` reads back `null` (FR-001, FR-002). Confirm it FAILS (red) — `stockQuantity` isn't in `CreateListingInput`/`UpdateListingInput` yet.
- [X] T003 [P] Extend `tests/contract/test_listings.ts` (or a new `tests/unit/test_listing_delete_cancels_pending.ts`) for `deleteListing()`'s new cascade-cancel step: seed a `Transaction` row directly via `prisma.transaction.create()` using T001's new nullable columns (`buyerId`, `sellerId`, `quantity`, `totalCents`, `state: "PENDING"`) against a listing, then call `deleteListing()` and assert that row's `state` becomes `CANCELLED` with `resolvedAt` set; separately seed a `state: "ACCEPTED"` row the same way and assert it is untouched (unchanged `state`, still present) after the listing is deleted (FR-028, research.md #9). This test does not depend on `proposePurchase()`/`acceptProposal()` existing yet — it seeds rows directly. Confirm it FAILS (red) — `deleteListing()` doesn't cancel anything yet.

### Implementation

- [X] T004 [P] Add `isValidStockQuantity(value: number): boolean` to `src/server/services/listingService.ts` (mirrors `isValidPriceCents()`: non-negative integer). Add `stockQuantity?: number` to `CreateListingInput` and `UpdateListingInput`, validate it in `createListing()`/`updateListing()` (reject `invalid_input` if present and invalid), and include `stockQuantity: number | null` in both functions' result shapes and in `getListing()`/`listListings()`/`listMyListings()`'s shapes (FR-001, FR-002). Confirm T002 passes (green).
- [X] T005 [P] Extend `deleteListing()` in `src/server/services/listingService.ts`: wrap in `prisma.$transaction(async (tx) => { ... })` — first `tx.transaction.updateMany({ where: { listingId: input.listingId, state: "PENDING" }, data: { state: "CANCELLED", resolvedAt: new Date() } })`, then `tx.listing.delete(...)` (research.md #9, FR-028). Confirm T003 passes (green).
- [X] T006 [P] Extend `PATCH app/api/communities/[communityId]/listings/[listingId]/route.ts` to pass through `stockQuantity` from the request body to `updateListing()` when it is a `number` (same pattern as `priceCents`).
- [X] T007 [P] Add a `stockQuantity` number input to `app/communities/[communityId]/listings/ListingForm.tsx` (create and edit), labeled to reflect FR-002's "seller indicates N available" framing, visible only when `kind === "FOR_SALE"`.

**Checkpoint**: Sellers can declare and edit stock on `FOR_SALE` listings, with validation enforced and tested; deleting a listing already correctly cancels any `PENDING` transaction referencing it and leaves `ACCEPTED` ones untouched, verified independently of the purchase flow itself. No `Transaction`-service code (`proposePurchase`, etc.) exists yet.

---

## Phase 3: User Story 1 - Buyer proposes a purchase (Priority: P1) 🎯 MVP

**Goal**: A co-member buyer can open a listing, adjust quantity/total, and submit a purchase proposal that is validated against community membership, listing status, and stock, and created `PENDING`.

**Independent Test**: A co-member buyer taps "Buy," adjusts quantity/total, submits; a `PENDING` transaction now exists naming the buyer, seller, listing, community, quantity, and total; the listing's stock is unchanged; every rejection path (bad quantity/total, non-member, `WANTED` listing, `PAUSED` listing, unset/exceeded stock, self-purchase, seller no longer a member) creates nothing.

### Tests ⚠️ Write first, confirm red

- [X] T008 [US1] Replace `tests/contract/test_transactions.ts`'s entire contents (010's `UNCONFIRMED`/`CONFIRMED`, thread-derived model is being retired by this feature, FR-027) with new fixtures (an `ACTIVE` community; a `FOR_SALE`, `ACTIVE` listing owned by S with `stockQuantity: 10`; a co-member buyer B) and cases for `proposePurchase({ communityId, listingId, buyerAccountId, quantity, totalCents })` per data-model.md's creation gates, in order:
  - Happy path: quantity `1`, `totalCents` = listing price → `PENDING` transaction naming B as buyer, S as seller, correct `communityId`/`listingId`/`listingTitle` snapshot/`quantity`/`totalCents`/`paymentPath: "OFF_PLATFORM"`; listing's `stockQuantity` still `10` (FR-003, FR-011, FR-012). Assert no `MessageThread` row exists anywhere for the (B, listing) pair before or after this call — the proposal succeeds with zero prior interaction, confirming FR-027 explicitly rather than only by fixture omission.
  - `quantity: 0` and `quantity: -1` → `invalid_input`, no row created.
  - `totalCents: 0` and `totalCents: -1` → `invalid_input`, no row created.
  - Buyer with no membership in `communityId` → `not_a_member`.
  - `listingId` belonging to a `kind: "WANTED"` post → `not_found` (research.md #7).
  - Listing `status: "PAUSED"` → `listing_not_active` (FR-009).
  - Listing `stockQuantity: null` → `stock_not_specified` (research.md #8).
  - `quantity: 11` against `stockQuantity: 10` → `exceeds_stock` (FR-008).
  - `buyerAccountId === listing.ownerId` → `self_purchase` (FR-010).
  - Listing owner no longer a member of `communityId` → `seller_not_a_member` (FR-007).
  - For every rejection case above, assert the listing's `stockQuantity` is unchanged and no `Transaction` row exists for that attempt (FR-011).
  - Every field returned by `proposePurchase()` is limited to `id`/`displayName`/enum/integer/timestamp/title values — no `email`/`phone`/address anywhere (FR-026, SC-005).

  Confirm this file FAILS (red) — `proposePurchase()` doesn't exist yet.

### Implementation

- [X] T009 [US1] Implement `proposePurchase()` in `src/server/services/transactionService.ts` per data-model.md's creation gates (using the new `buyerId`/`sellerId`/`quantity`/`totalCents`/`state: "PENDING"` columns from T001 — do not touch `recorderId`/`counterpartId`/`confirmationState`, which `recordTransaction()`/`confirmTransaction()` still own untouched, and do not consult `MessageThread` at all, per FR-027). Also rewrite `getTransaction()`/`listTransactions()` to read the new columns and return `role: "buyer" | "seller"` with `counterpartDisplayName` derived accordingly (contracts/purchase-flow-api.md) — these existing functions currently only know about `recorderId`/`counterpartId` and must now branch on whichever set of columns (`state` non-null vs `confirmationState` non-null) a given row was created with, so both this feature's new rows and any 010-era row already in the dev database keep resolving correctly until T019's contract migration removes the old columns entirely. Confirm T008 passes (green).
- [X] T010 [P] [US1] Create `app/api/communities/[communityId]/listings/[listingId]/proposals/route.ts` — `POST { quantity, totalCents }` calls `proposePurchase()`, maps results per contracts/purchase-flow-api.md (`201`, `400 invalid_input`, `403 not_a_member`/`self_purchase`, `404`, `409 listing_not_active`/`stock_not_specified`/`exceeds_stock`/`seller_not_a_member`).
- [X] T011 [P] [US1] Update `app/api/communities/[communityId]/transactions/route.ts` (GET) and `.../transactions/[transactionId]/route.ts` (GET) response mapping for the rewritten `listTransactions()`/`getTransaction()` shapes (no route-file logic change needed beyond what T009 already returns).

### Tests ⚠️ Write first, confirm red

- [X] T012 [US1] Write `tests/integration/test_purchase_flow.spec.ts` (Playwright): a co-member buyer opens a `FOR_SALE` listing with declared stock, taps "Buy," sees quantity `1` and the total pre-filled, increases quantity to `3` and confirms the total recalculates, submits; the resulting proposal shows as `PENDING` on the transactions page. Assert the proposal screen at no point renders a payment-method selection control of any kind (FR-005) — grep the rendered screen for common payment-method affordances (e.g. a "payment method" label, card-entry fields) and assert none are present. Confirm it FAILS (red) — no "Buy" action or `BuyForm` exists yet.

### Implementation

- [X] T013 [US1] Extend `app/communities/[communityId]/listings/[listingId]/page.tsx`: show stock as "seller indicates N available" or "stock not specified" (`stockQuantity === null`, FR-002); for a non-owner co-member on a `FOR_SALE`, `ACTIVE` listing, render a new `app/communities/[communityId]/listings/[listingId]/BuyForm.tsx` with a quantity stepper (default `1`) and an editable total (default price × quantity, recalculating live as quantity changes — FR-004), posting to T010's route, with no payment-method step of any kind. Confirm T012 passes (green).

**Checkpoint**: MVP — a co-member buyer can propose a purchase against a listing's declared stock, with no message-thread prerequisite and no payment-method step; it's visible (as `PENDING`) via the transactions pages, with every creation-time gate enforced.

---

## Phase 4: User Story 2 - Seller resolves a pending proposal (Priority: P1)

**Goal**: The seller can accept a `PENDING` proposal (atomically decrementing stock and recording the transaction) or reject it (no side effect).

**Independent Test**: Accepting a `PENDING` proposal decrements the listing's stock by exactly the confirmed quantity, marks it `ACCEPTED`, and makes it visible in both parties' history; rejecting it changes nothing but the proposal's own state; pausing the listing after a proposal is already `PENDING` does not block accepting it.

### Tests ⚠️ Write first, confirm red

- [X] T014 [US2] Extend `tests/contract/test_transactions.ts`:
  - `acceptProposal({ communityId, transactionId, callerAccountId: sellerId })` on a `PENDING` proposal for quantity `3` against `stockQuantity: 10` → listing's `stockQuantity` becomes `7`; transaction becomes `ACCEPTED` with `resolvedAt` set (FR-015).
  - Two independent `PENDING` proposals each for quantity `2` against a listing with `stockQuantity: 2`: accepting the first succeeds (`stockQuantity → 0`); accepting the second then gets `exceeds_stock`, and remains `PENDING` (FR-014, data-model.md gate 5-6, research.md #5's atomicity claim).
  - A `PENDING` proposal whose listing the seller pauses (`status → PAUSED`) *after* the proposal was created: `acceptProposal()` still succeeds normally (FR-009, FR-014's explicit "status MUST NOT be re-checked at acceptance" clause; spec.md US2 Acceptance Scenario 6, SC-009) — asserted here as a fast contract test, not deferred to Playwright/manual verification.
  - `rejectProposal(...)` on a `PENDING` proposal → `REJECTED`, `stockQuantity` unchanged, no history record either party can query (FR-016).
  - A non-seller (including the buyer) calling `acceptProposal()`/`rejectProposal()` → `not_a_seller`.
  - Calling `acceptProposal()`/`rejectProposal()` on an already-`ACCEPTED`/`REJECTED`/`CANCELLED` transaction → `not_pending` (FR-017).
  - There is no exported function in `transactionService.ts` capable of modifying any core field (`buyerId`, `sellerId`, `listingId`, `listingTitle`, `quantity`, `totalCents`, `communityId`, `paymentPath`, `createdAt`) of an `ACCEPTED` transaction (FR-022).

  Confirm these cases FAIL (red) — `acceptProposal()`/`rejectProposal()` don't exist yet.

### Implementation

- [X] T015 [US2] Implement `acceptProposal()` in `transactionService.ts` as the guarded `prisma.$transaction` from research.md #5/data-model.md (conditional `updateMany` on `state: "PENDING"` for the transaction, conditional `updateMany` on `stockQuantity: { gte: quantity }` for the listing, both checked for affected-row count `1`; roll back and return `exceeds_stock`/`not_pending` if either is `0`; deliberately no `listing.status` check at all). Implement `rejectProposal()` as a single guarded `updateMany` (`WHERE state = 'PENDING'`), mirroring 010's `confirmTransaction()` idempotency pattern. Confirm T014 passes (green).
- [X] T016 [P] [US2] Create `app/api/communities/[communityId]/transactions/[transactionId]/accept/route.ts` and `.../reject/route.ts` — `POST` (no body) mapping per contracts/purchase-flow-api.md (`200`, `403 not_a_member`/`not_a_seller`, `404`, `409 not_pending`/`exceeds_stock` for accept).

### Tests ⚠️ Write first, confirm red

- [X] T017 [US2] Extend `tests/integration/test_purchase_flow.spec.ts`: the seller signs in, sees the buyer's pending proposal (name, quantity, total) with Accept/Reject actions, accepts it; the listing's displayed stock updates; a second pending proposal is rejected instead, with the listing's stock unchanged. Confirm it FAILS (red) — no Accept/Reject UI exists yet.

### Implementation

- [X] T018 [US2] Add Accept/Reject actions to `app/communities/[communityId]/transactions/page.tsx` and `.../transactions/[transactionId]/page.tsx`, rendered only for the signed-in account matching the row's `sellerId` while `state === "PENDING"`, posting to T016's routes. Confirm T017 passes (green).
- [X] T019 [US2] **012-profiles-reputation regression fix + contract migration** (research.md #11, FR-029, FR-030, SC-010) — now that `acceptProposal()` exists:
  1. Rewrite `tests/contract/test_reviews.ts` and `tests/contract/test_profiles.ts` fixture setup to build their `ACCEPTED`-equivalent transaction via `proposePurchase()` + `acceptProposal()` instead of `recordTransaction()` + `confirmTransaction()`. Every existing assertion in both files MUST still pass, unmodified.
  2. Update `src/server/services/profileService.ts`'s `getProfile()` (`prisma.transaction.count(...)`) to filter `state: "ACCEPTED"` and `OR: [{ buyerId: accountId }, { sellerId: accountId }]`.
  3. Update `src/server/services/reviewService.ts`'s `createReview()`/`getMyReview()` to read `transaction.buyerId`/`transaction.sellerId` and check `transaction.state !== "ACCEPTED"` (replacing `recorderId`/`counterpartId`/`confirmationState !== "CONFIRMED"`).
  4. **Contract migration**: delete `recordTransaction()` and `confirmTransaction()` from `transactionService.ts`; delete `app/api/communities/[communityId]/threads/[threadId]/transaction/route.ts` and `app/api/communities/[communityId]/transactions/[transactionId]/confirm/route.ts` (FR-027, spec.md "Relationship to Feature 010"); in `prisma/schema.prisma`, drop `Transaction.recorderId`/`counterpartId`/`confirmationState`/`confirmedAt`, drop enum `TransactionConfirmationState`, drop the now-unused `transactionsRecorded`/`transactionsAsCounterpart` back-relations, and make `buyerId`/`sellerId`/`quantity`/`totalCents`/`state` required (non-nullable) with `state` defaulting to `PENDING`. Run `prisma migrate dev --name retire_confirmation_model` and `prisma generate`.
  5. Confirm `grep -rn "recorderId\|counterpartId\|confirmationState\|TransactionConfirmationState\|recordTransaction\|confirmTransaction" src/ app/ tests/` returns no matches, and the full `npm run test:unit` suite (including the rewritten `test_reviews.ts`/`test_profiles.ts`) passes.

**Checkpoint**: User Stories 1 and 2 both independently verified — propose → accept/reject works end to end, stock integrity holds under a two-proposals-for-the-last-units race, pausing mid-flight doesn't retroactively block acceptance, and 012's reputation/review logic is confirmed unaffected. The old confirmation model no longer exists in the codebase.

---

## Phase 5: User Story 3 - Cross-community and stock-integrity rejections (Priority: P1)

**Goal**: A proposal can never be created or accepted across a community boundary, and stock can never go negative regardless of timing.

**Independent Test**: Non-co-members can't create or accept a proposal between them; a membership lapse between creation and acceptance blocks the acceptance without touching the proposal itself; a `SUSPENDED` community blocks new proposals but not resolving existing ones; stock edited down between creation and acceptance blocks the acceptance.

### Tests ⚠️ Write first, confirm red

- [X] T020 [US3] Extend `tests/contract/test_transactions.ts`:
  - With a `PENDING` proposal already created while both were co-members, removing the seller's (or buyer's) `Membership` row, then calling `acceptProposal()`/`rejectProposal()`/`cancelProposal()` as the appropriate party → `not_a_member`; the proposal remains `PENDING`, untouched (FR-014's acceptance re-check).
  - Suspending the community (009-platform-administration `communityLifecycleService.ts`), then attempting `proposePurchase()` → `not_a_member` (creation requires `ACTIVE`, research.md #4a/#6); `acceptProposal()`/`rejectProposal()`/`cancelProposal()` on an already-`PENDING` proposal in that same `SUSPENDED` community still succeed (research.md #6).
  - Archiving the community, then attempting any of `proposePurchase()`/`acceptProposal()`/`rejectProposal()`/`cancelProposal()` → `not_a_member` (an `ARCHIVED` community fails `requireCommunityMembership()` outright).
  - A `PENDING` proposal for quantity `4` against a listing whose `stockQuantity` the seller has since edited down to `3` → `acceptProposal()` gets `exceeds_stock` (FR-014, already covered by T014's two-proposal case; this asserts the single-proposal stock-edit variant explicitly, per spec.md Story 3 Acceptance Scenario 4).

  Confirm these cases FAIL if any gate from T009/T015 is missing; if all already pass, this phase locks the guarantee in as regression coverage (mirrors 010's own Phase 5 pattern).

### Implementation

- [X] T021 [US3] Only if any T020 case is red: adjust `transactionService.ts`'s gates so every case in T020 passes.
- [X] T022 [US3] Extend `tests/contract/test_transactions.ts` with an end-to-end variant of T003's Foundational-level check: create a real `PENDING` proposal via `proposePurchase()`, delete its listing via `deleteListing()`, and assert it becomes `CANCELLED`; separately, `acceptProposal()` a proposal, delete its listing, and assert the resulting `ACCEPTED` transaction is untouched and still visible via `listTransactions()` for both parties (FR-028). T003 already proves `deleteListing()`'s own cascade logic in isolation; this proves the full propose/accept-to-delete flow behaves the same way through the real service functions.

**Checkpoint**: User Stories 1-3 independently verified — the community-isolation and stock-integrity guarantees named in Constitution Principle II/IV and spec.md's critical-flow list hold for every propose/accept/reject/cancel path.

---

## Phase 6: User Story 4 - Buyer tracks and cancels a pending proposal (Priority: P2)

**Goal**: The buyer can see every proposal's current state and cancel one that is still `PENDING`.

**Independent Test**: A buyer views their proposals list showing every state; cancelling a `PENDING` one makes it `CANCELLED` and no longer actionable by the seller.

### Tests ⚠️ Write first, confirm red

- [X] T023 [US4] Extend `tests/contract/test_transactions.ts`:
  - `cancelProposal({ communityId, transactionId, callerAccountId: buyerId })` on a `PENDING` proposal → `CANCELLED`, `resolvedAt` set, listing's `stockQuantity` unchanged, no history record (FR-018).
  - A non-buyer (including the seller) calling `cancelProposal()` → `not_a_buyer`.
  - Calling `cancelProposal()` on an already-`ACCEPTED`/`REJECTED`/`CANCELLED` transaction → `not_pending` (FR-019).
  - After the seller accepts a proposal, the buyer's subsequent `cancelProposal()` attempt on it → `not_pending` (spec.md US4 Acceptance Scenario 4).
  - `listTransactions()` for the buyer returns proposals in every state (`PENDING`/`ACCEPTED`/`REJECTED`/`CANCELLED`), not just `PENDING` (FR-020).

  Confirm these cases FAIL (red) — `cancelProposal()` doesn't exist yet.

### Implementation

- [X] T024 [US4] Implement `cancelProposal()` in `transactionService.ts` as a single guarded `updateMany` (`WHERE state = 'PENDING'`), mirroring `rejectProposal()`. Confirm T023 passes (green).
- [X] T025 [P] [US4] Create `app/api/communities/[communityId]/transactions/[transactionId]/cancel/route.ts` — `POST` (no body) mapping per contracts/purchase-flow-api.md (`200`, `403 not_a_member`/`not_a_buyer`, `404`, `409 not_pending`).

### Tests ⚠️ Write first, confirm red

- [X] T026 [US4] Extend `tests/integration/test_purchase_flow.spec.ts`: the buyer views their full proposals list (showing every state from Phases 3-4's scenarios), cancels a still-`PENDING` one; it shows as `CANCELLED` and the seller's view no longer offers Accept/Reject for it. Confirm it FAILS (red) — no Cancel action or full-state list exists yet.

### Implementation

- [X] T027 [US4] Add a Cancel action to `app/communities/[communityId]/transactions/page.tsx`/`.../[transactionId]/page.tsx`, rendered only for the signed-in account matching the row's `buyerId` while `state === "PENDING"`, posting to T025's route; ensure the list renders every state, not only `PENDING`. Confirm T026 passes (green).

**Checkpoint**: User Stories 1-4 independently verified — the buyer is never stuck waiting with no visibility or recourse.

---

## Phase 7: User Story 5 - Both parties view their own transaction history without contact exposure (Priority: P2)

**Goal**: Purchase history (buyer) and sales history (seller) are two owner-scoped views of the same `ACCEPTED` rows; no view anywhere exposes contact data.

**Independent Test**: An `ACCEPTED` transaction appears in the buyer's purchase history and the seller's sales history; no other account can view either; no screen renders email/phone/address.

### Tests ⚠️ Write first, confirm red

- [X] T028 [US5] Extend `tests/contract/test_transactions.ts`:
  - `listTransactions(communityId, buyerId, { state: "ACCEPTED" })`-equivalent (the `?state=` filter from contracts/purchase-flow-api.md) returns exactly the buyer's `ACCEPTED` rows with `role: "buyer"`; the same filter for the seller returns the identical rows with `role: "seller"` (spec.md Key Entities — one record, two views).
  - `getTransaction()`/`listTransactions()` called by any account that is neither `buyerId` nor `sellerId` → `not_a_member`/`not_a_party`, no data returned (FR-025).
  - Across every response asserted in T008/T014/T020/T023/T028 combined, no object contains an `email`, `phone`, or address field (FR-026, SC-005) — written as one consolidated assertion here rather than duplicated per case.

  Confirm red for any gap; otherwise this locks the guarantee in as regression coverage.

### Implementation

- [X] T029 [US5] Fix any gap found in T028 (response-shape or filter logic in `listTransactions()`/`getTransaction()`).
- [X] T030 [US5] Add "Purchase history" and "Sales history" filtered sections (or tabs) to `app/communities/[communityId]/transactions/page.tsx`, each backed by the `?state=ACCEPTED` filter and split by `role`; confirm neither this page nor `BuyForm.tsx`/the listing detail page/the transaction detail page ever renders a counterpart's email or phone number (manual grep over the rendered output, mirrors 010's own FR-015 UI check).

**Checkpoint**: User Stories 1-5 independently verified — both histories are correct, owner-scoped, and contact-data-free.

---

## Phase 8: User Story 6 - The non-intermediary disclosure is always shown (Priority: P3)

**Goal**: Before submitting a purchase proposal, the buyer sees that CMarket does not process, hold, or guarantee the payment.

**Independent Test**: Opening the "Buy" screen shows the disclosure before the proposal can be submitted.

### Tests ⚠️ Write first, confirm red

- [X] T031 [US6] Extend `tests/integration/test_purchase_flow.spec.ts`: before submitting a proposal via `BuyForm`, the non-intermediary disclosure text is visibly present. Confirm it FAILS (red) — no disclosure text exists in `BuyForm.tsx` yet.

### Implementation

- [X] T032 [US6] Render a `NonIntermediaryDisclosure` component (reuse 010's shared component if still present after T019's cleanup, else recreate it under `app/communities/[communityId]/_components/`) above the submit action in `BuyForm.tsx` (Constitution Principle IV, FR-006). Confirm T031 passes (green).

**Checkpoint**: All six user stories independently verified.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [X] T033 [P] Run `npm run typecheck` and `npx eslint .`; fix any issues introduced by this feature.
- [X] T034 [P] Run `npm run test:unit` (all of `tests/unit` + `tests/contract`, including this feature's full `test_transactions.ts`, `test_listings.ts`, and the updated `test_reviews.ts`/`test_profiles.ts`) and `npm run test:e2e` (Playwright, including `test_purchase_flow.spec.ts`); confirm the whole suite is green, including a regression check that every other existing feature's tests still pass unmodified.
- [X] T035 Manually execute quickstart.md Scenarios 1-8 against the real dev/test PostgreSQL database and a running dev server; record the results.
- [X] T036 Re-check plan.md's Constitution Check against the finished implementation, including the FR-029/FR-030 grep evidence from T019 step 5, and note the expand/contract migration sequencing actually used (per this file's Migration sequencing note) against plan.md's/data-model.md's original single-migration framing.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately.
- **Foundational (Phase 2)**: Depends on Setup (T001's `Listing.stockQuantity` and `Transaction`'s new nullable columns, the latter needed by T003's direct-seed test). BLOCKS Phase 3's `BuyForm` (needs stock to display/validate against).
- **Phase 3 (US1)**: Depends on Phases 1-2. BLOCKS Phases 4-8 (each extends the same `transactionService.ts` file and/or its consumers).
- **Phase 4 (US2)**: Depends on Phase 3 (`proposePurchase()`'s output is what gets accepted/rejected). Its final task (T019) is the point where the **contract** migration retires 010's old functions/columns.
- **Phase 5 (US3)**: Depends on Phase 4 (verifies/hardens gates both prior phases' entry points rely on, and requires T019's migration to be complete so `acceptProposal()`/`rejectProposal()`/`cancelProposal()` operate on the final, non-nullable schema — though `cancelProposal()` itself is only added in Phase 6, T020's membership-lapse cases only need `acceptProposal()`/`rejectProposal()`, already present).
- **Phase 6 (US4)**: Depends on Phase 5 (adds `cancelProposal()` to the now-stable `transactionService.ts`).
- **Phase 7 (US5)**: Depends on Phase 6 (the `?state=ACCEPTED` history views read rows every prior phase's actions produce).
- **Phase 8 (US6)**: Depends on Phase 7 (adds UI-only disclosure text to `BuyForm.tsx`, built in Phase 3).
- **Polish (Phase 9)**: Depends on all prior phases being complete.

### Parallel Opportunities

- T002 and T003 (Foundational tests) are [P] — different files, no dependency on each other.
- T004, T005, T006, T007 (Foundational implementation) are [P] — four different files, none depending on each other beyond their own paired test.
- T010 and T011 (US1) are [P] — different route files, both depending only on the already-green T009.
- T016 (US2) creates two different route files in one parallelizable task.
- T025 (US4) is a single new route file, independent of T024's same-file-as-T015 service change.
- T033 and T034 (Polish) — independent checks, can run in parallel.

---

## Parallel Example: Phase 2 (Foundational)

```bash
# T002-T003 (tests) are independent; once both are red:
Task: "Add isValidStockQuantity() and stockQuantity support to listingService.ts"       # T004
Task: "Extend deleteListing() to cancel PENDING transactions in a $transaction"          # T005
Task: "Extend PATCH .../listings/[listingId]/route.ts with stockQuantity"                # T006
Task: "Add a stockQuantity field to ListingForm.tsx"                                     # T007
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Complete Phase 1 (Setup) and Phase 2 (Foundational).
2. Complete Phase 3 (T008-T013).
3. **STOP and VALIDATE**: run quickstart.md Scenario 1's creation half; confirm T008 and T012 are both green.
4. This is a partial MVP: a proposal can be created and viewed, but nothing resolves anything yet without Phase 4's accept/reject.

### Incremental Delivery

1. Setup + Foundational → stock declarable and validated; listing deletion already correctly cancels pending proposals in isolation.
2. Phase 3 (US1) → a purchase can be proposed.
3. Phase 4 (US2) → accept/reject makes a proposal real; 010's old model is fully retired in the same phase.
4. Phase 5 (US3) → community-isolation and stock-integrity guarantees locked in as regression coverage.
5. Phase 6 (US4) → the buyer is never stuck waiting.
6. Phase 7 (US5) → both histories, contact-data-free.
7. Phase 8 (US6) → required disclosure text shipped.
8. Polish.

---

## Notes

- [P] tasks touch different files with no dependency on each other; tasks sharing a file with a sibling task in the same phase are intentionally sequenced instead.
- [Story] labels map every task to the spec.md story whose acceptance criterion it satisfies; T019 is labeled [US2] because it is gated by `acceptProposal()`'s existence, even though its 012-regression scope is cross-cutting (spec.md's "Dependency on Feature 012" section, not itself a numbered user story).
- Foundational tasks (Phase 2) follow the same write-test-first-confirm-red discipline as every user-story phase — "foundational" describes what the tasks unblock, not an exemption from Principle VIII.
- Commit after each task or logical group.
- Stop at any checkpoint to validate independently.
- Both Vitest (contract) and Playwright (integration) are used, matching 002-012 — this feature extends real pages/routes for Playwright to exercise.
