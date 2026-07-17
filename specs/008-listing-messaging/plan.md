# Implementation Plan: Listing Messaging

**Branch**: `008-listing-messaging` | **Date**: 2026-07-17 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/008-listing-messaging/spec.md`

## Summary

Let a community member open a text-only message thread with a listing's owner directly from that listing, with one thread per (listing, buyer) pair. The owner sees every thread across their own listings; a buyer sees only threads they started. Two new Prisma models (`MessageThread`, `Message`), scoped by community entirely through the existing `listing` relation (no denormalized `communityId`), gated by the existing `requireCommunityMembership()` and the same display-name-required pattern 005-product-listings already established for listing creation. No new runtime dependency, no real-time delivery — messages surface on page load only.

## Technical Context

**Language/Version**: TypeScript, Next.js (App Router) — unchanged from 002-007, no new language/runtime.

**Primary Dependencies**: Prisma Client (existing) — no new runtime dependency. Reuses `requireCommunityMembership()` from `src/server/services/listingService.ts` (005-product-listings) and `resolveDisplayName()`/`getCurrentAccount()` (006-user-display-names, 002-accounts-authentication) exactly as already implemented.

**Storage**: PostgreSQL via Prisma, same dev/test containers already used by 002-007. Two new models, `MessageThread` and `Message` (data-model.md); no existing model's columns change. `onDelete: Cascade` on both new models mirrors the existing `Listing` → `ListingPhoto` cascade pattern (research.md #7 of 005-product-listings' own plan) — no new `$transaction` needed for listing deletion.

**Testing**: Vitest (`tests/contract/test_messaging.ts`) for `messageService.ts` — thread creation/reuse, self-message prevention, the PAUSED-creation-only gate, the display-name gate, message-length validation, owner/buyer/third-party access scoping, membership-revocation effect, no-administrator-access, and cascade delete. Playwright (`tests/integration/test_messaging_flow.spec.ts`) for the message composer, threads inbox, and thread reply UI. Per this feature's own spec.md Assumptions, these are written first and confirmed red before implementation, mirroring — but not required by — Principle VIII (messaging is not on the constitution's default critical-flow list).

**Target Platform**: The existing single Next.js web app (App Router), installable PWA, Docker/Dokploy — no new deployable unit, no new route namespace beyond the existing per-community structure.

**Project Type**: Extension of the existing single Next.js/Prisma project (no new top-level project).

**Performance Goals**: None beyond standard interactive web-app latency; no throughput target is stated anywhere in the spec's Success Criteria.

**Constraints**: Every thread/message query MUST be scoped by community, expressed as a `listing: { communityId }` relation filter inside the query itself (FR-008, research.md #1) — never fetched broadly and filtered in application code. A new thread MUST NOT be created against a `PAUSED` listing, but an existing thread's messaging is unaffected by its listing's status (FR-016, research.md #4). No participant's email, phone, or contact data may appear in any response (FR-011). No new runtime dependency, no real-time delivery (FR-014) — the spec explicitly rules both out.

**Scale/Scope**: One community's threads at a time (mirrors 007-listing-discovery's own per-community scoping), unpaginated in this iteration since no scale requirement is stated (research.md #9) — revisit only if a real need emerges, the same way 007 revisited 005.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Admin-Controlled Membership Origin (NON-NEGOTIABLE) | N/A | This feature adds no membership path — it only reads existing `Membership` rows to authorize thread/message actions, exactly as 005/007 already do. |
| II. Community Isolation (NON-NEGOTIABLE) | **PASS** | Every thread/message query is scoped to one `communityId` via the `listing` relation (research.md #1) and gated by `requireCommunityMembership()` before any read or write (FR-008). A thread's community can never drift from its listing's community, since a listing's community is fixed for its entire lifetime (005-product-listings). |
| III. Administrator as Community Gatekeeper | N/A — explicitly not extended | This feature grants no new administrator action. Per this feature's Clarifications, an administrator has *no* special access to thread contents — `messageService.ts` never calls `requireCommunityAdministrator()` (research.md #6), keeping message content outside Principle III's gatekeeper scope by design. |
| IV. Non-Custodial Payments | N/A | No money moves and no payment path is touched. |
| V. Single Web Application, Installable as PWA | **PASS** | The message composer, threads inbox, and thread detail view extend the existing responsive Next.js PWA — no new client, no desktop-only surface. |
| VI. Contact & Data Privacy Gating | **PASS** | Every response shape carries only `displayName` values (FR-004, FR-011) — no email, phone, or address field is ever selected onto a thread/message payload. Message content itself is exactly the kind of exchange this principle gates behind the two parties' own mutual participation; access is never granted to a third party, including administrators (research.md #6). |
| VII. Simplicity & MVP-First | **PASS** | No new runtime dependency (no WebSocket/SSE/polling — research.md #7). No message editing, deletion, attachments, reactions, or read receipts (spec Out of Scope). No pagination until an actual need appears (research.md #9), mirroring 005→007's own precedent. Cascade delete via `onDelete: Cascade` mirrors the existing `ListingPhoto` pattern rather than inventing a new deletion mechanism. |
| VIII. Test Discipline for Critical Flows (NON-NEGOTIABLE) | **N/A by constitution, applied anyway by this feature's own spec** | Messaging is not on the constitution's named critical-flow list (registration, membership, listing, transaction logging, payment). This feature's spec.md Assumptions nonetheless commit to the same red-then-green discipline, because this feature handles other members' personal data (identity, conversation content) — tasks.md MUST order contract tests before their corresponding implementation. |

**Additional Constraints check**: Tenancy — no new data store; the two new tables are scoped by community entirely through the pre-existing `Listing`→`Community` relationship, keeping scoping first-class rather than retrofitted (research.md #1). Stack — no deviation (same Next.js/Prisma/PostgreSQL/Docker, no new dependency). Migrations & backups — the two new tables ship as one versioned Prisma migration, never a manual DB edit.

No violations identified; Complexity Tracking table is not needed.

*Re-check after Phase 1 design: data-model.md and contracts/messaging-api.md introduce no new violations. Community scoping is carried by the `listing` relation on every query the contract defines (no route accepts or trusts a client-supplied `communityId` without also checking `requireCommunityMembership()` first); the response shapes in the contract expose only `id`/`displayName`/`body`/`createdAt` fields, no new PII; no administrator-only route or field was introduced. No drift discovered during data-model/contract drafting.*

*Re-checked (T025) against the finished implementation: no new violations. Principle II holds on every path — `requireCommunityMembership()` is called first in `sendMessageToListingOwner()`, `sendThreadMessage()`, `getThread()`, and `listThreads()` (`grep -n "requireCommunityMembership" src/server/services/messageService.ts` shows all four), and every thread lookup carries a `listing.communityId`/`listing: { communityId }` filter. Principle VI and the Clarifications hold: `grep -n "email\|phone" src/server/services/messageService.ts` and `grep -n "requireCommunityAdministrator" src/server/services/messageService.ts` both return no matches — no contact-data field is ever selected, and no administrator special case exists anywhere in the file. Principle VII holds: `package.json`/`package-lock.json` are unchanged (no new runtime dependency), and FR-015's cascade delete is handled entirely by the migration's `onDelete: Cascade` (`tests/contract/test_messaging.ts`'s deletion test confirms both the thread and its messages are gone after `deleteListing()`, with no `$transaction` needed in application code). Full suite green: `npm run typecheck`, `npx eslint .` (0 errors), `npm run test:unit` (141 tests), `npm run test:e2e` (36 tests, including this feature's 3 new Playwright specs, alongside the full pre-existing 002-007 suite — no regressions).*

## Project Structure

### Documentation (this feature)

```text
specs/008-listing-messaging/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── messaging-api.md
└── tasks.md              # Phase 2 output (/speckit-tasks command — not created by /speckit-plan)
```

### Source Code (repository root)

Extends the existing single Next.js/Prisma project established by 002-007 — no new top-level project.

```text
prisma/
└── schema.prisma                          # + MessageThread, Message models (data-model.md);
                                            #   + back-relations on Listing, Account. New migration,
                                            #   no existing column changed.

