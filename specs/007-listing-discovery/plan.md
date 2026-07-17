# Implementation Plan: Listing Discovery

**Branch**: `007-listing-discovery` | **Date**: 2026-07-17 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/007-listing-discovery/spec.md`

## Summary

Extend 005-product-listings' community listing feed with keyword search (title/description substring match), a price range filter, and pagination — all expressed as a single Prisma query (`WHERE`/`ORDER BY`/`LIMIT`/`OFFSET`), never as an in-memory filter/sort/slice over a fully-loaded result set. Every discovery path stays scoped by `communityId` via the existing `requireCommunityMembership()` and returns `ACTIVE` listings only, exactly as 005 already enforces. The feed page already calls `listListings()` directly and renders a card grid (cover photo, price, owner display name) per an already-shipped, separate amendment — this feature extends that same function additively and adds search/filter/pagination controls around the existing cards, without changing how a card renders. No new entity, no new runtime dependency, no new authorization primitive.

## Technical Context

**Language/Version**: TypeScript 6.0.3, Next.js (App Router) — unchanged from 002-006, no new language/runtime.

**Primary Dependencies**: Prisma Client 6.19.3 (existing) — no new runtime dependency. Reuses `requireCommunityMembership()` from `src/server/services/listingService.ts` (005-product-listings) exactly as already implemented.

**Storage**: PostgreSQL via Prisma, same dev/test containers already used by 002-006. No new model, no new field on `Listing`. One schema change: replace the `Listing` model's `@@index([communityId])` with a composite index `@@index([communityId, status, createdAt])` (research.md #6).

**Testing**: Vitest (`tests/contract/`) for the extended `listListings()` — search, price filter, pagination, and their combinations, plus non-member rejection and invalid-range rejection. Playwright (`tests/integration/`) for the feed page's search box, price inputs, and pagination controls.

**Target Platform**: The existing single Next.js web app (App Router), installable PWA, Docker/Dokploy — no new deployable unit.

**Project Type**: Extension of the existing single Next.js/Prisma project (no new top-level project).

**Performance Goals**: None beyond standard interactive web-app latency. The one explicit goal is structural, not a throughput number: every discovery query MUST resolve in one bounded database round-trip regardless of how many listings a community has — never a full-table load followed by application-side work (spec.md Assumptions, research.md #4).

**Constraints**: FR-001's community-scoping and FR-002's `ACTIVE`-only rule MUST hold on every discovery path (search, filter, pagination, and every combination). Search, price filtering, and pagination MUST be expressed entirely as Prisma query clauses (`where`/`orderBy`/`skip`/`take`) inside a single `findMany` call — never fetched in full and then filtered/sorted/sliced in application code (spec.md Assumptions, research.md #4). `minPriceCents > maxPriceCents` MUST be rejected before any query executes (FR-005). The existing `coverPhotoId`/`ownerDisplayName` fields on every returned listing MUST be preserved unchanged (research.md #7).

**Scale/Scope**: One community's own listing set at a time, page-based browsing (default 20/page, max 50/page) — no infinite-scroll cursor, no cross-community aggregation, no bulk export.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Admin-Controlled Membership Origin (NON-NEGOTIABLE) | N/A | This feature adds no membership path — it only reads existing `Membership` rows to authorize discovery queries, exactly as 005 already does. |
| II. Community Isolation (NON-NEGOTIABLE) | **PASS** | Every discovery query (feed, search, filter, pagination, and every combination) is scoped to one `communityId` and gated by `requireCommunityMembership()` before any query executes (FR-001). A search or filter can never surface a listing from a different community — `communityId` is a mandatory clause on the one query this feature builds, not an optional narrowing. |
| III. Administrator as Community Gatekeeper | N/A | This feature adds no new administrator action — it only extends read/browse capability already available to any member (005's existing viewing rule, unchanged). |
| IV. Non-Custodial Payments | N/A | No money moves and no payment path is touched — this feature only queries listing metadata (title, description, price, status, cover photo, owner display name). |
| V. Single Web Application, Installable as PWA | **PASS** | The search box, price filters, and pagination controls extend the existing card-grid feed page (`/communities/{id}/listings`) within the same responsive Next.js PWA — no new client, no desktop-only surface. |
| VI. Contact & Data Privacy Gating | **PASS** | Discovery results expose the same fields the feed already exposes (`id`, `title`, `priceCents`, `status`, `ownerId`, `createdAt`, `coverPhotoId`, `ownerDisplayName`) — no email, phone, or address. This feature adds no new field to the response shape beyond pagination metadata (`page`, `pageSize`, `hasMore`). |
| VII. Simplicity & MVP-First | **PASS** | No new runtime dependency (search uses Prisma's built-in `contains`/`ILIKE`, no full-text engine or external index — research.md #2). No saved searches, no recommendations, no relevance ranking (FR-009, spec Out of Scope). Pagination is plain offset/limit, not cursor-based, matching this feature's actual scale (research.md #1). The one schema change is a plain B-tree composite index, not a new table or extension (research.md #6). Builds on the already-shipped card-grid feed rather than reverting or restructuring it (research.md #7). |
| VIII. Test Discipline for Critical Flows (NON-NEGOTIABLE) | **PASS, with obligation carried into tasks.md** | "Product listing" is an explicitly named critical flow, and discovery is how members reach a listing to act on it. Contract tests for the extended `listListings()` MUST be written first and confirmed red before implementation, and Playwright specs for the feed's new controls MUST likewise precede their implementation, per tasks.md ordering. |

**Additional Constraints check**: Tenancy constraint satisfied — the new composite index is keyed by `communityId` first, keeping community scoping first-class at the index level too, not retrofitted. Stack constraint satisfied (no deviation — same Next.js/Prisma/PostgreSQL/Docker; search and filtering deliberately stay inside the already-decided Postgres/Prisma query layer rather than introducing a new search system, research.md #2). Migrations & backups: the index change ships as a single versioned Prisma migration (tasks.md), never a manual DB edit.

No violations identified; Complexity Tracking table is not needed.

*Re-checked after Phase 1 design: data-model.md and contracts/listing-discovery-api.md introduce no new violations — the extended query carries `communityId`/membership scoping as its first, non-optional clause, no new dependency was introduced, and the response shape adds only pagination metadata alongside the pre-existing `coverPhotoId`/`ownerDisplayName` fields, no new PII. No drift discovered during data-model/contract drafting.*

*Re-checked (T024) against the finished implementation: no new violations. Principle II holds on every discovery path — `listListings()` checks `requireCommunityMembership()` before assembling any `where` clause, and `communityId` is never optional. FR-009's exclusions were not accidentally introduced: no saved-search persistence, no recommendation logic, no relevance ranking beyond case-insensitive substring match, no external search dependency (`package.json`/`package-lock.json` unchanged from before this feature). The pre-existing `coverPhotoId`/`ownerDisplayName` fields are passed through unchanged on every returned listing (verified by `tests/contract/test_listing_discovery.ts`). Full suite green: `npm run typecheck`, `npm run lint` (0 errors, 2 pre-existing `<img>` warnings unrelated to this feature), `npm run test:unit` (129 tests), `npm run test:e2e` (this feature's 4 new Playwright specs pass, alongside the full pre-existing 002-006 suite — one pre-existing, unrelated failure was found and is called out below, not introduced by this feature).*

**Known pre-existing gap (not part of this feature)**: `tests/integration/test_google_display_name.spec.ts` fails locally with `client_id is required` because `.env.test`'s `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/mock-server variables are blank — an environment configuration gap in the 006-user-display-names branch sync's local setup, in a subsystem (Google OAuth) this feature's code never touches. Out of scope to fix here.

