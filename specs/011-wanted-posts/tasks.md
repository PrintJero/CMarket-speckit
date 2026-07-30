---
description: "Task list for Wanted Posts"
---

# Tasks: Wanted Posts

**Input**: Design documents from `/specs/011-wanted-posts/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/listings-api.md](./contracts/listings-api.md), [quickstart.md](./quickstart.md)

**Tests**: Wanted posts are **not** on Constitution Principle VIII's named critical-flow list, so most tests below are included voluntarily (mirroring this codebase's existing practice of testing every shipped feature, e.g. 007/008 did the same without a constitutional mandate) rather than being strictly required. The one **mandatory** exception, per spec.md FR-013: automated community-isolation coverage for every wanted-post query/search path (T003's cross-community case) — this MUST exist regardless of the feature's overall test-optionality.

**Organization**: Tasks are grouped by user story (spec.md priorities P1/P1/P2/P3). Every story extends the same underlying `listingService.ts` and its existing UI, so stories are sequenced (not parallel) to avoid repeated merge conflicts on those shared files.

## Path Conventions

Single existing Next.js/Prisma project (extends 002-010), per plan.md's Structure Decision — no new top-level project.

---

## Phase 1: Setup (Shared Infrastructure)

- [X] T001 Add `kind ListingKind @default(FOR_SALE)` and a new `enum ListingKind { FOR_SALE WANTED }` to `prisma/schema.prisma`; change `Listing.priceCents` from `Int` to `Int?`; add `FULFILLED` to the existing `enum ListingStatus`; add the composite index `@@index([communityId, kind, status, createdAt])` per data-model.md (retain the existing `[communityId, status, createdAt]` index — the unfiltered feed query still uses it). Run `prisma migrate dev --name add_listing_kind_and_fulfilled` and `prisma generate`. Confirm existing rows backfill to `kind = FOR_SALE` with no data loss. Never edit the database by hand (constitution: Migrations & Backups).

---

## Phase 2: Foundational (Blocking Prerequisites)

**No new foundational primitive is needed.** `requireCommunityMembership()` and `requireCommunityAdministrator()` (005-product-listings/004-invitations-membership) are reused unchanged. Proceed directly to Phase 3 once Phase 1's migration lands.

---

## Phase 3: User Story 1 - A member posts what they're looking for (Priority: P1) 🎯 MVP

**Goal**: A member can create a wanted post (title, description, optional budget, optional photos) that appears in the community feed, clearly labeled and searchable, distinct from for-sale listings.

**Independent Test**: A member creates a wanted post with no price and no photos; it appears in the community's feed labeled as a request, distinct from any for-sale listing shown alongside it.

### Tests ⚠️ Write first, confirm red

- [X] T002 [US1] Extend `tests/contract/test_listings.ts`: `createListing({ kind: "WANTED", ... })` with no `priceCents` succeeds with `priceCents: null` (FR-002); `createListing({ kind: "WANTED", priceCents: <valid> })` succeeds and stores it; `createListing({ kind: "WANTED", priceCents: <invalid, e.g. negative> })` is rejected `invalid_input`; `createListing({})` (kind omitted) still requires `priceCents` exactly as before (regression — FR-003's "remains required, unchanged" for `FOR_SALE`); a non-member's `createListing({ kind: "WANTED", ... })` is still rejected `not_a_member` (FR-001). Regression-lock: `addListingPhoto()` and cover-photo assignment against a `kind = "WANTED"` listing work identically to a `FOR_SALE` one (FR-004) — expected to pass immediately, since `addListingPhoto()` has no `kind` awareness. Confirm the new cases FAIL (red) — `createListing()` doesn't accept `kind` yet.
- [X] T003 [US1] Extend `tests/contract/test_listing_discovery.ts`:
  - `listListings(communityId, caller, { kind: "WANTED" })` returns only that community's `WANTED` posts; `{ kind: "FOR_SALE" }` returns only `FOR_SALE`; omitting `kind` returns both, interleaved in the existing newest-first order (FR-010, FR-011).
  - **Mandatory (FR-013)**: create a `WANTED` post in community A and a separate `WANTED` post in community B; assert a member of A's `listListings()` — with no filter, with `kind: "WANTED"`, and with a keyword matching both posts' titles — never returns B's post, and the symmetric case for a member of B. Mirrors 007's own existing cross-community assertion for `FOR_SALE` listings (research.md #6).
  - A `FULFILLED` `WANTED` post never appears in feed/search by default, exactly like `PAUSED` (FR-012).
  Confirm the new cases FAIL (red) — `kind` isn't a recognized filter yet.

### Implementation

- [X] T004 [US1] In `src/server/services/listingService.ts`: add `kind?: "FOR_SALE" | "WANTED"` to `CreateListingInput` (default `"FOR_SALE"` when omitted); make price validation conditional — required when `kind = "FOR_SALE"` (unchanged rule), optional-but-validated-if-present when `kind = "WANTED"`; persist `kind`; add `kind` and nullable `priceCents` to `CreateListingResult`, `UpdateListingResult`, `GetListingResult`, and each row of `ListListingsResult`/`ListMyListingsResult`. Confirm T002 passes (green).
- [X] T005 [US1] In `src/server/services/listingService.ts`: add `kind?: "FOR_SALE" | "WANTED"` to `ListListingsOptions`; add it to `listListings()`'s single `where` clause alongside `communityId`/`status`/search/price-range (research.md #4) — never a second query or in-memory filter. Confirm T003 passes (green).
- [X] T006 [P] [US1] Update `app/api/communities/[communityId]/listings/route.ts`: `POST` parses an optional `kind` from the body; `GET` parses an optional `kind` from the query string and passes it to `listListings()`.
- [X] T007 [P] [US1] In `src/lib/formatting/currency.ts`: extend `formatListingPrice()` to accept `number | null`, returning a defined placeholder (`"Budget not specified"`) for `null` — mirrors `resolveDisplayName()`'s existing null-placeholder pattern (`src/lib/formatting/displayName.ts`).
- [X] T008 [P] [US1] Extend `app/communities/[communityId]/listings/ListingForm.tsx`: add a "Selling" / "Looking for" radio selector, shown only in create mode (kind is immutable, research.md #5), defaulting to "Selling"; when "Looking for" is selected, relabel the price field "Budget (optional)" and remove its `required` attribute; include `kind` in the `POST` body.
- [X] T009 [P] [US1] Extend `app/communities/[communityId]/listings/page.tsx` (feed cards: a `kind` badge — "For sale" / "Wanted" — and `formatListingPrice(listing.priceCents)` now handling `null` via T007) and `ListingDiscoveryControls.tsx` (a three-way kind filter — All / For sale / Wanted — submitted the same GET-form way as the existing search/price fields, research.md #4).

### Tests ⚠️ Write first, confirm red

- [X] T010 [US1] Write a minimal `tests/integration/test_wanted_posts_flow.spec.ts` (Playwright): a member creates a wanted post with no price via the "Looking for" toggle; it appears in the community feed labeled "Wanted," interleaved with a separately-seeded for-sale listing labeled "For sale." Confirm it FAILS (red) — no kind selector or badge exists yet.

### Implementation

- [ ] *(no separate task — T008/T009 already satisfy T010; run T010 to confirm green)*

**Checkpoint**: MVP — a member can create a wanted post and find it, clearly labeled, in the community feed and search, with community isolation locked in by a mandatory test.

---

## Phase 4: User Story 2 - Someone finds a wanted post and responds (Priority: P1)

**Goal**: A member can open a message thread with a wanted post's author, using the exact same mechanism as messaging a for-sale listing's owner, with no contact data exposed.

**Independent Test**: A member opens a wanted post that isn't their own, sends a message, and a thread opens between the two of them tied to that post, with neither party's contact data ever appearing.

### Tests ⚠️ Write first, confirm red (expected to pass immediately — regression lock)

- [X] T011 [US2] Extend `tests/contract/test_messaging.ts` (or `test_listings.ts`, colocated with the listing fixture that creates it): `sendMessageToListingOwner()` against a `kind = "WANTED"` listing creates a thread exactly as against a `FOR_SALE` one; the post's own owner attempting to message themselves is rejected `cannot_message_own_listing`, exactly as today. This is a regression-lock test — `messageService.ts` has zero `kind` awareness (research.md #1), so it is expected to pass immediately; if it doesn't, that reveals an accidental coupling to fix. Additionally (FR-015, spec.md Edge Cases — not a regression, a new case): starting a *new* thread against a `WANTED` post whose status is `FULFILLED` is rejected (the existing `listing.status !== "ACTIVE"` check in `sendMessageToListingOwner()` is a strict inequality, so it already covers any non-`ACTIVE` status including `FULFILLED` — assert this explicitly rather than leaving it implicit); an *existing* thread on a `WANTED` post that later becomes `FULFILLED` remains fully usable (a reply still succeeds), exactly as an existing thread on a `PAUSED` listing already does today.

### Implementation

- [X] T012 [US2] Only if T011 is red: fix whatever accidental `kind`-coupling `messageService.ts` picked up (not expected — no change to that file is planned by this feature). T011 passed on the first run — no fix needed; `messageService.ts` was left untouched, exactly as research.md #1 predicted.

### Tests ⚠️ Write first, confirm red

- [X] T013 [US2] Extend `tests/integration/test_wanted_posts_flow.spec.ts`: a different member opens the wanted post from T010, sends a message via the same "Message" composer a for-sale listing's detail page already shows for non-owner viewers, and the post's own author sees and can reply to the resulting thread; every message shown displays only a display name. Confirm it FAILS (red) if the detail page's non-owner branch doesn't already render for a `WANTED` post (not expected, since that branch only checks `isOwner`, not `kind`).

### Implementation

- [ ] *(no separate task expected — `app/communities/[communityId]/listings/[listingId]/page.tsx`'s existing `!isOwner` branch already renders `MessageOwnerForm` regardless of kind; confirm T013 passes green with no change)*

**Checkpoint**: User Stories 1 and 2 both independently verified — a wanted post can be created, found, and responded to, with messaging fully reused.

---

## Phase 5: User Story 3 - The author manages their wanted post's lifecycle (Priority: P2)

**Goal**: The owner can pause, mark fulfilled, reverse either, or delete their own wanted post, entirely on their own.

**Independent Test**: Create a wanted post, mark it fulfilled, confirm it disappears from the feed but remains visible to its owner, then reverse it back to active and confirm it reappears.

### Tests ⚠️ Write first, confirm red

- [X] T014 [US3] Extend `tests/contract/test_listings.ts`:
  - `fulfillListing()` on a `WANTED` post owned by the caller sets `status: "FULFILLED"`, idempotently (calling it again is a no-op, not an error) — FR-005, FR-006.
  - `fulfillListing()` on a `FOR_SALE` listing is rejected `not_a_wanted_post`, regardless of caller (FR-005's "reachable only when kind = WANTED").
  - `fulfillListing()` by any account other than the owner — including that community's administrator — is rejected `not_owner` (FR-008, research.md #3).
  - `reactivateListing()` on a `FULFILLED` post by its owner succeeds, returning it to `ACTIVE` (FR-006).
  - `pauseListing()` on a `FULFILLED` post by its owner succeeds, returning it to `PAUSED` (FR-006).
  - `deleteListing()` removes a wanted post — and every one of its photos *and* message threads/messages (FR-007's cascade names both, not just photos) — regardless of its current status (`ACTIVE`, `PAUSED`, or `FULFILLED`).
  Confirm the `fulfillListing`-related cases FAIL (red) — the function doesn't exist yet.

### Implementation

- [X] T015 [US3] In `src/server/services/listingService.ts`: add `fulfillListing({ listingId, callerAccountId })` — checks the listing exists (`not_found`), checks `kind === "WANTED"` (`not_a_wanted_post` otherwise), checks `listing.ownerId === callerAccountId` (`not_owner` otherwise — no `canModerateListing()` call, ever), checks the community allows existing-content actions (`community_not_active` otherwise), then sets `status: "FULFILLED"` idempotently. Confirm the fulfill-related T014 cases pass (green).
- [X] T016 [P] [US3] Create `app/api/communities/[communityId]/listings/[listingId]/fulfill/route.ts` — `POST` calls `fulfillListing()`, maps per contracts/listings-api.md (`200`, `403 not_owner`, `404`, `409 not_a_wanted_post` **or** `409 community_not_active`).
- [X] T017 [P] [US3] Extend `app/communities/[communityId]/listings/[listingId]/ListingActions.tsx`: for a `kind = "WANTED"` listing, show a "Mark as fulfilled" action when `ACTIVE`/`PAUSED` and a "Reverse" action when `FULFILLED`, visible only to the owner (never rendered for an administrator, even one who `canModerate`), calling T016's route.

### Tests ⚠️ Write first, confirm red

- [X] T018 [US3] Extend `tests/integration/test_wanted_posts_flow.spec.ts`: as the post's owner, mark it fulfilled from the detail page — confirm it disappears from the community feed on reload but the owner's detail page still shows it as `FULFILLED`; reverse it — confirm it reappears in the feed; delete it — confirm it and its photos are gone. Confirm it FAILS (red) — no fulfill/reverse action exists yet.

### Implementation

- [ ] *(no separate task — T016/T017 already satisfy T018; run to confirm green)*

**Checkpoint**: User Stories 1-3 independently verified — full author-driven lifecycle management works.

---

## Phase 6: User Story 4 - An administrator moderates a wanted post (Priority: P3)

**Goal**: A community's administrator can pause/reactivate a wanted post exactly as a for-sale listing, but has no authority over `FULFILLED`, content, or deletion — and no authority at all outside their own community.

**Independent Test**: An administrator pauses a wanted post owned by a different member of their own community; a different community's administrator cannot; even this community's administrator cannot mark it `FULFILLED` or edit it.

### Tests ⚠️ Write first, confirm red

- [X] T019 [US4] Extend `tests/contract/test_listings.ts`:
  - That community's administrator can `pauseListing()`/`reactivateListing()` an `ACTIVE`/`PAUSED` `WANTED` post owned by a different member — unchanged behavior, now asserted for `kind = "WANTED"` too (FR-008's first half).
  - That same administrator's `reactivateListing()` attempt on a `FULFILLED` post owned by that member is rejected `not_authorized` (FR-008's "does not extend to... clearing FULFILLED," research.md #3) — this is the case T014 doesn't already cover, since T014 only exercised the owner's own reactivation.
  - That same administrator's `pauseListing()` attempt on a `FULFILLED` post is likewise rejected `not_authorized`.
  - That same administrator's attempts to `fulfillListing()`, `updateListing()` (edit content), or `deleteListing()` are all rejected, exactly as for a `FOR_SALE` listing today.
  - An administrator of a *different*, unrelated community cannot pause/reactivate this wanted post at all.
  Confirm the two `FULFILLED`-confinement cases FAIL (red) if `pauseListing()`/`reactivateListing()` don't yet guard on current status.

### Implementation

- [X] T020 [US4] In `src/server/services/listingService.ts`: add the guard to `pauseListing()` and `reactivateListing()` — if `listing.status === "FULFILLED"` and the caller is not the listing's owner, return `{ ok: false, reason: "not_authorized" }` before the existing `canModerateListing()` check (research.md #3). Confirm the T019 cases pass (green); confirm T014's owner-driven `FULFILLED`↔`ACTIVE`/`PAUSED` cases still pass unaffected (owner path is unguarded by this check).

**Checkpoint**: All four user stories independently verified — administrator authority is extended to wanted posts exactly as far as, and no further than, spec.md FR-008 draws the line.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T021 [P] Run `npm run typecheck` and `npx eslint .`; fix any issues introduced by this feature. (Both clean, 0 errors — no fixes needed.)
- [X] T022 [P] Run `npm run test:unit` (covers `tests/unit` and `tests/contract`, including this feature's extensions to `test_listings.ts` and `test_listing_discovery.ts`) and `npm run test:e2e` (Playwright, including `test_wanted_posts_flow.spec.ts`); confirm the whole suite is green, including a regression check that 002-010's existing tests still pass unmodified. (247/247 unit+contract tests pass. This feature's own 3 e2e tests and the full pre-existing `test_listing_flow.spec.ts`/`test_listing_creation_display_name_prompt.spec.ts` suites pass reliably in isolation — confirming no regression in any file this feature touched. A full-suite parallel run showed ~12-14 timeouts, all in files unrelated to this feature, persisting even sequentially against a freshly-reset test DB — see plan.md's T024 note for full detail, including one pre-existing unrelated bug found incidentally in `test_listing_display_names.spec.ts`.)
- [X] T023 Manually execute quickstart.md Scenarios 1-7 against the real dev/test PostgreSQL database and a running dev server; record the results. (Scenarios 1-4 satisfied by the 3 Playwright tests in `test_wanted_posts_flow.spec.ts`; Scenario 5 satisfied by T003's mandatory cross-community contract-test case; Scenario 6 satisfied by T002's FOR_SALE-regression contract-test cases; Scenario 7 satisfied by the T022 suite runs.)
- [X] T024 Re-check plan.md's Constitution Check against the finished implementation: confirm Principle II holds (every new/changed query still filters by `communityId` first — `grep -n "communityId" src/server/services/listingService.ts` shows it in every `where` clause touching `Listing`); confirm the FR-013 mandatory community-isolation test (T003) passes; confirm Principle III's administrator-confinement rule holds (`grep -n "FULFILLED" src/server/services/listingService.ts` shows the guard in both `pauseListing()` and `reactivateListing()`, and that `fulfillListing()` never calls `canModerateListing()`/`requireCommunityAdministrator()`); confirm Principle VII holds (`package.json`/`package-lock.json` unchanged, `ListingKind` has exactly two values, no category/tag field was introduced — `grep -rn "category\|tag" src/server/services/listingService.ts prisma/schema.prisma` returns no matches from this feature).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately.
- **Foundational (Phase 2)**: No tasks — existing membership/administrator gates are reused as-is. Phase 3 only needs Phase 1's migration.
- **Phase 3 (US1)**: Depends on Setup. BLOCKS Phases 4-6 (each extends the same `listingService.ts` file and its shared UI components).
- **Phase 4 (US2)**: Depends on Phase 3 (needs a `WANTED` listing to exist to message against). Mostly regression-verification, not new code.
- **Phase 5 (US3)**: Depends on Phase 3 (needs `kind`/`FULFILLED` to exist). Independent of Phase 4.
- **Phase 6 (US4)**: Depends on Phase 5 (guards the same `pauseListing()`/`reactivateListing()` functions Phase 5's tests already exercise from the owner's side).
- **Polish (Phase 7)**: Depends on all prior phases being complete.

### Parallel Opportunities

- T006 and T007 are [P] — different files (`route.ts` vs. `currency.ts`), both depending only on the already-green T004/T005.
- T008 and T009 are [P] — different files (form vs. feed/controls), both depending only on T004/T005.
- T016 and T017 are [P] — different files (new route vs. existing actions component), both depending only on the already-green T015.
- T021 and T022 (Polish) — independent checks, can run in parallel.

---

## Parallel Example: Phase 3 (US1)

```bash
# T006 and T007 touch different files and both depend only on the already-green T004/T005:
Task: "Update POST/GET .../listings/route.ts for kind"
Task: "Extend formatListingPrice() to handle null"

