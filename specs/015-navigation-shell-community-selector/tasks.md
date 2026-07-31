---

description: "Task list for Navigation Shell and Community Selector"
---

# Tasks: Navigation Shell and Community Selector

**Input**: Design documents from `/specs/015-navigation-shell-community-selector/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/navigation-shell-api.md

**Tests**: Not a Principle VIII named critical flow. Per the spec's own testing note and plan.md's Constitution Check, automated tests are REQUIRED only for the community-scoping guarantee (User Story 3 / FR-009–FR-011). Those tests are written first below, ordered to fail before the code that makes them pass exists (T002/T003 before T004–T006). All other stories have no mandated test tasks.

**Organization**: Tasks are grouped by user story (spec.md's Story 1–6, in their stated priority order) to enable independent implementation and testing of each.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to
- File paths are exact, matching plan.md's Project Structure

---

## Phase 1: Setup

- [X] T001 Add `activeCommunityId String?` (nullable FK to `Community`, `onDelete: SetNull`) to the `Session` model in `prisma/schema.prisma` (data-model.md); run `npx prisma migrate dev --name add_active_community_to_session`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The session-scoped "active community" plumbing every user story depends on. No story below can be implemented until this phase is complete.

**⚠️ CRITICAL**: T002 and T003 are the tests mandated for the community-scoping guarantee (Story 3). They MUST be written and confirmed failing before T004–T006 make them pass — do not implement first and backfill these.

- [X] T002 [P] Contract test: `POST /api/active-community` returns `403 not_a_member` for a `communityId` the caller does not currently belong to, and `200 ok` for one they do — `tests/contract/test_active_community.ts` (contracts/navigation-shell-api.md). Expect this to fail until T006 exists.
- [X] T003 [P] Contract test: `getCurrentAccount()` returns `activeCommunityId: null` when the underlying `Session.activeCommunityId` refers to a community the caller is no longer a current member of (removed membership, or the community is `ARCHIVED`) — `tests/contract/test_current_account_active_community.ts` (research.md #3). Expect this to fail until T005 exists.
- [X] T004 Extend `src/server/services/sessionService.ts`: add `setActiveCommunity(rawSessionToken, communityId)`; extend `getValidSession()`'s return shape to include the raw stored `activeCommunityId` — reuses the existing `hashToken`/session-lookup pattern, no new lookup path (data-model.md)
- [X] T005 Extend `src/lib/auth/currentAccount.ts`: add `activeCommunityId: string | null` to `CurrentAccountPayload`; `getCurrentAccount()` re-verifies the stored value against `requireCommunityMembership()` (from `src/server/services/listingService.ts`) on every call before including it — makes T003 pass
- [X] T006 Implement `POST /api/active-community` in `app/api/active-community/route.ts`: validate `communityId` via `requireCommunityMembership()` (no `allowSuspended`), then call `setActiveCommunity()` (T004) — makes T002 pass (contracts/navigation-shell-api.md)
- [X] T007 [P] Add `getReputationSummaries(accountIds: string[])` (batched sibling of the existing `getReputationSummary()`) to `src/server/services/reviewService.ts` (research.md #2, data-model.md)

**Checkpoint**: T002 and T003 now pass. Foundation ready — user story implementation can begin.

---

## Phase 3: User Story 1 - Choosing an active community after signing in (Priority: P1) 🎯 MVP

**Goal**: A member reaching the app's top-level entry point with no valid remembered active community sees a selection screen listing exactly their current memberships (or the zero-memberships empty state); selecting one sets it active.

**Independent Test**: Sign in as a member of two communities → selection screen lists exactly those two. Sign in as a member of exactly one → still shown the selector once. Sign in as a member of zero → the defined empty state, no browse/join affordance.

- [X] T008 [US1] Create `app/_components/CommunitySelector.tsx`: renders exactly `account.memberships` (no directory/browse/join affordance anywhere, FR-003/FR-004), each option posting `communityId` to `/api/active-community` (T006) then navigating to `/communities/{communityId}`
- [X] T009 [US1] Rewrite `app/page.tsx` as the entry-point router: no session → unchanged `AuthShell`; zero memberships → unchanged empty-state copy ("You don't belong to any community yet"); a live `account.activeCommunityId` (T005) → server-side `redirect()` to `/communities/{activeCommunityId}` (FR-001a, no selector shown); otherwise → render `CommunitySelector` (T008)

**Checkpoint**: Sign-in → selection (or empty state) → active community set, works end to end.

---

## Phase 4: User Story 2 - The active community's main view (Priority: P1) 🎯 MVP

**Goal**: Once a community is active, its own search bar + For sale/Wanted feed is the member's home screen, with trust-visible cards.

**Independent Test**: With community A active, the search bar and feed show only A's data; toggling to "Wanted" shows only A's wanted posts.

- [X] T010 [US2] Create `app/communities/[communityId]/page.tsx`: member-only gate (matches the existing `/communities/{id}/listings` page's `notFound()` convention); reads `q`/`kind` query params; calls the existing `listListings(communityId, accountId, { search, kind })` unchanged (FR-006/FR-007); passes the account's currently-known `activeCommunityId` down to `MainViewControls` (T011) as a prop — this page's own server render performs no write of any kind (see T011); fully responsive, reusing `AppShell`'s existing mobile pattern (FR-023)
- [X] T011 [P] [US2] Create `app/communities/[communityId]/MainViewControls.tsx`: search input + a two-way For sale/Wanted segmented control (client component, GET-form submission matching `ListingDiscoveryControls.tsx`'s existing pattern, no price-range fields — not requested for this feature); also runs a post-hydration `useEffect` that calls `POST /api/active-community` (T006) with this page's `communityId` only when it differs from the `activeCommunityId` prop passed down from T010 (covers direct links/deep links, spec.md's deep-link Assumption), then `router.refresh()` once that resolves so `AppShell`'s sidebar (T014, reading the same server-rendered `account` prop) stops showing the now-stale previous active community. Deliberately a client-side effect and not a write during T010's server render — see contracts/navigation-shell-api.md's `GET /communities/{communityId}` section for why (Next.js Link prefetching / crawler GETs must never silently reassign a member's active community)
- [X] T012 [US2] Add trust-visible card details to `app/communities/[communityId]/page.tsx`: owner display name, a "verified member" badge (batched current-membership check against the active community, data-model.md), and reputation (`getReputationSummaries()` from T007) per card — never any contact data (FR-024); price via the existing `formatListingPrice()`, never raw cents

**Checkpoint**: US1 + US2 together deliver the full post-sign-in flow into a working main view.

---

## Phase 5: User Story 3 - Community data never leaks across the switch (Priority: P1) 🎯 MVP

**Goal**: No query introduced by this feature ever mixes two communities' data, even for a member of several.

**Independent Test**: A member of A and B never sees B's data while A is active, or vice versa; a member of only one community is still explicitly scoped, not "correct by accident."

- [X] T013 [P] [US3] Integration test (Playwright): a member of communities A and B confirms the main view's feed, search, and toggle (T010–T012) return only the active community's data, with zero carryover after switching (T014); a member of exactly one community confirms the same explicit scoping — `tests/integration/test_navigation_shell.spec.ts` (quickstart.md Scenario 4)

**Checkpoint**: All three P1 stories are independently verified; the isolation guarantee has automated coverage (T002, T003, T013) exactly as the spec requires.

---

## Phase 6: User Story 4 - Switching communities from the sidebar (Priority: P2)

**Goal**: A member can switch their active community from the sidebar without signing out.

**Independent Test**: With A active, tapping the active community's name reveals exactly the member's other current memberships (not A); selecting one re-scopes the main view.

- [X] T014 [US4] Reshape `app/_components/AppShell.tsx`: replace the always-expanded "Your communities" list with the active community's name (from `account.activeCommunityId`) as a collapsed trigger, expandable to reveal the member's OTHER current memberships (excluding the active one, FR-013); selecting one posts to `/api/active-community` (T006) and navigates to that community's main view (T010); a member with only one membership sees an explicit "nothing else to switch to" state rather than a broken/empty expansion (FR-015); reuses the existing mobile drawer pattern unchanged (FR-023)

---

## Phase 7: User Story 5 - Reaching existing surfaces from one consistent sidebar (Priority: P2)

**Goal**: Chats, My listings, Transactions, and Account remain reachable from the sidebar, unchanged, after the Story 4 reshape.

**Independent Test**: Every screen's sidebar still shows Chats/My listings/Transactions/Account/Sign out, each reaching its existing surface with no behavior change.

- [X] T015 [US5] Verify `app/_components/AppShell.tsx`'s existing Chats/My listings/Transactions/Account/Sign out entries remain present, unchanged, and correctly positioned after T014's reshape (FR-016/FR-017/FR-018; quickstart.md Scenario 6) — no route or service touched by this task; adjust only if T014 disturbed their markup or ordering

---

## Phase 8: User Story 6 - Administrators see one extra entry, and nothing more (Priority: P2)

**Goal**: An "Admin" entry appears above "Account" only for administrators of the currently active community.

**Independent Test**: An admin of A (not of B) sees "Admin" above "Account" while A is active; it disappears on switching to B.

- [X] T016 [US6] In `app/_components/AppShell.tsx`, replace the current per-row inline "Admin" link (rendered once per membership in the old always-expanded list) with a single persistent "Admin" nav entry positioned directly above "Account," shown only when the ACTIVE community's own membership has `role === "ADMINISTRATOR"` (FR-019/FR-020); the entry itself links only to the existing `/communities/{activeCommunityId}/admin` route and exposes nothing else (FR-021)

---

## Phase 9: Polish & Cross-Cutting Concerns

- [X] T017 Run quickstart.md's 8 scenarios end-to-end against the implemented feature and confirm each expected outcome

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup (T001). BLOCKS every user story. T002/T003 (tests) must be written and failing before T004–T006 (implementation).
- **User Stories (Phase 3–8)**: All depend on Foundational (Phase 2) completion.
  - US1 (T008–T009) and US2 (T010–T012) are independent of each other in code but together form the MVP entry flow.
  - US3 (T013) depends on US1 and US2 existing (it exercises their UI end-to-end).
  - US4 (T014), US5 (T015), and US6 (T016) all touch `app/_components/AppShell.tsx` sequentially (T014 → T015 → T016) — not parallelizable with each other, but independent of US1/US2/US3's files.
- **Polish (Phase 9)**: Depends on all desired stories being complete.

### Parallel Opportunities

- T002 and T003 (Foundational tests, different files).
- T007 alongside T002–T006 (different file, no dependency).
- T010's page and T011's controls component can be scaffolded in parallel, then T010 wired to import T011.
- US4/US5/US6 (T014–T016) are NOT parallel with each other (same file, sequential edits) but ARE parallel with US1/US2/US3 (T008–T013) since neither touches `AppShell.tsx`.

---

## Implementation Strategy

### MVP First

1. Phase 1 (Setup) → Phase 2 (Foundational, tests-first for the isolation guarantee).
2. Phase 3 (US1) + Phase 4 (US2) + Phase 5 (US3) = the full P1 slice: sign-in → active community → isolated main view, with the mandated scoping tests passing.
3. **STOP and VALIDATE** against quickstart.md Scenarios 1–4 before continuing.

### Incremental Delivery

4. Phase 6 (US4) — sidebar switching.
5. Phase 7 (US5) — confirm consolidated nav survived the reshape.
6. Phase 8 (US6) — admin entry point.
7. Phase 9 — full quickstart.md validation.
