---
description: "Task list for Chat Conversation UI Redesign"
---

# Tasks: Chat Conversation UI Redesign

**Input**: Design documents from `/specs/016-chat-conversation-redesign/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/thread-conversation-api.md](./contracts/thread-conversation-api.md), [quickstart.md](./quickstart.md)

**Tests**: This chat UI redesign is not on Constitution Principle VIII's named critical-flow list (it changes no business rule) — but spec.md's own Success Criteria (SC-001 through SC-008) commit to automated verification, so this file includes them as required, not optional, mirroring 012-profiles-reputation's and 014-account-public-profiles' identical treatment of their own specs (plan.md, Testing).

**Organization**: Tasks are grouped by user story (spec.md priorities P1/P1/P2/P2/P2). All five stories touch `app/communities/[communityId]/threads/[threadId]/page.tsx`, so they are sequenced (not parallel) to avoid repeated merge conflicts on that one file — same rationale as every prior feature in this codebase that shared a single central file across stories.

## Path Conventions

Single existing Next.js/Prisma project (extends 002-015), per plan.md's Structure Decision — no new top-level project, no schema/migration changes.

---

## Phase 1: Setup (Shared Infrastructure)

**No tasks.** This feature introduces no new dependency and ships zero `prisma/schema.prisma` changes (plan.md Storage) — there is nothing to initialize. Proceed directly to Phase 2.

---

## Phase 2: Foundational (Blocking Prerequisites)

**No tasks.** Unlike 012/014, no piece of this feature is a genuine prerequisite for *every* story: User Stories 1–3 need nothing beyond what `getThread()` already returns today, and only User Story 4 needs the one small service extension (research.md #6) — so that work lives inside User Story 4's own phase below, not here, keeping Stories 1–3 provably independent of any backend change. Proceed directly to Phase 3.

---

## Phase 3: User Story 1 - Instantly tell who sent what (Priority: P1) 🎯 MVP

**Goal**: Every message in a thread renders inside its own bubble — the signed-in account's own messages right-aligned in one style, the other participant's left-aligned in a visually distinguishable style — with correct sizing, wrapping, padding, and a subtle timestamp, applied directly to the conversation's current rendering with no other structural change yet.

**Independent Test**: Open a thread with messages from both participants and confirm every message the signed-in account sent is right-aligned and styled one way, every message from the other participant is left-aligned and styled distinguishably, long text wraps within a bounded bubble width with visible padding, each bubble shows a small light timestamp, and the order is chronological.

### Tests for User Story 1 ⚠️ Write first, confirm red

- [X] T001 [US1] Create `tests/integration/test_thread_conversation_ui.spec.ts` (Playwright) with a first test covering User Story 1's acceptance scenarios: seed a thread with messages from both a listing owner and a buyer, sign in as one of them, and assert every message that account sent is right-aligned and styled distinctly from every message the other account sent (assert via a data attribute or class distinguishing "own" vs. "counterpart," not by raw position alone); assert a long message wraps without producing horizontal page scroll; assert a very short message and a very long message each size to their own content (neither bubble occupying the full panel width) with visible internal spacing around the text; assert every message shows a timestamp; assert messages appear in chronological (send) order; assert no per-message sender-name label exists anymore (the old `data-testid="message"` header line naming the sender is gone). Confirm this FAILS (red) — the current page still renders every message identically with a per-message sender-name link and no bubble styling.

### Implementation for User Story 1

- [X] T002 [US1] Rewrite the message-rendering block in `app/communities/[communityId]/threads/[threadId]/page.tsx`: for each message, compute `isOwnMessage = message.senderId === account.accountId`; replace the existing per-message header line (sender name link + timestamp) and plain paragraph with a single bubble element whose alignment (`justify-end`/`justify-start` on its row, or equivalent) and background/text/border styling depend on `isOwnMessage` (own: brand-tint background; counterpart: neutral surface background with a hairline border — research.md #7); cap each bubble's width at roughly three-quarters of the panel, wrap long text, give it comfortable padding on all sides, and show `message.createdAt` formatted and styled smaller/lighter than the body text. Confirm T001 passes (green).

**Checkpoint**: MVP — messages are now instantly distinguishable by sender, independent of the rest of the redesign.

---

## Phase 4: User Story 2 - Open a thread inside a real conversation window (Priority: P1)

**Goal**: The thread page renders as one dedicated, centered conversation panel — a header, a message area, and a composer — instead of a plain page of stacked content, with a defined empty state when a thread has no messages yet.

**Independent Test**: Open any existing thread and confirm it renders as one panel containing a header, a message area, and a composer, visibly narrower than the full desktop width and tall enough for several messages at once; open a thread with zero messages and confirm a simple empty state appears with the composer still present and usable; confirm the existing Chats hub and a listing's thread list still land on this same route.

### Tests for User Story 2 ⚠️ Write first, confirm red

- [X] T003 [US2] Extend `tests/integration/test_thread_conversation_ui.spec.ts`: opening an existing thread renders one visually grouped panel containing a header region, a message region, and the composer, and — at a desktop-sized viewport — the panel is visibly narrower than the full page width with several messages visible without scrolling; a thread seeded with zero messages shows a "Start the conversation" empty state in place of the message list while the composer remains present and usable; navigating from `/chats` and from `/communities/{communityId}/threads` (the per-listing inbox) into a thread still lands on `/communities/{communityId}/threads/{threadId}`. Confirm this FAILS (red) — the current page has no panel grouping, no width constraint, and no empty state.

### Implementation for User Story 2

- [X] T004 [US2] Restructure `app/communities/[communityId]/threads/[threadId]/page.tsx` into a single centered panel (a bounded-width, `rounded-card`/`shadow-card` container) holding the existing header content, the message area (User Story 1's bubbles) below it, and the composer beneath that; add the "Start the conversation" empty state rendered in place of the message list exactly when `messages.length === 0`, with the composer still rendered outside that conditional. Restyle `app/communities/[communityId]/threads/[threadId]/ThreadReplyForm.tsx`'s markup only (textarea + Send button laid out as an attached composer row) — its `onSubmit` handler, endpoint, and validation-driven error display are untouched. Confirm T003 passes (green).

**Checkpoint**: Both P1 stories complete — the conversation now looks and is structured like a real chat window.

---

## Phase 5: User Story 3 - Scroll a long conversation without losing your place (Priority: P2)

**Goal**: Opening a long conversation leaves its newest message immediately visible with no manual scrolling, and sending a new message keeps that new message immediately visible too — while the header and composer stay fixed and only the message area itself scrolls.

**Independent Test**: Seed a thread with enough messages to exceed the visible message area, open it, and confirm the newest message is already visible with no scrolling; send a new message and confirm it is likewise immediately visible with no scrolling, with the header and composer unaffected; scroll up and confirm only the message area moves.

### Tests for User Story 3 ⚠️ Write first, confirm red

- [X] T005 [US3] Extend `tests/integration/test_thread_conversation_ui.spec.ts`: seed a thread with enough messages (e.g., 25+) to exceed a typical message-area height, open it, and assert the newest message's bubble is within the visible viewport with no manual scroll performed; send a new message via the composer and assert that new message is likewise within the visible viewport with no manual scroll; scroll the message area up and assert the header and composer remain in their fixed positions (only the message area's own scroll position changes). Confirm this FAILS (red) — the message area has no scroll-to-latest behavior yet.

### Implementation for User Story 3

- [X] T006 [US3] Create `app/communities/[communityId]/threads/[threadId]/ChatScrollArea.tsx` (`"use client"`): accepts `children` (the server-rendered message bubbles) and a `messageCount: number` prop; renders the scrollable message-area container with an empty bottom-sentinel `<div>` (with a `ref`) after `children`; a `useEffect` keyed on `[messageCount]` calls `scrollIntoView()` (or equivalent) on that sentinel. No other state, no network calls. Wire it into `page.tsx` around the message list (or empty state), passing `messages.length` as `messageCount`. Confirm T005 passes (green).

**Checkpoint**: All three of the core reading/writing/scrolling stories are independently functional.

---

## Phase 6: User Story 4 - Know who you're talking to, without seeing anything private (Priority: P2)

**Goal**: The chat header reliably shows the other participant's display name (clickable, opening their existing public profile) and the related listing's title when available — correctly, even when the signed-in account has sent every message in the thread so far — and no part of the redesigned chat ever shows contact, authentication, or raw-identifier data.

**Independent Test**: Open a thread (including one where the caller has sent every message so far, with the counterpart never having replied) and confirm the header shows the counterpart's display name and, when available, the listing title; confirm clicking the name opens the existing public profile; confirm no email, phone, address, authentication data, or raw internal identifier appears anywhere on the page or in its underlying data.

### Tests for User Story 4 (contract) ⚠️ Write first, confirm red

- [X] T007 [P] [US4] Extend `tests/contract/test_messaging.ts`: `getThread()`'s successful result now includes `thread.counterpartId` and `thread.counterpartDisplayName`, correct from either participant's point of view (buyer sees the listing owner's identity and vice versa) — including the case where the caller has sent every message in the thread so far and the counterpart has sent none (asserting the identity still resolves correctly, not blank and not the caller's own). Confirm this FAILS (red) — `GetThreadResult`'s `thread` object doesn't have these fields yet.

### Implementation for User Story 4 (service)

- [X] T008 [US4] Extend `getThread()` in `src/server/services/messageService.ts`: add `owner: { select: { displayName: true } }` under the existing `listing` include, and add a sibling `buyer: { select: { displayName: true } }` include on the thread query; compute `isOwner = thread.listing.ownerId === callerAccountId`, then `counterpartId = isOwner ? thread.buyerId : thread.listing.ownerId` and `counterpartDisplayName = isOwner ? thread.buyer.displayName : thread.listing.owner.displayName` (the identical derivation `listThreads()`/`listMyThreads()` already use in this same file); add both fields to the returned `thread` object and to the `GetThreadResult` type. No other function, gate, or route in this file changes. Confirm T007 passes (green).

### Tests for User Story 4 (integration) ⚠️ Write first, confirm red

- [X] T009 [P] [US4] Extend `tests/integration/test_thread_conversation_ui.spec.ts`: the header shows the counterpart's display name and the listing title when the thread has one; the header still correctly shows the counterpart's name in a thread where the caller has sent every message so far; clicking the header's display name navigates to `/communities/{communityId}/members/{counterpartId}` (the existing public profile page); a counterpart with no display name set shows the existing neutral placeholder, never their email; inspecting the full rendered page and its data finds no email address, phone number, physical address, authentication data, or raw message/thread/account ID shown as visible text anywhere. Confirm this FAILS (red) — the header currently shows only the listing title, no counterpart identity or profile link.

### Implementation for User Story 4 (page)

- [X] T010 [US4] In `app/communities/[communityId]/threads/[threadId]/page.tsx`, replace the plain `PageHeader title={thread.listingTitle}` with a chat header showing `resolveDisplayName(thread.counterpartDisplayName)` as a `Link` to `/communities/{communityId}/members/{thread.counterpartId}`, plus the listing title as secondary text shown only when present. Confirm T009 passes (green).

**Checkpoint**: The conversation now correctly identifies who you're talking to in every reachable case, with the profile link and privacy guarantees fully in place.

---

## Phase 7: User Story 5 - Use the conversation comfortably on any device (Priority: P2)

**Goal**: The same conversation panel works cleanly at both common desktop and common mobile viewport widths — centered and comfortably sized on desktop, full-width and overflow-free on mobile — with alignment and the composer both remaining usable at every width.

**Independent Test**: Open the same thread at a common desktop width and a common mobile width and confirm the panel adapts appropriately at each, alignment and bubble styling remain correct, the composer stays usable, and nothing overflows horizontally at either size.

### Tests for User Story 5 ⚠️ Write first, confirm red

- [X] T011 [US5] Extend `tests/integration/test_thread_conversation_ui.spec.ts` with a mobile-viewport pass (Playwright's mobile viewport/device emulation): open the same seeded thread at a common mobile width and assert no horizontal scrolling appears anywhere on the page, right/left alignment is unchanged from the desktop pass, and the composer's text input and Send button remain visible and usable. Confirm this FAILS (red) if the desktop-only layout from prior stories overflows or misbehaves at mobile widths.

### Implementation for User Story 5

- [X] T012 [US5] Adjust the panel, bubble, and composer styling in `app/communities/[communityId]/threads/[threadId]/page.tsx` (and `ThreadReplyForm.tsx` if needed) with mobile-specific responsive classes: the panel uses the full available width below the desktop breakpoint (no fixed desktop max-width applied), bubble max-width remains a proportion of the (now full-width) panel rather than a fixed pixel value, and the composer's controls remain full-width and reachable. Confirm T011 passes (green).

**Checkpoint**: All five user stories independently functional — the redesign is complete on both desktop and mobile.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T013 Run `npx tsc --noEmit` and `npx eslint .` — zero errors.
- [X] T014 Run `npm run test:unit` — the full suite, including the extended `tests/contract/test_messaging.ts`, must pass alongside every pre-existing 002-015 contract test unaffected.
- [X] T015 Run `npm run test:e2e` for this feature's new `test_thread_conversation_ui.spec.ts` plus the full existing suite — in particular `test_messaging_flow.spec.ts` and `test_profile_view.spec.ts` (both exercise this same thread page) — confirming no regression beyond the intentional removal of the per-message sender-name link (research.md #2), which neither existing test's link lookup depends on the location of.
- [X] T016 Walk through `quickstart.md`'s 7 scenarios end-to-end (manually or via the tests above already covering them) and confirm each passes.
- [X] T017 Re-check `plan.md`'s Constitution Check against the finished implementation: confirm `getThread()`'s existing authorization gate (`not_a_member`/`not_found`/`not_a_participant`) is byte-for-byte unchanged; `grep -rniE "email|phone|address" app/communities/*/threads/*/page.tsx app/communities/*/threads/*/ThreadReplyForm.tsx` returns nothing; `git diff --stat -- package.json package-lock.json` shows no changes (no new dependency); `git diff --stat -- prisma/schema.prisma` shows no changes (zero migration surface, as planned).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)** and **Foundational (Phase 2)**: No tasks — nothing to depend on.
- **User Story 1 (Phase 3)**: No dependencies. Can start immediately.
- **User Story 2 (Phase 4)**: No functional dependency on User Story 1, but sequenced after it in this file since both rewrite `page.tsx` — building on User Story 1's already-styled bubbles avoids redoing that work inside the panel restructure.
- **User Story 3 (Phase 5)**: Depends on User Story 2's panel/message-area structure existing (`ChatScrollArea` wraps that same message area).
- **User Story 4 (Phase 6)**: Independent of Stories 1–3 in principle (it only touches the header and `messageService.ts`), but sequenced after them here since all edit the same `page.tsx`.
- **User Story 5 (Phase 7)**: Depends on Stories 2 and 4 for there to be a panel and header worth making responsive; sequenced last.
- **Polish (Phase 8)**: Depends on all five user stories being complete.

### Within Each User Story

- Contract test (T007) before its service implementation (T008); integration test before its own page implementation — tests MUST be written first and confirmed failing (spec.md's Success Criteria commitment, mirroring 012/014's own precedent).
- Story complete (its own checkpoint) before moving to the next.

### Parallel Opportunities

- T007 (contract test, `tests/contract/test_messaging.ts`) and T009 (integration test, `tests/integration/test_thread_conversation_ui.spec.ts`) can be authored in parallel — different files, and both are red tests that don't need each other's implementation to exist yet.
- No other cross-task parallelism is expected: every implementation task in this feature edits `page.tsx` (or, for T006/T008, a file that `page.tsx`'s next task immediately consumes), so tasks within a story — and stories themselves — are effectively sequential by shared-file necessity, consistent with this feature's deliberately small file footprint (plan.md, Complexity Tracking).

---

## Parallel Example: User Story 4

```bash
# Once Phase 5 (User Story 3) is committed:
Task: "Extend tests/contract/test_messaging.ts for getThread()'s new counterpartId/counterpartDisplayName fields"   # T007
Task: "Extend tests/integration/test_thread_conversation_ui.spec.ts for the header's identity/profile-link/privacy"  # T009
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 3: User Story 1 (message alignment and bubbles).
2. **STOP and VALIDATE**: open an existing thread, confirm every message is correctly right/left-aligned and bubble-styled, per spec.md's own User Story 1 Acceptance Scenarios.
3. Deploy/demo if ready — the rest of the page (plain header, plain composer, no scroll behavior) is unchanged at this point, so nothing else regresses.

### Incremental Delivery

1. User Story 1 (MVP) → validate independently → deploy/demo.
2. Add User Story 2 (panel structure + empty state) → validate independently → deploy/demo.
3. Add User Story 3 (scroll-to-latest) → validate independently → deploy/demo.
4. Add User Story 4 (header identity, profile link, privacy) → validate independently, including the "caller sent every message" case → deploy/demo.
5. Add User Story 5 (mobile/desktop responsiveness) → validate independently → deploy/demo.
6. Polish (Phase 8) → full-suite and Constitution re-check.

---

## Notes

- [P] tasks = different files, no ordering dependency for *authoring* them (a red test still logically precedes its own green implementation).
- [Story] label maps task to specific user story for traceability; Setup, Foundational, and Polish tasks carry no story label.
- This feature ships zero `prisma/schema.prisma` changes — no migration task exists anywhere in this file, by design (plan.md Storage).
- The only backend change in this entire feature is T008 (two fields added to `getThread()`'s existing response) — every other task is presentation-layer only.