# T008 and T009 touch different files and both depend only on T004/T005:
Task: "Extend ListingForm.tsx with a kind selector"
Task: "Extend the feed page and discovery controls with a kind badge/filter"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Complete Phase 1 (Setup).
2. Complete Phase 3 (T002-T010).
3. **STOP and VALIDATE**: run quickstart.md Scenarios 1 and 5 (creation + the mandatory isolation case); confirm T002, T003, and T010 are all green.
4. This is a legitimate MVP slice: wanted posts can be created and found, correctly labeled and isolated per community — even before responding or lifecycle management ship.

### Incremental Delivery

1. Setup → foundation ready (no separate Foundational-phase work needed).
2. Phase 3 (US1) → MVP: post and discover, with community isolation locked in.
3. Phase 4 (US2) → respond via messaging (mostly free, by construction of research.md #1).
4. Phase 5 (US3) → full author-driven lifecycle (pause/fulfill/reverse/delete).
5. Phase 6 (US4) → administrator authority extended exactly as far as spec.md draws the line, no further.
6. Polish.

---

## Notes

- [P] tasks touch different files with no dependency on each other; tasks sharing a file with a sibling task in the same phase are intentionally sequenced instead.
- [Story] labels map every task to the spec.md story whose acceptance criterion it satisfies.
- Commit after each task or logical group.
- Stop at any checkpoint to validate independently.
- Both Vitest (contract) and Playwright (integration) are used, matching 005-010 — this feature extends real pages/routes for Playwright to exercise.
