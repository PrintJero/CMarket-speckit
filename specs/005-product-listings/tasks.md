---

description: "Task list for Product Listings"
---

# Tasks: Product Listings

**Input**: Design documents from `/specs/005-product-listings/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/listings-api.md](./contracts/listings-api.md), [quickstart.md](./quickstart.md)

**Tests**: "Product listing" is an explicitly named critical flow per Constitution Principle VIII. Tests are MANDATORY, MUST be written before their corresponding implementation, and MUST be confirmed failing (red) before that implementation is written.

**Organization**: Tasks are grouped by user story (spec.md priorities P1/P1/P2/P2/P3). Unlike 004-invitations-membership, no two stories here share an unsafe partial state — every action (create, edit, pause, reactivate, delete) is independently safe to ship alone — so each story gets its own clean phase with no forced combination.

## Path Conventions

Single existing Next.js/Prisma project (extends `002-accounts-authentication`, `003-community-creation`, `004-invitations-membership`), per plan.md's Structure Decision — no new top-level project.

---

## Phase 1: Setup (Shared Infrastructure)

- [X] T001 Add the `Listing` and `ListingPhoto` models and the `ListingStatus` enum to `prisma/schema.prisma` per data-model.md (`Listing`: `id`, `communityId`, `ownerId`, `title`, `description`, `priceCents`, `status` `ListingStatus @default(ACTIVE)`, `createdAt`, `updatedAt DateTime @updatedAt` (automatic on every write); `ListingPhoto`: `id`, `listingId`, `data Bytes`, `mimeType`, `sizeBytes`, `position`, `createdAt`; relations `onDelete: Cascade` to `Community`/`Account`/`Listing`), then run `prisma migrate dev --name add_listing_and_listing_photo` and `prisma generate`. Never edit the database by hand (constitution: Migrations & Backups).

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: No user story task may begin until this phase is complete.

- [X] T002 Implement `requireCommunityMembership(accountId, communityId): Promise<boolean>` in `src/server/services/listingService.ts` (research.md #2, new file): looks up `prisma.membership.findUnique({ where: { accountId_communityId: { accountId, communityId } } })` and returns `membership !== null` (any role — administrator or member). No dedicated test file for this helper (mirrors 004's `requireCommunityAdministrator`, which is exercised only through the service functions that call it); it's exercised in Phase 3's `not_a_member` cases.

**Checkpoint**: The one authorization primitive every subsequent story's routes depend on now exists. User story implementation can begin.

---

## Phase 3: User Story 1 - A member creates a product listing in their community (Priority: P1) 🎯 MVP

**Goal**: Any member (any role) of a community can create a listing with a title, description, price, and optional photos, and see it in that community's listing feed — strictly scoped to that community.

**Independent Test**: As a member of community C, create a listing with a photo; assert it exists, is scoped to C, starts `ACTIVE`, and is attributed to that member. As an account with no membership in C, confirm creation and viewing are both rejected.

### Tests ⚠️ Write first, confirm red

- [X] T003 [US1] Write `tests/contract/test_listings.ts` covering `createListing()`, against real accounts/communities/memberships in the real test database:
  - Success: a member (any role) creates a listing with a valid title, description, and `priceCents` → `{ ok: true, listing }`; the listing is scoped to `communityId`, owned by the caller, `status: "ACTIVE"` (FR-001, FR-002, FR-005).
  - FR-002: blank title, blank description, or a negative/non-integer `priceCents` → `{ ok: false, reason: "invalid_input" }`; no row created.
  - FR-001/Edge Cases: a caller with no `Membership` in `communityId` → `{ ok: false, reason: "not_a_member" }`; no row created.

  Confirm this file FAILS (red) — `createListing` doesn't exist yet.

- [X] T004 [US1] In the same file, add `addListingPhoto()` coverage:
  - Success: the listing's owner adds a photo (valid `image/jpeg`/`image/png`/`image/webp` bytes, ≤5MB) → `{ ok: true, photo }`; stored with the next `position`.
  - Oversized (>5MB) or wrong MIME type (e.g. `image/gif`) → `{ ok: false, reason: "invalid_photo" }`; no row created (research.md #1).
  - A listing that already has 6 photos → a 7th attempt returns `{ ok: false, reason: "photo_limit_reached" }`; no row created.
  - A non-owner (including that community's administrator) → `{ ok: false, reason: "not_owner" }`.

  Confirm this case FAILS (red).

- [X] T005 [US1] In the same file, add listing-view coverage for `listListings()`/`getListing()`:
  - A member (any role) of community C sees only C's `ACTIVE` listings via `listListings(C.id, ...)` — a listing that belongs to a different community D never appears (FR-011, FR-012).
  - `getListing()` returns a specific listing (regardless of status) only to a caller holding a `Membership` in its own `communityId`; a non-member → `{ ok: false, reason: "not_a_member" }`, and a `listingId` from a different community → `{ ok: false, reason: "not_found" }`.

  Confirm these cases FAIL (red).

### Implementation

- [X] T006 [US1] Implement `createListing({ communityId, ownerId, title, description, priceCents })` in `src/server/services/listingService.ts` (contracts/listings-api.md): validate `title`/`description` non-blank and `priceCents` a non-negative integer → `invalid_input`; call `requireCommunityMembership()` (T002) → `not_a_member` if false; create the `Listing` row with `status: "ACTIVE"`. Confirm T003 passes (green).
- [X] T007 [US1] Implement `addListingPhoto({ listingId, callerAccountId, data, mimeType, sizeBytes })` in the same file: look up the `Listing`, reject `not_found` if missing, `not_owner` if `callerAccountId !== ownerId`; validate `mimeType` against the allowed set and `sizeBytes <= 5_242_880` → `invalid_photo`; count existing photos for `listingId`, reject the 7th with `photo_limit_reached`; otherwise create the `ListingPhoto` row at the next `position`. Confirm T004 passes (green).
- [X] T008 [US1] Implement `listListings(communityId, callerAccountId)` and `getListing(communityId, listingId, callerAccountId)` in the same file: both call `requireCommunityMembership()` first → `not_a_member`; `listListings` returns only `status: "ACTIVE"` rows scoped to `communityId`; `getListing` returns the row (any status) only if it belongs to `communityId`, else `not_found`. Confirm T005 passes (green).

- [X] T009 [P] [US1] Implement `GET`+`POST /api/communities/[communityId]/listings/route.ts`: `GET` calls `listListings()`, maps `not_a_member` → `403`; `POST` parses `{ title, description, priceCents }`, calls `createListing()` with the signed-in caller's accountId, maps to `201`/`400`/`403` per contracts.md.
- [X] T010 [P] [US1] Implement `POST /api/communities/[communityId]/listings/[listingId]/photos/route.ts`: parses `multipart/form-data` via `request.formData()`, extracts the `photo` file field (bytes, `type`, `size`), calls `addListingPhoto()`, maps to `201`/`400`/`403`/`404`/`409` per contracts.md.
- [X] T011 [P] [US1] Implement `GET /api/communities/[communityId]/listings/[listingId]/route.ts` (GET only — `PATCH`/`DELETE` are added in Phases 4/6): calls `getListing()`, maps to `200`/`403`/`404`.
- [X] T012 [P] [US1] Implement `GET /api/communities/[communityId]/listings/[listingId]/photos/[photoId]/route.ts`: requires the caller to hold a `Membership` in `communityId` (`requireCommunityMembership()`), then streams the stored bytes with the stored `mimeType` as `Content-Type`; `404` if no such photo exists on that listing in that community.

### Tests ⚠️ Write first, confirm red

- [X] T013 [US1] Write `tests/integration/test_listing_flow.spec.ts` (Playwright): a member signs in, visits `/communities/{communityId}/listings`, follows "New listing" to `/communities/{communityId}/listings/new`, submits a title/description/price with one photo attached to the same form; asserts the submission redirects to `/communities/{communityId}/listings` and the new listing now appears there. **No detail page is needed for this assertion — it does not exist until Phase 4 (T022), and Phase 3 MUST be completable and testable without it.** A second account with no membership in that community is signed in and visiting `/communities/{communityId}/listings/new` directly gets a `404`. Confirm it FAILS (red) — no routes/pages exist yet.

### Implementation

- [X] T014 [US1] Implement `app/communities/[communityId]/listings/page.tsx` (member-only feed, `notFound()` convention from `/communities/{id}/admin`) + `app/communities/[communityId]/listings/new/page.tsx` + `ListingForm.tsx` (client component, mirrors `InviteForm`'s pattern). `ListingForm`'s create-mode submit handler: `POST .../listings` with `{ title, description, priceCents }`; on success, `POST .../listings/{id}/photos` once per selected file (sequentially, before navigating away); then redirect to `/communities/{communityId}/listings`. This keeps photo upload entirely inside the creation flow, so Phase 3 needs no detail page (analysis F1). Confirm T013 passes (green).

**Checkpoint**: MVP. A member can create a listing (with or without photos) and see it in their community's feed; non-members see and can do nothing.

---

## Phase 4: User Story 2 - The owner edits their own listing (Priority: P1)

**Goal**: The listing's owner can change its title, description, price, and photos at any time; no one else (including that community's administrator) can.

**Independent Test**: As the owner, change title/description/price/photos and confirm they're reflected with owner/community/status unchanged; confirm a different member's and that community's administrator's edit attempts are both rejected.

### Tests ⚠️ Write first, confirm red

- [X] T015 [US2] In `tests/contract/test_listings.ts`, add `updateListing()` coverage: the owner edits title/description/price → reflected; owner/community/status unchanged (FR-006). A non-owner — including that community's own administrator — attempts to edit → `{ ok: false, reason: "not_owner" }`; the listing is unchanged (FR-009's carve-out, FR-010). Confirm these FAIL (red).
- [X] T016 [US2] In the same file, add `removeListingPhoto()` coverage: the owner removes an existing photo → it no longer exists; a non-owner attempt → `{ ok: false, reason: "not_owner" }`. Confirm this FAILS (red).

### Implementation

- [X] T017 [US2] Implement `updateListing({ listingId, callerAccountId, title?, description?, priceCents? })` in `src/server/services/listingService.ts`: look up the `Listing`, `not_found` if missing, `not_owner` if `callerAccountId !== ownerId` (this check alone, never `requireCommunityAdministrator`, per FR-010); validate any provided field (same rules as `createListing`); update only the provided fields. Confirm T015 passes (green).
- [X] T018 [US2] Implement `removeListingPhoto({ listingId, photoId, callerAccountId })` in the same file: same ownership check as T017; delete the `ListingPhoto` row if it belongs to `listingId`, else `not_found`. Confirm T016 passes (green).
- [X] T019 [P] [US2] Add a `PATCH` handler to `app/api/communities/[communityId]/listings/[listingId]/route.ts` (extends T011's file): parses a partial `{ title?, description?, priceCents? }` body, calls `updateListing()`, maps to `200`/`400`/`403`/`404`.
- [X] T020 [P] [US2] Implement `DELETE /api/communities/[communityId]/listings/[listingId]/photos/[photoId]/route.ts` (extends T012's file): calls `removeListingPhoto()`, maps to `204`/`403`/`404`.

### Tests ⚠️ Write first, confirm red

- [X] T021 [US2] Extend `tests/integration/test_listing_flow.spec.ts`: the owner opens the listing from Phase 3 on its detail page, edits title/description/price via an edit form, and sees the changes persist; a second member's edit attempt via the API is rejected. Confirm it FAILS (red) — no edit UI exists yet.

### Implementation

- [X] T022 [US2] Implement `app/communities/[communityId]/listings/[listingId]/page.tsx` (detail view): shows an edit form (reusing `ListingForm.tsx`, pre-filled) when the caller is the owner. Confirm T021 passes (green).

**Checkpoint**: User Stories 1 and 2 both independently verified — a listing can be created and corrected end-to-end.

---

## Phase 5: User Story 3 - The owner pauses and reactivates their own listing (Priority: P2)

**Goal**: The owner can take a listing off the active feed (pause) and bring it back (reactivate) without losing any data; repeating either action is a harmless no-op.

**Independent Test**: Pause an `ACTIVE` listing, confirm it disappears from the community's active feed; reactivate it, confirm it reappears; pause it twice in a row and confirm no error.

### Tests ⚠️ Write first, confirm red

- [X] T023 [US3] In `tests/contract/test_listings.ts`, add `pauseListing()`/`reactivateListing()` coverage (owner path only — the administrator path is added in Phase 7): the owner pauses an `ACTIVE` listing → `status: "PAUSED"`; pausing it again → still `PAUSED`, no error (FR-007's idempotence). The owner reactivates a `PAUSED` listing → `status: "ACTIVE"`; reactivating it again → still `ACTIVE`, no error. A non-owner attempt (any role, any community) → `{ ok: false, reason: "not_authorized" }`. Confirm these FAIL (red).

### Implementation

- [X] T024 [US3] Implement `pauseListing({ listingId, callerAccountId })` and `reactivateListing({ listingId, callerAccountId })` in `src/server/services/listingService.ts`: look up the `Listing`, `not_found` if missing; **this phase's authorization check is `callerAccountId === ownerId` only** (Phase 7 extends it to also accept that community's administrator — research.md #3 notes neither transition needs transaction-level race protection, so this extension is a safe, incremental authorization change, not a re-opened safety gap); update `status` to the target value unconditionally (idempotent by construction). Confirm T023 passes (green).
- [X] T025 [P] [US3] Implement `POST /api/communities/[communityId]/listings/[listingId]/pause/route.ts` and `POST /api/communities/[communityId]/listings/[listingId]/reactivate/route.ts`: each calls the corresponding function, maps to `200`/`403`/`404`.

### Tests ⚠️ Write first, confirm red

- [X] T026 [US3] Extend `tests/integration/test_listing_flow.spec.ts`: the owner pauses the listing from the detail page; asserts it disappears from `/communities/{communityId}/listings`; reactivates it; asserts it reappears. Confirm it FAILS (red) — no pause/reactivate UI exists yet.

### Implementation

- [X] T027 [US3] Implement `ListingActions.tsx` (client component: Pause/Reactivate buttons, calling the routes from T025) and wire it into the owner's view of `app/communities/[communityId]/listings/[listingId]/page.tsx`. Confirm T026 passes (green).

**Checkpoint**: The owner's full lifecycle (create, edit, pause, reactivate) is independently verified end-to-end.

---

## Phase 6: User Story 4 - The owner permanently deletes their own listing (Priority: P2)

**Goal**: The owner can permanently remove a listing and every one of its photos; no one else — not even that community's administrator — ever can.

**Independent Test**: Delete a listing with photos attached; confirm the listing and all its photos no longer exist. Confirm that community's administrator cannot delete a listing they don't own.

### Tests ⚠️ Write first, confirm red

- [X] T028 [US4] In `tests/contract/test_listings.ts`, add `deleteListing()` coverage: the owner deletes a listing with photos attached → the `Listing` row and every one of its `ListingPhoto` rows no longer exist (FR-008, SC-006). A non-owner attempt — **including that community's own administrator** — → `{ ok: false, reason: "not_owner" }`; nothing is deleted (FR-010: deletion is never extended to administrators). Confirm these FAIL (red).

### Implementation

- [X] T029 [US4] Implement `deleteListing({ listingId, callerAccountId })` in `src/server/services/listingService.ts`: look up the `Listing`, `not_found` if missing, `not_owner` if `callerAccountId !== ownerId` (this check alone — never `requireCommunityAdministrator`, by design, per FR-010); `prisma.listing.delete()`, relying on schema `onDelete: Cascade` to remove its `ListingPhoto` rows (no `$transaction` needed — research.md #3/Atomicity). Confirm T028 passes (green).
- [X] T030 [US4] Add a `DELETE` handler to `app/api/communities/[communityId]/listings/[listingId]/route.ts` (extends T011/T019's file): calls `deleteListing()`, maps to `204`/`403`/`404`.

### Tests ⚠️ Write first, confirm red

- [X] T031 [US4] Extend `tests/integration/test_listing_flow.spec.ts`: the owner deletes a listing (with a photo attached) via the detail page's Delete action; asserts a redirect to the feed and the listing's absence from it. Confirm it FAILS (red) — no Delete UI exists yet.

### Implementation

- [X] T032 [US4] Extend `ListingActions.tsx` (T027) with a Delete button (calling T030's route, redirecting to the feed on `204`). Confirm T031 passes (green).

**Checkpoint**: All of the owner's actions (create, edit, pause, reactivate, delete) are independently verified end-to-end — this is a complete, safe, ownership-only marketplace listing lifecycle.

---

## Phase 7: User Story 5 - An administrator moderates a listing within their own community (Priority: P3)

**Goal**: A community's administrator can pause/reactivate any listing within their own community, even one they don't own — satisfying Constitution Principle III's listing-moderation guarantee — without gaining edit or delete authority over it.

**Independent Test**: As C's administrator, pause a listing owned by a different member of C; confirm it succeeds and the listing's ownership/data are unchanged. Confirm an administrator of a *different* community cannot do the same.

### Tests ⚠️ Write first, confirm red

- [X] T033 [US5] In `tests/contract/test_listings.ts`, add administrator-moderation coverage: community C's administrator pauses a listing owned by a different member M of C → `{ ok: true }`, `status: "PAUSED"`, M's ownership and the listing's other data unchanged (FR-009). Either the administrator or M reactivates it → `{ ok: true }`, `status: "ACTIVE"` — reactivation is not restricted to whoever paused it (Story 5 Scenario 2). An administrator of a *different*, unrelated community D attempts to pause the same listing in C → `{ ok: false, reason: "not_authorized" }` (FR-010). Confirm these FAIL (red) — the current implementation (Phase 5) only accepts the owner.

### Implementation

- [X] T034 [US5] Extend `pauseListing()`/`reactivateListing()` in `src/server/services/listingService.ts` (T024): authorization becomes `callerAccountId === ownerId` **OR** `requireCommunityAdministrator(callerAccountId, listing.communityId)` (reusing the existing helper imported from `src/server/services/invitationService.ts`, research.md #2 — no duplicated lookup); otherwise `not_authorized`. Confirm T033 passes **and** T023 (Phase 5's owner-path tests) still passes — this is one commit extending, not replacing, the existing authorization.

### Tests ⚠️ Write first, confirm red

- [X] T035 [US5] Extend `tests/integration/test_listing_flow.spec.ts`: signed in as C's administrator (not the listing's owner), visit the listing's detail page and pause it via the same Pause action; assert it succeeds and no Edit/Delete controls are shown to the administrator for a listing they don't own. Confirm it FAILS (red) — the detail page currently only shows actions to the owner.

### Implementation

- [X] T036 [US5] Extend `app/communities/[communityId]/listings/[listingId]/page.tsx` (T022) and `ListingActions.tsx` (T027/T032): render Pause/Reactivate for a non-owner caller who is that community's administrator, without rendering Edit or Delete for them. Confirm T035 passes (green).

**Checkpoint**: All five user stories independently verified — the feature is constitutionally complete (Principle III's listing-moderation guarantee is now enforced, not merely deferred).

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T037 [P] Run `npm run typecheck` and `npm run lint`; fix any issues introduced by this feature.
- [X] T038 [P] Run `npm run test:unit` (covers `tests/unit` and `tests/contract`, including this feature's full contract-test file) and `npm run test:e2e` (Playwright); confirm the whole suite is green, including a regression check that 002/003/004's existing tests still pass unmodified.
- [X] T039 Manually execute quickstart.md Scenarios 1–8 end-to-end against the real dev/test PostgreSQL database and a running dev server; record the results.
- [X] T040 Re-check plan.md's Constitution Check against the finished implementation: confirm Principle II's community-scoping holds on every route including the photo-stream route, FR-009/FR-010's owner-vs-administrator-vs-everyone-else authorization split is enforced exactly as designed in every service function, and no new runtime dependency crept in (Principle VII).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately.
- **Foundational (Phase 2)**: Depends on Setup (T001's migration must exist before T002's Prisma-backed code compiles). BLOCKS all user stories.
- **Phase 3 (US1)**: Depends on Foundational. BLOCKS Phases 4–7 (each extends `listingService.ts` and/or the pages Phase 3 creates).
- **Phase 4 (US2)**: Depends on Phase 3 (extends T011's route file and the detail page; needs an existing listing to edit).
- **Phase 5 (US3)**: Depends on Phase 3 (needs an existing listing to pause); independent of Phase 4's content-editing code, but shares the detail page (T022), so sequenced after it to avoid merge friction.
- **Phase 6 (US4)**: Depends on Phase 3; independent of Phases 4–5's logic, but shares files (`listings/[listingId]/route.ts`, `ListingActions.tsx`), so sequenced after them.
- **Phase 7 (US5)**: Depends on Phase 5 (extends its `pauseListing()`/`reactivateListing()` and their tests directly).
- **Polish (Phase 8)**: Depends on all prior phases being complete.

### Parallel Opportunities

- T003, T004, and T005 are **NOT** parallel with each other — all three extend the same file (`tests/contract/test_listings.ts`).
- T009, T010, T011, and T012 **ARE** parallel — four different route files, all depending only on Phase 3's already-complete service functions.
- T015 and T016 are **NOT** parallel — same test file. T019 and T020 **ARE** parallel — different route files.
- T037 and T038 (Polish) — independent checks, can run in parallel.

---

## Parallel Example: Phase 3 Routes

```bash
# All four depend only on T006-T008 (already complete) and touch different files:
Task: "Implement GET+POST /api/communities/[communityId]/listings/route.ts"
Task: "Implement POST /api/communities/[communityId]/listings/[listingId]/photos/route.ts"
Task: "Implement GET /api/communities/[communityId]/listings/[listingId]/route.ts"
Task: "Implement GET /api/communities/[communityId]/listings/[listingId]/photos/[photoId]/route.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Complete Phase 1 (Setup) and Phase 2 (Foundational).
2. Complete Phase 3 (T003–T014).
3. **STOP and VALIDATE**: run quickstart.md Scenario 1; confirm T003–T013 are all green.
4. This is a legitimate MVP: a member can create a listing (with or without photos) and see it in their community's feed, fully isolated from other communities.

### Incremental Delivery

1. Setup + Foundational → foundation ready.
2. Phase 3 (US1) → MVP: create + view, strictly community-scoped.
3. Phase 4 (US2) → the owner can correct mistakes.
4. Phase 5 (US3) → the owner can temporarily stand a listing down without losing it.
5. Phase 6 (US4) → the owner can permanently remove a listing.
6. Phase 7 (US5) → the constitutionally-required administrator moderation guarantee is enforced.
7. Polish.

---

## Notes

- [P] tasks touch different files with no dependency on each other; most tasks in this feature share a file with a sibling task within their own phase and are intentionally sequenced instead.
- [Story] labels map every task to the spec.md story whose acceptance criterion it satisfies.
- Commit after each task or logical group.
- Stop at any checkpoint to validate independently.
- Both Vitest (contract) and Playwright (integration) are used, matching 004-invitations-membership — this feature has real pages/routes for Playwright to exercise.
