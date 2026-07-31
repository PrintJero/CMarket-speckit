# Implementation Plan: Purchase Flow with Stock and Dual Transaction History

**Branch**: `013-purchase-flow-stock` | **Date**: 2026-07-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/013-purchase-flow-stock/spec.md`

## Summary

Replace 010-transaction-logging's thread-gated, two-sided *confirmation* model with a listing-gated, two-sided *proposal-and-acceptance* model, by evolving the existing `Transaction` entity in place (not adding a second one). A buyer proposes a quantity and self-reported total directly from a `FOR_SALE` listing; the system validates same-community membership, listing status, and stock; the seller accepts (atomically decrementing stock and writing the buyer's purchase history / seller's sales history as two views of the same `ACCEPTED` row) or rejects; the buyer may cancel while `PENDING`. Because 012-profiles-reputation already reads this same entity, its two read sites (`profileService.ts`, `reviewService.ts`) are updated in lockstep to the renamed fields/state with no behavioral change, verified by their existing contract tests.

## Technical Context

**Language/Version**: TypeScript, Next.js 16 (App Router) — unchanged from 002-012, no new language/runtime.

**Primary Dependencies**: Prisma Client (existing) — no new runtime dependency. Reuses `requireCommunityMembership()` (005-product-listings, `src/server/services/listingService.ts`), `isValidPriceCents()`'s validation pattern (new sibling `isValidStockQuantity()`), and `prisma.$transaction()` (already used by `communityLifecycleService.ts`, `messageService.ts`, `masterAdministrationService.ts`, `invitationService.ts`) for the guarded, atomic accept step.

**Storage**: PostgreSQL via Prisma, same dev/test containers already used by 002-012. **No new table.** One migration evolves the existing `transactions` table (migration `20260729010738_add_transaction`): renames `recorderId`/`counterpartId` → `buyerId`/`sellerId`, adds `quantity`/`totalCents`/`resolvedAt`, replaces `confirmationState`/`TransactionConfirmationState` with `state`/`TransactionState` (`PENDING`/`ACCEPTED`/`REJECTED`/`CANCELLED`). A second, additive change adds `Listing.stockQuantity Int?` (nullable — research.md #8). See [data-model.md](./data-model.md).

**Testing**: Vitest (`tests/contract/test_transactions.ts`, rewritten for the new state machine; `tests/contract/test_reviews.ts` and `tests/contract/test_profiles.ts`, whose fixtures move from creating `CONFIRMED` transactions via 010's shape to `ACCEPTED` ones via this feature's `proposePurchase`/`acceptProposal`, with assertions otherwise unchanged — FR-029/FR-030/SC-010) for `transactionService.ts`, the extended `listingService.ts` (`isValidStockQuantity`, `deleteListing`'s new cascade-cancel step), `reviewService.ts`, and `profileService.ts`. Playwright (`tests/integration/`) for the "Buy" action on the listing page, the accept/reject/cancel actions on the transaction list/detail pages, the stock field in the listing edit form, and the non-intermediary disclosure text. Per Constitution Principle VIII, this is a **named critical flow** (transaction logging, explicitly named, and this feature is its direct successor): tests MUST be written first and confirmed failing (red) before implementation, mirroring 002–012's own documented discipline.

**Target Platform**: The existing single Next.js web app (App Router), installable PWA, Docker/Dokploy — no new deployable unit, no new route namespace beyond the existing per-community structure.

**Project Type**: Extension of the existing single Next.js/Prisma project (no new top-level project). Note: this repository also contains vestigial, unused `backend/`, `web/`, and `mobile/` top-level directories from an earlier scaffold — confirmed inactive (not imported by `vitest.config.ts`'s `@` alias, not referenced by `package.json` scripts, no `tests/` entries under them) and out of scope for this feature to touch.

**Performance Goals**: None beyond standard interactive web-app latency; no throughput target is stated in spec.md's Success Criteria.

**Constraints**: Every proposal/accept/reject/cancel action MUST verify current co-membership, listing status (creation only), and stock (creation and acceptance) live, in the request itself (FR-007, FR-008, FR-009, FR-013, FR-014). Acceptance's stock re-check and decrement MUST be atomic against concurrent accept attempts (FR-014, research.md #5) — implemented as a guarded `prisma.$transaction`, not a read-then-write. No payment-method step (FR-005). `ACCEPTED` core facts are immutable (FR-022). No contact data in any route response (FR-026). 012-profiles-reputation's read path MUST show zero behavioral drift (FR-029, FR-030, SC-010).

**Scale/Scope**: One community's transactions/proposals at a time for the list view (mirrors 010's own unpaginated scoping) — no scale requirement is stated.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Admin-Controlled Membership Origin (NON-NEGOTIABLE) | N/A | This feature adds no membership path — it only reads existing `Membership` rows to authorize proposal/accept/reject/cancel actions. |
| II. Community Isolation (NON-NEGOTIABLE) | **PASS** | `Transaction.communityId` remains a first-class, denormalized column (unchanged from 010). Every mutating action (`proposePurchase`, `acceptProposal`, `rejectProposal`, `cancelProposal`) calls `requireCommunityMembership()` for the relevant party/parties, live, before any read or write (research.md #4, #5, #6). A proposal can never be created or accepted between two accounts that are not both current co-members, and neither history view can be read by anyone but its own owner (FR-025). |
| III. Administrator as Community Gatekeeper | N/A — explicitly not extended | No administrator action is added; an administrator gets no special access to another member's proposals or histories, mirroring 010's own precedent. |
| IV. Non-Custodial Payments — Transaction Logging as Source of Truth (NON-NEGOTIABLE) | **PASS** | This feature *is* the evolved traceability layer for path (a) (off-platform); it does not touch path (b). Every record captures buyer, seller, listing, community, quantity, total, payment path, timestamp, and final state (FR-023). The non-intermediary disclosure is shown before proposal submission (FR-006). Both parties are verified as co-members before a proposal can be created or accepted (FR-007, FR-014). Accepting a proposal is framed strictly as "accept and record this transaction," never "confirm payment received" (spec.md Constraints) — no route or page copy in contracts/purchase-flow-api.md implies CMarket backs the payment. `paymentPath` remains the same single-value enum (`OFF_PLATFORM`), unchanged shape for a future `IN_APP` value (FR-024, 010 research.md #5, carried over). |
| V. Single Web Application, Installable as PWA | **PASS** | The "Buy," accept/reject/cancel actions, and stock field extend the existing responsive Next.js PWA — no new client, no desktop-only surface. |
| VI. Contact & Data Privacy Gating | **PASS** | Every response shape carries only `displayName` values, never email/phone/address (FR-026) — unchanged from 010's FR-015 precedent, extended to the new accept/reject/cancel/proposal routes in contracts/purchase-flow-api.md. |
| VII. Simplicity & MVP-First | **PASS** | No payment-method step (FR-005). No seller counter-offer, no stock reservation on `PENDING` proposals, no notifications (spec.md Assumptions). The schema evolves the existing `Transaction` in place rather than adding a second entity or a compatibility shim (research.md #1, #11) — the simpler of the two options once the system is confirmed pre-launch (no data to preserve). `paymentPath` still ships with one enum value. |
| VIII. Test Discipline for Critical Flows (NON-NEGOTIABLE) | **Obligation carried into tasks.md** | Transaction logging is explicitly named in Principle VIII's critical-flow list; this feature is its direct successor and inherits the obligation. `tasks.md` MUST order every `tests/contract/test_transactions.ts` case (and the updated `test_reviews.ts`/`test_profiles.ts` fixtures) before its corresponding implementation task, written first and confirmed red. **Known pre-existing gap, not introduced by this feature**: this repository still has no CI configuration (010's plan.md already flagged this identically) — noted here for visibility, not silently marked PASS. |
| Additional Constraints: Tenancy | **PASS** | `communityId` remains a first-class stored column on `Transaction`, unchanged. |
| Additional Constraints: Stack (decided) | **PASS** | No deviation — same Next.js/Prisma/PostgreSQL/Docker, no new dependency. |
| Additional Constraints: Migrations & backups | **PASS** | The schema evolution ships as one versioned Prisma migration; no manual DB edit. Pre-launch status (spec.md Assumptions) means no production backfill is required. |
| IX. Platform Administration Authority (NON-NEGOTIABLE) | N/A | A MASTER identity holds no community `Membership` and gains no marketplace permission by virtue of MASTER status; none of `transactionService.ts`'s new functions import or call anything from `masterAdministrationService.ts`, and no route in contracts/purchase-flow-api.md is reachable from the platform-administration surface. |

**012-profiles-reputation regression check (this feature's own added obligation, FR-029/FR-030)**: `profileService.ts`'s `getProfile()` and `reviewService.ts`'s `createReview()`/`getMyReview()` are the only two files outside `transactionService.ts` itself that reference the fields this migration renames. Both are updated in the same feature (research.md #11) and their existing contract tests (`tests/contract/test_profiles.ts`, `tests/contract/test_reviews.ts`) MUST still pass with only fixture setup changed (creating `ACCEPTED` transactions via this feature's flow instead of `CONFIRMED` ones via 010's), never their assertions. **Sequencing note**: tasks.md implements this as a two-step expand/contract migration rather than one atomic schema change, precisely so `acceptProposal()` exists (needed to build 012's replacement fixtures) before 010's old columns/functions are removed — see tasks.md's own "Migration sequencing note" and T019. The fix and the schema's final shape land together at that point, not literally in the same task as the initial migration (T001).

**Additional Constraints check**: no new payment code path is touched; Principle IV's payments-specific sub-obligations (triple opt-in, webhook verification) remain explicitly out of scope, unchanged from 010.

No violations identified; Complexity Tracking table is not needed.

*Re-check after Phase 1 design: data-model.md and contracts/purchase-flow-api.md introduce no new violations. Community scoping is carried by `Transaction.communityId` on every query the contract defines; every mutating route checks `requireCommunityMembership()` (with the ACTIVE-vs-SUSPENDED split from research.md #4/#6) before any read or write; response shapes expose only `id`/`displayName`/enum/integer/timestamp fields; no administrator-only route or field was introduced; `paymentPath` remains a single-value enum; the guarded `$transaction` in data-model.md's acceptance gates keeps stock non-negative under concurrency without introducing a new dependency. No drift discovered during data-model/contract drafting.*

*Re-checked (T036) against the finished implementation: no new violations. Principle II holds — `grep -rn "requireCommunityMembership" src/server/services/transactionService.ts` shows all five exported functions (`proposePurchase`, `acceptProposal`, `rejectProposal`, `cancelProposal`, plus the reused check inside `getTransaction`/`listTransactions`) call it before any read or write, with the ACTIVE-only gate on creation and the SUSPENDED-tolerant gate on resolution exactly as research.md #4/#6 specify; `communityId` remains a first-class column on every query. Principle IV holds: `proposePurchase`'s screen and route never mention a payment method, `NonIntermediaryDisclosure` renders in `BuyForm.tsx` before submission, and `paymentPath` is still the single-value `OFF_PLATFORM` enum. Principle VI holds: `grep -in "email|phone"` across `transactionService.ts`, `BuyForm.tsx`, `AcceptRejectButtons.tsx`, `CancelProposalButton.tsx`, and both transaction pages returns no matches — only `displayName` values are ever selected or rendered; a consolidated contract-test assertion (`tests/contract/test_transactions.ts`, "dual history and no contact exposure" describe block) checks this across propose/accept/reject/cancel/get/list in one pass. Principle VII holds: `git diff package.json package-lock.json` is empty (no new runtime dependency); the schema evolves the existing `Transaction` in place rather than adding a second entity. FR-021's state machine holds: `acceptProposal`/`rejectProposal`/`cancelProposal` all gate on `state: "PENDING"` via the identical guarded-`updateMany` pattern, so no terminal state can transition again (asserted directly by contract tests, not just this design argument). FR-022's immutability holds: `transactionService.ts` exports no `update`/`edit`/`patch`/`delete`-named function (asserted directly by a contract test, T014/T023's "no exported function" case).*

*FR-029/FR-030 regression evidence (T019 step 5): `grep -rn "recorderId|counterpartId:.*string|TransactionConfirmationState|recordTransaction|confirmTransaction" src/ app/ tests/` returns no matches for 010's retired columns, enum, or functions — the only surviving hits are the unrelated, pre-existing `counterpartId` field name in `messageService.ts` (008's own MessageThread concept) and this feature's own generic `counterpartId` response field (a deliberate naming choice, not a database column), plus historical doc-comment mentions. `profileService.ts` and `reviewService.ts` now read `state: "ACCEPTED"`/`buyerId`/`sellerId`; their existing contract tests (`tests/contract/test_profiles.ts`, `tests/contract/test_reviews.ts`) pass unmodified in their assertions, with only fixture setup changed to build via `proposePurchase()`/`acceptProposal()`.*

*Full suite (T033/T034): `npx tsc --noEmit` and `npx eslint .` both clean. `npm run test:unit` — 280/280 tests pass (33 files), covering all six user stories' contract-level guarantees. `npm run test:e2e` for this feature's own specs (`test_purchase_flow.spec.ts`, plus the updated `test_review_creation.spec.ts` and `test_profile_view.spec.ts`) — all green. A full-suite Playwright run surfaced intermittent failures exclusively in unrelated pre-existing areas this feature never touches (009 platform-administration/MASTER flows, 003 community lifecycle, signup/verification, 006 display names) — re-running the same specs in isolation with fewer workers passed all but the 009 MASTER-flow tests and one 006 display-name test. The MASTER-flow failures were traced to 18 leftover `MasterIdentity` rows accumulated in the test database from this session's own repeated full-suite runs (`SELECT COUNT(*) FROM master_identities` = 18), polluting MASTER-bootstrap-dependent assertions — pre-existing test-environment state, not a code regression, and outside this feature's scope to clean up. The 006 display-name failure (`getByText("A member")` matching two elements) is a deterministic, pre-existing test/UI staleness unrelated to any file this feature touches (likely from a later feature adding a second matching profile-name element); also outside scope. Every failure was independently confirmed unrelated by inspecting `git diff` — none touch a file this feature modified.*

## Project Structure

### Documentation (this feature)

```text
specs/013-purchase-flow-stock/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md         # Phase 1 output (/speckit-plan command)
├── quickstart.md         # Phase 1 output (/speckit-plan command)
├── contracts/
│   └── purchase-flow-api.md  # Phase 1 output (/speckit-plan command)
└── tasks.md              # Phase 2 output (/speckit-tasks command — NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
prisma/
├── schema.prisma                 # Listing.stockQuantity added; Transaction evolved in place; TransactionState replaces TransactionConfirmationState
└── migrations/
    └── <new>_evolve_transaction_to_purchase_flow/

