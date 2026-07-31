# Implementation Plan: Account Profile and Shared-Community Member Profiles

**Branch**: `014-account-public-profiles` | **Date**: 2026-07-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/014-account-public-profiles/spec.md`

## Summary

Replace the "Account settings coming soon" placeholder with a real self-profile page (display name, email, account creation date, global reputation, and every current community the account belongs to — role, member-since date, own active `FOR_SALE`/`WANTED` listings, both clickable). Rebuild 012-profiles-reputation's public member profile so it aggregates **every community the viewer and the viewed account currently both belong to** — not only the one community the link happened to come from — while never naming a community only one of the two belongs to. Access to a public profile is decided purely by whether that shared-community intersection is non-empty; when it is empty, the profile is unreachable and no data (not even a display name) is returned. No new stored entity: this is an access-control and aggregation change over the same `Account`, `Membership`, `Listing`, `Transaction`, and `Review` rows 012 and 013 already established, reusing `getReputationSummary()` and the `ACCEPTED`-only completed-transaction count unchanged.

## Technical Context

**Language/Version**: TypeScript, Next.js (App Router) — unchanged from 002-013, no new language/runtime.

**Primary Dependencies**: Prisma Client (existing) — no new runtime dependency. Reuses `getReputationSummary()` (012, `reviewService.ts`) and 013's `Transaction.state === "ACCEPTED"` completed-transaction count unchanged; reuses the existing `Listing` model's `kind`/`status`/`stockQuantity` fields (005/011/013) unchanged.

**Storage**: PostgreSQL via Prisma, same dev/test containers already used by 002-013. **No new table, no new column, no migration** — this feature is the first in this codebase to require none. `profileService.ts`'s `getProfile()` and new `getSelfProfile()` are pure read aggregations over existing `Account`, `Membership`, `Listing`, `Transaction`, and `Review` rows.

**Testing**: Vitest (`tests/contract/test_profiles.ts`, rewritten) for the shared-community intersection algorithm (one shared community, several shared communities, zero shared communities, self-viewing-self, a community only one party belongs to never appearing) and the new `getSelfProfile()` (own email/creation date/role/all current communities, never exposing another account's email). Playwright (`tests/integration/test_profile_view.spec.ts`, rewritten; a new `test_self_profile.spec.ts`) for the self-profile page reached from "Account," the multi-community public-profile view reached from a listing/thread/transaction, and clickable community names/listing cards. Neither self- nor public-profile viewing is on Constitution Principle VIII's named critical-flow list — tests remain required in tasks.md anyway because spec.md's own Success Criteria (SC-001 through SC-007) commit to automated verification of these guarantees, mirroring 012-profiles-reputation's identical precedent for its own spec.

**Target Platform**: The existing single Next.js web app (App Router), installable PWA, Docker/Dokploy — no new deployable unit. The self-profile reuses the existing `/account` route (replacing its placeholder body). The public profile **keeps its existing route** (`/communities/[communityId]/members/[accountId]`, page + `GET` API route) — every one of the 8 existing files that link to it (listings feed/detail, chat threads list/detail, transactions list/detail, the Transactions hub) needs zero changes, since the URL shape is unchanged; only what renders behind it changes.

**Project Type**: Extension of the existing single Next.js/Prisma project (no new top-level project).

**Performance Goals**: None beyond standard interactive web-app latency. A profile view now issues one listings query per shared community rather than one; bounded by how many communities two real accounts can plausibly share (small n in this product's domain), not a scale concern.

**Constraints**: A public profile's accessibility is decided **solely** by whether the viewer's and the viewed account's own current-Membership community-ID sets intersect (FR-013, FR-017) — never by the route's own `communityId` path segment, which is retained only for navigation/back-link continuity, not as an access gate. "Currently belongs to" reuses the exact operationalEpoch-matching definition already independently implemented in `getCurrentAccount()` (`src/lib/auth/currentAccount.ts`), `listMyListings()`, and `listMyThreads()` (`listingService.ts`/`messageService.ts`) — `profileService.ts` gets its own small epoch-aware membership helper, matching this codebase's established per-service-duplication convention rather than introducing a new shared cross-module utility (Principle VII). Global average rating, rating count, and completed-transaction count are computed exactly as 012/013 already do — global, never community-scoped, never revealing which community contributed (FR-018–FR-020) — unchanged logic, only reused.

**Scale/Scope**: One profile view at a time; no new index is required — `Membership`'s existing `(accountId, communityId)` unique constraint and `communityId` index, and `Listing`'s existing per-owner/per-community query shape, are sufficient at this scale.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Admin-Controlled Membership Origin (NON-NEGOTIABLE) | N/A | This feature adds no membership path — it only reads each account's own existing `Membership` rows. |
| II. Community Isolation (NON-NEGOTIABLE) | **PASS** | A public profile's visible communities are exactly the non-empty intersection of the viewer's *own* current memberships and the viewed account's *own* current memberships (FR-013) — never a caller-supplied or route-supplied list, and never including a community only one party belongs to (FR-015, FR-016). This is a strengthening over 012's single-community model, not a weakening: a profile can now only ever disclose communities *both* parties independently already belong to, and discloses strictly more of them only when that mutual membership genuinely grows. Self-profile has no isolation concern — it only ever shows the caller's own data (FR-026). |
| III. Administrator as Community Gatekeeper | N/A | No administrator action is added; mirrors 012's own identical "no administrator access path" precedent. |
| IV. Non-Custodial Payments — Transaction Logging as Source of Truth (NON-NEGOTIABLE) | N/A | No money or payment path is touched. Reads 013's `Transaction.state` as a read-only completed-count source; writes nothing back. |
| V. Single Web Application, Installable as PWA | **PASS** | Both profile pages extend the existing responsive `AppShell` — no new client, no desktop-only surface (spec.md SC-006). |
| VI. Contact & Data Privacy Gating | **PASS** | The self profile's email is confined to the account owner's own page (FR-008) — this is the caller viewing their *own* contact data, not a disclosure to another user, so it does not engage the "shared only after mutual agreement" rule this principle protects. The public profile carries no email, phone, address, or authentication data under any circumstance (FR-012), verified by SC-003, identical in kind to 012's own guarantee. |
| VII. Simplicity & MVP-First | **PASS** | Zero new entities, zero migrations — the entire feature is a query/access-control rewrite of one existing service (`profileService.ts`) plus two page templates. No new shared abstraction is introduced for "current membership" — the existing per-service duplication convention is followed instead of inventing a cross-module utility for a three-line epoch check. |
| VIII. Test Discipline for Critical Flows (NON-NEGOTIABLE) | **N/A by constitution; mandatory by this feature's own spec** | Not on Principle VIII's named critical-flow list. spec.md's Success Criteria (SC-001–SC-007) nonetheless commit to automated verification — tasks.md MUST carry these as required tests, mirroring 012's own identical treatment. |
| IX. Platform Administration Authority (NON-NEGOTIABLE) | N/A | No MASTER-surface change; nothing in `profileService.ts` or its routes/pages references `masterAdministrationService` or any `/master` route. |

**Additional Constraints check**: Tenancy — the shared-community intersection is derived transiently, at request time, from each account's own live `Membership` rows; nothing is cached or supplied by the caller, and no new store is introduced. Stack — no deviation, no new dependency. Migrations & backups — **none needed**; this feature ships with zero `prisma/schema.prisma` changes and zero new migrations.

No Core Principle violations identified; Complexity Tracking table is not needed.

*Re-check after Phase 1 design: data-model.md and contracts/account-profiles-api.md introduce no new violations — both describe read shapes over existing tables only. The shared-community intersection is computed from two independently-fetched, live `Membership` queries (never a client-supplied community list). No new PII field is introduced; the self profile's email field is the account owner's own, gated by "is this the signed-in caller's own accountId," not a new privacy exception. No administrator- or MASTER-only route or field was introduced.*

## Project Structure

### Documentation (this feature)

```text
specs/014-account-public-profiles/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── account-profiles-api.md
└── tasks.md             # Phase 2 output (/speckit-tasks command — not created by /speckit-plan)
```

### Source Code (repository root)

Extends the existing single Next.js/Prisma project established by 002-013 — no new top-level project, no schema/migration changes.

```text
src/
└── server/
    └── services/
        └── profileService.ts       # rewritten: getProfile() now computes the viewer↔target
                                     #   current-membership intersection (FR-013–FR-017) instead
                                     #   of a single communityId gate; the old "not_a_member"
                                     #   reason is retired — an outsider sharing no community gets
                                     #   the same "not_found" a nonexistent account would (research.md);
                                     #   new getSelfProfile(accountId) for the account-owner view
                                     #   (email, account creation date, role, every current
                                     #   community, own active FOR_SALE/WANTED listings per community)

