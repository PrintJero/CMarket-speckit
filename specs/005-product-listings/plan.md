# Implementation Plan: Product Listings

**Branch**: `spec005-product-listing` | **Date**: 2026-07-17 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-product-listings/spec.md`

## Summary

Let any account holding a `Membership` (administrator or member) in a community create a product listing scoped to that community — title, description, a simple fixed price, and zero or more photos. A listing's visibility is a `ListingStatus` enum (`ACTIVE`/`PAUSED`), never a boolean or free-text field. The listing's owner can edit its content, pause/reactivate it, and permanently delete it (with its photos); a community's own administrator can additionally pause/reactivate any listing in their community as a moderation action (Constitution Principle III), but never edit its content or delete it. Every access path — creation, viewing, editing, pausing, and the listing feed itself — is scoped by `communityId` and requires the caller to hold a membership in that specific community (Principle II). Photos are stored as raw bytes in the existing PostgreSQL database (no new dependency, no new external service — research.md #1), capped at 5MB/6 photos per listing. Testing follows 004-invitations-membership's stack: Vitest contract tests for the service layer, Playwright specs for the new pages/routes.

## Technical Context

**Language/Version**: TypeScript 6.0.3, Next.js (App Router) — unchanged from 002/003/004, no new language/runtime.

**Primary Dependencies**: Prisma Client 6.19.3 (existing) — no new runtime dependency. Reuses `requireCommunityAdministrator()` from `src/server/services/invitationService.ts` exactly as already implemented; uses Next.js's built-in `request.formData()` for photo uploads (no multipart-parsing library needed).

**Storage**: PostgreSQL via Prisma, same dev/test containers already used by 002/003/004. New models: `Listing`, `ListingPhoto` (photo bytes stored as Prisma `Bytes`/Postgres `bytea` — research.md #1, no object-storage service). New enum: `ListingStatus`.

**Testing**: Vitest (`tests/contract/`) for `createListing()`, `updateListing()`, `pauseListing()`, `reactivateListing()`, `deleteListing()`, `addListingPhoto()`, `removeListingPhoto()` — red-then-green per Principle VIII. Playwright (`tests/integration/`) for the listing feed, create/edit forms, and pause/reactivate/delete actions.

**Target Platform**: The existing single Next.js web app (App Router), installable PWA, Docker/Dokploy — no new deployable unit.

**Project Type**: Extension of the existing single Next.js/Prisma project (no new top-level project).

**Performance Goals**: None beyond standard interactive web-app latency — same low-volume, community-driven scale as 003/004; no specified throughput target. Photo caps (5MB/6 photos) bound worst-case row size, not a performance target per se.

**Constraints**: FR-011/FR-012's community-scoping MUST hold on every access path, including the photo-streaming route (research.md #5 — `communityId` stays in the URL path on every route, never only a body/query field). FR-009/FR-010's authorization split (owner: edit+pause+delete; administrator: pause only, own community only) MUST be enforced identically at the service layer regardless of which route calls it.

**Scale/Scope**: One listing, one photo, one pause/reactivate/delete at a time (spec's implicit MVP scope — no bulk operations mentioned); expected volume proportional to each community's real marketplace activity, not a high-throughput path.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Admin-Controlled Membership Origin (NON-NEGOTIABLE) | N/A | This feature touches no membership origination — it only reads existing `Membership` rows to authorize listing actions. |
| II. Community Isolation (NON-NEGOTIABLE) | **PASS** | Every new operation (create, view, edit, pause, reactivate, delete, photo add/remove/stream) is scoped to one `communityId`, checked against the caller's own `Membership` row for that specific community (FR-011, FR-012). `Listing.communityId` is a required, non-optional, immutable field from creation — never retrofitted, never reassignable. |
| III. Administrator as Community Gatekeeper | **PASS** | This feature implements the listing-moderation half of Principle III named explicitly in the constitution ("moderate (edit visibility of, take down) listings") via administrator pause/reactivate authority (FR-009), resolved with the user to explicitly exclude content-edit and delete from that authority — the more destructive actions stay owner-only (FR-010). |
| IV. Non-Custodial Payments | N/A | A listing's price is informational only (FR-002) — this feature moves no money and integrates no payment path. |
| V. Single Web Application, Installable as PWA | **PASS** | New pages (`/communities/{id}/listings`, `.../new`, `.../{listingId}`) are part of the same responsive Next.js PWA; no new client, no desktop-only surface. |
| VI. Contact & Data Privacy Gating | **PASS** | A listing exposes only an opaque `ownerId` to fellow community members (contracts/listings-api.md) — never an email, phone, or address. This is a strictly narrower exposure than 004's own admin member list (which shows member emails, but only to that community's administrator, not to fellow ordinary members) — no new PII exposure is introduced by this feature at all. |
| VII. Simplicity & MVP-First | **PASS** | No new runtime dependency (photo upload uses Next.js's built-in `request.formData()`; photo storage reuses the existing Postgres/Prisma stack — research.md #1). No nested categories, variants, inventory, drafts, or dynamic pricing (FR-013, spec Out of Scope). Photo caps are fixed, not user-configurable. Pause/reactivate reuses a plain conditional `update`, not the heavier transaction machinery 004 needed for a genuinely different (race-prone) problem (research.md #3). |
| VIII. Test Discipline for Critical Flows (NON-NEGOTIABLE) | **PASS, with obligation carried into tasks.md** | "Product listing" is an explicitly named critical flow. Contract tests for every service function MUST be written first and confirmed red before implementation, and Playwright specs for the new pages MUST likewise precede their implementation, per tasks.md ordering. |

**Additional Constraints check**: Tenancy constraint satisfied (`Listing.communityId` is a first-class, required, immutable field, never retrofitted — research.md #5). Stack constraint satisfied (no deviation — same Next.js/Prisma/PostgreSQL/Docker; photo storage deliberately stays inside the already-decided Postgres rather than introducing a new storage system, research.md #1). Migrations & backups: the new `Listing`/`ListingPhoto` models and `ListingStatus` enum ship as a single versioned Prisma migration (tasks.md), never a manual DB edit; photo durability rides on the same existing Postgres backup/restore guarantee, with no second backup story to verify.

No violations identified; Complexity Tracking table is not needed.

*Re-checked after Phase 1 design: data-model.md and contracts/listings-api.md introduce no new violations — every entity carries `communityId`/ownership scoping as a first-class field, no new dependency was introduced, and the authorization split (owner vs. that community's own administrator vs. everyone else) matches FR-009/FR-010 exactly as designed, with no drift discovered during data-model/contract drafting.*

*Re-checked (T040) against the finished implementation: no new violations. Principle II holds on every route, including the photo-stream route (`getListingPhoto()` calls `requireCommunityMembership()` before returning any bytes). FR-009/FR-010's three-way split is enforced identically regardless of caller: `updateListing()`/`deleteListing()` check `ownerId` alone and never call `requireCommunityAdministrator()`, while `pauseListing()`/`reactivateListing()` share one `canModerateListing()` helper (owner OR that community's administrator) — verified by `tests/contract/test_listings.ts`'s administrator-moderation suite (19/19 passing) and confirmed the owner-only tests from Phase 5 still pass unchanged after Phase 7 extended the authorization. No new runtime dependency was introduced (`package.json`/`package-lock.json` unchanged from before this feature). Full suite green: `npm run typecheck`, `npm run lint`, `npm run test:unit` (94 tests), `npm run test:e2e` (19 tests, including this feature's 5 Playwright specs covering US1–US5 and the full pre-existing 002/003/004 suite unmodified).*

## Project Structure

### Documentation (this feature)

```text
specs/005-product-listings/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── listings-api.md
└── tasks.md              # Phase 2 output (/speckit-tasks command — not created by /speckit-plan)
```

### Source Code (repository root)

Extends the existing single Next.js/Prisma project established by 002/003/004 — no new top-level project.

```text
prisma/
└── schema.prisma                          # + Listing, ListingPhoto models; + ListingStatus enum (new migration)

