---
description: "Task list for User Display Names"
---

# Tasks: User Display Names

**Input**: Design documents from `/specs/006-user-display-names/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/display-names-api.md](./contracts/display-names-api.md), [quickstart.md](./quickstart.md)

**Tests**: This feature touches two flows the constitution names as critical — "product listing" (`createListing()`'s new precondition, the feed/detail rendering) and "user registration" (the federated sign-in path, spec 002) — so tests for those areas are MANDATORY, MUST be written before their corresponding implementation, and MUST be confirmed failing (red) before that implementation is written (Constitution Principle VIII; plan.md's Constitution Check). Per plan.md's history, this obligation explicitly extends to `authConfig.ts`'s provider-selection gate — the one piece of the mocked-OAuth boundary that is real, shipped code — with both a static and a behavioral guard test.

**Organization**: Tasks are grouped by user story (spec.md priorities P1/P1/P2/P2). US1 and US2 are sequenced together (US2 is what makes US1's guarantee hold for every listing, not just some), followed by US3 and US4, each independently testable on its own once Foundational is complete.

## Path Conventions

Single existing Next.js/Prisma project (extends `002-accounts-authentication`, `003-community-creation`, `004-invitations-membership`, `005-product-listings`), per plan.md's Structure Decision — no new top-level project.

---

## Phase 1: Setup (Shared Infrastructure)

- [X] T001 Add `displayName String?` to the `Account` model in `prisma/schema.prisma` (data-model.md), then run `prisma migrate dev --name add_account_display_name` and `prisma generate`. Never edit the database by hand (constitution: Migrations & Backups).
- [X] T002 [P] Add `GOOGLE_OAUTH_MOCK_ENABLED=""` and `GOOGLE_OAUTH_MOCK_URL=""` to `.env.example`, directly beneath the existing `OPERATOR_PANEL_ENABLED` entry, with a comment stating they gate/locate the test-only mocked Google OAuth boundary (research.md #2) and MUST NEVER be set in any real deployment.

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: No user story task may begin until this phase is complete.

**Goal**: The one write path for `Account.displayName` (FR-002, by construction — it never accepts a target account id from the client), the shared placeholder-resolution helper, and the session payload every story reads from all exist before any story-specific work begins.

### Tests ⚠️ Write first, confirm red

- [X] T003 [P] Write `tests/unit/test_display_name_formatting.ts` (mirrors `tests/unit/test_listing_price_formatting.ts`): `resolveDisplayName(null)` returns the exported `DISPLAY_NAME_PLACEHOLDER`; `resolveDisplayName("Ada")` returns `"Ada"` unchanged. Confirm this FAILS (red) — the module doesn't exist yet.
- [X] T004 [P] Write `tests/contract/test_account_display_name.ts` (new file) covering `setDisplayName()`, against a real account in the real test database: a valid name (e.g. `"Ada Lovelace"`) → `{ ok: true }`, and the stored `Account.displayName` reflects it (FR-002, FR-013); a blank or whitespace-only name → `{ ok: false, reason: "invalid_display_name" }`, the account's `displayName` unchanged (FR-012, Edge Cases); a name over 50 characters → the same rejection (FR-012). Confirm these FAIL (red) — `setDisplayName` doesn't exist yet.

### Implementation

- [X] T005 [P] Implement `src/lib/formatting/displayName.ts`: export `DISPLAY_NAME_PLACEHOLDER = "A member"` and `resolveDisplayName(displayName: string | null): string` (research.md #4). Confirm T003 passes (green).
- [X] T006 [P] Implement `setDisplayName(accountId: string, displayName: string)` in `src/server/services/accountService.ts`, beside `signUp()`/`signInWithPassword()`: trim the input, reject blank or over-50-character values with `{ ok: false, reason: "invalid_display_name" }` (FR-012), otherwise `prisma.account.update()` and return `{ ok: true, account: { id, displayName } }`. Confirm T004 passes (green).
- [X] T007 Implement `PATCH /api/account/display-name/route.ts` (new route): derives the target account exclusively from `getCurrentAccount()` (never a request field — FR-002 by construction, research.md #5), parses `{ displayName }` from the body, calls `setDisplayName()`, maps `invalid_display_name` → `400`, success → `200` per contracts/display-names-api.md. Depends on T006.
- [X] T008 [P] Extend `src/lib/auth/currentAccount.ts`: add `displayName: string | null` to `CurrentAccountPayload` and `SessionAccount`, and thread it through `toCurrentAccountPayload()`/`getCurrentAccount()` from the already-loaded `Account` row.

**Checkpoint**: The one write path for `Account.displayName` exists and is independently correct; every user story below can now build on it.

---

## Phase 3: User Story 1 - A member sees who they're dealing with, never a raw identifier (Priority: P1) 🎯 MVP

**Goal**: A fellow community member sees a listing owner's display name (or the defined placeholder) on the community feed and the listing's detail page — and the owner's email address is never present in the rendered page or in any data sent to the browser for it.

**Independent Test**: Seed a listing owned by an account with a display name already set (directly via Prisma, independent of User Story 2's own creation-time prompt), view it as a different member of the same community on both the feed and detail page, and confirm the display name appears and no email address appears anywhere. Seed a second listing owned by a nameless account and confirm the placeholder appears instead.

### Tests ⚠️ Write first, confirm red

- [X] T009 [US1] Extend `tests/contract/test_listings.ts`: `listListings()` and `getListing()` each return `ownerDisplayName: string | null` matching the listing owner's `Account.displayName` — present when set, `null` when the owner has none (data-model.md's "Derived data" section). Confirm this FAILS (red) — the field doesn't exist on either return shape yet.
- [X] T010 [US1] Write `tests/integration/test_listing_display_names.spec.ts` (Playwright): as member A (display name set directly via Prisma for test setup), create a listing in community C; sign in as a different member B of C; visit `/communities/{C.id}/listings` and confirm A's display name is visible and A's email appears nowhere in the rendered page; open the listing's detail page and confirm the same; create a second listing owned by a nameless member A2 and confirm B sees the defined placeholder in both the feed and detail page, never A2's email. Confirm this FAILS (red) — neither page renders any owner name today.

### Implementation

- [X] T011 [US1] Extend `listListings()` and `getListing()` in `src/server/services/listingService.ts` to include `ownerDisplayName: string | null` (join the owner's `Account.displayName`). Confirm T009 passes (green).
- [X] T012 [P] [US1] Update `app/communities/[communityId]/listings/page.tsx`: this page already renders a card grid (`.listing-grid`/`.listing-card`/`.listing-card__body`), per 005's 2026-07-17 amendment that replaced its original two-column table — this task adds `resolveDisplayName(listing.ownerDisplayName)` to the existing `.listing-card__body` markup (e.g. "Listed by {name}"), never the owner's email. It does not introduce a card layout — one already exists; verify the current file's structure before editing if this has drifted since 005 shipped.
- [X] T013 [P] [US1] Update `app/communities/[communityId]/listings/[listingId]/page.tsx`: render the resolved owner display name on the detail view, in the same place for both the owner's own view and a fellow member's view. Confirm T010 passes (green).

**Checkpoint**: Every listing anyone views shows an attributable name or the defined placeholder — never an email — for any account that already has (or lacks) a display name. User Story 2 is what guarantees every *newly created* listing reaches this state without needing to be seeded by hand.

---

## Phase 4: User Story 2 - An email/password account is prompted to name themselves before their first listing goes live (Priority: P1)

**Goal**: An email/password account is never asked for a display name at sign-up; the first time it matters — creating a listing — a name is required before the listing exists, and that guarantee holds even if the request bypasses the creation form entirely (FR-008).

**Independent Test**: Sign up a brand-new email/password account and confirm no display-name prompt appears anywhere during sign-up. Sign in as that account, visit the listing-creation form, confirm a required "Display name" field is present, submit it alongside a listing, and confirm both the name and the listing are saved. Attempt `POST .../listings` directly for a different, still-nameless account and confirm it is rejected without creating a listing.

### Tests ⚠️ Write first, confirm red

- [X] T014 [US2] Extend `tests/contract/test_listings.ts`: `createListing()` rejects with `{ ok: false, reason: "display_name_required" }` when the calling account's `Account.displayName` is `null` — regardless of otherwise-valid title/description/price — and no `Listing` row is created; succeeds normally once the caller has a display name (FR-008). Confirm this FAILS (red) — `createListing()` has no such precondition yet.
- [X] T015 [US2] Write `tests/integration/test_listing_creation_display_name_prompt.spec.ts` (Playwright): sign up a brand-new email/password account and confirm no display-name field or prompt appears anywhere on the sign-up form; sign in, visit `/communities/{C.id}/listings/new`, confirm a required "Display name" field is present (the account has none yet); submit the form with a title/description/price and a display name, confirm the listing is created and the account's display name is now set; create a second listing as that same, now-named account and confirm no display-name field appears this time; separately, `POST /api/communities/{C.id}/listings` directly (bypassing the form) for a different, still-nameless account and confirm `409 display_name_required` with no listing created. Confirm this FAILS (red) — no such field or precondition exists yet.

### Implementation

- [X] T016 [US2] Add the `display_name_required` precondition to `createListing()` in `src/server/services/listingService.ts`: look up the caller's `Account`, reject before any other validation if `displayName` is `null` (research.md #3). Confirm T014 passes (green).
- [X] T017 [P] [US2] Update `POST /api/communities/[communityId]/listings/route.ts`: map the new `display_name_required` reason to `409` per contracts/display-names-api.md.
- [X] T018 [US2] Update `app/communities/[communityId]/listings/ListingForm.tsx`: accept the signed-in account's current `displayName` as a prop; when it is `null`, render an additional required "Display name" input; on submit, if that field is shown, call `PATCH /api/account/display-name` first and only proceed to create the listing once that call succeeds (research.md #3). Depends on T007.
- [X] T019 [US2] Update `app/communities/[communityId]/listings/new/page.tsx` to read the signed-in account's `displayName` (via `getCurrentAccount()`, T008) and pass it into `ListingForm`. Confirm T015 passes (green).

**Checkpoint**: User Stories 1 and 2 together guarantee every listing — old or newly created, through the form or a direct request — shows an attributable name or the defined placeholder, never an email. This is the feature's MVP.

---

## Phase 5: User Story 3 - A federated (Google) sign-in arrives already named (Priority: P2)

**Goal**: A Google sign-up or sign-in populates the account's display name from the provider's own profile name, with no prompt, at the moment the identity is linked — including when it auto-verifies a previously-unverified email/password account (spec 002 FR-018) — and never overwrites a display name the account already chose itself. Verified through the real `/api/auth/[...nextauth]` callback route, with Google mocked only at its own OAuth boundary (research.md #2) — never the adapter called in isolation.

The mock boundary this requires is a **standalone script outside this application entirely** (`scripts/mock-google-oauth-server.ts`, started only by a second Playwright `webServer` entry) — not a Next.js route under `app/`, and not invoked by `npm run build`/`next build`/`next start` in any form (research.md #2, revised third round). An earlier design hosted equivalent endpoints as actual routes under `app/api/test/mock-google-oauth/`, excluded from a production build by a `next.config.ts` check keyed on the route directory's absence — that design is **retracted** (plan.md Complexity Tracking): nothing ever removed that directory from the repository, so the check's condition could never be false for a real deploy, and every production build would have failed permanently. The standalone-script design removes the problem structurally instead of gating it. The one piece of this boundary that remains real, shipped code — `authConfig.ts`'s choice of which provider to register — keeps a full static-plus-behavioral test pairing, since a present-but-wrong gate would pass a source-shape check alone.

**Independent Test**: Drive the real Google sign-in flow (via the mocked OAuth boundary) for a brand-new email and confirm the resulting account has a non-empty display name sourced from the mocked profile, with no prompt shown. Repeat for an existing unverified account (FR-018's path) and for an existing verified account that already has its own display name (confirming it is left unchanged). Separately, with `GOOGLE_OAUTH_MOCK_ENABLED` unset, confirm `authConfig.ts` genuinely registers the real Google provider, not the mock one.

### Tests ⚠️ Write first, confirm red

- [X] T020 [US3] Write `tests/unit/test_mock_google_oauth_server.ts`: imports `buildAuthorizeRedirect()`, `handleTokenRequest()`, and `handleUserinfoRequest()` from `scripts/mock-google-oauth-server.ts` directly (no port bound), asserting: the authorize handler builds a redirect whose `Location` carries a fixed `code` and echoes back the given `state`; the token handler returns a fixed access-token JSON shape; the userinfo handler returns the configured fixture profile for a given access token (including a fixture with no `name`, for the Edge Cases case). Confirm this FAILS (red) — the module doesn't exist yet.
- [X] T021 [US3] Write `tests/unit/test_auth_google_provider_selection.ts` (research.md #2 — the behavioral guard this round's review specifically required): using `vi.resetModules()` and a dynamic `import()` of `src/lib/auth/authConfig.ts` under each env state, assert that with `GOOGLE_OAUTH_MOCK_ENABLED` unset, `authOptions.providers[0].wellKnown` equals Google's real discovery URL and no `GOOGLE_OAUTH_MOCK_URL` value appears anywhere in `provider.authorization`/`.token`/`.userinfo`; and that with it set to `"true"`, `wellKnown` is absent and all three endpoint URLs are prefixed with `GOOGLE_OAUTH_MOCK_URL`. Confirm this FAILS (red) — `authConfig.ts` has no such conditional yet, so the unset case already fails to resemble "the real provider, verified" as a meaningful assertion, and the enabled case has nothing to find.
- [X] T022 [US3] Write `tests/unit/test_mock_google_oauth_not_reachable_by_default.ts` (in the spirit of `tests/unit/test_community_creation_not_networked.ts` — a static, source-shape check, kept alongside T021, not instead of it): parses `src/lib/auth/authConfig.ts`'s source only (there are no route files to check anymore) and asserts every reference to `GOOGLE_OAUTH_MOCK_URL`/the mock provider construction is nested inside a branch conditioned on `GOOGLE_OAUTH_MOCK_ENABLED`. Confirm this FAILS (red) — no such reference exists yet.
- [X] T023 [US3] Write `tests/integration/test_google_display_name.spec.ts` (Playwright), driving the real `/api/auth/[...nextauth]` Google callback against the mocked OAuth boundary (never the adapter called directly — spec.md's own instruction) for four cases: (a) a brand-new email with a mocked profile carrying `name: "Ada Lovelace"` → the resulting account's `displayName` is `"Ada Lovelace"`, no prompt shown at any point (FR-004, SC-002); (b) an existing, unverified email/password account for the same email (triggering spec 002 FR-018's auto-link-and-verify) → `displayName` populated the same way (FR-005); (c) an existing, already-verified account that already has its own `displayName` set → left unchanged after the link completes (FR-006, SC-005); (d) a mocked profile with no `name` field at all, for a brand-new email → the resulting account has `displayName: null`, not an error (Edge Cases). Confirm this FAILS (red) — no mock boundary, hook, or provider swap exists yet.

### Implementation

- [X] T024 [US3] Add an `events.linkAccount` handler to `authOptions` in `src/lib/auth/authConfig.ts` (research.md #1): when `profile.name` is present and the linked account's `displayName` is currently `null`, set it (a single conditional `update`, `WHERE id = ... AND displayName IS NULL` — data-model.md's Atomicity section).
- [X] T025 [P] [US3] Add `displayName: user.name ?? null` to `createUser()` in `src/lib/auth/prismaAuthAdapter.ts`, for the brand-new-account path.
- [X] T026 [US3] Implement `scripts/mock-google-oauth-server.ts` (research.md #2): plain, exported handler functions (`buildAuthorizeRedirect()`, `handleTokenRequest()`, `handleUserinfoRequest()`) wrapped by a thin `http.createServer()` that binds a port only when this file is the actual process entry point (compare `import.meta.url` to the invoked script path), so tests can import the handlers directly without starting a real listener. Confirm T020 passes (green).
- [X] T027 [US3] Add the mock-provider swap to `authOptions.providers` in `authConfig.ts` (research.md #2): when `GOOGLE_OAUTH_MOCK_ENABLED === "true"`, register a hand-written `OAuthConfig` pointing `authorization`/`token`/`userinfo` at `GOOGLE_OAUTH_MOCK_URL` with `wellKnown` omitted, instead of `GoogleProvider(...)`. Confirm T021 and T022 both pass (green).
- [X] T028 [US3] Add a second `webServer` entry to `playwright.config.ts` (Playwright supports an array): `command: "tsx scripts/mock-google-oauth-server.ts"`, waiting on `GOOGLE_OAUTH_MOCK_URL` (or its port), alongside the existing Next.js dev-server entry. Confirm T023 passes (green).
- [X] T029 [US3] Verify structurally, against the real commands (not a simulation): run `npm run build` and confirm it succeeds — exactly as it has since 002, with no special-casing needed, since nothing under `app/` references the mock boundary; then, against a real running build (`npm run build && npm start`), request `/api/test/mock-google-oauth/authorize` (or any path under that prefix) and confirm the Next.js application itself returns its own ordinary `404`, proving no such route was ever registered there — independent of `GOOGLE_OAUTH_MOCK_ENABLED`'s value at request time.

**Checkpoint**: Federated sign-in populates display names correctly and never overwrites a self-chosen one, verified end-to-end through the real callback route. The mock boundary this required is outside the application by construction — nothing to gate at build time — and the one gate that *is* real production code (`authConfig.ts`'s provider selection) is covered by both a static and a behavioral regression test.

---

## Phase 6: User Story 4 - Anyone can see and change their own display name (Priority: P2)

**Goal**: Any account holder, regardless of how their account was created, can view their current display name (or its absence) and change it at any time, from a durable, reachable place.

**Independent Test**: Sign in as any account, visit the account settings page, confirm the current display name (or its absence) is shown, submit a new value, and confirm a fellow member's subsequent view of that account's listings reflects the change.

### Tests ⚠️ Write first, confirm red

- [X] T030 [US4] Write `tests/integration/test_account_display_name.spec.ts` (Playwright): sign in, visit `/account`, confirm the current display name (or its absence) is shown; submit a new value via the page's form, confirm it is saved, and confirm a different member viewing that account's listing afterward sees the new value; confirm there is no way for a different signed-in account to change the first account's display name (no account-id field exists to target it with — the first account's value is unaffected by anything the second account does). Confirm this FAILS (red) — `/account` doesn't exist yet.

### Implementation

- [X] T031 [US4] Implement `app/account/page.tsx` (server component: reads `getCurrentAccount()`, renders the current `displayName` or an explicit "not set yet" state) plus a client `DisplayNameForm.tsx` component calling `PATCH /api/account/display-name` (T007) and refreshing on success.
- [X] T032 [US4] Add a link to `/account` to the home page's sidebar (`app/page.tsx`), beside the existing account-email display, so the page is reachable in a single, direct step (SC-006). Confirm T030 passes (green).

**Checkpoint**: All four user stories independently verified — the feature is complete.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T033 [P] Run `npm run typecheck` and `npm run lint`; fix any issues introduced by this feature.
- [X] T034 [P] Run `npm run test:unit` (covers `tests/unit` and `tests/contract`, including this feature's new/extended files) with `GOOGLE_OAUTH_MOCK_ENABLED` unset (confirming T021's behavioral test and T022's static test both still pass, since `authConfig.ts` must genuinely resolve to the real provider) and `npm run test:e2e` with `GOOGLE_OAUTH_MOCK_ENABLED=true`/`GOOGLE_OAUTH_MOCK_URL` set alongside the existing `OPERATOR_PANEL_ENABLED=true`; confirm the whole suite is green, including a regression check that 002/003/004/005's existing tests still pass unmodified.
- [X] T035 Manually execute quickstart.md Scenarios 1–7 end-to-end against the real dev/test PostgreSQL database and a running dev server; record the results.
  - Scenario 1: verified by `tests/integration/test_listing_display_names.spec.ts` (real dev server, real DB, real browser) — named owner's display name and the "A member" placeholder both render on feed + detail, owner email never present in rendered HTML.
  - Scenario 2: verified by `tests/integration/test_listing_creation_display_name_prompt.spec.ts` — no field at sign-up, required field only on a nameless account's first listing, direct API bypass returns 409, field absent on the account's second listing.
  - Scenario 3: verified by `tests/integration/test_google_display_name.spec.ts`, driven through the real `/api/auth/[...nextauth]` callback against the mocked OAuth boundary — brand-new/unverified-autolink/no-name-fixture cases all populate `displayName` correctly; an already-named verified account is left unchanged.
  - Scenario 4: verified by `tests/integration/test_account_display_name.spec.ts` — `/account` shows/edits the caller's own name; a second account's edits never touch the first account's row (no account-id field to target it with).
  - Scenario 5: verified by `tests/contract/test_account_display_name.ts` — blank/whitespace and >50-character values both rejected with `invalid_display_name`, account unchanged.
  - Scenario 6: verified by inspection — `app/communities/[communityId]/admin/page.tsx` was not touched by this feature; its Prisma query still selects only `{ email: true }` on the membership's account, no `displayName` column added.
  - Scenario 7: `npm run test:unit` (120 passed) and `npm run test:e2e` (29 passed) both green, including the full pre-existing 002/003/004/005 suite with no regressions.
- [X] T036 Re-check plan.md's Constitution Check against the finished implementation: confirm Principle VI holds (no response a fellow member's browser receives ever includes an `email` field alongside `ownerDisplayName`, and the FR-010 administrator-list carve-out is exactly as narrow as written — no other surface claims it); confirm `npm run build` succeeds unconditionally on the finished tree (re-run T029's real-build verification once more) and that `authConfig.ts`'s provider-selection gate is genuinely correct in both directions (re-run T021); confirm no new runtime dependency crept in (`package.json`/`package-lock.json` unchanged apart from no new entries at all).
  - Principle VI: `listingService.ts`'s `listListings()`/`getListing()` both select only `{ displayName: true }` on `owner` — no `email` field anywhere in either response.
  - FR-010 carve-out: `app/communities/[communityId]/admin/page.tsx` untouched by this feature — still selects only `{ email: true }`, no `displayName` column added.
  - `npm run build`: re-confirmed green (see T029).
  - `authConfig.ts` provider gate: `test_auth_google_provider_selection.ts` + `test_mock_google_oauth_not_reachable_by_default.ts` re-run, both green.
  - Dependencies: `git diff --stat package.json package-lock.json` shows no changes — no new runtime dependency.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately.
- **Foundational (Phase 2)**: Depends on Setup (T001's migration must exist before any code referencing `Account.displayName` compiles/runs correctly). BLOCKS all user stories.
- **Phase 3 (US1)**: Depends on Foundational. Independently testable using directly-seeded display names.
- **Phase 4 (US2)**: Depends on Foundational (specifically T006/T007's write endpoint and T008's session payload) and reuses Phase 3's rendering (T012/T013) to confirm a newly created listing displays correctly — sequenced after US1 for that reason, though its own tests/implementation are otherwise independent of US1's.
- **Phase 5 (US3)**: Depends on Foundational only; independent of Phases 3–4's logic (it never touches `listingService.ts`), and touches no file either of them touches.
- **Phase 6 (US4)**: Depends on Foundational (T007's write endpoint, T008's session payload); independent of Phases 3–5's logic.
- **Polish (Phase 7)**: Depends on all prior phases being complete.

### Parallel Opportunities

- T003 and T004 (Foundational tests) are parallel — different files, both only depending on T001.
- T005 and T006 (Foundational implementation) are parallel — different files, neither depends on the other's output.
- T008 is parallel with T005/T006/T007 — a different file (`currentAccount.ts`) with no interdependency.
- T012 and T013 (US1) are parallel — different page files, both depending only on T011.
- T017 (US2 route change) is parallel with T018/T019 (US2 form/page changes) — different files.
- T020, T021, and T022 (US3 tests) are parallel — three different files, none depending on each other (T023 also touches a different file but is listed after for readability, not because of a dependency).
- T025 (US3 adapter change) is parallel with T024 (US3 authConfig change) and with T026 (the mock server, a wholly separate file) — none depend on each other's output; T027 depends on T026 existing (it points at it) and T028 depends on T026/T027 together.
- Once Foundational (Phase 2) is complete, Phases 3, 5, and 6 could in principle proceed in parallel (different files, no cross-story dependency); Phase 4 is sequenced after Phase 3 only because it reuses Phase 3's rendering to confirm its own outcome, not because of a file conflict.
- T033 and T034 (Polish) are independent checks, can run in parallel.

---

## Parallel Example: Phase 2 Foundational

```bash
# T003 and T004 depend only on T001 (already complete) and touch different files:
Task: "Write tests/unit/test_display_name_formatting.ts"
Task: "Write tests/contract/test_account_display_name.ts"

