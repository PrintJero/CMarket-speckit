# Implementation Plan: User Profiles and Reputation

**Branch**: `012-profiles-reputation` | **Date**: 2026-07-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/012-profiles-reputation/spec.md`

## Summary

Let a member open a fellow current co-member's public profile from a listing, a thread, or a transaction, showing display name, community-scoped member-since date and active listings, plus three reputation numbers — confirmed-transaction count, average rating, review count — computed **globally across every community the account belongs to**, never broken down or attributed to a specific other community (spec.md Clarifications). Reputation is built exclusively from a new `Review` row: a bare 1-5 integer rating (no comment field, no individual review list — MVP scope per Clarifications) that either participant of a `CONFIRMED` 010-transaction-logging `Transaction` may leave about the other, at most once each, immutable once created. A profile additionally requires the *viewed account itself* to currently hold membership in the community being viewed — a refinement over spec.md's own edge-case wording, forced by a concrete storage fact: `Membership` rows are hard-deleted on removal/departure (no soft-delete column exists), so there is no `Membership.createdAt` left to render a member-since date from once someone has left (research.md #1).

**Post-implementation UX amendment (FR-030, FR-031)**: confirming a transaction now immediately shows the confirming participant a rating modal (star selector, Submit, Maybe later) for the other participant, rather than leaving rating as something only discoverable later on the transaction page. This is presentation-only — the modal calls the exact same review-creation action and gates already described above; declining it leaves the transaction ratable afterward exactly as before the amendment.

## Technical Context

**Language/Version**: TypeScript, Next.js (App Router) — unchanged from 002-011, no new language/runtime.

**Primary Dependencies**: Prisma Client (existing) — no new runtime dependency. Reuses `requireCommunityMembership()` (005-product-listings, `src/server/services/listingService.ts`) unchanged for every membership gate in this feature; reads 010-transaction-logging's `Transaction` model and 005/011's `Listing` model without modifying either.

**Storage**: PostgreSQL via Prisma, same dev/test containers already used by 002-011. One new table, `Review` (data-model.md). Unlike every other per-community model in this codebase (`Listing`, `MessageThread`, `Invitation`, `Membership`, and `Transaction`'s own `communityId`), `Review` carries **no `communityId` column at all** — a deliberate, narrow exception to the "any new data store MUST be designed with community scoping as a first-class dimension" constraint, justified by the feature's own resolved design: reputation (`FR-008`, `FR-009`) is computed globally across every community an account belongs to, so there is no per-row community to scope by, and the one place community *does* matter — verifying live co-membership at review-creation time (`FR-019`) — is derived transiently through `transactionId → Transaction.communityId`, never stored redundantly on `Review` itself.

**Testing**: Vitest (`tests/contract/test_reviews.ts`, `tests/contract/test_profiles.ts`) for `reviewService.ts`/`profileService.ts` — the fraud-prevention gates (non-participant, unconfirmed transaction, self-review structurally impossible, duplicate, lapsed membership), the immutability guarantee (no edit/delete function exported), the global (not community-scoped) aggregation of rating/review/transaction counts, and the non-disclosure guarantee (no other-community detail in any response, no email/phone/address anywhere). Playwright (`tests/integration/test_profile_view.spec.ts`, `tests/integration/test_review_creation.spec.ts`) for opening a profile from a listing/thread/transaction, leaving a rating from the transaction detail page, and the display-name-is-clickable navigation path. This feature is **not** on Constitution Principle VIII's named critical-flow list, so tests are optional by constitutional default — but spec.md's own Success Criteria (SC-001, SC-002, SC-003, SC-006) commit to automated verification of exactly these guarantees, so tasks.md carries them as required, not optional, mirroring 011-wanted-posts' identical treatment of its own FR-013.

**Target Platform**: The existing single Next.js web app (App Router), installable PWA, Docker/Dokploy — no new deployable unit; one new route namespace (`communities/[communityId]/members/[accountId]`) alongside the existing per-community structure.

**Project Type**: Extension of the existing single Next.js/Prisma project (no new top-level project).

**Performance Goals**: None beyond standard interactive web-app latency; no throughput target is stated anywhere in the spec's Success Criteria.

**Constraints**: Every profile-access and review-creation gate MUST re-verify membership live, never from cached/creation-time state (FR-006, FR-019), mirroring 010's own FR-002/FR-003 discipline. A review's reviewed account is always derived server-side as "whichever of the transaction's two participants the reviewer is not" (FR-013) — never a separate client-supplied field — removing an entire class of "does this reviewed-account match the transaction" validation bugs, exactly mirroring 010's own counterpart-derivation precedent (research.md #2 there). No comment field, no individual review/rating list, no pagination concern as a result (FR-021, FR-010). No badges/rankings/dispute handling/edit/delete (FR-028). The three reputation numbers MUST be computed fresh at request time from qualifying rows, never cached on `Account` (FR-023, FR-024).

**Scale/Scope**: One profile at a time; no aggregate cross-member ranking or leaderboard is in scope (FR-028), so no new indexing concern beyond `Review.reviewedId` for the aggregate query and `Transaction`'s own existing `recorderId`/`counterpartId` indexes (010) for the global transaction count.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Admin-Controlled Membership Origin (NON-NEGOTIABLE) | N/A | This feature adds no membership path — it only reads existing `Membership` rows to authorize profile access and review creation. |
| II. Community Isolation (NON-NEGOTIABLE) | **PASS** | Opening a profile requires *both* the viewer and the viewed account to currently hold membership in the community being viewed (FR-006, research.md #1) — re-verified live via the existing `requireCommunityMembership()`, never cached. Active listings and the member-since date are strictly scoped to that one community (FR-007). The three reputation numbers are a deliberate, explicitly documented exception (see Storage, above, and Clarifications): they are global rather than community-scoped, but FR-011 makes it a hard requirement that no response ever names, lists, or otherwise makes inferable *which* other community contributed to them — the disclosure is a bare magnitude, never a cross-community detail. |
| III. Administrator as Community Gatekeeper | N/A | No administrator action is added. A community administrator gets no special access to, or authority over, another member's profile or reviews — mirrors 010's own "no administrator access path" precedent (its plan.md, Principle III row) for the same privacy reason; nothing in this feature calls `requireCommunityAdministrator()`. |
| IV. Non-Custodial Payments — Transaction Logging as Source of Truth (NON-NEGOTIABLE) | N/A | No money or payment path is touched. This feature reads 010's `Transaction.confirmationState` as its sole reputation gate but writes nothing back to `Transaction` and does not alter its confirmation rules (FR-026). |
| V. Single Web Application, Installable as PWA | **PASS** | The profile page and the rating action extend the existing responsive Next.js PWA shell (`AppShell`) — no new client, no desktop-only surface (FR-029). |
| VI. Contact & Data Privacy Gating | **PASS** | A profile response carries only `displayName`, dates, listing summaries, and the three reputation numbers — never email, phone, address, or authentication data (FR-003), verified by SC-003. Reviewing has zero effect on contact-data visibility; mirrors 006/008/010's own identical guarantee. |
| VII. Simplicity & MVP-First | **PASS** | No comment field, no individual review list, no pagination, no blind-review mechanism, no badges/rankings/seller tiers/dispute handling (FR-021, FR-010, FR-028 — this feature's own explicit, resolved scope cuts). `Review` has five columns and one relationless foreign key discipline choice (no `communityId`), not a speculative general-purpose reputation engine. Reuses `requireCommunityMembership()` unchanged rather than inventing a parallel authorization primitive. |
| VIII. Test Discipline for Critical Flows (NON-NEGOTIABLE) | **N/A by constitution; mandatory by this feature's own spec** | User profiles/reviews are not on Principle VIII's named critical-flow list. spec.md's own Success Criteria (SC-001, SC-002, SC-003, SC-006) nonetheless commit to automated verification of the fraud-prevention and non-disclosure guarantees — tasks.md MUST carry these as required tests, mirroring 011-wanted-posts' identical treatment of its own FR-013 obligation. |
| IX. Platform Administration Authority (NON-NEGOTIABLE) | N/A | No MASTER-surface change. A MASTER identity holds no community `Membership` and gains no marketplace visibility by virtue of MASTER status; nothing in `reviewService.ts`/`profileService.ts` imports from or is reachable through `masterAdministrationService.ts` or any `/master` route — mirrors 008/010's identical treatment. |

**Additional Constraints check**: Tenancy — `Review`'s deliberate lack of a `communityId` column is the one considered exception in this codebase (see Storage, above); every other new-in-this-feature concern (`profileService.ts`'s profile-access gates) treats `communityId` as first-class. Stack — no deviation, no new dependency. Migrations & backups — the one new table ships as a single versioned Prisma migration; no manual DB edit.

No Core Principle violations identified; Complexity Tracking table is not needed (the Tenancy note above is an Additional Constraint judgment call, explained here and in data-model.md, not a Core Principle exception).

*Re-check after Phase 1 design: data-model.md and contracts/profiles-reputation-api.md introduce no new violations. Community scoping is carried by explicit, live `requireCommunityMembership()` calls for both the viewer and the viewed account (profileService.ts) and for both the reviewer and the reviewed account (reviewService.ts) — never inferred or cached. The global-reputation exception is confined to exactly three numbers (`confirmedTransactionCount`, `averageRating`, `reviewCount`); every other field in `contracts/profiles-reputation-api.md`'s profile response is community-scoped or account-identity-only. No new PII field is introduced anywhere. No administrator- or MASTER-only route or field was introduced. `Review` remains a five-column table with no comment/text field. No drift discovered during data-model/contract drafting.*

*Re-checked (T032) against the finished implementation: no new violations. Principle II holds — `grep -n "requireCommunityMembership" src/server/services/reviewService.ts src/server/services/profileService.ts` shows it called before any read/write in both files (reviewer and reviewed account in `createReview()`; the viewer in `getProfile()`, with the viewed account's own membership checked via a direct, current-epoch-aware `Membership` lookup per research.md #1); `grep -n "communityId" prisma/schema.prisma` confirms `Review` has no such column. Principle VI holds: `grep -rniE "email|phone|address" src/server/services/reviewService.ts src/server/services/profileService.ts app/communities/*/members/*/page.tsx` returns no matches. Principle VII holds: `git diff --stat -- package.json package-lock.json` shows no changes (no new dependency); `reviewService.ts` exports no `update`/`edit`/`patch`/`delete`-named function (asserted directly by a contract test, mirroring 010's own FR-007 test). Principle IX holds: no new file or route references `masterAdministrationService` or `/master`. Full suite green: `npx tsc --noEmit`, `npx eslint .` (0 errors), `npm run test:unit` (268 tests, all pre-existing 002-011 tests unaffected), and this feature's own Playwright specs (`test_profile_view.spec.ts`, `test_review_creation.spec.ts`, 6 tests) all green in isolation, along with every other touched file's existing suite (`test_transactions_flow`, `test_messaging_flow`, `test_listing_flow`, `test_listing_display_names`, `test_wanted_posts_flow` — 24 tests total at `--workers=1`). A full-suite `npm run test:e2e` run at default parallelism showed 28 failures across files this feature never touches (MASTER administration, community lifecycle, invitations) plus the touched-file set; re-running the touched-file set alone at `--workers=1` isolated exactly one pre-existing, out-of-scope issue — `test_listing_display_names.spec.ts`'s `getByText("A member")` strict-mode collision between the AppShell sidebar's own nameless-caller placeholder and a nameless listing owner's identical placeholder, already discovered and explicitly left unfixed by 011-wanted-posts' own plan.md re-check note, confirmed unrelated to this feature since the same two elements would collide whether the listing-card owner name is a `<p>` (as before) or an `<a>` (as this feature changes it to) — `getByText` matches either equally. Two real issues found in this feature's own new Playwright tests (not the application) were fixed during verification: a race condition in `test_profile_view.spec.ts` (navigated away before the "Record transaction" action had visibly completed) and a missing automated check for FR-004/SC-009 (self-view parity), now covered by a new `test_profiles.ts` case. The remaining unrelated full-suite failures are consistent with this Windows dev machine's documented parallel-resource-contention characteristic (010/011 plan.md precedent), not regressions introduced by this feature.*

## Project Structure

### Documentation (this feature)

```text
specs/012-profiles-reputation/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output
├── data-model.md         # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── profiles-reputation-api.md
└── tasks.md              # Phase 2 output (/speckit-tasks command — not created by /speckit-plan)
```

### Source Code (repository root)

Extends the existing single Next.js/Prisma project established by 002-011 — no new top-level project.

```text
prisma/
└── schema.prisma                          # + Review model (data-model.md); + back-relations on
                                            #   Account ("reviewsWritten", "reviewsReceived") and
                                            #   Transaction ("reviews"). New migration. No existing
                                            #   column changed.