src/
└── server/
    └── services/
        └── messageService.ts              # new: sendMessageToListingOwner() (find-or-create thread +
                                             #   first/next message as buyer), sendThreadMessage() (reply as
                                             #   either participant), getThread(), listThreads() — all reuse
                                             #   requireCommunityMembership() from listingService.ts; a single
                                             #   internal helper enforces body validation + display-name gate
                                             #   (research.md #5)

app/
├── communities/
│   └── [communityId]/
│       ├── listings/
│       │   └── [listingId]/
│       │       ├── page.tsx               # extended: non-owner viewers see a message composer
│       │       └── MessageOwnerForm.tsx    # new: client component posting the first/next message,
│       │                                   #      then navigating to the resulting thread page
│       └── threads/
│           ├── page.tsx                   # new: inbox — every thread the caller is party to (FR-005, FR-006)
│           └── [threadId]/
│               ├── page.tsx               # new: one thread's full message history
│               └── ThreadReplyForm.tsx    # new: client component posting a reply
└── api/
    └── communities/
        └── [communityId]/
            ├── listings/
            │   └── [listingId]/
            │       └── messages/
            │           └── route.ts       # new: POST — sendMessageToListingOwner()
            └── threads/
                ├── route.ts               # new: GET — listThreads()
                └── [threadId]/
                    ├── route.ts           # new: GET — getThread()
                    └── messages/
                        └── route.ts       # new: POST — sendThreadMessage()

