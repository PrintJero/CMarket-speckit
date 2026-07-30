# Implementation Plan: Wanted Posts

**Branch**: `011-wanted-posts` | **Date**: 2026-07-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/011-wanted-posts/spec.md`

## Summary

Let a member post what they're looking to buy, as a `kind = WANTED` variant of the existing `Listing` (005-product-listings) rather than a distinct entity — the load-bearing reason is that 008-listing-messaging's `MessageThread` has no polymorphic-FK path to a second entity, so the variant approach inherits messaging, photos, moderation, and discovery/search with zero structural change to any shipped feature. `Listing` gains a `kind` enum (`FOR_SALE` default, `WANTED`), `priceCents` becomes nullable (required only for `FOR_SALE`), and `ListingStatus` gains a `FULFILLED` value reachable only for `WANTED` and reversible only by the owner — never by an administrator, whose pause/reactivate authority is confined to the `ACTIVE`↔`PAUSED` axis exactly as today. The community feed/search gains one optional `kind` filter, reusing the exact optional-filter pattern price-range already established.

## Technical Context

**Language/Version**: TypeScript, Next.js (App Router) — unchanged from 002-010, no new language/runtime.

**Primary Dependencies**: Prisma Client (existing) — no new runtime dependency. Extends `listingService.ts` (005-product-listings) in place; reuses `requireCommunityMembership()`/`requireCommunityAdministrator()` unchanged.

**Storage**: PostgreSQL via Prisma, same dev/test containers already used by 002-010. One new enum (`ListingKind`), one new value on the existing `ListingStatus` enum (`FULFILLED`), one new column (`Listing.kind`, default `FOR_SALE`), one column nullability change (`Listing.priceCents Int` → `Int?`). No new table, no new model.

**Testing**: Per Constitution Principle VIII, this feature is **not** on the named critical-flow list, so automated tests are optional by default — **except** community-isolation coverage for every wanted-post query/search path, which spec.md's FR-013 makes mandatory regardless (Principle II). Vitest extensions to `tests/contract/test_listings.ts` (kind/price validation at creation, the owner-only `FULFILLED` transition, the administrator's confinement to `ACTIVE`↔`PAUSED`) and `tests/contract/test_listing_discovery.ts` (the new `kind` filter, and — the one mandatory case — a `WANTED` post in one community never appearing in another community's feed/search, exactly mirroring 007's own existing cross-community assertions for `FOR_SALE` listings). No Playwright integration tests are required by the constitution for this feature; a minimal one is still added for the create/respond/fulfill happy path since it's cheap and this is a user-facing surface change, mirroring 007's own precedent of shipping Playwright coverage without a constitutional mandate.

**Target Platform**: The existing single Next.js web app (App Router), installable PWA, Docker/Dokploy — no new deployable unit, no new route namespace (extends the existing `listings` namespace).

**Project Type**: Extension of the existing single Next.js/Prisma project (no new top-level project).

**Performance Goals**: None beyond standard interactive web-app latency; no throughput target is stated anywhere in the spec's Success Criteria.

**Constraints**: `kind` is immutable after creation (not stated explicitly in spec.md; decided here per Principle VII — mirrors `communityId`/`ownerId`'s existing immutability, avoids a listing's price-requiredness rule changing mid-life). `FULFILLED` is reachable only for `kind = WANTED` and only by the listing's owner — entering **or** leaving `FULFILLED` is confined to the owner; an administrator's pause/reactivate authority never touches a listing whose *current* status is `FULFILLED` (research.md #3 — a careful reading of FR-008: "clearing FULFILLED" includes an administrator reactivating it back to `ACTIVE`, not just setting it). Every discovery query continues to be expressed as a single Prisma query (007's own non-negotiable constraint) — the new `kind` filter is one more optional `where` clause, never an in-memory filter.

**Scale/Scope**: Same per-community feed/search scope as 007-listing-discovery; no new scale dimension.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Admin-Controlled Membership Origin (NON-NEGOTIABLE) | N/A | This feature adds no membership path. |
| II. Community Isolation (NON-NEGOTIABLE) | **PASS** | A wanted post is a `Listing` row — `communityId` is already the tenancy-defining column on every query it's created/read/searched through (unchanged from 005/007). The one new filter (`kind`) is additive to the same `communityId`-scoped `where` clause, never a separate unscoped query. Per spec.md FR-013, this MUST additionally be covered by an automated cross-community test regardless of this feature's overall test-optionality — carried into tasks.md as a mandatory task, not an optional one. |
| III. Administrator as Community Gatekeeper | **PASS** | Administrator pause/reactivate authority extends to wanted posts exactly as for-sale listings (unchanged `canModerateListing()` logic) but is explicitly confined to the `ACTIVE`↔`PAUSED` axis — a listing currently `FULFILLED` cannot be touched by an administrator in either direction (research.md #3), matching FR-008's "does NOT extend to setting or clearing FULFILLED" precisely. |
| IV. Non-Custodial Payments | N/A | No money moves and no payment path is touched. A completed deal is still logged via the unchanged 010-transaction-logging flow, which already accepts any listing's id/title as an unconstrained snapshot (research.md #6 of that feature) — no change needed there. |
| V. Single Web Application, Installable as PWA | **PASS** | The kind selector, kind badge, kind filter, and fulfill/reverse actions all extend the existing responsive `ListingForm`/feed/detail pages — no new client, no desktop-only surface. |
| VI. Contact & Data Privacy Gating | **PASS** | Responding to a wanted post reuses 008-listing-messaging's unchanged `sendMessageToListingOwner()`/thread pages — display-name-only, no contact-data field, exactly as for a for-sale listing. |
| VII. Simplicity & MVP-First | **PASS** | No new entity, no new table, no category/tag field, no min/max budget range, no new messaging capability, no cross-community aggregation — every explicit Out-of-Scope item in spec.md (FR-016) is honored. The single new filter parameter (`kind`) mirrors an existing pattern (price range) rather than inventing a new one. |
| VIII. Test Discipline for Critical Flows (NON-NEGOTIABLE) | **N/A by constitution, partially mandatory by this feature's own spec** | Wanted posts are not on the named critical-flow list. spec.md's FR-013 nonetheless makes community-isolation coverage for wanted-post query/search paths mandatory — tasks.md MUST include this test regardless of the general optionality. |
| IX. Platform Administration Authority (NON-NEGOTIABLE) | N/A | No MASTER-surface change; a MASTER has no special access to or authority over wanted posts, exactly as for for-sale listings today. |

**Additional Constraints check**: Tenancy — no new data store; `kind`/nullable-`priceCents` are columns on the already-community-scoped `Listing` table, not a retrofit. Stack — no deviation (same Next.js/Prisma/PostgreSQL/Docker, no new dependency). Migrations & backups — the enum/column changes ship as one versioned Prisma migration; existing rows backfill to `kind = FOR_SALE` with their existing `priceCents` value unchanged (no data loss).

No violations identified; Complexity Tracking table is not needed.

*Re-check after Phase 1 design: data-model.md and contracts/listings-api.md introduce no new violations. Every new/changed query still filters by `communityId` first; the administrator-confinement rule (research.md #3) is expressed as an explicit guard in `pauseListing()`/`reactivateListing()`, not a new authorization primitive; no new PII field is introduced; `kind` remains a two-value enum with no speculative third value. No drift discovered during data-model/contract drafting.*

*Re-checked (T024) against the finished implementation: no new violations. Principle II holds — every query in `listingService.ts` touching `Listing` filters by `communityId` (`grep -n "communityId" src/server/services/listingService.ts` shows it in every read/write path), and the mandatory FR-013 cross-community isolation test (T003, including the new `kind` filter itself) passes. Principle III's administrator-confinement rule holds: `grep -n "FULFILLED" src/server/services/listingService.ts` shows the `isLeavingFulfilledAsNonOwner()` guard called in both `pauseListing()` and `reactivateListing()`, and `fulfillListing()` contains no call to `canModerateListing()`/`requireCommunityAdministrator()` anywhere. Principle VII holds: `git status` shows `package.json`/`package-lock.json` unchanged (no new dependency); `grep -rn "category|tag" src/server/services/listingService.ts prisma/schema.prisma` returns no matches; `ListingKind` still has exactly two values. Full suite green: `npx tsc --noEmit`, `npx eslint .` (0 errors), `npm run test:unit` (247 tests, all pre-existing 002-010 tests unaffected), and this feature's own 3 Playwright tests plus the full pre-existing `test_listing_flow.spec.ts` suite (9 tests total) all green in isolation. A full-suite `npm run test:e2e` run showed ~12-14 timeouts in files this feature never touches (MASTER administration, community lifecycle, Google OAuth mock, generic messaging) that persisted even at `--workers=1` against a freshly-reset test database — consistent with this Windows dev machine's environment rather than a regression. One pre-existing, unrelated bug was discovered incidentally in `test_listing_display_names.spec.ts`: `AppShell.tsx`'s sidebar renders the signed-in caller's own display-name placeholder ("A member"), which can collide with a nameless listing owner's identical placeholder on the same page — confirmed via `git log -- app/_components/AppShell.tsx` to predate this session (last touched in an unrelated commit); left unfixed as out of this feature's scope.*

## Project Structure

### Documentation (this feature)

```text
specs/011-wanted-posts/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── listings-api.md
└── tasks.md              # Phase 2 output (/speckit-tasks command — not created by /speckit-plan)
```

### Source Code (repository root)

Extends the existing single Next.js/Prisma project established by 002-010 — no new top-level project.

```text
prisma/
└── schema.prisma                          # Listing: + kind ListingKind @default(FOR_SALE);
                                            #   priceCents Int → Int?; ListingStatus: + FULFILLED.
                                            #   New migration, existing rows backfilled to FOR_SALE.