src/
├── server/
│   └── services/
│       ├── reviewService.ts               # new: createReview() (participant + confirmed-state +
│       │                                   #   live co-membership + self-review + duplicate checks,
│       │                                   #   FR-012–FR-020), getReputationSummary() (global
│       │                                   #   average rating + review count, FR-008, FR-023, FR-024)
│       ├── profileService.ts              # new: getProfile() (live dual-membership gate, FR-006 +
│       │                                   #   research.md #1; member-since + active listings scoped
│       │                                   #   to communityId, FR-007; confirmed-transaction count +
│       │                                   #   getReputationSummary() results, both global, FR-008/009)
│       ├── transactionService.ts          # extended: GetTransactionResult/ListTransactionsResult/
│       │                                   #   ListTransactionsForThreadResult gain counterpartId
│       │                                   #   alongside the existing counterpartDisplayName (FR-005)
│       └── messageService.ts              # extended: ListThreadsResult/ListMyThreadsResult gain
│                                           #   counterpartId alongside counterpartDisplayName (FR-005)
│                                           #   — GetThreadResult's messages already expose senderId,
│                                           #   no change needed there
└── lib/
    └── formatting/
        └── rating.ts                       # new: formatAverageRating() — "4.3" or "No ratings yet",
                                              #   mirrors formatListingPrice()'s existing pattern

