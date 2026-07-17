---

description: "Task list for Listing Discovery"
---

# Tasks: Listing Discovery

**Input**: Design documents from `/specs/007-listing-discovery/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/listing-discovery-api.md](./contracts/listing-discovery-api.md), [quickstart.md](./quickstart.md)

**Tests**: This feature extends 005-product-listings' "product listing" flow, an explicitly named critical flow per Constitution Principle VIII (discovery is how members reach a listing to act on it). Tests are MANDATORY, MUST be written before their corresponding implementation, and MUST be confirmed failing (red) before that implementation is written.

**Organization**: Tasks are grouped by user story (spec.md priorities P1/P1/P2/P3). Every story reads the same underlying `Listing` data through the same `listListings()` function, so stories are sequenced (not parallel) to avoid repeated merge conflicts on that one function and its two call sites (the GET route, the feed page).

**Note**: This is a from-scratch redo of an earlier pass whose uncommitted work (spec/plan/tasks and partial implementation) was lost to an unrelated branch sync. It targets the codebase as it stands today, which already includes a separate, already-shipped amendment (cover photo + owner display name on the feed's card grid) — this feature builds on top of that, per research.md #7.

## Path Conventions

Single existing Next.js/Prisma project (extends `002-accounts-authentication`, `003-community-creation`, `004-invitations-membership`, `005-product-listings`, `006-user-display-names`), per plan.md's Structure Decision — no new top-level project, no new route.

---

## Phase 1: Setup (Shared Infrastructure)

- [X] T001 Replace `@@index([communityId])` with `@@index([communityId, status, createdAt])` on the `Listing` model in `prisma/schema.prisma` (research.md #6 — supports every discovery query's community-scoped, `ACTIVE`-only, newest-first pattern; no new column, no new model), then run `prisma migrate dev --name add_listing_discovery_index` and `prisma generate`. Never edit the database by hand (constitution: Migrations & Backups).

---

## Phase 2: Foundational (Blocking Prerequisites)

**No new foundational primitive is needed.** 005-product-listings' `requireCommunityMembership()` already gates every discovery query (research.md #5) — this feature reuses it unchanged. Proceed directly to Phase 3 once Phase 1's migration lands.

---

## Phase 3: User Story 1 - A member browses their community's listing feed, page by page (Priority: P1) 🎯 MVP

**Goal**: Any member of a community can browse that community's `ACTIVE` listings as a paginated, newest-first feed.

**Independent Test**: Seed a community with more listings than one page holds; request page 1 and assert exactly one page's worth of the newest listings; request page 2 and assert the remainder with no overlap or omission.

### Tests ⚠️ Write first, confirm red

- [X] T002 [US1] Write `tests/contract/test_listing_discovery.ts` covering pagination on the extended `listListings()`, against real accounts/communities/memberships/listings in the real test database (note: `createListing()` requires the caller to have a `displayName` set per the existing display-name amendment — seed helper accounts with one):
  - A community with 25 `ACTIVE` listings → page 1 (default `pageSize`) returns the 20 newest, ordered newest-first, `hasMore: true`; page 2 returns the remaining 5, `hasMore: false`; no listing appears on both pages (FR-003).
  - A `PAUSED` listing in the same community never appears on any page (FR-002).
  - A page number beyond the last page with data → `{ ok: true, listings: [], hasMore: false }`, not an error (FR-008).
  - A caller with no `Membership` in the community → `{ ok: false, reason: "not_a_member" }` (FR-001).

  Confirm this file FAILS (red) — `listListings()` doesn't yet accept pagination options.

### Implementation

- [X] T003 [US1] Extend `listListings(communityId, callerAccountId, options?)` in `src/server/services/listingService.ts`: add `page?: number` and `pageSize?: number` to `options`; clamp `page` to a minimum of 1 and `pageSize` to `DEFAULT_PAGE_SIZE = 20`/`MAX_PAGE_SIZE = 50`; order by `createdAt desc, id desc` (deterministic tie-breaker, research.md #1); fetch `pageSize + 1` rows via `skip`/`take` in the existing `findMany` call (which already includes `owner: { select: { displayName: true } }` and `coverPhotoId` per the existing amendment — preserve both unchanged) and slice to `pageSize` to derive `hasMore` (no separate `COUNT(*)`, research.md #1); return `{ ok: true, listings, page, pageSize, hasMore }`. Confirm T002 passes (green).
- [X] T004 [P] [US1] Extend the `GET` handler in `app/api/communities/[communityId]/listings/route.ts`: parse `page`/`pageSize` query params (default/clamp as above), pass through to `listListings()`, include `page`/`pageSize`/`hasMore` in the `200` response body per contracts/listing-discovery-api.md.

### Tests ⚠️ Write first, confirm red

- [X] T005 [US1] Write `tests/integration/test_listing_discovery_flow.spec.ts` (Playwright): a member signs in to a community seeded with 25+ `ACTIVE` listings, visits `/communities/{communityId}/listings`, asserts 20 listing cards render with a "Next" control, follows it, and asserts the remaining listings render with none repeated from page 1. Confirm it FAILS (red) — the feed page doesn't yet render pagination controls.

### Implementation

- [X] T006 [US1] Extend `app/communities/[communityId]/listings/page.tsx`: read `page`/`pageSize` from the page's `searchParams`, pass them to the existing `listListings()` call, and render Prev/Next controls (as links adjusting only the `page` query param) below the existing card grid — the cards themselves (cover photo, price, owner display name) are unchanged. Confirm T005 passes (green).

**Checkpoint**: MVP. A member can browse their community's full listing set across pages without it ever being loaded in one unbounded response.

---

## Phase 4: User Story 2 - A member searches their community's listings by keyword (Priority: P1)

**Goal**: A member can narrow a community's listings to those whose title or description contains a keyword.

**Independent Test**: Create listings with distinct titles/descriptions in a community; search a keyword matching exactly one; assert only that listing is returned; search a keyword matching none; assert an empty result.

### Tests ⚠️ Write first, confirm red

- [X] T007 [US2] In `tests/contract/test_listing_discovery.ts`, add keyword-search coverage:
  - A listing whose title contains "bicycle" → searching "bicycle" returns it (FR-004).
  - A different listing whose description (not title) contains "leather" → searching "leather" returns it (FR-004).
  - A search term matching nothing → `{ ok: true, listings: [], hasMore: false }` (FR-007).
  - A matching listing in a different community → never returned when searching the caller's own community (FR-001).
  - A `PAUSED` listing matching the search term → never returned (FR-002).

  Confirm these cases FAIL (red).

### Implementation

- [X] T008 [US2] Extend `listListings()` in `src/server/services/listingService.ts`: add `search?: string` to `options`; when non-blank, add an `OR` clause (`title` / `description` each with `contains`, `mode: "insensitive"`) to the existing `where`, composed with the community/status/pagination clauses already in the same `findMany` call (research.md #2, #4) — never a second query or an in-memory filter. Confirm T007 passes (green).
- [X] T009 [P] [US2] Extend the `GET` handler in `app/api/communities/[communityId]/listings/route.ts`: parse the `q` query param and pass it through to `listListings()` as `search`.

### Tests ⚠️ Write first, confirm red

- [X] T010 [US2] Extend `tests/integration/test_listing_discovery_flow.spec.ts`: a member types a keyword into the feed page's search box and submits; asserts only matching listing cards render; clears the search and asserts the full feed returns. Confirm it FAILS (red) — no search box exists yet.

### Implementation

- [X] T011 [US2] Create `app/communities/[communityId]/listings/ListingDiscoveryControls.tsx` (a small client component) with a search input, submitting via GET navigation to the feed page so the term lands in the `q` query param (shareable/reloadable); wire it into `page.tsx` above the card grid. Submitting a new search resets `page` to 1 (no `page` field in the form). Confirm T010 passes (green).

**Checkpoint**: User Stories 1 and 2 both independently verified — members can browse or search their community's listings, still strictly community-scoped and `ACTIVE`-only.

---

## Phase 5: User Story 3 - A member filters their community's listings by price range (Priority: P2)

**Goal**: A member can narrow a community's listings to a minimum and/or maximum price, inclusive.

**Independent Test**: Create listings at several distinct prices; filter for a range including only some of them; assert exactly the in-range listings (bounds inclusive) are returned; a minimum above a maximum is rejected.

### Tests ⚠️ Write first, confirm red

- [X] T012 [US3] In `tests/contract/test_listing_discovery.ts`, add price-filter coverage:
  - Listings priced 1000, 5000, 9000 → filtering `minPriceCents: 2000, maxPriceCents: 6000` returns only the 5000 listing (FR-005).
  - Filtering with only a minimum, or only a maximum, includes all listings on the open side of that bound (FR-005).
  - A listing priced exactly at a filter's minimum or maximum → included (inclusive bounds, FR-005).
  - `minPriceCents > maxPriceCents` → `{ ok: false, reason: "invalid_input" }`, no listings queried (FR-005, Edge Cases).

  Confirm these cases FAIL (red).

### Implementation

- [X] T013 [US3] Extend `listListings()` in `src/server/services/listingService.ts`: add `minPriceCents?: number` and `maxPriceCents?: number` to `options`; if both are present and `minPriceCents > maxPriceCents`, return `{ ok: false, reason: "invalid_input" }` before querying; otherwise add `priceCents: { gte, lte }` (only the provided bounds) to the same `where` clause as search/pagination (research.md #3, #4). Confirm T012 passes (green).
- [X] T014 [P] [US3] Extend the `GET` handler in `app/api/communities/[communityId]/listings/route.ts`: parse `minPrice`/`maxPrice` query params as integers, pass through to `listListings()`, map its `invalid_input` result to `400` per contracts/listing-discovery-api.md.

### Tests ⚠️ Write first, confirm red

- [X] T015 [US3] Extend `tests/integration/test_listing_discovery_flow.spec.ts`: a member enters min/max price values in the feed page's filter inputs and submits; asserts only in-range listing cards render; entering a minimum above the maximum shows a validation message and submits no request. Confirm it FAILS (red) — no price inputs exist yet.

### Implementation

- [X] T016 [US3] Add min/max price inputs to `ListingDiscoveryControls.tsx` (T011): submitting includes `minPrice`/`maxPrice` in the query string and resets `page` to 1; a client-side check mirrors the server's `min > max` rejection so an invalid range is never submitted. Confirm T015 passes (green).

**Checkpoint**: User Stories 1-3 independently verified — browse, search, and price-filter all work, each strictly community-scoped and `ACTIVE`-only.

---

## Phase 6: User Story 4 - A member combines search, price filters, and pagination in one query (Priority: P3)

**Goal**: Keyword search and a price range apply together, and the combined result set still pages correctly.

**Independent Test**: Create listings where only some satisfy both a keyword and a price range; request a paginated result with both applied; assert only listings satisfying both appear, correctly paginated across more than one page.

### Tests ⚠️ Write first, confirm red

- [X] T017 [US4] In `tests/contract/test_listing_discovery.ts`, add combined-query coverage: listings of varying titles/prices in one community → a request with `search`, `minPriceCents`, `maxPriceCents`, and `page` all set together returns only listings satisfying every condition, correctly paginated, in the same newest-first/id-tiebreak order as an unfiltered feed, with every matching listing appearing exactly once across pages (FR-006). Confirm this FAILS (red) if any prior phase's clause was composed incorrectly (e.g., as a separate query or post-filter step) — otherwise this task documents that the composition already holds and locks it in as a regression test.

### Implementation

- [X] T018 [US4] If T017 fails: fix `listListings()` in `src/server/services/listingService.ts` so `search`, price bounds, and pagination are assembled into the single `where`/`orderBy`/`skip`/`take` clause set of one `findMany` call (research.md #4) — never separate queries or an in-memory intersection. Confirm T017 passes (green).

### Tests ⚠️ Write first, confirm red

- [X] T019 [US4] Extend `tests/integration/test_listing_discovery_flow.spec.ts`: a member sets a search term and a price range together on the feed page, then navigates to the next page; asserts the combined filters stay applied across the page change (no silently-dropped filter) and the two pages together contain every matching listing exactly once. Confirm it FAILS (red) — pagination links currently drop the `q`/`minPrice`/`maxPrice` params.

### Implementation

- [X] T020 [US4] Update the Prev/Next controls in `app/communities/[communityId]/listings/page.tsx` (T006) to preserve the current `q`/`minPrice`/`maxPrice` query params when changing `page` (change only `page` itself). Confirm T019 passes (green).

**Checkpoint**: All four user stories independently verified — browse, search, price-filter, and their combination all work correctly, entirely at the database query level.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T021 [P] Run `npm run typecheck` and `npm run lint`; fix any issues introduced by this feature.
- [X] T022 [P] Run `npm run test:unit` (covers `tests/unit` and `tests/contract`, including this feature's full contract-test file) and `npm run test:e2e` (Playwright); confirm the whole suite is green, including a regression check that 002/003/004/005/006's existing tests still pass unmodified.
- [X] T023 Manually execute quickstart.md Scenarios 1-6 end-to-end against the real dev/test PostgreSQL database and a running dev server; record the results.
- [X] T024 Re-check plan.md's Constitution Check against the finished implementation: confirm Principle II's community-scoping holds on every discovery path (feed, search, filter, and every combination), FR-009's exclusions (no saved searches, no recommendations, no advanced full-text, no external index) were not accidentally introduced, no new runtime dependency crept in (Principle VII), and the pre-existing `coverPhotoId`/`ownerDisplayName` fields are unchanged on every returned listing.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately.
- **Foundational (Phase 2)**: No tasks — 005's `requireCommunityMembership()` is reused as-is. Phase 3 only needs Phase 1's migration.
- **Phase 3 (US1)**: Depends on Setup. BLOCKS Phases 4-6 (each extends the same `listListings()` function, the same GET route, and the same feed page).
- **Phase 4 (US2)**: Depends on Phase 3 (extends `listListings()`'s `options`, the GET route, and introduces `ListingDiscoveryControls.tsx` alongside the pagination controls Phase 3 added).
- **Phase 5 (US3)**: Depends on Phase 4 (extends `listListings()`'s `options` again and `ListingDiscoveryControls.tsx`; sequenced after search to avoid two stories editing the same new component concurrently).
- **Phase 6 (US4)**: Depends on Phase 5 (verifies/fixes the composition of every option Phases 3-5 added, and the pagination controls' param-preservation).
- **Polish (Phase 7)**: Depends on all prior phases being complete.

### Parallel Opportunities

- T002 is a standalone new file — no conflict with any other Phase 3 task, but T003 depends on it being red first (TDD ordering, not a file conflict).
- T004 is [P] — a different file (`route.ts`) from T003 (`listingService.ts`), both depending only on the already-red T002.
- T007, T012, and T017 are **NOT** parallel with each other or with T002 — all extend the same file (`tests/contract/test_listing_discovery.ts`).
- T009 and T014 are [P] within their own phases — same reasoning as T004 (route file vs. service file).
- T021 and T022 (Polish) — independent checks, can run in parallel.

---

## Parallel Example: Phase 3 (US1)

```bash
# T003 (service) and T004 (route) touch different files and both depend only on T002 being red:
Task: "Extend listListings() with page/pageSize in src/server/services/listingService.ts"
Task: "Extend GET .../listings/route.ts to parse page/pageSize query params"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Complete Phase 1 (Setup).
2. Complete Phase 3 (T002-T006).
3. **STOP and VALIDATE**: run quickstart.md Scenario 1; confirm T002 and T005 are both green.
4. This is a legitimate MVP: a member can browse their community's entire listing set across bounded, correctly-ordered pages — the scaling problem this feature exists to fix is already solved.

### Incremental Delivery

1. Setup → foundation ready (no separate Foundational-phase work needed).
2. Phase 3 (US1) → MVP: paginated browse, strictly community-scoped and `ACTIVE`-only.
3. Phase 4 (US2) → keyword search, composable with pagination.
4. Phase 5 (US3) → price-range filter, composable with search and pagination.
5. Phase 6 (US4) → explicit proof that all three compose correctly together.
6. Polish.

---

## Notes

- [P] tasks touch different files with no dependency on each other; most tasks in this feature share a file with a sibling task within their own phase and are intentionally sequenced instead.
- [Story] labels map every task to the spec.md story whose acceptance criterion it satisfies.
- Commit after each task or logical group — this redo starts fresh after the previous uncommitted pass was lost to an unrelated branch sync; commit early and often this time.
- Stop at any checkpoint to validate independently.
- Both Vitest (contract) and Playwright (integration) are used, matching 005-product-listings — this feature extends real pages/routes for Playwright to exercise.
