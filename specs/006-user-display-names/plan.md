# Implementation Plan: User Display Names

**Branch**: `006-user-display-names` | **Date**: 2026-07-17 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/006-user-display-names/spec.md`

## Summary

Give every `Account` an optional, self-chosen `displayName`, shown wherever that account is shown to a fellow community member — starting with a listing's owner on the community feed and detail page — and never the account's email address, in any form or as any fallback (Principle VI). A federated (Google) sign-up gets its display name populated automatically from the provider's own profile name, with no prompt, at the exact moment its identity is linked (`events.linkAccount`, research.md #1) — including when linking auto-verifies a previously-unverified email/password account (spec 002 FR-018), since that account can never have set one itself beforehand. An email/password account is prompted for a display name only when it first matters: creating its first listing — never at sign-up — and the guarantee that no listing exists for a nameless account is enforced inside `createListing()` itself, not only in the form, so it holds regardless of how the request arrives (research.md #3). One new endpoint (`PATCH /api/account/display-name`) is the sole write path, reused by both the listing-creation prompt and a new `/account` settings page where any account holder can view/edit their own name. Verifying the federated path end-to-end requires driving the real `/api/auth/[...nextauth]` callback route with Google mocked only at its own OAuth boundary (research.md #2) — not the adapter called in isolation, which is the exact seam that hid 002's session-cookie mismatch behind four adapter-only tests.

## Technical Context

**Language/Version**: TypeScript 6.0.3, Next.js (App Router) — unchanged from 002/003/004/005, no new language/runtime.

**Primary Dependencies**: `next-auth` 4.24.14 (existing) — no version change; this feature uses its already-available `events.linkAccount` hook and its provider-config shape (to define a test-only mock provider), not a new library. Prisma Client 6.19.3 (existing) — no new runtime dependency. `tsx` (existing devDependency, already used to run `scripts/create-community.ts`) runs the new standalone mock-OAuth server script for tests. No new npm package is added for OAuth mocking (research.md #2) or for anything else in this feature.

**Storage**: PostgreSQL via Prisma, same dev/test containers already used by 002–005. One new nullable column: `Account.displayName`. No new table.

**Testing**: Vitest (`tests/unit/`, `tests/contract/`) for `resolveDisplayName()`/placeholder resolution, `setDisplayName()`, `createListing()`'s new precondition, `listListings()`/`getListing()`'s `ownerDisplayName` field, the mock-OAuth server's own request-handling logic, and `authConfig.ts`'s provider selection (both statically and behaviorally) — red-then-green per Principle VIII, since this feature touches the already-critical product-listing and user-registration/federated-sign-in flows. Playwright (`tests/integration/`) for the listing feed/detail rendering, the listing-creation prompt (including a direct-API-bypass case), the `/account` page, and a real, end-to-end Google callback driven against the mocked OAuth boundary (research.md #2) — a second Playwright `webServer` entry, not the existing single one, since the mock boundary is now its own standalone process.

**Target Platform**: The existing single Next.js web app (App Router), installable PWA, Docker/Dokploy — no new deployable unit. The mocked Google OAuth boundary is **not part of this application at all** — it is a standalone script (`scripts/mock-google-oauth-server.ts`) that only Playwright's test configuration ever starts; it is not a Next.js route, is not under `app/`, and is not invoked by `npm run build`/`next build`/`next start` in any form, so there is no production-build state in which it could be present or reachable (research.md #2, revised third round). The one piece of this boundary that *is* shipped, real production code is `authConfig.ts`'s provider selection, gated at runtime by `GOOGLE_OAUTH_MOCK_ENABLED` (default unset/false).

**Project Type**: Extension of the existing single Next.js/Prisma project (no new top-level project).

**Constraints**: FR-002 ("only the account itself may set or change its own display name") MUST hold by construction — the one write endpoint derives its target exclusively from the caller's session, never a client-supplied account id (research.md #5). FR-008's "regardless of how the request arrives" MUST be enforced inside `createListing()` itself, not only in the listing-creation form (research.md #3) — this codebase already carries a precedent for exactly this class of gap (a check present in a page but not the service it calls), and this feature must not repeat it. FR-010's "email never rendered to a fellow member, anywhere in the product" MUST continue to hold — this feature only ever adds `ownerDisplayName`, never `ownerEmail`, to any response a fellow member's browser receives. `npm run build` MUST keep succeeding unconditionally, exactly as it has since 002 — nothing in this feature may make a normal production build fail or depend on a manual step being remembered first (research.md #2, revised third round).

**Scale/Scope**: One new column, three modified service functions (`accountService.ts` gains `setDisplayName()`; `listingService.ts`'s `createListing()`/`listListings()`/`getListing()` are extended), one new page (`/account`), one new API route, one new shared formatting helper, one standalone test-only mock-OAuth server script (outside `app/`, outside the deployable application) — no new entity, no new external integration, no bulk/administrative display-name operations.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Admin-Controlled Membership Origin (NON-NEGOTIABLE) | N/A | This feature touches no membership origination — it reads nothing about how a `Membership` came to exist. |
| II. Community Isolation (NON-NEGOTIABLE) | **PASS** | `displayName` is account-level, shown identically in every community the account holds membership in by design (FR-014) — there is no per-community data to leak across a boundary. The two extended queries (`listListings()`, `getListing()`) are already, and remain, scoped to `communityId` exactly as 005 established; this feature adds a field to their existing, already-scoped result, not a new unscoped read path. |
| III. Administrator as Community Gatekeeper | **PASS** | FR-002 and FR-015 explicitly preserve that a community administrator has no more authority over a display name than any other fellow member (none at all, over anyone but themselves), and explicitly leave the existing administrator-only member list (spec 004, which shows emails) completely untouched — no new administrator capability is added or removed. |
| IV. Non-Custodial Payments | N/A | No money, no payment path, no transaction logging touched. |
| V. Single Web Application, Installable as PWA | **PASS** | The new `/account` page and the extended listing-creation form are part of the same responsive Next.js PWA; no new client, no desktop-only surface. |
| VI. Contact & Data Privacy Gating (motivating principle) | **PASS, primary gate for this feature** | This feature exists to satisfy this principle: FR-009/FR-010/FR-011 require a display name (or a defined placeholder) wherever a fellow member sees an account, and require the email address never be rendered to a fellow member in any form, in any surface this feature touches. Re-verify at Phase 1 (data-model.md/contracts) and again at code review that no response a fellow member's browser receives ever includes an `email` field alongside `ownerDisplayName`. |
| VII. Simplicity & MVP-First | **PASS** | Reuses three already-established patterns in this exact codebase rather than inventing new ones: a shared resolve-with-placeholder formatter (mirrors 005's `formatListingPrice()`), a raw-`string \| null` service return field resolved only at render time (mirrors 005's `coverPhotoId`), and a disabled-by-default, env-gated provider selection (mirrors `OPERATOR_PANEL_ENABLED`'s shape, applied to `authConfig.ts` rather than a route). One write endpoint is reused by both User Story 2 and User Story 4 rather than two near-duplicate ones. No new entity, no new npm dependency, no per-community override, no moderation/impersonation tooling (FR-016, explicitly out of scope). The mocked Google OAuth boundary needed for User Story 3's verification (research.md #2) is a standalone script outside the application entirely, not a networked surface added to it — see the third-round revision below for why this is no longer a Complexity Tracking item. |
| VIII. Test Discipline for Critical Flows (NON-NEGOTIABLE) | **PASS, obligation carried into tasks.md** | This feature modifies the creation and rendering paths of "product listing" (005, explicitly named) and the federated-sign-in path of "user registration" (002, explicitly named) — both already-critical flows. Tests for every touched service function and page MUST be written first and confirmed red before implementation, per spec.md's own explicit instruction and tasks.md's ordering. This obligation explicitly includes both guard tests for `authConfig.ts`'s remaining, genuinely-shipped provider-selection gate (research.md #2, mitigations 2–3 in the revised numbering; Complexity Tracking history below) — a static (source-shape) test and a behavioral test that forces a real module re-evaluation and inspects the actual resulting provider config — since a present-but-wrong gate would pass the static check alone; both MUST be written first and confirmed red. |

**Additional Constraints check**: Stack constraint satisfied — no deviation from Next.js/Prisma/PostgreSQL/Docker, and no new runtime dependency of any kind (research.md #2's OAuth mocking is a standalone script run via the already-present `tsx` devDependency, not a library or a new build tool). Migrations & backups: the new `Account.displayName` column ships as a single versioned Prisma migration (tasks.md), never a manual DB edit.

**No Complexity Tracking violation remains open, as of the third-round revision below — see its own history for why an earlier round did carry one.**

*Re-checked after Phase 1 design: data-model.md and contracts/display-names-api.md introduce no new, additional violations beyond the one disclosed at the time (the mock-OAuth routes, since retracted). `ownerDisplayName` is the only new field added to the already community-scoped `listListings()`/`getListing()` responses — no `email` field is added alongside it anywhere (Principle VI). FR-002 is satisfied by construction in the contract (`PATCH /api/account/display-name` has no account-id request field), not merely by a check that could be gotten wrong.*

*Re-checked a second time (2026-07-17, before tasks.md was executed): the first correction's own build-exclusion mitigation (an npm `prebuild` script keyed on `process.env.NODE_ENV`) was itself found unreliable — traced through npm's and Next's actual process model, that check would never fire on a real deployment host. That round replaced it with a pure function invoked from the project's existing `next.config.ts`, and added a sixth mitigation (a behavioral contract test mirroring `test_operator_panel.ts`) alongside the static one. FR-010 also gained an explicit carve-out for the spec-004 administrator member list, moved out of an Edge Cases entry and into the requirement itself, since an administrator is — factually — also a fellow member by `Membership`, and the requirement's own text needs to say so rather than leave the reconciliation implicit.*

*Re-checked a third time (2026-07-17, still before tasks.md was executed): the second round's own fix was itself incomplete — it made the build-exclusion *trigger* reliable (`next.config.ts` does see the real `NODE_ENV`) but never specified anything that makes the trigger's condition ever false for a real build, since the mock-oauth directory it checked for is checked into the repository with nothing removing it before a production build. Every real deploy would have found the directory and failed, permanently, exactly the "guard that must be defeated to ship is a guard that will be defeated" failure mode. The fix is not a better build-time check — it's removing the reason one is needed: the mocked OAuth boundary is now a standalone script (`scripts/mock-google-oauth-server.ts`) that lives outside `app/` entirely and is never invoked by any production build/start command, so there is nothing under the application's route tree to exclude, in any state. `src/lib/build/assertTestOnlyRoutesExcluded.ts`, its `next.config.ts` wiring, and its unit test are removed as a result — not replaced, removed, since the guarantee they existed to provide is now true unconditionally. This also closes the second reviewer finding of this round: the provider-selection gate in `authConfig.ts` (the one piece of this boundary that remains real, shipped code) had only ever been checked statically; a new behavioral test (`tests/unit/test_auth_google_provider_selection.ts`) now forces a real module re-evaluation under both env states and inspects the actual resulting provider config, closing the same "present but wrong" gap the second round's mitigation 6 closed for the (now-removed) routes.*

## Project Structure

### Documentation (this feature)

```text
specs/006-user-display-names/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output
├── data-model.md         # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── display-names-api.md
└── tasks.md              # Phase 2 output (/speckit-tasks command — not created by /speckit-plan)
```

### Source Code (repository root)

Extends the existing single Next.js/Prisma project established by 002–005 — no new top-level project.

```text
prisma/
└── schema.prisma                              # + Account.displayName String? (new migration: add_account_display_name)

