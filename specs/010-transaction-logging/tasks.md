---
description: "Task list for Transaction Logging"
---

# Tasks: Transaction Logging

**Input**: Design documents from `/specs/010-transaction-logging/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/transactions-api.md](./contracts/transactions-api.md), [quickstart.md](./quickstart.md)

**Tests**: Transaction logging is explicitly named in Constitution Principle VIII's critical-flow list. Tests are MANDATORY, MUST be written before their corresponding implementation, and MUST be confirmed failing (red) before that implementation is written. CI enforcement of this gate is a known pre-existing repository gap (plan.md's Constitution Check) — not introduced or fixed by this feature.

**Organization**: Tasks are grouped by user story (spec.md priorities P1/P1/P1/P2). Every story extends the same underlying `transactionService.ts`, so stories are sequenced (not parallel) to avoid repeated merge conflicts on that one file.

## Path Conventions

Single existing Next.js/Prisma project (extends 002-009), per plan.md's Structure Decision — no new top-level project.

---

## Phase 1: Setup (Shared Infrastructure)

- [X] T001 Add `Transaction` model and `TransactionPaymentPath`/`TransactionConfirmationState` enums to `prisma/schema.prisma` per data-model.md — no relation on `listingId` (plain string + `listingTitle` snapshot, research.md #1), real relations on `communityId`/`recorderId`/`counterpartId`. Add back-relations `transactionsRecorded`/`transactionsAsCounterpart` on `Account` and `transactions` on `Community`. Run `prisma migrate dev --name add_transaction` and `prisma generate`. Never edit the database by hand (constitution: Migrations & Backups).

---

## Phase 2: Foundational (Blocking Prerequisites)

**No new foundational primitive is needed.** `requireCommunityMembership()` (005-product-listings, `src/server/services/listingService.ts`) already gates every membership check this feature needs — this feature reuses it unchanged, including its `{ allowSuspended }` option (research.md #4). Proceed directly to Phase 3 once Phase 1's migration lands.

---

## Phase 3: User Story 1 - A member records an off-platform sale (Priority: P1) 🎯 MVP

**Goal**: Either participant of an existing message thread on a listing can record that a transaction happened, creating an `UNCONFIRMED` log naming the other participant as counterpart — derived from the thread, never client-supplied.

**Independent Test**: Two co-members with an existing thread on a listing (one owner, one buyer) have either party record a transaction; a log now exists identifying both parties, the listing, the community, the timestamp, and `OFF_PLATFORM`, in `UNCONFIRMED` state, visible to both parties afterward.

### Tests ⚠️ Write first, confirm red

- [X] T002 [US1] Write `tests/contract/test_transactions.ts` against real accounts/communities/memberships/listings/threads in the real test database (seed helper mirroring `tests/contract/test_messaging.ts`'s pattern: an `ACTIVE` community, an `ACTIVE` listing owned by O, an existing `MessageThread` from buyer B), covering:
  - `recordTransaction(threadId, O)` creates an `UNCONFIRMED` `Transaction` naming B as counterpart, with the correct `communityId`, `listingId`/`listingTitle` snapshot, and `paymentPath: "OFF_PLATFORM"` (FR-001, FR-004, FR-008, FR-009).
  - `recordTransaction(threadId, B)` (the other direction) creates a log naming O as counterpart — both directions work (FR-001).
  - A third account with no thread on that listing calling `recordTransaction()` on that `threadId` gets `not_a_participant` (FR-001).
  - A nonexistent or wrong-community `threadId` gets `not_found`.
  - The community not `ACTIVE` (e.g. `SUSPENDED`) gets `community_not_active` when creating (research.md #4).
  - The derived counterpart (or the recorder) lacking current membership gets `not_a_member` — no log created (FR-002).
  - The same (recorder, thread) pair can record a second, independent transaction after the first already exists (Edge Cases — no dedup/limit).
  - Both the recorder and the counterpart can fetch the log via `getTransaction()`/`listTransactions()`; a third party gets `not_a_party` (FR-016).
  - After the listing (and its thread) is deleted via `deleteListing()`, a previously created `Transaction` referencing it is still returned unchanged by `getTransaction()`/`listTransactions()`, with its `listingTitle` snapshot intact (FR-017).
  - For every thread, the derived `counterpartId` always differs from the calling `recorderAccountId` — assert no code path can produce `recorderId === counterpartId` on a created row, regardless of which participant calls `recordTransaction()` (FR-013; guards the "structurally impossible by derivation" claim in data-model.md as a real regression test, not just a design argument).
  - A `recordTransaction()` call is unaffected by, and never persists, any extra/unexpected field (e.g. an `amount` or `priceCents` value) — the created row has no such column and the function signature accepts none (FR-010).
  - `Listing.status` (fetched via `prisma.listing.findUnique()`) is unchanged — still `ACTIVE` — immediately after both `recordTransaction()` and, in the Phase 4 extension of this same file, `confirmTransaction()` (FR-012).
  - Every field returned by `recordTransaction()`, `getTransaction()`, and `listTransactions()` is limited to `id`/`displayName`/enum/timestamp/title values — assert no returned object anywhere contains an `email`, `phone`, or address field (FR-015, SC-005; written here as a red-then-green contract test rather than deferred to a Polish-phase code review).

  Confirm this file FAILS (red) — `transactionService.ts` doesn't exist yet.

### Implementation

- [X] T003 [US1] Create `src/server/services/transactionService.ts`: import `requireCommunityMembership()` from `listingService.ts`; implement `recordTransaction({ communityId, threadId, recorderAccountId })` — loads the `MessageThread` with its `listing`, rejects `not_found` if absent or its `operationalEpoch` doesn't match the community's current one (mirrors `sendThreadMessage()`'s check); rejects `not_a_participant` if `recorderAccountId` is neither `thread.buyerId` nor `thread.listing.ownerId`; derives `counterpartId` as whichever of that pair is not the recorder; checks the community is `ACTIVE`; checks both `recorderAccountId` and `counterpartId` currently hold membership (`not_a_member` otherwise); creates the `Transaction` row (`UNCONFIRMED`, `OFF_PLATFORM`, `listingTitle` snapshot from `thread.listing.title`). Implement `getTransaction({ communityId, transactionId, callerAccountId })` and `listTransactions(communityId, callerAccountId)` — both check `requireCommunityMembership(callerAccountId, communityId, { allowSuspended: true })`, then restrict to rows where the caller is `recorderId` or `counterpartId` (`not_a_party` for `getTransaction()` when found but caller isn't a party). Confirm T002 passes (green).
- [X] T004 [P] [US1] Create `app/api/communities/[communityId]/threads/[threadId]/transaction/route.ts` — `POST` (no body) calls `recordTransaction()`, maps results per contracts/transactions-api.md (`201`, `403 not_a_member`/`not_a_participant`, `404`, `409 community_not_active`/`not_a_member`).
- [X] T005 [P] [US1] Create `app/api/communities/[communityId]/transactions/route.ts` — `GET` calls `listTransactions()`, maps per contracts/transactions-api.md (`200`, `403 not_a_member`).
- [X] T006 [P] [US1] Create `app/api/communities/[communityId]/transactions/[transactionId]/route.ts` — `GET` calls `getTransaction()`, maps per contracts/transactions-api.md (`200`, `403 not_a_member`/`not_a_party`, `404`).

### Tests ⚠️ Write first, confirm red

- [X] T007 [US1] Write `tests/integration/test_transactions_flow.spec.ts` (Playwright): a buyer with an existing thread on a listing signs in, opens that thread, triggers "Record transaction"; the listing's owner signs in, opens the same thread, sees the log listed as `UNCONFIRMED`; both then separately visit the community's `transactions` list page and see it. Confirm it FAILS (red) — no record action or transactions pages exist yet.

### Implementation

- [X] T008 [P] [US1] Extend `app/communities/[communityId]/threads/[threadId]/page.tsx` (008-listing-messaging) with a "Record transaction" action for either participant, posting to T004's route with no fields to fill in (counterpart/listing are derived server-side); on success, show the resulting log's state inline.
- [X] T009 [P] [US1] Create `app/communities/[communityId]/transactions/page.tsx` (lists every log from T005's route where the caller is a party, newest first) and `app/communities/[communityId]/transactions/[transactionId]/page.tsx` (one log's full detail via T006's route). Confirm T007 passes (green).

**Checkpoint**: MVP — either thread participant can record a transaction, and it's visible to both, including via a standalone page independent of the thread.

---

## Phase 4: User Story 2 - The counterpart confirms the transaction (Priority: P1)

**Goal**: The account named as counterpart can confirm an `UNCONFIRMED` log, locking its core facts in permanently.

**Independent Test**: The named counterpart on an unconfirmed log confirms it; the log's state becomes `CONFIRMED`; none of its core facts can subsequently be changed by either party; no other account can confirm it.

### Tests ⚠️ Write first, confirm red

- [X] T010 [US2] Extend `tests/contract/test_transactions.ts`:
  - `confirmTransaction(transactionId, counterpartId)` transitions an `UNCONFIRMED` log to `CONFIRMED` and sets `confirmedAt` (FR-005).
  - The recorder attempting to confirm their own log gets `not_a_counterpart` (FR-005).
  - Any third account attempting to confirm gets `not_a_counterpart`.
  - Re-confirming an already-`CONFIRMED` log is a no-op — returns the same `CONFIRMED` state, `confirmedAt` unchanged (data-model.md gate 4).
  - There is no exported function in `transactionService.ts` capable of modifying any core field (`recorderId`, `counterpartId`, `listingId`, `listingTitle`, `communityId`, `paymentPath`, `createdAt`) of a `CONFIRMED` (or any) `Transaction` — confirmed by inspecting the module's exports (FR-007).
  - `Listing.status` is unchanged — still `ACTIVE` — immediately after `confirmTransaction()` (FR-012, completing T002's creation-side case for the same requirement).

  Confirm these cases FAIL (red) — `confirmTransaction()` doesn't exist yet.

### Implementation

- [X] T011 [US2] Implement `confirmTransaction({ communityId, transactionId, callerAccountId })` in `transactionService.ts`: checks `requireCommunityMembership(callerAccountId, communityId, { allowSuspended: true })` (research.md #4); loads the transaction (`not_found` if absent); rejects `not_a_counterpart` if `callerAccountId !== transaction.counterpartId`; if already `CONFIRMED`, returns it unchanged (idempotent); otherwise updates `confirmationState: "CONFIRMED"`, `confirmedAt: now`. Confirm T010 passes (green).
- [X] T012 [P] [US2] Create `app/api/communities/[communityId]/transactions/[transactionId]/confirm/route.ts` — `POST` (no body) calls `confirmTransaction()`, maps per contracts/transactions-api.md (`200`, `403 not_a_member`/`not_a_counterpart`, `404`).

### Tests ⚠️ Write first, confirm red

- [X] T013 [US2] Extend `tests/integration/test_transactions_flow.spec.ts`: the counterpart signs in, opens the thread (or the transaction detail page) showing the `UNCONFIRMED` log, confirms it; the state updates to `CONFIRMED` for both parties on reload; the recorder's view shows no confirm action for their own log. Confirm it FAILS (red) — no confirm action exists yet.

### Implementation

- [X] T014 [US2] Add a "Confirm" action to the thread page (T008) and the transaction detail page (T009), rendered only for the signed-in account matching the log's `counterpartId` while `UNCONFIRMED`, posting to T012's route. Confirm T013 passes (green).

**Checkpoint**: User Stories 1 and 2 both independently verified — the full record → confirm loop works end to end.

---

## Phase 5: User Story 3 - Cross-community and non-member attempts are rejected (Priority: P1)

**Goal**: A transaction log can never be created or confirmed between two accounts that are not both current members of the referenced community.

**Independent Test**: Two accounts not sharing a community cannot log a transaction between them; a co-member whose membership lapses between logging and confirming cannot have that confirmation succeed, while the log itself is untouched.

### Tests ⚠️ Write first, confirm red

- [X] T015 [US3] Extend `tests/contract/test_transactions.ts`:
  - With an existing thread and an already-created `UNCONFIRMED` log, removing the counterpart's `Membership` row, then calling `confirmTransaction()` as that counterpart, gets `not_a_member` — the log remains `UNCONFIRMED`, untouched (FR-003).
  - Removing the recorder's or the derived counterpart's membership before `recordTransaction()` is called (i.e. either party is no longer current) gets `not_a_member` at creation time, even though a thread still exists between them (FR-002).
  - Suspending the community (009-platform-administration `communityLifecycleService.ts`), then attempting `recordTransaction()` on an existing thread, gets `community_not_active`; `confirmTransaction()` on an already-existing `UNCONFIRMED` log in that same `SUSPENDED` community still succeeds (research.md #4).
  - Archiving the community, then attempting either `recordTransaction()` or `confirmTransaction()`, gets `not_a_member` (an `ARCHIVED` community fails `requireCommunityMembership()` outright, regardless of `allowSuspended`).

  Confirm these cases FAIL if any gate from T003/T011 is missing; if all already pass, this phase locks the guarantee in as regression coverage (mirrors 008's own Phase 6 pattern for its membership-revocation guarantee).

### Implementation

- [X] T016 [US3] Only if any T015 case is red: adjust `transactionService.ts`'s gates in `recordTransaction()`/`confirmTransaction()` so every case in T015 passes. (All T015 cases passed on the first run — no fix needed. One real gap was found and fixed independently during T004's route mapping: the counterpart-not-a-member case at creation needed its own `counterpart_not_a_member` reason, distinct from the caller's `not_a_member`, since the two map to different HTTP statuses — see contracts/transactions-api.md.)

**Checkpoint**: User Stories 1-3 independently verified — the community-isolation guarantee named in Constitution Principle II/IV holds for every logging and confirmation path.

---

## Phase 6: User Story 4 - The non-intermediary disclosure is always shown (Priority: P2)

**Goal**: Before recording or confirming a transaction, a member sees a clear statement that CMarket is not a financial intermediary and takes no responsibility for the payment.

**Independent Test**: Opening the logging flow and the confirmation flow independently both show the non-intermediary disclosure before the action is submitted.

### Tests ⚠️ Write first, confirm red

- [X] T017 [US4] Extend `tests/integration/test_transactions_flow.spec.ts`: before submitting "Record transaction" on the thread page, the non-intermediary disclosure text is visibly present; before submitting "Confirm" (on either the thread page or the transaction detail page), the same disclosure is visibly present. Confirm it FAILS (red) — no disclosure text exists in either UI surface yet.

### Implementation

- [X] T018 [US4] Create a small shared `app/communities/[communityId]/_components/NonIntermediaryDisclosure.tsx` component with the required statement (Constitution Principle IV, FR-014) and render it above both the "Record transaction" action (T008) and the "Confirm" action (T014) on the thread page and the transaction detail page. Confirm T017 passes (green).

**Checkpoint**: All four user stories independently verified.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T019 [P] Run `npm run typecheck` and `npx eslint .`; fix any issues introduced by this feature. (One lint error found and fixed: a test helper variable named `module` collided with `@next/next/no-assign-module-variable`; renamed to `transactionServiceModule`.)
- [X] T020 [P] Run `npm run test:unit` (covers `tests/unit` and `tests/contract`, including this feature's full `test_transactions.ts`) and `npm run test:e2e` (Playwright, including `test_transactions_flow.spec.ts`); confirm the whole suite is green, including a regression check that 002-009's existing tests still pass unmodified. (226/226 unit+contract tests pass. Full e2e run showed 9 timeouts in unrelated pre-existing files under full parallelism; isolated re-runs with fewer workers passed all of them except one pre-existing Google OAuth mock-server config failure, unrelated to this feature — see plan.md's T022 re-check note for detail.)
- [X] T021 Manually execute quickstart.md Scenarios 1-8 against the real dev/test PostgreSQL database and a running dev server; record the results. (Scenarios 1, 4 satisfied by `test_transactions_flow.spec.ts`'s three Playwright tests; Scenarios 2, 3, 5, 6, 7 satisfied by `test_transactions.ts`'s contract-test cases (not_a_participant/not_found rejection, cross-community/suspended/archived gating, listing-deletion survival, no-contact-data assertion, repeat transactions); Scenario 8 satisfied by the T020 suite runs.)
- [X] T022 Re-check plan.md's Constitution Check against the finished implementation — see plan.md's own post-implementation re-check note for the full grep/test evidence.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately.
- **Foundational (Phase 2)**: No tasks — `requireCommunityMembership()` is reused as-is. Phase 3 only needs Phase 1's migration.
- **Phase 3 (US1)**: Depends on Setup. BLOCKS Phases 4-6 (each extends the same `transactionService.ts` file).
- **Phase 4 (US2)**: Depends on Phase 3 (adds `confirmTransaction()` to `transactionService.ts`; reuses the `Transaction` rows Phase 3 creates and the pages Phase 3 built).
- **Phase 5 (US3)**: Depends on Phase 4 (verifies/hardens the membership-check behavior both prior phases' entry points already rely on).
- **Phase 6 (US4)**: Depends on Phase 5 (adds UI-only disclosure text to the surfaces built in Phases 3-4).
- **Polish (Phase 7)**: Depends on all prior phases being complete.

### Parallel Opportunities

- T004, T005, T006 are [P] — three different route files, all depending only on the already-green T003.
- T008 and T009 are [P] — different files (thread-page extension vs. new transactions pages), both depending only on T003-T006.
- T019 and T020 (Polish) — independent checks, can run in parallel.

---

## Parallel Example: Phase 3 (US1)

```bash
# T004, T005, T006 touch different route files and all depend only on the already-green T003:
Task: "Create POST .../threads/[threadId]/transaction/route.ts"
Task: "Create GET .../transactions/route.ts"
Task: "Create GET .../transactions/[transactionId]/route.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Complete Phase 1 (Setup).
2. Complete Phase 3 (T002-T009).
3. **STOP and VALIDATE**: run quickstart.md Scenario 1 (creation half); confirm T002 and T007 are both green.
4. This is a partial MVP: a log can be created and viewed by both parties, but nothing is trustworthy yet without Phase 4's confirmation.

### Incremental Delivery

1. Setup → foundation ready (no separate Foundational-phase work needed).
2. Phase 3 (US1) → a transaction can be recorded and viewed by both parties.
3. Phase 4 (US2) → confirmation makes a log trustworthy; this is the first genuinely complete slice.
4. Phase 5 (US3) → community-isolation guarantee locked in as regression coverage.
5. Phase 6 (US4) → required disclosure text shipped.
6. Polish.

---

## Notes

- [P] tasks touch different files with no dependency on each other; tasks sharing a file with a sibling task in the same phase are intentionally sequenced instead.
- [Story] labels map every task to the spec.md story whose acceptance criterion it satisfies.
- Commit after each task or logical group.
- Stop at any checkpoint to validate independently.
- Both Vitest (contract) and Playwright (integration) are used, matching 005-009 — this feature extends real pages/routes for Playwright to exercise.
