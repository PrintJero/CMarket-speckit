# Implementation Plan: Transaction Logging

**Branch**: `010-transaction-logging` | **Date**: 2026-07-28 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/010-transaction-logging/spec.md`

## Summary

Let either participant of an existing 008-listing-messaging thread (the listing's owner or its buyer) record that an off-platform transaction happened between them, creating an immutable-once-confirmed `Transaction` log. The counterpart derived directly from the thread — never a client-supplied account id — must explicitly confirm before the log counts as anything more than one party's unconfirmed claim; a log that's never confirmed simply stays that way forever, with no dispute/edit path. One new Prisma model (`Transaction`), gated by the existing `requireCommunityMembership()` (checked live at both creation and confirmation) and a new thread-derived eligibility check. No amount field, no listing-status side effect, no new runtime dependency.

## Technical Context

**Language/Version**: TypeScript, Next.js (App Router) — unchanged from 002-009, no new language/runtime.

**Primary Dependencies**: Prisma Client (existing) — no new runtime dependency. Reuses `requireCommunityMembership()` (005-product-listings, `src/server/services/listingService.ts`) and the `MessageThread` model/`messageService.ts` patterns (008-listing-messaging) for eligibility.

**Storage**: PostgreSQL via Prisma, same dev/test containers already used by 002-009. One new model, `Transaction` (data-model.md). Unlike `MessageThread`/`Message` (which cascade-delete with their listing, 008 FR-015), `Transaction` intentionally has **no** foreign-key relation to `Listing` or `MessageThread` — it stores `listingId` and `listingTitle` as a plain, unconstrained snapshot, exactly mirroring the existing `AdministrativeAuditEntry.targetId` precedent (009-platform-administration) for a record that must outlive the thing it references (FR-017). `recorderId`/`counterpartId`/`communityId` remain real Prisma relations to `Account`/`Community`, since neither is ever hard-deleted in this codebase (Account: soft-delete via `deletedAt`; Community: archived, never deleted) — no dangling-FK risk there.

**Testing**: Vitest (`tests/contract/test_transactions.ts`) for `transactionService.ts` — thread-derived eligibility (owner/buyer pairing, non-existent/wrong-listing thread rejection), self-transaction rejection, live co-membership at creation and at confirmation, cross-community rejection, the confirmation state machine, confirmed-log immutability, non-exposure of contact data, and listing-deletion survival. Playwright (`tests/integration/test_transactions_flow.spec.ts`) for the "record transaction" and "confirm" actions on the thread page, the per-community transaction-log list/detail pages, and the non-intermediary disclosure text. Per Constitution Principle VIII, transaction logging is a **named critical flow**: these tests MUST be written first and confirmed failing (red) before implementation, mirroring 002/003/004/005's own documented discipline for their critical flows.

**Target Platform**: The existing single Next.js web app (App Router), installable PWA, Docker/Dokploy — no new deployable unit, no new route namespace beyond the existing per-community structure.

**Project Type**: Extension of the existing single Next.js/Prisma project (no new top-level project).

**Performance Goals**: None beyond standard interactive web-app latency; no throughput target is stated anywhere in the spec's Success Criteria.

**Constraints**: Every creation/confirmation action MUST verify current co-membership live, in the request itself, not from cached/thread-creation-time state (FR-002, FR-003). A log MUST be creatable only when the recorder and named counterpart are exactly the listing-owner/thread-buyer pair of an existing, current-epoch `MessageThread` on that listing (FR-001) — the counterpart is always derived from that thread server-side, never accepted as a separate client-supplied id, which removes an entire class of "does this counterpart match the thread" validation bugs. No amount field of any kind (FR-010). No `ListingStatus` side effect (FR-012). Confirmed core facts are immutable (FR-007). No contact data in any logging/confirmation/view response (FR-015).

**Scale/Scope**: One community's transaction logs at a time for the list view (mirrors 008's pre-amendment `listThreads()` scoping), unpaginated since no scale requirement is stated — same "simplest thing that satisfies today's scale" reasoning 005→007 and 008 already established.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Admin-Controlled Membership Origin (NON-NEGOTIABLE) | N/A | This feature adds no membership path — it only reads existing `Membership` rows to authorize logging/confirmation actions. |
| II. Community Isolation (NON-NEGOTIABLE) | **PASS** | `Transaction.communityId` is a first-class, denormalized column (not inferred through a joinable-but-deletable `Listing`), checked via `requireCommunityMembership()` for both the recorder and the counterpart, live, at creation and again at confirmation (FR-002, FR-003, research.md #3). A transaction can never exist, or become confirmed, between two accounts that are not both current co-members. |
| III. Administrator as Community Gatekeeper | N/A — explicitly not extended | No administrator action is added. An administrator gets no special access to, or authority over, another member's transaction logs — mirrors 008's own "no administrator access path" precedent (research.md #6 there) for the same privacy reason. |
| IV. Non-Custodial Payments — Transaction Logging as Source of Truth (NON-NEGOTIABLE) | **PASS** | This feature *is* the traceability layer this principle names for path (a) (off-platform). Every log captures who transacted/logged, when, against which listing, with which counterpart, and via which payment path (FR-008). The non-intermediary disclosure is shown before both recording and confirming (FR-014). Both parties are verified as co-members before a log can be created or confirmed (FR-002, FR-003). `paymentPath` is a closed enum with a single value (`OFF_PLATFORM`) today; research.md #5 documents why adding `IN_APP` later is a purely additive migration, satisfying FR-011's forward-compatibility requirement without building unused speculative scope now (Principle VII). |
| V. Single Web Application, Installable as PWA | **PASS** | The record/confirm actions and the transaction-log list/detail pages extend the existing responsive Next.js PWA — no new client, no desktop-only surface. |
| VI. Contact & Data Privacy Gating | **PASS** | Every response shape carries only `displayName` values, never email/phone/address (FR-015) — mirrors 008's FR-011 precedent exactly. Recording or confirming a transaction has zero side effect on contact-data visibility. |
| VII. Simplicity & MVP-First | **PASS** | No amount field (FR-010, this feature's own resolved clarification). No `ListingStatus` change (FR-012). No dispute/edit/appeal mechanism — declining to confirm is the entire repudiation mechanism (FR-006). No new runtime dependency. `paymentPath` ships with one enum value, not a speculative `IN_APP` implementation. |
| VIII. Test Discipline for Critical Flows (NON-NEGOTIABLE) | **Obligation carried into tasks.md** | Transaction logging is explicitly named in Principle VIII's critical-flow list. `tasks.md` MUST order every `tests/contract/test_transactions.ts` case before its corresponding implementation task, written first and confirmed red. **Known pre-existing gap, not introduced by this feature**: this repository has no `.github/workflows` (or any other) CI configuration yet — "CI MUST block merge on failure" is currently unenforced for *every* critical flow, not only this one (spec 002's own plan.md marks this same obligation "PASS, with obligation carried into tasks.md" without an actual CI file existing). This plan does not attempt to retrofit repository-wide CI as an undiscussed side effect of a transaction-logging feature; it is flagged here for visibility rather than silently marked PASS. |
| Additional Constraints: Tenancy | **PASS** | `communityId` is a first-class stored column on `Transaction` from day one (not retrofitted), consistent with "any new data store... MUST be designed with community scoping as a first-class dimension." |
| Additional Constraints: Stack (decided) | **PASS** | No deviation — same Next.js/Prisma/PostgreSQL/Docker, no new dependency. |
| Additional Constraints: Migrations & backups | **PASS** | The one new table ships as a single versioned Prisma migration; no manual DB edit. |
| IX. Platform Administration Authority (NON-NEGOTIABLE) | N/A | Named explicitly by the constitution's Development Workflow gate as required reading for any transaction-logging feature. A MASTER identity holds no community `Membership` and gains no marketplace permission by virtue of MASTER status; `transactionService.ts` never imports or calls anything from `masterAdministrationService.ts`, and no route in contracts/transactions-api.md is reachable from the platform-administration surface. A MASTER gets no special access to, or authority over, another member's transaction logs — mirrors the Principle III row's treatment above for the same reason. |

**Additional Constraints check**: no new payment code path is touched (Transaction logging ≠ payment execution); Principle IV's payments-specific sub-obligations (triple opt-in, webhook verification, one-log-per-payment) are explicitly out of scope for this feature per spec.md.

No violations identified; Complexity Tracking table is not needed.

*Re-check after Phase 1 design: data-model.md and contracts/transactions-api.md introduce no new violations. Community scoping is carried by `Transaction.communityId` directly on every query the contract defines (never inferred through a deletable `Listing`/`MessageThread` relation); every route checks `requireCommunityMembership()` before any read or write; response shapes expose only `id`/`displayName`/enum/timestamp fields, no new PII; no administrator-only route or field was introduced; `paymentPath` remains a single-value enum. No drift discovered during data-model/contract drafting.*

*Re-checked (T022) against the finished implementation: no new violations. Principle II holds — `grep -n "requireCommunityMembership" src/server/services/transactionService.ts` shows all five exported functions (`recordTransaction`, `confirmTransaction`, `getTransaction`, `listTransactions`, `listTransactionsForThread`) call it before any read or write, and `communityId` is a first-class column on every query, never inferred through the unconstrained `listingId`. Principle VI holds: `grep -in "email|phone"` across `transactionService.ts` and every new page/route/component returns no matches — only `displayName` values are ever selected or rendered. Principle VII holds: `git status` shows `package.json`/`package-lock.json` unchanged (no new runtime dependency), and `TransactionPaymentPath` still has exactly one member (`OFF_PLATFORM`). FR-007's immutability holds: `transactionService.ts` exports no `update`/`edit`/`patch`/`delete`-named function (asserted directly by a contract test); the only field-level write outside creation is `confirmTransaction()`'s guarded `confirmationState`/`confirmedAt` update. FR-017 holds: the contract test's post-`deleteListing()` case still passes. Full suite green: `npx tsc --noEmit`, `npx eslint .` (0 errors), `npm run test:unit` (226 tests, all pre-existing 002-009 tests unaffected), and `npm run test:e2e` for this feature's own spec (all 3 new Playwright tests green) plus a full-suite run — the full-suite run surfaced 9 timeouts, all in pre-existing, unrelated test files (community lifecycle, account administration, listing flow, Google OAuth mock, display-name prompt); re-running each of those files in isolation with fewer workers passed everything except one pre-existing Google OAuth mock-server configuration failure (`client_id is required`), confirming the timeouts were parallel resource contention against this Windows dev machine's single dev-server instance, not a regression introduced by this feature.*

## Project Structure

### Documentation (this feature)

```text
specs/010-transaction-logging/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── transactions-api.md
└── tasks.md              # Phase 2 output (/speckit-tasks command — not created by /speckit-plan)
```

### Source Code (repository root)

Extends the existing single Next.js/Prisma project established by 002-009 — no new top-level project.

```text
prisma/
└── schema.prisma                          # + Transaction model, TransactionConfirmationState and
                                            #   TransactionPaymentPath enums (data-model.md); + back-relations
                                            #   on Account ("as recorder", "as counterpart") and Community.
                                            #   New migration. No existing column changed.