app/
├── account/
│   └── page.tsx                     # rewritten: replaces the "Account settings coming soon"
│                                     #   placeholder with the self-profile view (FR-001–FR-009b)
├── api/
│   └── communities/
│       └── [communityId]/
│           └── members/
│               └── [accountId]/
│                   └── route.ts     # extended: GET handler stops forwarding the URL's
│                                     #   communityId into getProfile() — the path segment is
│                                     #   kept only for route/back-link continuity, no longer
│                                     #   part of the access decision; 403 (not_a_member) retires
│                                     #   in favor of 404 for the zero-shared-community case
└── communities/
    └── [communityId]/
        └── members/
            └── [accountId]/
                └── page.tsx          # rewritten: one section per shared community (community
                                       #   name → link to that community's listings feed,
                                       #   member-since date, active FOR_SALE/WANTED listings as
                                       #   clickable cards) instead of a single community's data
                                       #   (FR-010–FR-017b)
```

**Structure Decision**: The public profile keeps its existing route shape exactly (`/communities/[communityId]/members/[accountId]`, page + API) — the `communityId` segment remains for navigation/back-link purposes only, per spec.md's own Assumptions, so every one of the 8 existing call sites that link to it (`app/communities/[communityId]/listings/page.tsx`, `.../listings/[listingId]/page.tsx`, `.../threads/page.tsx`, `.../threads/[threadId]/page.tsx`, `.../transactions/page.tsx`, `.../transactions/[transactionId]/page.tsx`, `app/chats/page.tsx`, `app/transactions/page.tsx`) needs zero changes. The self profile reuses the existing `/account` route and its existing "Account" nav link (`app/_components/AppShell.tsx`) unchanged. The only rewritten runtime files are `profileService.ts`, the one existing profile page, the one existing profile API route, and `app/account/page.tsx` — every other file in the project is untouched.

## Complexity Tracking

*No Core Principle violations — table not needed. This feature reduces complexity relative to 012 (its predecessor): one fewer distinguishable "reason" in `GetProfileResult`, and zero schema/migration surface.*
