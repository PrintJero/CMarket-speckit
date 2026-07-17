---
description: "Task list for Listing Messaging"
---

# Tasks: Listing Messaging

**Input**: Design documents from `/specs/008-listing-messaging/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/messaging-api.md](./contracts/messaging-api.md), [quickstart.md](./quickstart.md)

**Tests**: Messaging is not on the constitution's named critical-flow list, but this feature's own spec.md Assumptions explicitly commit to the same discipline: tests are MANDATORY, MUST be written before their corresponding implementation, and MUST be confirmed failing (red) before that implementation is written — because this feature handles other members' personal data (identity, conversation content).

**Organization**: Tasks are grouped by user story (spec.md priorities P1/P1/P2/P3). Every story extends the same underlying `messageService.ts`, so stories are sequenced (not parallel) to avoid repeated merge conflicts on that one file and its shared internal helper.

## Path Conventions

Single existing Next.js/Prisma project (extends 002-accounts-authentication, 003-community-creation, 004-invitations-membership, 005-product-listings, 006-user-display-names, 007-listing-discovery), per plan.md's Structure Decision — no new top-level project.

---

## Phase 1: Setup (Shared Infrastructure)

- [X] T001 Add `MessageThread` and `Message` models to `prisma/schema.prisma` per data-model.md (`@@unique([listingId, buyerId])` on `MessageThread`; `onDelete: Cascade` on both new models' foreign keys, mirroring the existing `Listing` → `ListingPhoto` pattern), plus back-relations on `Listing` and `Account`. Run `prisma migrate dev --name add_message_thread_and_message` and `prisma generate`. Never edit the database by hand (constitution: Migrations & Backups).

---

## Phase 2: Foundational (Blocking Prerequisites)

**No new foundational primitive is needed.** `requireCommunityMembership()` (005-product-listings, `src/server/services/listingService.ts`) already gates every action this feature needs — this feature reuses it unchanged. Proceed directly to Phase 3 once Phase 1's migration lands.

---

## Phase 3: User Story 1 - A buyer asks the owner about a listing (Priority: P1) 🎯 MVP

**Goal**: A member can open a message thread with a listing's owner from that listing, and the two can go back and forth.

**Independent Test**: A member opens a listing that isn't their own, sends a message, and the listing's owner sees the new thread and can reply, with both people seeing the full back-and-forth in order.

### Tests ⚠️ Write first, confirm red

- [X] T002 [US1] Write `tests/contract/test_messaging.ts` against real accounts/communities/memberships/listings in the real test database (seed helper accounts with a `displayName` set, mirroring `tests/contract/test_listings.ts`'s `createVerifiedAccount()` pattern), covering:
  - A buyer's first message to a listing's owner creates a `MessageThread` and its first `Message` (FR-001).
  - A second message from the same buyer to the same listing reuses the existing thread — no second thread is created (FR-002, `@@unique([listingId, buyerId])`).
  - The owner can reply within that thread, and the buyer's next fetch of it shows both messages in send order (FR-003, FR-004).
  - A member attempting to message their own listing gets `cannot_message_own_listing` (FR-013).
  - A brand-new thread cannot be started against a `PAUSED` listing (`listing_paused`), but a reply within an _existing_ thread on a listing that is later paused still succeeds (FR-016, research.md #4).
  - An empty, whitespace-only, or over-2,000-character message body is rejected as `invalid_message` on both the first-message and reply paths (FR-012).
  - A caller with no `Membership` in the listing's community cannot create or reply to a thread (`not_a_member`, FR-008).
  - The thread's owner and its buyer can each fetch it via `getThread()` (FR-005, FR-006 happy path).
  - Deleting the listing (`deleteListing()`, 005-product-listings) removes its threads and messages (FR-015) — confirm via a direct `prisma.messageThread.findUnique()`/`prisma.message.findMany()` returning nothing afterward.

  Confirm this file FAILS (red) — `messageService.ts` doesn't exist yet.

### Implementation

- [X] T003 [US1] Create `src/server/services/messageService.ts`: import `requireCommunityMembership()` from `listingService.ts`; add an internal `createMessage()` helper that trims and validates `body` (non-empty, ≤2,000 chars, `invalid_message` otherwise — display-name check deferred to US3, research.md #5); implement `sendMessageToListingOwner({ communityId, listingId, buyerAccountId, body })` (checks membership, rejects self-message, find-or-creates the `(listingId, buyerAccountId)` thread inside one `prisma.$transaction` with its first message when new, checking `status === "ACTIVE"` only on creation per research.md #4); implement `sendThreadMessage({ communityId, threadId, senderAccountId, body })` (checks membership and that the sender is the thread's buyer or its listing's owner, then calls `createMessage()`); implement `getThread({ communityId, threadId, callerAccountId })` (checks membership and participant status, returns the thread plus its messages ordered by `createdAt` ascending with each sender's `displayName`). Confirm T002 passes (green).
- [X] T004 [P] [US1] Create `app/api/communities/[communityId]/listings/[listingId]/messages/route.ts` — `POST` parses `{ body }`, calls `sendMessageToListingOwner()`, maps results to status codes per contracts/messaging-api.md (`201`/`200`, `400 invalid_message`, `403 not_a_member`/`cannot_message_own_listing`, `404`, `409 listing_paused`).
- [X] T005 [P] [US1] Create `app/api/communities/[communityId]/threads/[threadId]/route.ts` — `GET` calls `getThread()`, maps results per contracts/messaging-api.md (`200`, `403 not_a_member`/`not_a_participant`, `404`).
- [X] T006 [P] [US1] Create `app/api/communities/[communityId]/threads/[threadId]/messages/route.ts` — `POST` parses `{ body }`, calls `sendThreadMessage()`, maps results per contracts/messaging-api.md (`201`, `400 invalid_message`, `403`, `404`).

### Tests ⚠️ Write first, confirm red

- [X] T007 [US1] Write `tests/integration/test_messaging_flow.spec.ts` (Playwright): a buyer signs in, opens a listing that isn't theirs, sends a message; the listing's owner signs in, navigates to the resulting thread, sees the message, and replies; the buyer reloads the thread page and sees the reply in order. Confirm it FAILS (red) — no message composer or thread page exists yet.

### Implementation

- [X] T008 [P] [US1] Create `app/communities/[communityId]/listings/[listingId]/MessageOwnerForm.tsx` (client component: a text field + submit, posting to T004's route) and wire it into `app/communities/[communityId]/listings/[listingId]/page.tsx` for non-owner viewers only (`!isOwner`, mirroring the existing `isOwner` check already on that page); on success, navigate to the returned thread's page.
- [X] T009 [P] [US1] Create `app/communities/[communityId]/threads/[threadId]/page.tsx` (fetches via T005's route server-side, `notFound()` on `403`/`404`, renders each message with its sender's `displayName` — via `resolveDisplayName()` — and timestamp) and `app/communities/[communityId]/threads/[threadId]/ThreadReplyForm.tsx` (client component posting to T006's route, then `router.refresh()`). Confirm T007 passes (green).

**Checkpoint**: MVP — a buyer can open a thread from a listing and both sides can converse.

---

## Phase 4: User Story 2 - Everyone sees only the threads they belong to (Priority: P1)

**Goal**: A listing owner sees every thread across all of their listings; a buyer sees only the threads they personally started.

**Independent Test**: Two different buyers each open separate threads with the same listing's owner; the owner sees both threads, each buyer sees only their own, and neither buyer can see the other's messages.

### Tests ⚠️ Write first, confirm red

- [X] T010 [US2] Extend `tests/contract/test_messaging.ts`:
  - Two different buyers each message the same listing's owner → the owner's `listThreads()` returns both threads; each buyer's `listThreads()` returns only their own (FR-005, FR-006).
  - A third member with no thread of their own (including a community administrator with no thread of their own — FR-007, Clarifications) attempting `getThread()` on either thread gets `not_a_participant`, not the thread's contents.

  Confirm these cases FAIL (red) — `listThreads()` doesn't exist yet.

### Implementation

- [X] T011 [US2] Implement `listThreads(communityId, callerAccountId)` in `src/server/services/messageService.ts`: checks membership, then returns every thread in `communityId` where the caller is the thread's listing's `ownerId` OR its `buyerId` (`listing: { communityId }` relation filter, research.md #1), each with `listingId`, `listingTitle`, the counterpart's `displayName`, and the most recent message's time/preview, ordered by most-recent-message-first. Confirm T010 passes (green).
- [X] T012 [P] [US2] Create `app/api/communities/[communityId]/threads/route.ts` — `GET` calls `listThreads()`, maps per contracts/messaging-api.md (`200`, `403 not_a_member`).

### Tests ⚠️ Write first, confirm red

- [X] T013 [US2] Extend `tests/integration/test_messaging_flow.spec.ts`: with two buyers' threads on the same owner's listing, the owner visits the community's threads inbox and sees both; each buyer visits their own inbox and sees only their own thread. Confirm it FAILS (red) — no inbox page exists yet.

### Implementation

- [X] T014 [US2] Create `app/communities/[communityId]/threads/page.tsx` — the caller's inbox: lists every thread from T012's route (listing title, counterpart display name, last message preview/time), each linking to its `app/communities/[communityId]/threads/[threadId]/page.tsx` (T009). Confirm T013 passes (green).

**Checkpoint**: User Stories 1 and 2 both independently verified — conversation plus correct owner/buyer visibility scoping.

---

## Phase 5: User Story 3 - A nameless account is asked to choose a name before it can speak (Priority: P2)

**Goal**: An account with no display name is required to set one before its first message can be sent.

**Independent Test**: A brand-new email/password account with no listings and no display name attempts to send a message; it is required to set a display name before the message is accepted, and is not asked again afterward.

### Tests ⚠️ Write first, confirm red

- [X] T015 [US3] Extend `tests/contract/test_messaging.ts`: an account with no `displayName` attempting `sendMessageToListingOwner()` or `sendThreadMessage()` gets `display_name_required`, and neither a `MessageThread` nor a `Message` row is created by the attempt (FR-010); after the account's `displayName` is set, an identical call succeeds; an account that already has a `displayName` is never blocked. Confirm these cases FAIL (red) — no display-name check exists yet in `messageService.ts`.

### Implementation

- [X] T016 [US3] Add the display-name check to `messageService.ts`'s internal `createMessage()` helper (T003) — reject with `display_name_required` before any `Message`/`MessageThread` row is persisted, checked once and shared by both `sendMessageToListingOwner()` and `sendThreadMessage()` (research.md #5, mirroring 006-user-display-names FR-008's "single point of enforcement" precedent in `createListing()`). Confirm T015 passes (green).
- [X] T017 [P] [US3] Update T004's and T006's route handlers to map `display_name_required` to `409 Conflict` per contracts/messaging-api.md. (Already satisfied — both handlers' catch-all `else` branch already returns `409` for any unmatched reason, which now includes `display_name_required`; verified, no code change needed.)

### Tests ⚠️ Write first, confirm red

- [X] T018 [US3] Extend `tests/integration/test_messaging_flow.spec.ts`: a brand-new, nameless account attempts to message a listing owner, is prompted inline for a display name before the message sends (mirroring `ListingForm.tsx`'s existing pattern), the message sends successfully once a name is provided, and a follow-up message from the same account is not prompted again. Confirm it FAILS (red) — no display-name prompt exists in the composer yet.

### Implementation

- [X] T019 [US3] Update `MessageOwnerForm.tsx` (T008) and `ThreadReplyForm.tsx` (T009) to show a required "Display name" field when the signed-in account has none (passed in as a prop, same as `ListingForm.tsx`'s `currentDisplayName`); on submit with no existing name, first `PATCH /api/account/display-name`, then send the message — identical sequencing to `ListingForm.tsx`. Confirm T018 passes (green).

**Checkpoint**: User Stories 1-3 independently verified.

---

## Phase 6: User Story 4 - Losing membership closes the door on that community's threads (Priority: P3)

**Goal**: An account that loses its membership in a community can no longer view or send messages in that community's threads.

**Independent Test**: A buyer with an open thread loses their membership in that community; they can no longer view or send messages in that thread, while the still-current-member owner is unaffected.

### Tests ⚠️ Write first, confirm red

- [X] T020 [US4] Extend `tests/contract/test_messaging.ts`: delete a thread's buyer's `Membership` row directly, then confirm `sendThreadMessage()` and `getThread()` for that (now former) buyer both return `not_a_member`, while the still-current-member owner's `getThread()` on the same thread still succeeds and returns the full, unaffected message history (FR-009). This is expected to already pass, since every entry point already re-checks `requireCommunityMembership()` per call (T003, research.md #3) rather than caching it from thread-creation time — this task locks that guarantee in as a regression test. If it fails, that reveals a caching/staleness bug to fix.

### Implementation

- [X] T021 [US4] Only if T020 is red: fix `messageService.ts` (T020 passed immediately — no fix needed; every entry point already re-checks `requireCommunityMembership()` per call, per research.md #3). so every entry point (`sendMessageToListingOwner`, `sendThreadMessage`, `getThread`, `listThreads`) re-checks `requireCommunityMembership()` for the acting caller at call time, never reusing a membership result cached from an earlier point in the same request or from thread-creation time.

**Checkpoint**: All four user stories independently verified.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T022 [P] Run `npm run typecheck` and `npm run lint`; fix any issues introduced by this feature.
- [X] T023 [P] Run `npm run test:unit` (covers `tests/unit` and `tests/contract`, including this feature's full `test_messaging.ts`) and `npm run test:e2e` (Playwright, including `test_messaging_flow.spec.ts`); confirm the whole suite is green, including a regression check that 002-007's existing tests still pass unmodified.
- [X] T024 Manually execute quickstart.md Scenarios 1-8 (satisfied by the T023 runs against the real dev/test PostgreSQL database and a live dev server — see completion report for the scenario-by-scenario mapping). end-to-end against the real dev/test PostgreSQL database and a running dev server; record the results.
- [X] T025 Re-check plan.md's Constitution Check against the finished implementation: confirm Principle II's community scoping holds on every thread/message path (send, reply, view, list), Principle VI holds (no response anywhere carries an email/phone/contact field, only `displayName`), no administrator special-case path was accidentally introduced (Principle III/Clarifications), no new runtime dependency crept in (Principle VII), and FR-015's cascade delete behaves as verified in T002.

---

## Phase 8: Amendment (2026-07-17) — Thread & Listing Navigability

**Goal**: Today the only path to a thread is the listing page that started it, and a paused listing has no page at all — this amendment adds two cross-community, read-only views ("Chats", "My listings"), both reachable in one step from `AppShell`'s existing sidebar (FR-017–FR-025).

**Independent Test**: An account with threads in two communities (one as owner, one as buyer) and both an ACTIVE and PAUSED owned listing can, from a page other than any thread or listing, reach Chats (grouped by community, correctly side-marked, ordered by recent activity) and My listings (both statuses, correct per-listing thread counts, each linking to its own threads) — with nothing from a community it has since left appearing in either.

### Tests ⚠️ Write first, confirm red

- [X] T026 [Amendment] Extend `tests/contract/test_messaging.ts`: add a case proving `listThreads()` orders by `lastMessageAt` at the database level — create two threads, send a fresh message in the older one, confirm it now sorts first. (This case asserts observable ordering only, so it passed immediately against the pre-amendment in-memory `.sort()` — it does not by itself prove the ordering is DB-driven. T030 still performs the `orderBy`/schema refactor the amendment requires; this test now guards that refactor as a regression test.)
- [X] T027 [Amendment] Extend `tests/contract/test_messaging.ts`: add `listMyThreads(callerAccountId)` coverage — a thread owned in Community A and a thread bought-into in Community B both appear, each correctly marked `role: "owner"`/`role: "buyer"` (FR-019); ordered by `lastMessageAt` descending across communities (FR-020); a thread in a community the caller has since left via a deleted `Membership` does not appear (FR-024); an account with no threads gets `{ ok: true, threads: [] }` (Edge Cases). Confirmed FAILS (red) — `listMyThreads` doesn't exist.
- [X] T028 [Amendment] Extend `tests/contract/test_listings.ts`: add `listMyListings(callerAccountId)` coverage — an ACTIVE and a PAUSED listing the caller owns both appear (FR-021); each shows a `threadCount` matching its actual thread count, computed via a database aggregate, not a fetched-and-counted array (FR-021); a listing in a community the caller has since left does not appear (FR-024); an account with no owned listings gets `{ ok: true, listings: [] }`. Confirm it FAILS (red) — `listMyListings` doesn't exist.

### Implementation

- [X] T029 [Amendment] Add `lastMessageAt DateTime @default(now())` and `@@index([lastMessageAt])` to `MessageThread` in `prisma/schema.prisma` (data-model.md). Run `prisma migrate dev --name add_message_thread_last_message_at` and `prisma generate`.
- [X] T030 [Amendment] In `src/server/services/messageService.ts`: update the internal `insertMessage()` helper to also update its thread's `lastMessageAt` to the new message's `createdAt` (single point of truth, mirroring research.md #5); change `listThreads()` to `orderBy: { lastMessageAt: "desc" }` at the database level, removing its prior in-memory `.sort()`; add `listMyThreads(callerAccountId)` — resolves the caller's current `Membership` community ids first, then one query scoped to `listing: { communityId: { in: ids } }` with an `OR: [{ buyerId: callerAccountId }, { listing: { ownerId: callerAccountId } }]` filter, `orderBy: { lastMessageAt: "desc" }`, computing `role` per row from `listing.ownerId === callerAccountId`. Confirm T026/T027 pass (green).
- [X] T031 [P] [Amendment] In `src/server/services/listingService.ts`: add `listMyListings(callerAccountId)` — resolves the caller's current `Membership` community ids first, then `prisma.listing.findMany({ where: { ownerId: callerAccountId, communityId: { in: ids } } , include: { _count: { select: { threads: true } }, community: { select: { name: true } } } })` (any status, database-computed thread count). Confirm T028 passes (green).
- [X] T032 [P] [Amendment] Create `app/api/chats/route.ts` — `GET` calls `listMyThreads()`.
- [X] T033 [P] [Amendment] Create `app/api/my-listings/route.ts` — `GET` calls `listMyListings()`.
- [X] T034 [Amendment] Add an optional `listingId?: string` option to `listThreads()` (`messageService.ts`, added to its `where` clause — done as part of T030) and parse an optional `?listingId=` query param in `app/api/communities/[communityId]/threads/route.ts`'s `GET` handler, passing it through (contracts/messaging-api.md).

### Tests ⚠️ Write first, confirm red

- [X] T035 [Amendment] Extend `tests/integration/test_messaging_flow.spec.ts` (Playwright): an account with a thread as buyer in Community A and a thread as owner in Community B signs in, visits a page that is neither a listing nor a thread (e.g., home), finds and follows a "Chats" link, sees both communities' sections with correct owner/buyer marking, sends a new message in Community A's thread and confirms it re-sorts to the top on reload, and confirms a different, thread-less account sees an empty Chats page. Confirmed FAILS (red) — no Chats link or page exists yet.
- [X] T036 [Amendment] Extend `tests/integration/test_messaging_flow.spec.ts`: an owner with one ACTIVE and one PAUSED listing (2 threads and 0 threads respectively) signs in, visits a page that is not a listing page, finds and follows a "My listings" link, sees both listings regardless of status with correct thread counts, and follows each listing's threads link (including the zero-thread one, which shows an empty inbox, not an error). Confirmed FAILS (red) — no My listings link or page exists yet.

### Implementation

- [X] T037 [Amendment] Update `app/_components/AppShell.tsx`: add "Chats" (`/chats`) and "My listings" (`/my-listings`) links to the sidebar, alongside the existing "Your communities"/"Account" sections, shown whenever `account` is present — reachable from every authenticated screen since `AppShell` already renders on all of them (spec.md Clarifications, amendment session).
- [X] T038 [P] [Amendment] Create `app/chats/page.tsx`: server component calling `listMyThreads()` directly; groups the already-scoped, already-ordered result by `communityId` for rendering only (spec.md Assumptions); marks each thread by its `role`; links each to its existing `/communities/{communityId}/threads/{threadId}` page; renders an empty state when there are no threads.
- [X] T039 [P] [Amendment] Create `app/my-listings/page.tsx`: server component calling `listMyListings()` directly; renders every listing (any status) with its `threadCount`; links to `/communities/{communityId}/listings/{listingId}` and, when `threadCount > 0`, to `/communities/{communityId}/threads?listingId={listingId}` (T034). Confirm T035/T036 pass (green).

**Checkpoint**: Chats and My listings are both live, reachable in one step from any authenticated screen, correctly scoped/ordered/counted entirely by database queries, with nothing from a departed community appearing in either.

### Polish

- [X] T040 [Amendment] Run `npm run typecheck` and `npx eslint .`; fix any issues introduced by this amendment.
- [X] T041 [Amendment] Run `npm run test:unit` and `npm run test:e2e`; confirm the whole suite is green, including a full regression check of every pre-amendment test (002–008).
- [X] T042 [Amendment] Manually execute quickstart.md Scenarios 9–11 (satisfied by the T041 runs against the real dev/test PostgreSQL database and a live dev server — Scenario 9 by `test_messaging_flow.spec.ts`'s Chats test, Scenario 10 by its My listings test, Scenario 11 by the full suite run).
- [X] T043 [Amendment] Re-check plan.md's amendment Constitution Check against the finished implementation: confirm both new views scope entirely from the caller's own current memberships (Principle II), carry no contact-data field (Principle VI), and introduce no new dependency (Principle VII). Verified: `listMyThreads()`/`listMyListings()` both resolve `communityId` exclusively from a `prisma.membership.findMany({ where: { accountId: callerAccountId } })` query — no caller-suppliable community filter exists to bypass. `grep -n "email\|phone"` across `messageService.ts`, `listingService.ts`, `app/chats/page.tsx`, `app/my-listings/page.tsx` returns no matches. `package.json`/`package-lock.json` unchanged.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately.
- **Foundational (Phase 2)**: No tasks — `requireCommunityMembership()` is reused as-is. Phase 3 only needs Phase 1's migration.
- **Phase 3 (US1)**: Depends on Setup. BLOCKS Phases 4-6 (each extends the same `messageService.ts` file and its shared `createMessage()` helper).
- **Phase 4 (US2)**: Depends on Phase 3 (adds `listThreads()` to `messageService.ts`; reuses `getThread()`'s participant check built in Phase 3).
- **Phase 5 (US3)**: Depends on Phase 4 (adds the display-name check to the `createMessage()` helper built in Phase 3, used by every send path).
- **Phase 6 (US4)**: Depends on Phase 5 (verifies/hardens the membership-check behavior every prior phase's entry points already rely on).
- **Polish (Phase 7)**: Depends on all prior phases being complete.
- **Amendment (Phase 8)**: Depends on Phase 7 being complete — extends `MessageThread` (T029), `messageService.ts`'s `insertMessage()`/`listThreads()` (T030, both already built in Phases 3-4), and `listingService.ts` (T031, already built in the original 005-product-listings feature this branch carries).

### Parallel Opportunities

- T004, T005, T006 are [P] — three different route files, all depending only on the already-green T003.
- T008 and T009 are [P] — different files (listing-page composer vs. new thread page), both depending only on T003-T006.
- T010, T015, and T020 are **NOT** parallel with each other or with T002 — all extend the same file (`tests/contract/test_messaging.ts`).
- T007, T013, and T018 are **NOT** parallel with each other — all extend the same file (`tests/integration/test_messaging_flow.spec.ts`).
- T022 and T023 (Polish) — independent checks, can run in parallel.
- T026 and T027 are **NOT** parallel — both extend `tests/contract/test_messaging.ts`. T028 is a different file (`tests/contract/test_listings.ts`) but depends on the same schema change (T029) as T026/T027, so it's sequenced with them rather than marked [P].
- T031, T032, T033 are [P] — three different files (`listingService.ts`, two new route files), all depending only on the already-green T030/T029.
- T038 and T039 are [P] — different new page files, both depending only on T037.
- T035 and T036 are **NOT** parallel — both extend `tests/integration/test_messaging_flow.spec.ts`.

---

## Parallel Example: Phase 3 (US1)

```bash
# T004, T005, T006 touch different route files and all depend only on the already-green T003:
Task: "Create POST .../listings/[listingId]/messages/route.ts"
Task: "Create GET .../threads/[threadId]/route.ts"
Task: "Create POST .../threads/[threadId]/messages/route.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Complete Phase 1 (Setup).
2. Complete Phase 3 (T002-T009).
3. **STOP and VALIDATE**: run quickstart.md Scenario 1; confirm T002 and T007 are both green.
4. This is a legitimate MVP: a buyer can reach a listing's owner and hold a conversation, tied to that listing.

### Incremental Delivery

1. Setup → foundation ready (no separate Foundational-phase work needed).
2. Phase 3 (US1) → MVP: open a thread, converse.
3. Phase 4 (US2) → correct owner/buyer visibility scoping via an inbox.
4. Phase 5 (US3) → nameless accounts are gated before their first message.
5. Phase 6 (US4) → membership-loss revocation locked in as a regression test.
6. Polish.
7. Phase 8 (Amendment) → Chats and My listings make every thread and every owned listing reachable without a typed URL.

---

## Notes

- [P] tasks touch different files with no dependency on each other; tasks sharing a file with a sibling task in the same phase are intentionally sequenced instead.
- [Story] labels map every task to the spec.md story whose acceptance criterion it satisfies.
- Commit after each task or logical group.
- Stop at any checkpoint to validate independently.
- Both Vitest (contract) and Playwright (integration) are used, matching 005-007 — this feature extends real pages/routes for Playwright to exercise.
