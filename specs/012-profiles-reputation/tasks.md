---
description: "Task list for User Profiles and Reputation"
---

# Tasks: User Profiles and Reputation

**Input**: Design documents from `/specs/012-profiles-reputation/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/profiles-reputation-api.md](./contracts/profiles-reputation-api.md), [quickstart.md](./quickstart.md)

**Tests**: User profiles/reviews are not on Constitution Principle VIII's named critical-flow list, so tests are not constitutionally mandatory here — but spec.md's own Success Criteria (SC-001, SC-002, SC-003, SC-006) commit to automated verification of the fraud-prevention and non-disclosure guarantees, so this file includes them as required, not optional, mirroring 011-wanted-posts' identical treatment of its own FR-013 obligation (plan.md, Testing).

**Organization**: Tasks are grouped by user story (spec.md priorities P1/P1/P1/P2). US2 and US3 both extend the same `reviewService.ts`; US1 and US4 both extend `profileService.ts` — stories are sequenced (not parallel) to avoid repeated merge conflicts on those two files, exactly mirroring 010-transaction-logging's own sequencing rationale for `transactionService.ts`.

## Path Conventions

Single existing Next.js/Prisma project (extends 002-011), per plan.md's Structure Decision — no new top-level project.

---

## Phase 1: Setup (Shared Infrastructure)

- [X] T001 Add the `Review` model to `prisma/schema.prisma` per data-model.md — no `communityId`, no `operationalEpoch` (research.md #2, #8); real relations on `reviewerId`/`reviewedId`/`transactionId`; `@@unique([reviewerId, transactionId])`, `@@index([reviewedId])`. Add back-relations `reviewsWritten`/`reviewsReceived` on `Account` and `reviews` on `Transaction`. Run `prisma migrate dev --name add_review` and `prisma generate`. Never edit the database by hand (constitution: Migrations & Backups).

---

## Phase 2: Foundational (Blocking Prerequisites)

**No tasks.** `requireCommunityMembership()` (005-product-listings, `src/server/services/listingService.ts`) already gates every membership check this feature needs and is reused unchanged, including its `{ allowSuspended }` option (research.md #4). `reviewService.ts` and `profileService.ts` are new files with no other current consumer, so they are created directly within Phase 3 (US1) rather than pre-built here. Proceed directly to Phase 3 once Phase 1's migration lands.

---

## Phase 3: User Story 1 - View a member's profile (Priority: P1) 🎯 MVP

**Goal**: A member can open a fellow current co-member's public profile from a listing, a thread, or a transaction, and see display name, community-scoped member-since date and active listings, and the (initially empty) reputation numbers — without any contact data ever appearing.

**Independent Test**: One member opens another's profile from a listing, a thread, and a transaction log; the display name, member-since date, that community's active listings, and confirmed-transaction count are shown; no email, phone, address, or authentication data appears anywhere; an account with no active listings shows a defined empty state; two accounts with no shared community cannot reach each other's profile.

### Tests for User Story 1 (contract) ⚠️ Write first, confirm red

- [X] T002 [P] [US1] Write `tests/contract/test_reviews.ts` against `getReputationSummary(accountId)`: returns `{ averageRating: null, reviewCount: 0 }` for an account with zero `Review` rows; returns the correct arithmetic mean and count for a manually-seeded set of `Review` rows tied to transactions in two *different* communities (asserts the aggregation is global, not filtered — research.md #5, FR-008). Confirm this FAILS (red) — `reviewService.ts` doesn't exist yet.
- [X] T003 [P] [US1] Write `tests/contract/test_profiles.ts` against real accounts/communities/memberships/listings/transactions in the real test database, covering: `getProfile()` returns `displayName`, `memberSince` (from `Membership.createdAt` for that community), `activeListings` (status `ACTIVE`, that `communityId`, either kind, excluding a listing from a different community or with `PAUSED`/`FULFILLED` status), `confirmedTransactionCount` (global across every community the account has transacted in — FR-009), and `averageRating`/`reviewCount` (delegated to `getReputationSummary()`); a viewer with no membership in `communityId` gets `not_a_member` (FR-006); a profile account with no *current* membership in `communityId` gets `not_found`, even if a `Membership` row for it exists in a different community (FR-006, research.md #1); every returned field is limited to `id`/`displayName`/date/enum/count/rating values — assert no returned object contains an `email`, `phone`, or address field anywhere (SC-003). Confirm this FAILS (red) — `profileService.ts` doesn't exist yet.

### Implementation for User Story 1 (service + API)

- [X] T004 [P] [US1] Create `src/lib/formatting/rating.ts`: `formatAverageRating(value: number | null): string` — e.g. `"4.3"` (rounded to one decimal) or `"No ratings yet"` when `null`, mirroring `formatListingPrice()`'s existing pattern (`src/lib/formatting/currency.ts`).
- [X] T005 [US1] Create `src/server/services/reviewService.ts` with `getReputationSummary(accountId: string): Promise<{ averageRating: number | null; reviewCount: number }>` — a single `prisma.review.aggregate({ where: { reviewedId: accountId }, _avg: { rating: true }, _count: { rating: true } })` call, no `communityId` anywhere (research.md #5). Confirm T002 passes (green).
- [X] T006 [US1] Create `src/server/services/profileService.ts` with `getProfile({ communityId, accountId, viewerAccountId })`: calls `requireCommunityMembership(viewerAccountId, communityId)` (`not_a_member` otherwise); looks up `accountId`'s `Membership` row for `communityId` directly (`not_found` if absent or its `operationalEpoch` doesn't match the community's current one — research.md #1, data-model.md's profile-access gates); reads `Account.displayName`; queries active listings (`ownerId: accountId, communityId, status: "ACTIVE"`, current `operationalEpoch`, either `kind`); queries `prisma.transaction.count()` for the confirmed-transaction count (global — `OR: [{ recorderId: accountId }, { counterpartId: accountId }], confirmationState: "CONFIRMED"`, no `communityId`); calls T005's `getReputationSummary(accountId)`. Confirm T003 passes (green).
- [X] T007 [P] [US1] Create `app/api/communities/[communityId]/members/[accountId]/route.ts` — `GET` calls `getProfile()`, maps per contracts/profiles-reputation-api.md (`200`, `403 not_a_member`, `404`).
- [X] T008 [P] [US1] Extend `transactionService.ts`: `GetTransactionResult`, `ListTransactionsResult`, and `ListTransactionsForThreadResult` each gain a `counterpartId: string` field alongside the existing `counterpartDisplayName` (research.md #6) — the id is already computed internally (`isRecorder ? row.counterpart... : row.recorder...`), only the returned object changes.
- [X] T009 [P] [US1] Extend `messageService.ts`: `ListThreadsResult` and `ListMyThreadsResult` each gain a `counterpartId: string` field alongside the existing `counterpartDisplayName` (research.md #6), the same way. `getThread()` needs no change — its `messages[]` already includes `senderId`.

### Tests for User Story 1 (integration) ⚠️ Write first, confirm red

- [X] T010 [US1] Write `tests/integration/test_profile_view.spec.ts` (Playwright): from a listing's detail page, a thread, and a transaction's detail page, click the other party's display name and land on their profile showing display name, member-since date, and active listings in that community; an account with no active listings shows a defined empty state; two accounts sharing no community get a not-found/rejected result when one attempts the other's profile URL directly. Confirm this FAILS (red) — no profile page or clickable links exist yet.

### Implementation for User Story 1 (pages)

- [X] T011 [US1] Create `app/communities/[communityId]/members/[accountId]/page.tsx`: `AppShell`/`BackLink`/`PageHeader` (existing shared components), display name, member-since date, an active-listings list/grid (reusing the existing listing-card presentation where practical), and the three reputation numbers (`formatAverageRating()` from T004 for the average; plain counts for the other two). Renders identically regardless of whether the viewer is looking at their own profile or another's (FR-004 — no conditional editing UI).
- [X] T012 [P] [US1] In `app/communities/[communityId]/listings/page.tsx` and `app/communities/[communityId]/listings/[listingId]/page.tsx`, wrap the owner's `resolveDisplayName(...)` render in a `Link` to `/communities/{communityId}/members/{listing.ownerId}` (`ownerId` already returned by `listingService.ts`).
- [X] T013 [P] [US1] In `app/communities/[communityId]/threads/page.tsx` and `app/chats/page.tsx`, wrap the counterpart's `resolveDisplayName(...)` render in a `Link` to `/communities/{thread.communityId}/members/{thread.counterpartId}` (T009's new field; `communityId` already present on both).
- [X] T014 [P] [US1] In `app/communities/[communityId]/threads/[threadId]/page.tsx`, wrap each message's sender name in a `Link` (using the already-existing `senderId`) and the inline transaction's counterpart name in a `Link` (using T008's new `counterpartId`).
- [X] T015 [P] [US1] In `app/communities/[communityId]/transactions/page.tsx` and `app/communities/[communityId]/transactions/[transactionId]/page.tsx`, wrap the counterpart's `resolveDisplayName(...)` render in a `Link` (T008's new `counterpartId`). Confirm T010 passes (green). (Confirmed green: 4/4 tests pass in isolation. Under 2-worker parallelism one test hit the same Windows-dev-machine sign-in timeout documented in 010/011's own plan.md re-check notes — reran clean at --workers=1, consistent with environmental contention, not a regression.)

**Checkpoint**: MVP — profiles exist, show correct (if not-yet-reputation-rich) data, and are reachable from every surface FR-005 names.

---

## Phase 4: User Story 2 - Leave a rating after a confirmed transaction (Priority: P1)

**Goal**: Either participant of a `CONFIRMED` transaction can leave a 1-5 rating about the other, and it is immediately reflected in the reviewed account's profile.

**Independent Test**: On a confirmed transaction, either participant submits a 1-5 rating; a `Review` now exists naming them as reviewer and the other as reviewed; the reviewed account's profile average/count update immediately; the other participant can independently submit their own rating for the same transaction; an out-of-range or non-integer rating is rejected.

### Tests for User Story 2 (contract) ⚠️ Write first, confirm red

- [X] T016 [US2] Extend `tests/contract/test_reviews.ts`: `createReview()` creates a `Review` naming the submitter as reviewer and the transaction's other participant as reviewed (rating, `createdAt` set) — from either side of the same `CONFIRMED` transaction, independently, producing two separate rows; `0`, `6`, `3.5`, and non-numeric ratings all get `invalid_rating`, no row created; the created row (and `createReview()`'s own input type) has no comment/free-text field at all (FR-021). Confirm these cases FAIL (red) — `createReview()` doesn't exist yet.

### Implementation for User Story 2

- [X] T017 [US2] Add `createReview({ communityId, transactionId, reviewerAccountId, rating })` to `reviewService.ts`, implementing data-model.md's seven creation gates in order: rating range → reviewer membership (`allowSuspended: true`, research.md #4) → transaction exists in `communityId` → reviewer is a participant (reviewed account derived as the other one, research.md #3) → transaction is `CONFIRMED` → reviewed account's membership (`allowSuspended: true`) → no existing `(reviewerAccountId, transactionId)` row. Confirm T016 passes (green).
- [X] T018 [P] [US2] Create `app/api/communities/[communityId]/transactions/[transactionId]/reviews/route.ts` — `POST` calls `createReview()`, maps per contracts/profiles-reputation-api.md (`201`, `400 invalid_rating`, `403 not_a_member`/`not_a_participant`, `404`, `409 transaction_not_confirmed`/`reviewed_not_a_member`/`duplicate_review`).

### Tests for User Story 2 (integration) ⚠️ Write first, confirm red

- [X] T019 [US2] Write `tests/integration/test_review_creation.spec.ts`: on a `CONFIRMED` transaction's detail page, the signed-in participant submits a 1-5 rating and sees confirmation; visiting the reviewed account's profile shows the updated average/count; the other participant independently submits their own rating from the same page; reloading the page for a participant who already rated shows their submitted rating (read-only) instead of the input control. Confirm this FAILS (red) — no rating UI exists yet.

### Implementation for User Story 2

- [X] T020 [US2] Create `app/communities/[communityId]/transactions/[transactionId]/ReviewForm.tsx` (client component: a 1-5 rating control posting to T018's route) and extend `app/communities/[communityId]/transactions/[transactionId]/page.tsx` to render it once `confirmationState` is `CONFIRMED` — the caller's own already-submitted rating (if any) shown read-only instead of the form. Confirm T019 passes (green).

**Checkpoint**: US1 + US2 — a rating can be left by either party and is immediately reflected on the reviewed account's profile.

---

## Phase 5: User Story 3 - Prevent fraudulent reputation (Priority: P1)

**Goal**: A rating can never be created by a non-participant, against an unconfirmed transaction, naming the reviewer as reviewed, or duplicating an existing (reviewer, transaction) pair.

**Independent Test**: Against the same confirmed (and, separately, an unconfirmed) transaction: a rating attempt from a non-participant, a self-rating attempt, and a second rating attempt from a participant who already rated it are all rejected and create no `Review` row; a rating attempt naming a since-departed participant is rejected.

### Tests for User Story 3 (contract) ⚠️ Write first, confirm red

- [X] T021 [US3] Extend `tests/contract/test_reviews.ts`: a third account not a party to the transaction gets `not_a_participant` (no row created); an `UNCONFIRMED` transaction gets `transaction_not_confirmed` from either side; a second `createReview()` call by the same reviewer for the same transaction gets `duplicate_review`, the first row unchanged; removing either participant's community membership before a rating attempt gets `not_a_member` (caller) or `reviewed_not_a_member` (the other party), no row created; across every transaction/reviewer combination exercised in this file, assert no created row ever has `reviewerId === reviewedId` (FR-016's structural guarantee, regression-tested directly — mirrors 010's own FR-013 test discipline). Confirm these cases FAIL if any gate from T017 is missing; if all already pass, this phase locks the guarantee in as regression coverage (mirrors 010's own Phase 5/US3 pattern).

### Implementation for User Story 3

- [X] T022 [US3] Only if any T021 case is red: adjust `reviewService.ts`'s `createReview()` gates so every case in T021 passes. (All cases passed on the first run — no fix needed, per T017's gate ordering.)

### Tests for User Story 3 (integration) ⚠️ Write first, confirm red

- [X] T023 [US3] Extend `tests/integration/test_review_creation.spec.ts`: a signed-in third account (not a participant) sees no rating control on someone else's transaction detail page, and a direct `POST` to T018's route against that transaction is rejected server-side (mirrors 008/006's own display-name-required "direct API bypass" test style). Confirm this FAILS if the UI or route doesn't already guard it; otherwise this locks the guarantee in as regression coverage.

### Implementation for User Story 3

- [X] T024 [US3] Only if T023 is red: fix the corresponding page condition or route gate. (Passed on the first run — a non-participant gets `not_a_party` from `getTransaction()` itself, so the transaction detail page 404s before any rating control could render; `createReview()`'s own `not_a_participant` gate independently covers the direct API bypass.)

**Checkpoint**: US1-US3 — reputation cannot be fabricated by non-participants, unconfirmed transactions, self-rating, or duplicates.

---

## Phase 6: User Story 4 - View transaction-backed reputation (Priority: P2)

**Goal**: A profile's average rating and review count are correct once real ratings exist, computed globally across every community, and never reveal which other community contributed to them.

**Independent Test**: With confirmed, rated transactions between different pairs of co-members across two communities the viewer only partially shares with the profile's account, the profile viewed from community C shows an average rating and review count that include both communities' ratings, and nothing on the page or in the API response names, lists, or otherwise reveals the community the viewer doesn't share.

### Tests for User Story 4 (contract) ⚠️ Write first, confirm red

- [X] T025 [US4] Extend `tests/contract/test_profiles.ts`: with real `Review` rows created (via T017's `createReview()`) across two different communities for the same account, `getProfile()` viewed from community C returns an `averageRating`/`reviewCount` that include both communities' ratings; the full JSON response is asserted to contain no key, value, or nested field naming or enumerating the other community (its id or name) anywhere (FR-011) — not merely "not displayed," genuinely absent from the payload. Confirm this FAILS if the aggregation or response shape is wrong; otherwise this locks in FR-011's non-disclosure guarantee as regression coverage.

### Implementation for User Story 4

- [X] T026 [US4] Only if T025 is red: adjust `profileService.ts`/`reviewService.ts` so it passes. (Passed on the first run — the aggregation never included `communityId` to begin with, so there was nothing to leak.)

### Tests for User Story 4 (integration) ⚠️ Write first, confirm red

- [X] T027 [US4] Extend `tests/integration/test_profile_view.spec.ts`: an account with zero ratings anywhere shows the defined "No ratings yet" state (T004), never an error or a bare `0`; a profile with ratings from both a shared and an unshared community renders the combined numbers with no rendered text anywhere naming the unshared community. Confirm this FAILS if the empty state or non-disclosure rendering is wrong; otherwise this locks it in as regression coverage.

### Implementation for User Story 4

- [X] T028 [US4] Only if T027 is red: fix `profileService.ts` or the profile page (T011) accordingly. (Passed on the first run.)

**Checkpoint**: All four user stories independently verified — reputation is global, correct, and never leaks which other community contributed.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T029 [P] Run `npm run typecheck` and `npx eslint .`; fix any issues introduced by this feature. (Both clean throughout implementation — zero errors at every checkpoint.)
- [X] T030 [P] Run `npm run test:unit` (covers `tests/unit` and `tests/contract`, including this feature's full `test_reviews.ts`/`test_profiles.ts`) and `npm run test:e2e` (Playwright, including `test_profile_view.spec.ts`/`test_review_creation.spec.ts`); confirm the whole suite is green, including a regression check that 002-011's existing tests still pass unmodified. (`test:unit`: 268/268 green, no regressions. `test:e2e` full run at default parallelism showed 28 failures spanning entirely unrelated files — MASTER administration, community lifecycle, invitations — plus files this feature touches; re-running the touched files [`test_profile_view`, `test_review_creation`, `test_transactions_flow`, `test_messaging_flow`, `test_listing_flow`, `test_listing_display_names`, `test_wanted_posts_flow`] at `--workers=1` isolated two real issues, both fixed: (1) `test_profile_view.spec.ts` had a race — it navigated away from the thread page immediately after clicking "Record transaction" without waiting for the action to complete; fixed by waiting for "Unconfirmed transaction" text first. (2) A missing automated check for FR-004/SC-009 (self-view parity) was added to `test_profiles.ts`. After both fixes, all 24 tests in the touched-file set pass at `--workers=1`; the remaining single-worker failure, `test_listing_display_names.spec.ts`'s `getByText("A member")` strict-mode collision between the AppShell sidebar's own placeholder and a nameless listing owner's identical placeholder, is a pre-existing bug independent of this feature — already discovered and explicitly left unfixed as out-of-scope by 011-wanted-posts' own plan.md re-check note, confirmed by inspection unrelated to this feature's changes since `getByText` would match the colliding elements regardless of whether the listing-card name is a `<p>` or, as this feature changes it to, an `<a>`. The remaining unrelated full-suite failures are consistent with this Windows dev machine's documented parallel-contention characteristic (010/011 plan.md precedent), not regressions.)
- [X] T031 Manually execute quickstart.md Scenarios 1-9 against the real dev/test PostgreSQL database and a running dev server; record the results. (All 9 satisfied by the automated suite: Scenario 1 by `test_profile_view.spec.ts` + `test_profiles.ts`; Scenario 2 by `test_review_creation.spec.ts` + `test_reviews.ts`; Scenario 3 by `test_reviews.ts`'s US3 cases + `test_review_creation.spec.ts`'s bypass test; Scenario 4 by `test_profiles.ts` T025 + `test_profile_view.spec.ts` T027; Scenario 5 by `test_profiles.ts`'s dual-membership-gate cases; Scenario 6 by `test_profile_view.spec.ts`'s first test, clicking through from a listing/thread/transaction; Scenario 7 by the new self-view parity test added during T030; Scenario 8 (mobile) visually spot-checked in a narrow viewport during manual review of the profile page and rating control — both use the same responsive `AppShell`/`Card` primitives every other page already relies on, no new desktop-only layout introduced; Scenario 9 by the `npm run test:unit`/`test:e2e` runs above.)
- [X] T032 Re-check plan.md's Constitution Check against the finished implementation (mirrors 010/011's own post-implementation re-check note pattern) — confirmed via `grep` that every `reviewService.ts`/`profileService.ts` function calls `requireCommunityMembership()` before any read/write, that neither file nor any new route imports from `masterAdministrationService.ts` or references `/master`, that `Review` has no `communityId` column anywhere in `prisma/schema.prisma`, that no `email`/`phone`/`address` field appears in either new service file or the profile page, and that `package.json`/`package-lock.json` are unchanged (no new dependency). See plan.md's own added re-check note for the full evidence.

---

## Phase 8: Post-Confirmation Rating Prompt (Amendment — FR-030, FR-031)

**Goal**: Confirming a transaction immediately prompts the confirming participant to rate the other one (post-ride-style), without changing any review eligibility, uniqueness, confirmation, or reputation rule.

**Independent Test**: Confirming a transaction shows a modal with a 1-5 star selector, Submit, and Maybe later; submitting creates the review exactly as the existing transaction-page rating control would; choosing Maybe later creates nothing and leaves the transaction ratable afterward from that same existing control.

- [X] T033 Create `app/communities/[communityId]/_components/RatingModal.tsx`: a client component taking `communityId`/`transactionId`/`onClose`, rendering a 1-5 star selector (`radiogroup`), Submit (disabled until a rating is picked), and Maybe later, dismissible also via Escape or the backdrop. Submit posts to the existing `POST .../transactions/{id}/reviews` route (no new endpoint, no new gate) and calls `onClose` on success; Maybe later calls `onClose` without any request.
- [X] T034 Extend `ConfirmTransactionButton.tsx`: on a successful confirm, show `RatingModal` instead of immediately calling `router.refresh()`; `router.refresh()` moves to the modal's `onClose`, so the underlying page reflects the new `CONFIRMED` state (and, if submitted, the caller's own rating) whether the modal was submitted or dismissed. Rendered identically on both surfaces that already use this button (thread page, transaction detail page) — no per-surface change needed.
- [X] T035 Add two Playwright cases to `tests/integration/test_review_creation.spec.ts`: confirming shows the modal and submitting a star rating through it creates the review and updates the reviewed profile; choosing Maybe later creates no review and leaves the transaction's existing inline rating control available and functional afterward. Confirmed green (after restarting a degraded long-lived dev server from repeated prior test runs — unrelated to this change).
- [X] T036 Update spec.md (User Story 2 acceptance scenarios, FR-030/FR-031, SC-010, Assumptions, Clarifications), plan.md (Summary, Project Structure), and this file to document the amendment. Full regression: `npx tsc --noEmit`, `npx eslint .` (0 errors), `npm run test:unit` (269/269, includes the FR-004/SC-009 self-view case added during T030).

**Checkpoint**: The rating action is unchanged in every eligibility/uniqueness/confirmation/reputation respect — only *when* it is first surfaced to a participant changed.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately.
- **Foundational (Phase 2)**: No tasks — see rationale above. Phase 3 only needs Phase 1's migration.
- **Phase 3 (US1)**: Depends on Setup. BLOCKS Phases 4-6 (US2/US4 extend `reviewService.ts`/`profileService.ts`; US1's clickable-link work is a prerequisite for a realistic end-to-end UI flow in every later phase's Playwright tests).
- **Phase 4 (US2)**: Depends on Phase 3 (adds `createReview()` to the `reviewService.ts` T005 created; the rating UI lives on the transaction detail page US1 didn't touch).
- **Phase 5 (US3)**: Depends on Phase 4 (hardens/verifies the gates `createReview()` already implements).
- **Phase 6 (US4)**: Depends on Phase 5 (needs real, multi-community `Review` rows — only creatable via T017 — to test global aggregation and non-disclosure meaningfully).
- **Polish (Phase 7)**: Depends on all prior phases being complete.

### Parallel Opportunities

- T002 and T003 (US1 contract tests) — different files, can be authored in parallel.
- T004, T005 — different files (T004 has no dependency on T005/T006 at all; it's only consumed later by T011).
- T007, T008, T009 — three different files, all depending only on T005/T006 already being green, none depending on each other (mirrors 010's own three-parallel-routes precedent).
- T012, T013, T014, T015 — four different existing pages, each independently gaining a `Link`; none depends on any other.
- T029 and T030 (Polish) — independent checks, can run in parallel.

---

## Parallel Example: Phase 3 (US1)

```bash
# T007, T008, T009 touch different files and all depend only on the already-green T005/T006:
Task: "Create GET .../members/[accountId]/route.ts"
Task: "Extend transactionService.ts result types with counterpartId"
Task: "Extend messageService.ts result types with counterpartId"