tests/
├── contract/
│   └── test_messaging.ts                  # new: messageService.ts coverage (research.md #1-#9, all FRs)
└── integration/
    └── test_messaging_flow.spec.ts         # new: Playwright — compose from listing, inbox, reply,
                                             #      cross-participant denial, membership-loss denial
```

**Structure Decision**: One new service file (`messageService.ts`), following the same `{ ok, reason }` discriminated-union convention as `listingService.ts`; no existing service is modified beyond importing its exported `requireCommunityMembership()`. New routes live entirely under the existing `app/api/communities/{communityId}/` namespace, alongside the existing `listings/` routes, plus a new sibling `threads/` namespace. The listing detail page gains a small new client component rather than being restructured, mirroring how 007-listing-discovery added `ListingDiscoveryControls.tsx` alongside the existing card grid without touching its rendering.

## Complexity Tracking

No Constitution Check violations were identified for this feature — table intentionally left empty.

## Amendment (2026-07-17): Thread & Listing Navigability

**Summary**: Neither a thread nor a paused listing had any page linking to it — the only path to a thread was the listing page that started it, and a paused listing had no page at all once it left the discovery feed (007-listing-discovery). This amendment adds two new, cross-community, read-only aggregate views — **Chats** (every thread the signed-in account participates in, grouped by community) and **My listings** (every listing the account owns, any status, with a thread count) — both reachable in one step from `AppShell`'s existing sidebar, which already renders on every authenticated screen (spec.md Clarifications, 2026-07-17 amendment session). No new shared layout is introduced.

**Technical Context delta**:

- **Storage**: `MessageThread` gains one new column, `lastMessageAt DateTime @default(now())`, updated by the same low-level `insertMessage()` helper that already creates every `Message` row (single point of truth, mirroring research.md #5's existing single-enforcement-point pattern). This lets both the existing per-community `listThreads()` and the new cross-community `listMyThreads()` order threads by `orderBy: { lastMessageAt: "desc" }` at the database level — `listThreads()`'s prior in-memory `.sort()` is removed as part of this amendment, since the same "ordering happens in the database query" standard this amendment introduces (spec.md Assumptions) applies retroactively to the function it extends. One new index, `@@index([lastMessageAt])`.
- **Primary Dependencies**: No new dependency. Both new views are read-only Prisma queries added to `messageService.ts` (`listMyThreads`) and `listingService.ts` (`listMyListings`, since it queries `Listing` rows directly, mirroring where `listListings`/`getListing` already live).
- **Testing**: Extends `tests/contract/test_messaging.ts` (for `listMyThreads`, and the `lastMessageAt`-driven ordering) and `tests/contract/test_listings.ts` (for `listMyListings`), plus `tests/integration/test_messaging_flow.spec.ts` for the two new pages and the two new sidebar links. Same red-then-green discipline as the rest of this feature.
- **Constraints**: Scoping for both new views is a `communityId: { in: currentCommunityIds }` filter built from the caller's own current `Membership` rows (never another account's) — this is the same two-query shape `getCurrentAccount()` already uses to build a cross-community sidebar payload, not a new authorization primitive. Grouping the Chats result by community, for rendering, is a presentational transform over an already-scoped, already-ordered, single-query result set — not a re-implementation of scoping or ordering in application code (spec.md Assumptions spells this out explicitly, since Prisma cannot express "GROUP BY community, return full nested thread arrays per group" without raw SQL, which this amendment does not introduce, per Principle VII). The owner/buyer distinction (FR-019) is computed at read time from `listing.ownerId === callerAccountId`, exactly like the existing `counterpartDisplayName` computation in `listThreads()` — no new column.

**Constitution re-check for this amendment**:

| Principle | Status | Notes |
|---|---|---|
| II. Community Isolation (NON-NEGOTIABLE) | **PASS** | Both `listMyThreads()` and `listMyListings()` take only `callerAccountId` (never a caller-supplied community list) and internally resolve the caller's own current `Membership` rows first, then filter by `communityId: { in: ... }` in the same query that returns threads/listings — no cross-account leakage is possible, since the scoping set is always derived from the caller's own session-verified identity. |
| VI. Contact & Data Privacy Gating | **PASS** | Both new response shapes carry only `displayName`/`title`/`status`/counts/timestamps — no email, phone, or contact field is added (FR-025). |
| VII. Simplicity & MVP-First | **PASS** | No unread counts, badges, or notification delivery (spec.md Assumptions) — reachability only, exactly as requested. No new dependency; the two-query "caller's memberships, then scope by them" shape reuses an existing pattern (`getCurrentAccount()`) rather than inventing a new one. |

No violations identified; Complexity Tracking remains empty.

*Re-checked (T043) against the finished implementation: no new violations. `listMyThreads()` and `listMyListings()` both resolve `communityId` scope exclusively from `prisma.membership.findMany({ where: { accountId: callerAccountId } })` — verified by inspection, no caller-suppliable community filter exists in either function's signature. `grep -n "email\|phone"` across `messageService.ts`, `listingService.ts`, `app/chats/page.tsx`, and `app/my-listings/page.tsx` returns no matches. `package.json`/`package-lock.json` unchanged (no new dependency). Full suite green: `npm run typecheck`, `npx eslint .` (0 errors), `npm run test:unit` (146 tests, up from 141), `npm run test:e2e` (38 tests, up from 36, including this amendment's 2 new Playwright specs — no regressions across 002-008).*

### Project Structure delta

```text
prisma/
└── schema.prisma                          # ~ MessageThread gains lastMessageAt DateTime @default(now()),
                                            #   @@index([lastMessageAt]). New migration, no other column change.