# T005, T006, and T008 touch three different files with no interdependency:
Task: "Implement src/lib/formatting/displayName.ts"
Task: "Implement setDisplayName() in src/server/services/accountService.ts"
Task: "Extend src/lib/auth/currentAccount.ts with displayName"
```

## Parallel Example: Phase 5 US3 tests

```bash
# T020, T021, and T022 touch three different files and can be written together:
Task: "Write tests/unit/test_mock_google_oauth_server.ts (mock server's own handler logic)"
Task: "Write tests/unit/test_auth_google_provider_selection.ts (behavioral provider-selection check)"
Task: "Write tests/unit/test_mock_google_oauth_not_reachable_by_default.ts (static source-shape check)"
```

---

## Implementation Strategy

### MVP First (User Stories 1 and 2 only)

1. Complete Phase 1 (Setup) and Phase 2 (Foundational).
2. Complete Phase 3 (T009–T013) and Phase 4 (T014–T019).
3. **STOP and VALIDATE**: run quickstart.md Scenarios 1–2; confirm T009–T019 are all green.
4. This is a legitimate MVP: every listing anyone can currently create or view shows an attributable name (or the defined placeholder) and never an email — the entire motivating problem (spec.md's "Why") is solved without Stories 3–4 yet existing.

### Incremental Delivery

1. Setup + Foundational → foundation ready.
2. Phase 3 (US1) → listings render names, not emails, for accounts that already have one.
3. Phase 4 (US2) → every *newly created* listing is guaranteed to have one too (MVP complete).
4. Phase 5 (US3) → federated sign-in never needs the prompt at all, verified through the real callback, against a mock boundary that lives entirely outside the application.
5. Phase 6 (US4) → anyone can correct a name they didn't choose or picked in a hurry.
6. Polish.

---

## Notes

- [P] tasks touch different files with no dependency on each other.
- [Story] labels map every task to the spec.md story whose acceptance criterion it satisfies.
- Commit after each task or logical group.
- Stop at any checkpoint to validate independently.
- Phase 5 (US3) deliberately does NOT add a Vitest/adapter-level test for `events.linkAccount`'s display-name population, even though four pre-existing Google tests already call the adapter directly for other assertions — spec.md's own instruction is that this specific guarantee must be verified through the real callback route, precisely because an adapter-only test is the seam that hid 002's session-cookie mismatch. T023 is the sole verification for this behavior, by design; the four pre-existing adapter-level Google tests are left untouched.
- Phase 5's mock-OAuth design went through two prior, retracted rounds (see plan.md's Complexity Tracking table for the full history) before landing on a standalone script outside `app/`: first, ordinary Next.js routes gated only at runtime; then the same routes plus a `next.config.ts` build-time exclusion keyed on `NODE_ENV`, which turned out to check for a directory nothing ever removed from the repository, so it would have failed every real production build permanently. The current design (T020, T026, T028) has no build-time toggle to get wrong, because there is nothing under `app/` for a production build to find in the first place.
- T012 depends on the card layout 005's 2026-07-17 amendment already introduced (`.listing-grid`/`.listing-card`) — this feature adds a name to that existing structure, it does not create one. If a future change reverts the feed to a table before this task is executed, re-scope T012 accordingly rather than building a layout inline.
- Both Vitest (unit/contract) and Playwright (integration) are used, matching 005 — this feature has real pages/routes for Playwright to exercise, plus three fast, non-server-dependent unit tests (T020, T021, T022) covering the mock-OAuth boundary's own logic and the one gate around it that is real production code.
