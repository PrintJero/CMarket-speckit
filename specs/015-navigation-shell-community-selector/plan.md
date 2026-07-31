# Implementation Plan: Navigation Shell and Community Selector

**Branch**: `015-navigation-shell-community-selector` | **Date**: 2026-07-31 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/015-navigation-shell-community-selector/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

After sign-in, a member must choose one active community and then works entirely within it: a search+feed main view scoped to that community, and a sidebar exposing the active community's identity plus consolidated navigation to existing surfaces. "Active community" does not exist as a concept anywhere in the codebase today (confirmed by investigation below), so this plan introduces the smallest possible extension to make it exist: a nullable `activeCommunityId` column on the *existing* `Session` row (002-accounts-authentication), re-verified as a live membership via the *existing* `requireCommunityMembership()` gate on every read — never cached, never a second parallel tracking mechanism. The main view and sidebar are built entirely on top of already-existing, unmodified service functions (`listListings`, `getReputationSummary`, `getCurrentAccount`, thread/listing/transaction hub routes); the only new code is the entry-point router, the community-selection screen, the active-community main view, a batched reputation lookup, and a reshaped (not re-logicked) sidebar.

## Technical Context

**Language/Version**: TypeScript, Next.js 16 (App Router) — existing stack, unchanged.

**Primary Dependencies**: Prisma ORM (PostgreSQL), existing `sessionService.ts`, `listingService.ts` (`requireCommunityMembership`, `listListings`), `reviewService.ts` (`getReputationSummary`), `src/lib/auth/currentAccount.ts` (`getCurrentAccount`). No new dependency introduced.

**Storage**: PostgreSQL via Prisma. One additive column: `Session.activeCommunityId String?` (+ FK to `Community`, `onDelete: SetNull`). No new table.

**Testing**: Vitest-style contract/unit tests + Playwright integration tests, matching the project's existing convention. Per the constitution's default (not a Principle VIII named critical flow) and the spec's own testing note, automated tests are REQUIRED only for the community-scoping guarantee (User Story 3 / FR-009–FR-011 / SC-003); tests for the rest of this feature are optional.

**Target Platform**: Web, PWA-installable, must be fully usable at mobile viewport widths (Principle V) — reuses the existing `AppShell.tsx` mobile drawer pattern (`peer-checked` checkbox toggle) rather than a new one.

**Project Type**: Single Next.js web application (existing repo layout) — no frontend/backend split.

**Performance Goals**: No new performance target beyond avoiding N+1 queries introduced by this feature itself — the main view's trust-visible cards fetch reputation and current-membership state for a page of listings in one batched query each, not one query per card.

**Constraints**: Zero cross-community aggregation on any surface this feature introduces (Principle II); zero directory/browse/self-join affordance (Principle I); zero contact data on any new screen (Principle VI); sidebar and all new screens fully responsive (Principle V).

**Scale/Scope**: Presentational/navigational feature: one new entry-point router, one new selection screen, one new active-community main view, one reshaped sidebar, one small schema addition, one small batched-lookup addition to `reviewService.ts`. No new marketplace entity.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Principle I (Admin-Controlled Membership Origin) — PASS.** The community-selection screen (FR-001–FR-005) renders exclusively from `getCurrentAccount().memberships` — the same current-membership list already used by the existing sidebar — with no directory, browse, search-for-communities, or join/request-to-join affordance anywhere on it or on the zero-memberships empty state (which already exists, unchanged in substance, in `app/page.tsx` today). This plan adds no new membership-origin path.
- **Principle II (Community Isolation) — PASS, explicitly confirmed.** Every surface this feature introduces or changes is parameterized by exactly one `communityId` (from the URL path or the freshly-selected value) and passes it straight into the existing single-community gate `requireCommunityMembership()` and the existing single-community query `listListings(communityId, ...)`. Switching the active community (FR-002/FR-011/FR-014) is implemented as: persist the new `activeCommunityId`, then navigate to that one community's own main view — there is no code path that unions or aggregates two `communityId` values into one result set. Note for reviewers: the pre-existing global hub routes this feature links to unchanged (`/chats`, `/my-listings`, `/transactions` — each intentionally cross-community by design, per their own already-approved features 008/005/013) are reused exactly as FR-018 requires and are **not** introduced by this feature; they are out of scope to re-litigate here.
- **Principle III (Administrator as Gatekeeper) — N/A.** No invitation, approval, revocation, or moderation action is touched. The new "Admin" sidebar entry (FR-019–FR-021) is a link only; it performs no gatekeeper action itself.
- **Principle IV (Non-Custodial Payments) — N/A.** No payment path touched.
- **Principle V (Single Web App / PWA) — PASS.** The community-selection screen, the main view, and the reshaped sidebar all reuse `AppShell.tsx`'s existing mobile collapse mechanism (the `peer-checked` checkbox drawer) rather than introducing a second responsive pattern.
- **Principle VI (Contact & Data Privacy Gating) — PASS.** New screens show only display name, active-community name/membership badge, and reputation (rating/review count) — never phone/email/address (FR-024/SC-008). The Admin entry point grants no data access by itself (FR-021).
- **Principle VII (Simplicity & MVP-First) — PASS.** No new service is created beyond one additive Prisma column, two small `sessionService.ts` functions reusing its existing `hashToken`/lookup pattern, and one batched sibling of the already-exported `getReputationSummary()`. The main view's feed query is the existing `listListings()` call, unchanged. Price-range filtering (present in the existing `/listings` page) is deliberately not carried into the new main view — it was never requested here, so it stays out of scope rather than being spuriously ported.
- **Principle VIII (Test Discipline) — PASS.** Not a named critical flow. Per the spec's own testing note, automated tests are mandatory only for the community-scoping guarantee (Story 3); those tests will be written test-first per the general contract-test convention already used elsewhere in this codebase, though the constitution does not require red-green-refactor discipline outside named critical flows.
- **Principle IX (Platform Administration) — N/A.** No MASTER-authority surface touched.