src/
├── server/
│   └── services/
│       ├── accountService.ts                  # + setDisplayName(accountId, displayName) — FR-002, FR-012;
│       │                                       #   the only Account.displayName write path
│       └── listingService.ts                  # createListing(): + display_name_required precondition (FR-008);
│                                                #   listListings()/getListing(): + ownerDisplayName: string | null
├── lib/
│   ├── auth/
│   │   ├── authConfig.ts                      # + events.linkAccount (research.md #1); + mock-provider swap
│   │   │                                       #   gated by GOOGLE_OAUTH_MOCK_ENABLED, pointing at
│   │   │                                       #   GOOGLE_OAUTH_MOCK_URL (research.md #2, revised)
│   │   ├── prismaAuthAdapter.ts                # createUser(): + displayName from user.name (brand-new account)
│   │   └── currentAccount.ts                   # CurrentAccountPayload: + displayName: string | null
│   └── formatting/
│       └── displayName.ts                     # new: DISPLAY_NAME_PLACEHOLDER, resolveDisplayName() — mirrors
│                                                #   005's formatting/currency.ts precedent (research.md #4)

scripts/
└── mock-google-oauth-server.ts                 # new, test-only: standalone Node HTTP server (research.md #2,
                                                  #   revised third round) — NOT a Next.js route, not under app/,
                                                  #   never invoked by npm run build/next build/next start;
                                                  #   exports buildAuthorizeRedirect()/handleTokenRequest()/
                                                  #   handleUserinfoRequest() for direct unit testing, and binds
                                                  #   a real port only when run as the process entry point