app/
├── api/
│   └── communities/
│       └── [communityId]/
│           ├── members/
│           │   └── [accountId]/
│           │       └── route.ts            # new: GET → profileService.getProfile()
│           └── transactions/
│               └── [transactionId]/
│                   └── reviews/
│                       └── route.ts        # new: POST → reviewService.createReview()
└── communities/
    └── [communityId]/
        ├── members/
        │   └── [accountId]/
        │       └── page.tsx                # new: the public profile page (User Story 1/4)
        ├── transactions/
        │   ├── page.tsx                    # extended: counterpart name becomes a Link to their profile
        │   └── [transactionId]/
        │       ├── page.tsx                # extended: counterpart name becomes a Link; shows a rating
        │       │                           #   action (or the caller's own past rating) once CONFIRMED
        │       └── ReviewForm.tsx          # new: 1-5 rating control, calls the reviews route
        ├── _components/
        │   ├── ConfirmTransactionButton.tsx # extended (FR-030 amendment): on a successful confirm,
        │   │                                #   shows RatingModal instead of refreshing immediately
        │   └── RatingModal.tsx              # new (FR-030/FR-031 amendment): post-confirmation rating
        │                                    #   prompt — stars, Submit, Maybe later; calls the exact
        │                                    #   same reviews route as ReviewForm, no new gate
        ├── threads/
        │   ├── page.tsx                    # extended: counterpart name becomes a Link
        │   └── [threadId]/
        │       └── page.tsx                # extended: message-sender and transaction-counterpart
        │                                    #   names become Links (senderId already available)
        └── listings/
            ├── page.tsx                    # extended: owner name becomes a Link (ownerId already
            │                                #   available)
            └── [listingId]/
                └── page.tsx                # extended: owner name becomes a Link
└── chats/
    └── page.tsx                             # extended: counterpart name becomes a Link
                                              #   (communityId already available per thread)
```

**Structure Decision**: One new per-community route pair (`members/[accountId]` — page + API) alongside the existing `listings`/`threads`/`transactions` siblings, plus a review-creation endpoint nested under the existing `transactions/[transactionId]` resource (mirroring how 010 nested `confirm` under the same resource). Every other change is additive: existing pages gain a `Link` around a display name they already render, and two existing services gain one already-computed field to their return shape. No existing page, route, or service function is removed or restructured.

## Complexity Tracking

*No Core Principle violations — table not needed. The one deliberate Additional-Constraint judgment call (Review's lack of a `communityId` column) is explained in Technical Context (Storage) and the Constitution Check's Community Isolation row, not repeated here since it is not a Core Principle exception.*