## Project Structure

### Documentation (this feature)

```text
specs/007-listing-discovery/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── listing-discovery-api.md
└── tasks.md              # Phase 2 output (/speckit-tasks command — not created by /speckit-plan)
```

### Source Code (repository root)

Extends the existing single Next.js/Prisma project established by 002-006 — no new top-level project, no new route.

```text
prisma/
└── schema.prisma                          # ~ @@index([communityId]) → @@index([communityId, status, createdAt])
                                            #   on Listing (new migration, no new model, no new field)

src/
└── server/
    └── services/
        └── listingService.ts              # extended: listListings(communityId, callerAccountId, options?) gains
                                             #   search/minPriceCents/maxPriceCents/page/pageSize, returns
                                             #   { listings, page, pageSize, hasMore } — coverPhotoId/ownerDisplayName
                                             #   on each listing preserved unchanged; reuses requireCommunityMembership()

app/
├── communities/
│   └── [communityId]/
│       └── listings/
│           ├── page.tsx                   # extended: reads q/minPrice/maxPrice/page/pageSize from searchParams,
│           │                              #      renders search/price controls + Prev/Next around the existing card grid
│           └── ListingDiscoveryControls.tsx # new: small client component — search box + min/max price inputs,
│                                            #      client-side min>max rejection mirroring the server
└── api/
    └── communities/
        └── [communityId]/
            └── listings/
                └── route.ts               # extended: GET parses q/minPrice/maxPrice/page/pageSize query params

tests/
├── contract/
│   └── test_listing_discovery.ts          # new: search/filter/pagination/combinations/invalid-range/non-member
│                                           #      coverage for the extended listListings() (FR-001–FR-009)
└── integration/
    └── test_listing_discovery_flow.spec.ts # new: Playwright — browse+paginate, search, price filter, combined,
                                             #      cross-community rejection
```

**Structure Decision**: No new service file, no new route — this feature extends `listingService.ts`'s existing `listListings()` (005-product-listings, already the feed page's sole data source per research.md #7) and the existing feed route/page. One new small client component (`ListingDiscoveryControls.tsx`) holds the search/filter form's client-side validation; it does not replace or restructure the card-grid rendering already shipped. New test files are kept separate from 005's/006's so this feature's red-then-green cycle doesn't touch already-passing suites.

## Complexity Tracking

No Constitution Check violations were identified for this feature — table intentionally left empty.
