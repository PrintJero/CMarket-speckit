---
description: "Task list for Account Profile and Shared-Community Member Profiles"
---

# Tasks: Account Profile and Shared-Community Member Profiles

**Input**: Design documents from `/specs/014-account-public-profiles/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/account-profiles-api.md](./contracts/account-profiles-api.md), [quickstart.md](./quickstart.md)

**Tests**: Neither the self profile nor the public profile is on Constitution Principle VIII's named critical-flow list, so tests are not constitutionally mandatory here — but spec.md's own Success Criteria (SC-001 through SC-007) commit to automated verification of the shared-community intersection, the non-disclosure guarantees, and the clickable navigation, so this file includes them as required, not optional, mirroring 012-profiles-reputation's identical treatment of its own spec (plan.md, Testing).

**Organization**: Tasks are grouped by user story (spec.md priorities P1/P1/P2). US1 and US2 both extend the same `src/server/services/profileService.ts` and the same `tests/contract/test_profiles.ts` — stories are sequenced (not parallel) to avoid repeated merge conflicts on those two files, exactly mirroring 012-profiles-reputation's own sequencing rationale for `reviewService.ts`/`profileService.ts`.

## Path Conventions

Single existing Next.js/Prisma project (extends 002-013), per plan.md's Structure Decision — no new top-level project, no schema/migration changes.

---

## Phase 1: Setup (Shared Infrastructure)

**No tasks.** This feature introduces no new dependency and ships zero `prisma/schema.prisma` changes (plan.md Storage, research.md) — there is nothing to initialize. Proceed directly to Phase 2.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The one piece of logic both user stories need from the same file, built once so US1 and US2 don't each reinvent it.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T001 In `src/server/services/profileService.ts`, add two private (unexported) helpers, additive alongside the existing (still-untouched) `getProfile()`: (a) `getCurrentMembershipsWithDetails(accountId: string): Promise<Map<string, { communityName: string; role: MembershipRole; memberSince: Date; currentEpoch: number }>>` — fetches `Membership` rows for `accountId` joined to `Community.operationalEpoch`, keeping only rows whose own `operationalEpoch` matches, mirroring the identical filter already independently implemented in `getCurrentAccount()` (`src/lib/auth/currentAccount.ts`), `listMyListings()`, and `listMyThreads()` (research.md #3); (b) `getActiveListingsForCommunity(accountId: string, communityId: string, currentEpoch: number): Promise<{ id: string; title: string; kind: "FOR_SALE" | "WANTED"; priceCents: number | null; stockQuantity: number | null; coverPhotoId: string | null }[]>` — `Listing` rows where `ownerId = accountId`, that `communityId`, `status: "ACTIVE"`, that `operationalEpoch`, ordered `createdAt desc`; no `status` field in the returned shape (FR-007, FR-023, FR-024, data-model.md).

**Checkpoint**: Foundation ready — US1 and US2 can now each build on `profileService.ts`.

---

## Phase 3: User Story 1 - A signed-in member views their own Account/Profile (Priority: P1) 🎯 MVP

**Goal**: Replace the "Account settings coming soon" placeholder with a real self-profile: display name, email, account creation date, global reputation, and every current community the account belongs to (role, member-since date, own active `FOR_SALE`/`WANTED` listings, both clickable).

**Independent Test**: Sign in as a member of two or more communities who owns active listings in at least one, open "Account," and confirm display name/email/account-creation-date/global-rating-summary/global-completed-transaction-count all appear, each current community shows name/role/member-since/own-active-listings, a community name click lands on that community's listings feed, a listing click lands on its detail page, and no password/session/authentication data appears anywhere.

### Tests for User Story 1 (contract) ⚠️ Write first, confirm red

- [X] T002 [P] [US1] Add a `describe("getSelfProfile", ...)` block to `tests/contract/test_profiles.ts`: returns the caller's own `displayName`, `email`, `accountCreatedAt` (`Account.createdAt`); `averageRating`/`reviewCount` delegate to the existing `getReputationSummary()`; `completedTransactionCount` is the global `ACCEPTED`-only count (reusing the same query shape the old `getProfile()` already used); `communities` has one entry per current membership with `communityId`/`communityName`/`role`/`memberSince`, each carrying its own active `FOR_SALE` and `WANTED` listings (both kinds, `ACTIVE` only, no `status` field, `stockQuantity` present when declared and `null` otherwise); an account with zero current memberships gets `communities: []`, not an error; the returned object never contains a `passwordHash`, session, or authentication-token field (assert no key matches `/password|session|token/i`). Confirm this FAILS (red) — `getSelfProfile()` doesn't exist yet.

### Implementation for User Story 1 (service)

- [X] T003 [US1] Add `getSelfProfile(accountId: string): Promise<GetSelfProfileResult>` to `src/server/services/profileService.ts`, using T001's helpers: fetch `Account` (`displayName`, `email`, `createdAt`); call `getCurrentMembershipsWithDetails(accountId)`; for each entry call `getActiveListingsForCommunity(accountId, communityId, currentEpoch)`; compute the global `completedTransactionCount` and `getReputationSummary(accountId)` exactly as the existing `getProfile()` already does. Confirm T002 passes (green).

### Tests for User Story 1 (integration) ⚠️ Write first, confirm red

- [X] T004 [P] [US1] Write `tests/integration/test_self_profile.spec.ts` (Playwright): sign in as a member of two communities who owns an active `FOR_SALE` listing in one and an active `WANTED` post in the other; click "Account"; confirm display name, email, account creation date, global rating summary, and global completed-transaction count are all visible; confirm both communities' sections show name/role/member-since/listings; click a community name and confirm navigation to `/communities/{communityId}/listings`; click a listing card and confirm navigation to its detail page; confirm no password or session data appears anywhere on the page. Separately, sign in as a brand-new account with no memberships and confirm the page renders a defined empty state, not an error. Confirm this FAILS (red) — the page still shows the old placeholder.

### Implementation for User Story 1 (page)

- [X] T005 [US1] Rewrite `app/account/page.tsx`: call `getSelfProfile(account.accountId)`; render `PageHeader` "Account"; a card with display name, email, account creation date, and the global reputation block (average rating via `formatAverageRating()`, rating count, completed-transaction count — same presentation as the existing profile page's own reputation block); a "My communities" section with one card per community: the community name as a `Link` to `/communities/{communityId}/listings` (FR-009a), the role, "Member since {date}", and the community's listings rendered as clickable cards linking to `/communities/{communityId}/listings/{listingId}` (FR-009b) — each showing title, kind label, price/budget via `formatListingPrice()`, and stock quantity when present; a defined empty state when the account belongs to no community yet. Confirm T004 passes (green).

**Checkpoint**: MVP — the self profile is real, correct, and independently functional.

---

## Phase 4: User Story 2 - A member views another member's profile across every community they share (Priority: P1)

**Goal**: Rebuild the public profile so it shows every community the viewer and the viewed account **currently both** belong to, never a community only one of them belongs to, and is unreachable entirely when they share none.

**Independent Test**: Two accounts sharing exactly one community see that one shown normally; two accounts sharing two or more see every one of them, each correctly scoped; a community only one party belongs to never appears anywhere in the page or its underlying response; two accounts sharing no community cannot reach either's profile at all.

### Tests for User Story 2 (contract) ⚠️ Write first, confirm red

- [X] T006 [US2] Replace the existing `getProfile` describe block in `tests/contract/test_profiles.ts` (the old single-`communityId`-scoped cases) with cases for the new signature `getProfile({ accountId, viewerAccountId })`: two accounts sharing exactly one community get that community's section (correct `memberSince`, correct listings); sharing two communities get both sections, each independently scoped; a community only the viewer belongs to is asserted absent (serialize the response, assert its name/id do not appear); a community only the target belongs to is likewise asserted absent; zero shared communities returns `{ ok: false, reason: "not_found" }`; a nonexistent `accountId` returns the **identical** `{ ok: false, reason: "not_found" }` (asserting the two cases are indistinguishable, research.md #2); `viewerAccountId === accountId` (self-view) returns every one of that account's own current communities; global `averageRating`/`reviewCount`/`completedTransactionCount` are unchanged in derivation from the prior implementation; no listing entry carries a `status` field; no response anywhere carries an email/phone/address field. Confirm this FAILS (red) — the old `getProfile()` still requires a hard `communityId` gate and returns the old single-community shape.

### Implementation for User Story 2 (service + API)

- [X] T007 [US2] Rewrite `getProfile()` in `src/server/services/profileService.ts` to the new signature `getProfile({ accountId, viewerAccountId }): Promise<GetProfileResult>` (drop `communityId` from the input type entirely), using T001's helpers: look up `Account.displayName` for `accountId` (`not_found` if it doesn't exist); call `getCurrentMembershipsWithDetails()` for both `viewerAccountId` and `accountId`; compute the intersection of the two community-id sets; `not_found` if empty (same reason as the missing-account case, research.md #2); otherwise, for each shared community build `{ communityId, communityName, memberSince: <the target's own membership.createdAt>, listings: getActiveListingsForCommunity(accountId, communityId, currentEpoch) }`; compute the global `completedTransactionCount` and `getReputationSummary(accountId)` exactly as before. Remove the retired `not_a_member` reason from `GetProfileResult`. Confirm T006 passes (green).
- [X] T008 [P] [US2] Update `app/api/communities/[communityId]/members/[accountId]/route.ts`: the `GET` handler stops forwarding the URL's `communityId` into `getProfile()` (still extracts `accountId` from `params`); response mapping per `contracts/account-profiles-api.md` — `200` on success, `404` for `not_found` (the old `403`/`not_a_member` branch is removed, since that reason no longer exists).

### Tests for User Story 2 (integration) ⚠️ Write first, confirm red

- [X] T009 [US2] Rewrite `tests/integration/test_profile_view.spec.ts`: two accounts sharing exactly one community see that section (name, member-since, listings) when one opens the other's profile; two accounts sharing two communities see both sections, each independently scoped; a community only the viewer belongs to is asserted absent from the rendered page text; a shared community where the target owns no active listings shows a defined empty state, not an error; clicking a shared community's name navigates to `/communities/{communityId}/listings`; clicking a listing card navigates to its detail page; an outsider sharing no community with the target gets `404` calling the API route directly (replacing the old `403` assertion, per `contracts/account-profiles-api.md`); opening your own profile link behaves identically to someone else opening it, without ever showing your own email in that view. Confirm this FAILS (red) — the page still renders the old single-community shape and the route still returns `403`.

### Implementation for User Story 2 (page)

- [X] T010 [US2] Rewrite `app/communities/[communityId]/members/[accountId]/page.tsx`: call `getProfile({ accountId, viewerAccountId: account.accountId })` (the route's own `communityId` is read from `params` only for the existing `BackLink`, no longer passed into the service call); render one card per shared community — the community name as a `Link` to `/communities/{communityId}/listings` (FR-017a), "Member since {date}", and that community's listings as clickable cards linking to `/communities/{communityId}/listings/{listingId}` (FR-017b); keep the existing global reputation block and its `data-testid="profile-reputation"`; a defined empty state per community with no active listings. Confirm T009 passes (green).

**Checkpoint**: Both P1 stories complete — the self profile and the multi-community public profile both work independently.

---

## Phase 5: User Story 3 - Reaching a profile from anywhere a person's name appears (Priority: P2)

**Goal**: Confirm every existing "click a display name" surface still opens the (now rewritten) shared-community profile — with **zero** production-code changes required, since all 8 linking files already point at the unchanged route (plan.md Structure Decision).

**Independent Test**: Click a counterpart's display name from a listing, a chat thread, a transaction, the `/chats` list, and the Transactions hub's Buying/Selling rows; every one of them opens the same shared-community profile view for that person.

### Tests for User Story 3 ⚠️ Write first, confirm red (against the pre-US2 page, then green after US2)

- [X] T011 [US3] Extend `tests/integration/test_profile_view.spec.ts` (or add a new `tests/integration/test_profile_navigation.spec.ts`) covering the two entry points not already exercised by T009's rewrite: clicking a counterpart's display name from `app/chats/page.tsx` and from the global `app/transactions/page.tsx` (Buying/Selling hub), confirming both land on the same `/communities/{communityId}/members/{accountId}` shared-community profile. This should already pass once Phase 4 is complete, since none of the 8 linking files were touched (plan.md Structure Decision) — a failure here would indicate an unexpected regression in one of those pages, not missing new code.

**No implementation tasks.** Every linking file (`app/communities/[communityId]/listings/page.tsx`, `.../listings/[listingId]/page.tsx`, `.../threads/page.tsx`, `.../threads/[threadId]/page.tsx`, `.../transactions/page.tsx`, `.../transactions/[transactionId]/page.tsx`, `app/chats/page.tsx`, `app/transactions/page.tsx`) already links to the unchanged route — Phase 4 alone makes this story pass.

**Checkpoint**: All three user stories independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T012 Run `npx tsc --noEmit` and `npx eslint .` — zero errors, confirming `GetProfileResult`'s retired `not_a_member` reason has no remaining reference anywhere in the codebase.
- [X] T013 Run `npm run test:unit` — the full suite, including this feature's rewritten `tests/contract/test_profiles.ts`, must pass alongside every pre-existing 002-013 contract test unaffected.
- [X] T014 Run `npm run test:e2e` for this feature's touched specs (`test_self_profile.spec.ts`, `test_profile_view.spec.ts`, and any file exercising a display-name link) plus a full-suite pass, confirming no regression beyond the documented `403 → 404` change (`contracts/account-profiles-api.md`); note any pre-existing, out-of-scope flake exactly as 012-profiles-reputation's own plan.md re-check did, rather than treating it as caused by this feature.
- [X] T015 Walk through `quickstart.md`'s 8 scenarios end-to-end (manually or via the tests above already covering them) and confirm each one passes.
- [X] T016 Re-check `plan.md`'s Constitution Check against the finished implementation (mirrors 012's own post-implementation re-check): `grep -n "not_a_member" src/server/services/profileService.ts app/api/communities/*/members/*/route.ts` returns nothing; `grep -rniE "email|phone|address" app/communities/*/members/*/page.tsx` returns nothing (the self profile's own `app/account/page.tsx` is expected to contain `email` — that is the one intentional exception, FR-008); `git diff --stat -- package.json package-lock.json` shows no changes (no new dependency); `git diff --stat -- prisma/schema.prisma` shows no changes (zero migration surface, as planned).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No tasks — nothing to depend on.
- **Foundational (Phase 2)**: No dependencies beyond existing code — BLOCKS both P1 user stories (both call T001's helpers).
- **User Story 1 (Phase 3)**: Depends on Phase 2. No dependency on User Story 2.
- **User Story 2 (Phase 4)**: Depends on Phase 2. Does not require User Story 1 to be complete, but is sequenced after it in this file to avoid concurrent edits to the same two files (`profileService.ts`, `test_profiles.ts`) — safe to reorder before US1 if only one file is being edited at a time.
- **User Story 3 (Phase 5)**: Depends on Phase 4 being complete (it exercises the rewritten public-profile page) — otherwise it is pure verification, no new code.
- **Polish (Phase 6)**: Depends on all three user stories being complete.

### Within Each User Story

- Contract test before service implementation; service implementation before integration test; integration test before page implementation — tests MUST be written first and confirmed failing (spec.md's Success Criteria commitment, mirroring 012's own precedent).
- Story complete (its own checkpoint) before moving to the next.

### Parallel Opportunities

- T002 (contract test) can be authored in parallel with T001 (Foundational implementation) — different files, and a red test doesn't require the implementation to exist yet.
- T004 (integration test) can be authored in parallel with T003 (service implementation) — different files.
- T008 (API route update) can proceed in parallel with T007 (service rewrite) once both are understood to target the same new `getProfile()` signature — different files.
- US1 and US2 touch the same two files (`profileService.ts`, `test_profiles.ts`), so within this feature they are sequenced, not run concurrently by two people, despite neither depending on the other's *feature* completeness.

---

## Parallel Example: User Story 1

```bash
# Once Phase 2 (Foundational) is committed:
Task: "Add getSelfProfile contract tests to tests/contract/test_profiles.ts"      # T002
Task: "Add getSelfProfile() to src/server/services/profileService.ts"            # T003 (can start once T001 lands; T002 can be authored in parallel)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 2: Foundational.
2. Complete Phase 3: User Story 1 (self profile).
3. **STOP and VALIDATE**: sign in, open "Account," confirm everything in spec.md's US1 Acceptance Scenarios.
4. Deploy/demo if ready — the public profile still works exactly as it did under 012 at this point, since Phase 4 hasn't touched it yet.

### Incremental Delivery

1. Foundational → self profile (US1, MVP) → validate independently.
2. Add User Story 2 (multi-community public profile) → validate independently, including the `403 → 404` behavior change.
3. Add User Story 3 (navigation verification) → confirm no regression across every existing display-name link.
4. Polish (Phase 6) → full-suite and Constitution re-check.

---

## Notes

- [P] tasks = different files, no ordering dependency for *authoring* them (though a red test still logically precedes its own green implementation).
- [Story] label maps task to specific user story for traceability; Foundational and Polish tasks carry no story label.
- This feature ships zero `prisma/schema.prisma` changes — no migration task exists anywhere in this file, by design (plan.md Storage).
- Every task inside Phase 3/4 that touches `profileService.ts` or `tests/contract/test_profiles.ts` must be done in the order listed — both files are shared across both P1 stories.