playwright.config.ts                             # webServer becomes an array: the existing Next.js dev-server
                                                  #   entry, plus a new entry starting the script above
                                                  #   (`tsx scripts/mock-google-oauth-server.ts`) on its own port

.env.example                                     # + GOOGLE_OAUTH_MOCK_ENABLED="" and GOOGLE_OAUTH_MOCK_URL=""
                                                  #   with a "never enable outside tests" warning, alongside the
                                                  #   existing OPERATOR_PANEL_ENABLED

app/
├── account/
│   └── page.tsx                               # new: signed-in-only — view/edit own displayName (Story 4)
├── page.tsx                                    # + sidebar link to /account
├── communities/
│   └── [communityId]/
│       └── listings/
│           ├── page.tsx                       # + resolved ownerDisplayName on the existing card layout (005's
│           │                                   #   2026-07-17 amendment already replaced the old table with
│           │                                   #   .listing-grid/.listing-card — this adds a name, not a layout)
│           ├── ListingForm.tsx                # + conditional required "Display name" field when the caller has
│           │                                   #   none yet (Story 2); calls the display-name endpoint first,
│           │                                   #   then creates the listing
│           └── [listingId]/
│               └── page.tsx                   # + resolved ownerDisplayName on the detail view (Story 1)
└── api/
    └── account/
        └── display-name/
            └── route.ts                       # new: PATCH — the sole Account.displayName write path