src/
└── server/
    └── services/
        ├── messageService.ts              # ~ insertMessage() now also updates the parent thread's
        │                                   #   lastMessageAt; listThreads() orders via the database
        │                                   #   (orderBy: lastMessageAt desc) instead of an in-memory sort;
        │                                   #   + listMyThreads(callerAccountId) — cross-community
        └── listingService.ts               # + listMyListings(callerAccountId) — every listing the caller
                                             #   owns, any status, across current memberships, with a
                                             #   Prisma `_count` of its threads

app/
├── _components/
│   └── AppShell.tsx                       # ~ sidebar nav gains "Chats" and "My listings" links
├── chats/
│   └── page.tsx                           # new: Chats — groups listMyThreads() by community for rendering
├── my-listings/
│   └── page.tsx                           # new: My listings — listMyListings(), each row links to its
│                                           #      listing and (when threadCount > 0) to that listing's threads
└── communities/
    └── [communityId]/
        └── threads/
            └── page.tsx                   # ~ accepts an optional ?listingId= query param to narrow the
                                            #   existing per-community inbox to one listing's threads

api/
├── chats/
│   └── route.ts                           # new: GET — listMyThreads()
└── my-listings/
    └── route.ts                           # new: GET — listMyListings()

tests/
├── contract/
│   ├── test_messaging.ts                  # ~ + listMyThreads()/lastMessageAt-ordering coverage
│   └── test_listings.ts                   # ~ + listMyListings() coverage
└── integration/
    └── test_messaging_flow.spec.ts         # ~ + Chats/My listings navigation and content coverage
```

**Structure Decision**: `listMyListings()` lives in `listingService.ts` (it queries `Listing` rows as the primary entity, mirroring where `listListings`/`getListing` already live), while `listMyThreads()` lives in `messageService.ts` (it queries `MessageThread` as the primary entity). Both new pages are new top-level routes (siblings to the existing `/account` route) rather than nested under `/communities/{communityId}/`, since both are explicitly cross-community aggregates — the one deliberate structural departure from this feature's original per-community route namespace, required by FR-017/FR-021's "across every community" scope.