**Reuse audit (Mandate: list what this feature reuses from each surface, and confirm it forks nothing):**

| Feature | Reused as-is | Forked? |
|---|---|---|
| 002-accounts-authentication | `Session` model, `sessionService.ts`'s `hashToken`/session-lookup pattern, sign-in/sign-up pages, password-change surface (linked from Account) | No — `Session` gains one additive nullable column; no existing session function's behavior changes for any caller that doesn't pass the new optional argument |
| 005-product-listings | `listListings()`, `getListing()`, `/my-listings` hub route, `formatListingPrice()` | No — called unchanged; no new listing business rule |
| 006-user-display-names | `resolveDisplayName()`, the Account display-name change surface | No |
| 008-listing-messaging | `/chats` hub route, `listMyThreads()`/`listThreads()`, thread pages | No |
| 011-wanted-posts | The `kind` filter on `listListings()` (`FOR_SALE` \| `WANTED`) — there is no separate wanted-post service; it is the same `Listing` model and function | No |
| 012-profiles-reputation | `getReputationSummary(accountId)` in `reviewService.ts` — extended with a new batched sibling in the same file for feed-card use, built on the same underlying aggregate query, not a divergent computation | No — see research.md #2 |
| 013-purchase-flow-stock | `/transactions` hub route, `listMyTransactions()` | No |

## Project Structure

### Documentation (this feature)

```text
specs/015-navigation-shell-community-selector/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
prisma/
└── schema.prisma                                  # Session gains activeCommunityId (+ FK to Community, SetNull)

src/
├── server/services/
│   ├── sessionService.ts                          # + setActiveCommunity(), getValidSession() returns activeCommunityId
│   └── reviewService.ts                           # + getReputationSummaries() (batched sibling of getReputationSummary)
└── lib/auth/
    └── currentAccount.ts                          # CurrentAccountPayload gains activeCommunityId (re-verified live)

app/
├── page.tsx                                        # rewritten: entry-point router (redirect / selection screen / empty state)
├── _components/
│   ├── AppShell.tsx                                # sidebar reshaped: active-community name + expandable switcher, single Admin entry
│   └── CommunitySelector.tsx                       # NEW: the community-selection screen content
├── api/
│   └── active-community/route.ts                   # NEW: POST — validates membership, persists activeCommunityId; the ONLY write path (selector, switcher, and the main view's deep-link sync all call this same route)
└── communities/[communityId]/
    ├── page.tsx                                     # NEW: Story 2 main view (search + For sale/Wanted toggle), reuses listListings() — server render performs no writes
    └── MainViewControls.tsx                         # NEW: search + toggle, client component; post-hydration effect syncs deep-link visits to POST /api/active-community

tests/
├── contract/
│   └── test_active_community.ts                    # NEW: community-scoping guarantee (Story 3 / FR-009–FR-011)
└── integration/
    └── test_navigation_shell.spec.ts                # NEW: selection → main view → switch → isolation, Playwright
```

**Structure Decision**: Existing single Next.js App Router project (`app/`, `src/server/services/`, `src/lib/`, `prisma/`, `tests/`). No new project, package, or directory tier — this feature adds files inside the existing structure only, consistent with Principle VII.

## Complexity Tracking

*No Constitution Check violations — table intentionally empty.*