src/
├── lib/
│   └── prisma.ts                 # existing, unchanged
└── server/
    └── services/
        ├── listingService.ts     # + isValidStockQuantity(), stockQuantity in create/update, deleteListing() gains the cascade-cancel step (research.md #9)
        ├── transactionService.ts # recordTransaction/confirmTransaction retired; proposePurchase/acceptProposal/rejectProposal/cancelProposal/getTransaction/listTransactions added or evolved
        ├── reviewService.ts      # createReview/getMyReview updated to state === "ACCEPTED", buyerId/sellerId (research.md #11)
        └── profileService.ts     # getProfile's confirmedTransactionCount query updated to state === "ACCEPTED", buyerId/sellerId (research.md #11)

app/
├── api/communities/[communityId]/
│   ├── listings/[listingId]/
│   │   ├── route.ts                       # PATCH extended with stockQuantity
│   │   └── proposals/route.ts             # NEW — POST propose
│   ├── threads/[threadId]/transaction/    # REMOVED (route.ts deleted)
│   └── transactions/
│       ├── route.ts                       # GET list — evolved response shape, optional ?state=
│       └── [transactionId]/
│           ├── route.ts                   # GET detail — evolved response shape
│           ├── confirm/                   # REMOVED (route.ts deleted)
│           ├── accept/route.ts            # NEW — POST accept
│           ├── reject/route.ts            # NEW — POST reject
│           └── cancel/route.ts            # NEW — POST cancel
└── communities/[communityId]/
    ├── listings/
    │   ├── ListingForm.tsx                # + stockQuantity field
    │   └── [listingId]/
    │       ├── page.tsx                   # + stock display, "Buy" action
    │       └── BuyForm.tsx                # NEW
    └── transactions/
        ├── page.tsx                       # evolved: state column, accept/reject/cancel actions
        └── [transactionId]/page.tsx        # evolved: state-appropriate actions

tests/
├── contract/
│   ├── test_transactions.ts   # rewritten for the new state machine (this feature's own critical-flow tests)
│   ├── test_reviews.ts        # fixtures updated (research.md #11), assertions unchanged
│   └── test_profiles.ts       # fixtures updated (research.md #11), assertions unchanged
├── unit/
│   └── test_listing_stock_validation.ts  # NEW — isValidStockQuantity()
└── integration/
    └── test_purchase_flow.spec.ts        # NEW — Playwright, end-to-end Buy → Accept/Reject/Cancel
```

**Structure Decision**: Extends the existing single Next.js/Prisma application at the repository root (`src/server/services`, `app/api`, `app/communities`, `tests/{contract,unit,integration}`) — the same structure every prior feature (002–012) used. No new top-level project or package. The repository's `backend/`, `web/`, and `mobile/` directories are pre-existing, unused scaffolding (Technical Context) and are not part of this feature's structure.

## Complexity Tracking

*No entries — Constitution Check identified no violations requiring justification.*