tests/
├── unit/
│   ├── test_display_name_formatting.ts         # new: resolveDisplayName()/placeholder (mirrors
│   │                                            #   test_listing_price_formatting.ts)
│   ├── test_mock_google_oauth_server.ts         # new: imports buildAuthorizeRedirect()/handleTokenRequest()/
│   │                                            #   handleUserinfoRequest() from scripts/mock-google-oauth-
│   │                                            #   server.ts directly — no port bound, ordinary correctness
│   │                                            #   testing for test infrastructure (research.md #2)
│   ├── test_auth_google_provider_selection.ts   # new: behavioral guard (research.md #2, mitigation 3, revised)
│   │                                            #   — forces a real module re-evaluation of authConfig.ts under
│   │                                            #   both env states (vi.resetModules() + dynamic import) and
│   │                                            #   inspects the actual authOptions.providers[0]: real Google
│   │                                            #   config (wellKnown present) when unset, mock config
│   │                                            #   (wellKnown absent, endpoints under GOOGLE_OAUTH_MOCK_URL)
│   │                                            #   when enabled
│   └── test_mock_google_oauth_not_reachable_by_default.ts
│                                                # new: static guard (research.md #2, mitigation 2, revised) — in
│                                                #   the spirit of test_community_creation_not_networked.ts;
│                                                #   parses authConfig.ts's source only (no more route files)
│                                                #   to confirm its mock-provider reference is gated
├── contract/
│   ├── test_account_display_name.ts            # new: setDisplayName() — FR-002, FR-012, red→green
│   └── test_listings.ts                        # extended: createListing()'s display_name_required precondition;
│                                                #   listListings()/getListing()'s ownerDisplayName
└── integration/
    ├── test_listing_display_names.spec.ts       # new: Playwright — feed/detail show displayName or placeholder,
    │                                             #   never email (US1 only; display names seeded via Prisma)
    ├── test_listing_creation_display_name_prompt.spec.ts
    │                                             # new: Playwright — US2's sign-up-to-listing flow, including
    │                                             #   the direct-API create-listing bypass rejection
    ├── test_account_display_name.spec.ts        # new: Playwright — /account view/edit; a different account
    │                                             #   cannot change it
    └── test_google_display_name.spec.ts         # new: Playwright — real /api/auth/[...nextauth] callback against
                                                  #   the mocked OAuth boundary; brand-new account, existing
                                                  #   unverified account (FR-018 path), existing verified account
                                                  #   with its own name (must not be overwritten), no-name profile