src/
└── server/
    └── services/
        └── transactionService.ts          # new: recordTransaction() (thread-derived eligibility +
                                             #   co-membership + self-transaction checks, creates
                                             #   UNCONFIRMED row), confirmTransaction() (counterpart-only,
                                             #   live co-membership re-check, sets CONFIRMED — immutable
                                             #   from this point), getTransaction(), listTransactions()
                                             #   (per-community, caller as recorder or counterpart) — all
                                             #   reuse requireCommunityMembership() from listingService.ts

app/
├── communities/
│   └── [communityId]/
│       ├── threads/
│       │   └── [threadId]/
│       │       └── page.tsx               # extended: participants see the non-intermediary disclosure,
│       │                                   #   a "Record transaction" action (derives counterpart/listing
│       │                                   #   from the thread, no manual selection), and — once one or
│       │                                   #   more logs exist on this thread — their state, with a
│       │                                   #   "Confirm" action for the named counterpart only
│       └── transactions/
│           ├── page.tsx                   # new: every transaction log in this community where the caller
│           │                               #      is recorder or counterpart (FR-016) — survives even after
│           │                               #      the source thread/listing is later deleted (FR-017)
│           └── [transactionId]/
│               └── page.tsx               # new: one log's full detail + confirm action (non-intermediary
│                                            #      disclosure shown again here for the confirming party)
```

**Structure Decision**: Extends 008's existing per-community `threads/[threadId]` surface as the primary entry point (record/confirm inline, since eligibility is thread-derived), plus a standalone `transactions/` surface so a log remains reachable and traceable by both parties even after its source thread and listing no longer exist (FR-016, FR-017) — mirroring why 008 itself later added a standalone `Chats` surface, except scoped to one community here since no cross-community aggregation is requested by this feature's spec.

## Complexity Tracking

*No Constitution Check violations — table not needed.*