src/
└── server/
    └── services/
        └── listingService.ts              # new: createListing(), updateListing(), pauseListing(), reactivateListing(),
                                             #      deleteListing(), addListingPhoto(), removeListingPhoto(),
                                             #      requireCommunityMembership() (research.md #2)
                                             #      — reuses requireCommunityAdministrator() from invitationService.ts

app/
├── communities/
│   └── [communityId]/
│       └── listings/
│           ├── page.tsx                   # new: member-only — community's ACTIVE listing feed + "New listing" link
│           ├── new/
│           │   └── page.tsx               # new: member-only — create form (title, description, price, photos)
│           ├── ListingForm.tsx            # new: client component, create/edit form
│           └── [listingId]/
│               ├── page.tsx               # new: member-only detail view; owner sees Edit/Pause/Reactivate/Delete,
│               │                          #      that community's administrator (non-owner) sees Pause/Reactivate only
│               └── ListingActions.tsx     # new: client component — pause/reactivate/delete buttons
└── api/
    └── communities/
        └── [communityId]/
            └── listings/
                ├── route.ts               # new: GET (list) + POST (create)
                └── [listingId]/
                    ├── route.ts           # new: GET (one) + PATCH (edit) + DELETE
                    ├── pause/
                    │   └── route.ts       # new: POST
                    ├── reactivate/
                    │   └── route.ts       # new: POST
                    └── photos/
                        ├── route.ts       # new: POST (add)
                        └── [photoId]/
                            └── route.ts   # new: GET (stream bytes) + DELETE

tests/
├── contract/
│   └── test_listings.ts                   # new: createListing()/updateListing()/pauseListing()/reactivateListing()/
│                                           #      deleteListing()/addListingPhoto()/removeListingPhoto() red→green
│                                           #      (FR-001–FR-013, including admin-moderation and cross-community rejection)
└── integration/
    └── test_listing_flow.spec.ts          # new: Playwright — create with photos, edit, pause/reactivate (owner and
                                            #      admin), delete, cross-community isolation, photo limits
```

**Structure Decision**: `listingService.ts` lives beside `invitationService.ts`/`communityService.ts`/`accountService.ts`/`sessionService.ts` in `src/server/services/`, reusing the same direct-Prisma, discriminated-union-result convention and importing `requireCommunityAdministrator()` from `invitationService.ts` rather than duplicating it (research.md #2). New pages live under the `app/communities/[communityId]/` route group 004 already established, adding a sibling `listings/` segment rather than a new top-level route (research.md #5).

## Complexity Tracking

No Constitution Check violations were identified for this feature — table intentionally left empty.