src/
├── server/
│   └── services/
│       └── listingService.ts              # extended: createListing() accepts kind (default
│                                            #   FOR_SALE), conditional price validation;
│                                            #   updateListing()/listListings()/getListing()/
│                                            #   listMyListings() carry kind through; new
│                                            #   fulfillListing() (owner-only, WANTED-only);
│                                            #   pauseListing()/reactivateListing() gain the
│                                            #   FULFILLED-confinement guard (research.md #3);
│                                            #   listListings() gains an optional kind filter
│                                            #   (research.md #4, mirrors price-range pattern)
└── lib/
    └── formatting/
        └── currency.ts                     # formatListingPrice() extended to accept null
                                             #   (renders as "Budget not specified")

app/
├── api/
│   └── communities/
│       └── [communityId]/
│           └── listings/
│               ├── route.ts                # POST: parses kind; GET: parses kind filter
│               └── [listingId]/
│                   ├── route.ts            # PATCH: unchanged shape, nullable priceCents
│                   └── fulfill/
│                       └── route.ts        # new: POST → fulfillListing()
└── communities/
    └── [communityId]/
        └── listings/
            ├── ListingForm.tsx             # extended: kind selector (create-only, immutable
            │                                #   after creation), price field relabeled/optional
            │                                #   for WANTED
            ├── ListingDiscoveryControls.tsx # extended: kind filter control
            ├── page.tsx                    # extended: each card shows a kind badge
            ├── new/
            │   └── page.tsx                # unchanged structurally — form does the branching
            └── [listingId]/
                ├── ListingActions.tsx       # extended: Fulfil/Reverse action, owner-only,
                │                            #   WANTED-only
                └── page.tsx                 # extended: shows kind + budget-or-price accordingly
```

**Structure Decision**: Extends 005-product-listings' existing `Listing` model and `listingService.ts` in place — no new top-level module, no new route namespace. Every surface a for-sale listing already has (create form, feed card, detail page, moderation actions, messaging, discovery filters) gains a `WANTED`-aware branch rather than a parallel copy.

## Complexity Tracking

*No Constitution Check violations — table not needed.*