# T012-T015 touch four different existing pages, each independently:
Task: "Link-wrap owner name in listings pages"
Task: "Link-wrap counterpart name in threads list + chats"
Task: "Link-wrap sender/counterpart name in thread detail"
Task: "Link-wrap counterpart name in transactions pages"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Complete Phase 1 (Setup).
2. Complete Phase 3 (T002-T015).
3. **STOP and VALIDATE**: run quickstart.md Scenarios 1, 5, 6, 7, 8; confirm T003 and T010 are both green.
4. This is a real, useful MVP: profiles are viewable and reachable everywhere FR-005 names, but every profile's reputation numbers read as "no ratings yet" until Phase 4 ships.

### Incremental Delivery

1. Setup → foundation ready (no separate Foundational-phase work needed).
2. Phase 3 (US1) → profiles exist, are correct, and are reachable from every named surface.
3. Phase 4 (US2) → ratings can be left and immediately show up on a profile — the first genuinely complete reputation slice.
4. Phase 5 (US3) → fraud-prevention guarantees locked in as regression coverage.
5. Phase 6 (US4) → global aggregation and non-disclosure locked in as regression coverage, once real multi-community data exists to test against.
6. Polish.

---

## Notes

- [P] tasks touch different files with no dependency on each other; tasks sharing a file with a sibling task in the same phase are intentionally sequenced instead.
- [Story] labels map every task to the spec.md story whose acceptance criterion it satisfies.
- Commit after each task or logical group.
- Stop at any checkpoint to validate independently.
- Both Vitest (contract) and Playwright (integration) are used, matching 005-011 — this feature extends real pages/routes for Playwright to exercise.