```

**Structure Decision**: `setDisplayName()` lives beside `signUp()`/`signInWithPassword()` in the existing `accountService.ts`, since it is an `Account`-level mutation like those (no new service file). `resolveDisplayName()`/`DISPLAY_NAME_PLACEHOLDER` live in a new `src/lib/formatting/displayName.ts`, directly alongside 005's `src/lib/formatting/currency.ts`, following the exact same shared-formatter shape rather than inlining presentation logic per page. `/account` is a new top-level page (not nested under `/communities/{id}`), since a display name is account-level, never community-scoped (FR-014). The mocked Google OAuth boundary is `scripts/mock-google-oauth-server.ts` — beside the existing `scripts/create-community.ts` (003), reusing the same `tsx`-executed-standalone-script convention — deliberately **not** under `app/api/test/` this time (research.md #2, revised third round): the whole point is that Next.js's build/route-resolution process never looks at this file at all, which a location under `app/` cannot offer regardless of any runtime or build-time guard layered on top.

## Complexity Tracking

**Current status: empty — no open Constitution Check violation.** The table below records one that existed for two rounds of this feature's own planning and was fully resolved, kept for the audit trail rather than deleted, since silently erasing a disclosed-then-retracted deviation would make the plan's history harder to reconstruct than either keeping it disclosed or never having raised it.

| Violation (status) | Why it was proposed | Why it's no longer needed |
|-----------|------------|-------------------------------------|
| *(RETRACTED, 2026-07-17, third round)* Three test-only routes under `app/api/test/mock-google-oauth/` would have impersonated Google's OAuth `authorize`/`token`/`userinfo` endpoints — if reachable, a caller could assert *who a user is*, a complete authentication bypass, not merely a privacy leak (reviewer finding, first round). Two further review rounds hardened this design (independent runtime gates, a `next.config.ts`-enforced build exclusion, static and behavioral guard tests) before a third round found the build-exclusion condition itself unsatisfiable: it checked for the mock-oauth directory's absence, but nothing removed that directory from the repository before a production build, so every real deploy would have found it present and failed the build permanently — a guard with no specified path to a successful build is not a guard, it's a landmine. | User Story 3 / SC-002 require driving the real `/api/auth/[...nextauth]` callback route end-to-end (not the adapter called in isolation — the exact seam that hid 002's session-cookie mismatch behind four adapter-only tests), and Google itself blocks automated browsers, so *something* had to stand in for Google's endpoints during a real callback in CI. | The mocked boundary is now `scripts/mock-google-oauth-server.ts` (research.md #2) — a standalone script, never under `app/`, never invoked by `npm run build`/`next build`/`next start`. There is nothing in the application's own route tree to exclude from a production build, in any state, so no build-time guard is needed at all; `npm run build` keeps succeeding exactly as it always has since 002. The one piece of this boundary that remains real, shipped code — `authConfig.ts`'s choice of which provider to register — is still gated by `GOOGLE_OAUTH_MOCK_ENABLED` (default unset/false) and is still covered by both a static test (source-shape) and a behavioral test (forces a real re-evaluation and inspects the actual provider config) — the same static/behavioral pairing the second round introduced, now correctly aimed at the one gate that is still production code. This is no longer a disclosed deviation because it no longer widens what is reachable from the shipped application at all — it is testing infrastructure that happens to live in this repository, exactly like `scripts/create-community.ts` already does. |
