# Implementation Plan: Platform Administration

**Branch**: `009-platform-administration` | **Date**: 2026-07-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/009-platform-administration/spec.md`

## Summary

Introduce a global `MASTER` platform-operator identity, entirely separate from marketplace `Account`/`Membership`, authenticated through its own Master ID/password sign-in and its own session store. An active MASTER can create further MASTER identities, create communities with either an existing or newly provisioned founding administrator, manage any community's administrators/members from outside without ever becoming a member, and fully manage ordinary accounts (edit, suspend, reset, permanently and non-destructively delete). Communities gain an `ACTIVE → SUSPENDED → ARCHIVED` lifecycle: suspension keeps existing read/reply access working while blocking growth, unreactivated suspension auto-archives after 30 days (retaining all history), and a MASTER can later restore an archived community by reactivating exactly one prior administrator's access. Every MASTER action and the automatic archival transition write to a new, immutable administrative audit log, distinct from the future marketplace transaction log. Community administrators additionally gain the ability to promote a peer member to administrator directly (no MASTER involved). Analytics, access codes, payments, 2FA, and recovery-request intake are explicitly out of scope (FR-075).

## Technical Context

**Language/Version**: TypeScript, Next.js (App Router) — unchanged from 002–008, no new language/runtime.

**Primary Dependencies**: Prisma Client (existing) — no new runtime dependency. Reuses `hashPassword`/`verifyPassword` (`src/lib/auth/passwordHash.ts`) for MASTER and provisioned-account credentials, the SHA-256 session-token-hashing pattern from `sessionService.ts` for the new `MasterSession` store, and the existing `{ ok, reason }` discriminated-union service convention used by every prior spec's services.

**Storage**: PostgreSQL via Prisma, same dev/test containers as 002–008. Three new models (`MasterIdentity`, `MasterSession`, `AdministrativeAuditEntry`), two extended models (`Community` gains lifecycle fields plus an `operationalEpoch` counter, `Account` gains `status`/`deletedAt`), and four models that each gain one `operationalEpoch` column (`Listing`, `MessageThread`, `Invitation`, `Membership` — research.md #8) — see [data-model.md](./data-model.md). No existing column is removed or repurposed; all additions are nullable or carry a safe default so every pre-009 row remains valid without a data migration/backfill.

**Testing**: Vitest contract tests for five new service files (`masterAuthService.ts`, `masterSessionService.ts`, `communityLifecycleService.ts`, `masterAdministrationService.ts`, `auditService.ts`) plus additive coverage on existing contract tests wherever a gate function's `WHERE` clause changes to add an `operationalEpoch` check (research.md #8) or an account-status check (research.md #9), and dedicated coverage for the audit log's SUCCESS-atomic / FAILURE-independent transaction discipline (research.md #6). Playwright integration tests for MASTER sign-in, community creation (both founder modes), suspend/reactivate/restore, and account suspend/delete. Per spec.md's own Assumptions and Constitution v4.1.0 Principles VIII and IX, this feature commits to the same red-then-green discipline already mandated for MASTER authentication/authorization, community bootstrap, last-MASTER/last-administrator guards, managed provisioning, suspend/archive/restore, and audit integrity — all six are now standing constitutional critical flows, not just this feature's own commitment; tests-first is not optional for them.

**Target Platform**: The existing single Next.js web app (App Router), installable PWA, Docker/Dokploy — no new deployable unit. Two new operational CLI scripts (`scripts/bootstrap-master.ts`, `scripts/archive-suspended-communities.ts`), run via `tsx` exactly like the existing `scripts/create-community.ts`, the second intended to run on a Dokploy-scheduled cron (research.md #7) rather than as an in-process scheduler.

**Project Type**: Extension of the existing single Next.js/Prisma project (no new top-level project).

**Performance Goals**: None beyond standard interactive web-app latency; SC-012 requires paginated, database-filtered administration list views (communities, accounts, masters, audit log) rather than loading full tables into memory — an explicit, testable constraint, not a numeric target.

**Constraints**: A MASTER session can never authenticate as an Account, and vice versa (FR-001, FR-004, FR-005, research.md #1) — enforced by fully separate tables/cookies, not a shared discriminator. Every MASTER capability routes through a dedicated authorization boundary, never a fabricated community `Membership` (FR-018). No plaintext password, password hash, session token, invitation/verification token, or access code may ever appear in an audit entry (FR-070). No action may leave the platform with zero active MASTER identities or an active/suspended community with zero active administrators (FR-013, FR-030). Archival must retain all data — no cascading physical deletion (FR-060), and must not touch any `Listing`/`MessageThread`/`Invitation`/`Membership` row (research.md #8); permanent account deletion must retain non-reassignable historical attribution, not reassign or erase it (FR-034). A rejected/failed state-changing attempt MUST still produce its own audit entry, written independently of (never nested inside) the transaction whose rollback it is recording (Constitution v4.1.0 Principle IX, research.md #6).

**Scale/Scope**: Platform-wide administration surface, used by a small number of MASTER operators (not marketplace-scale traffic) — list views are paginated (SC-012) but no specific throughput target is stated anywhere in Success Criteria.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design. Evaluated against **Constitution v4.1.0**, which adds Principle IX specifically to authorize this feature (see research.md's preamble) — several rows below cite it as the grounding for a mechanism this plan needed, rather than as this feature's own ad hoc justification.*

| Principle | Status | Notes |
|---|---|---|
| I. Admin-Controlled Membership Origin (NON-NEGOTIABLE) | **PASS, under Principle IX's managed-provisioning exception** | Principle IX (v4.1.0) explicitly names "managed account provisioning" as a second, bounded exception to Principle I's credential-origin rule, permitted only through MASTER-driven creation: (a) MASTER-driven community creation may provision a brand-new `Account`, applying that exception *for the MASTER flow specifically* — the pre-existing `createCommunity()`/operator-panel path is untouched (research.md #12); (b) a MASTER-provisioned account is created already-verified with a system-issued temporary password, exactly the provisioning shape Principle IX describes (research.md #10). Principle I's core guarantee — an account alone grants zero community access — holds: access is only ever granted by the same atomic action that also creates a Membership. |
| II. Community Isolation (NON-NEGOTIABLE) | **PASS** | Every community-scoped MASTER read/write takes `communityId` explicitly and every ordinary marketplace gate function (`requireCommunityMembership`, `requireCommunityAdministrator`, and every listing/message query) is extended, never bypassed, to also check `Community.status` and, for the four epoch-bearing entities, `operationalEpoch` (research.md #8, #15). A MASTER's cross-community visibility is a documented, distinct authorization boundary (FR-018) — it does not weaken per-community isolation for ordinary accounts, who still see only their own communities. |
| III. Administrator as Community Gatekeeper | **PASS, exercising Principle IX's escalation path** | Principle IX (v4.1.0) now formally defines the MASTER administration area as Principle III's "documented support/escalation path" — not an invisible shortcut inside ordinary marketplace authorization (it never touches `requireCommunityAdministrator()`'s code path; it uses its own MASTER-only checks) and separately auditable from ordinary community-administrator actions (only MASTER/system actions write `AdministrativeAuditEntry` rows — User Story 6's peer-promotion is not audited by this feature, since it is ordinary community self-governance, not platform escalation). The last-admin guard (FR-030) and invitation-lifecycle rule are preserved and, for the first time, explicitly testable at the MASTER layer too (Story 5, Scenario 4). |
| IV. Non-Custodial Payments | **N/A** | No money moves and no payment path is touched; FR-075 explicitly excludes payments, platform billing, and subscription charging from this feature. |
| V. Single Web Application, Installable as PWA | **PASS** | The MASTER administration area (`app/master/*`) extends the existing responsive Next.js PWA (FR-020) — no new client, no desktop-only surface. |
| VI. Contact & Data Privacy Gating | **PASS, under Principle IX's bounded exception** | Principle IX (v4.1.0) explicitly permits MASTER support/account-management views to surface an account's contact data as needed for support (Story 5, Scenario 6) — a named, bounded exception rather than an implicit one. This visibility is strictly confined to `app/master/*` and never leaks into ordinary marketplace rendering or another user's view (FR — "MASTER actions that expose personal data are restricted to the administration area," Edge Cases). Ordinary marketplace contact-gating (Principle VI's core rule, enforced by 005–008) is untouched. |
| VII. Simplicity & MVP-First | **PASS** | No new runtime dependency anywhere in this feature (research.md #1, #2, #5, #7). No queue/scheduler infrastructure introduced — the one recurring job rides Dokploy's existing cron capability (research.md #7). Audit-log immutability and message-style "no edit/delete" are enforced by omission, not new DB triggers (research.md #6). The operational-epoch mechanism (research.md #8) was chosen specifically because it turned out *simpler* overall than the status-column alternative it replaced — see Complexity Tracking. Explicit exclusions (FR-075, FR-076): no access codes, bulk onboarding, transaction logging, in-app payments, platform billing, analytics dashboards, notifications, 2FA, or email-based MASTER recovery — all correctly deferred to future specs rather than built speculatively now. |
| VIII. Test Discipline for Critical Flows (NON-NEGOTIABLE) | **PASS** | MASTER authentication/authorization, community bootstrap, last-MASTER/last-administrator guards, managed ordinary-account provisioning, community suspend/archive/restore, and administrative audit integrity are now named directly in Constitution v4.1.0 Principle VIII's own critical-flow list (this amendment's doing, propagated into `.specify/templates/tasks-template.md`) — not only this feature's own spec.md Assumptions. None of the constitution's other named flows change behavior here except membership (extended, not replaced; tasks.md must order contract tests before their implementation for all six new flows). |
| IX. Platform Administration Authority (NON-NEGOTIABLE) | **PASS** | This feature *is* Principle IX's reference implementation: `MasterIdentity`/`MasterSession` are structurally separate from `Account`/`Session` (research.md #1); bootstrap runs outside `app/` and is architecturally test-enforced (research.md #5); the last-MASTER guard and self-disable prohibition are enforced inside the same transaction as every disable attempt (research.md #11); managed provisioning leaves no pending credential (research.md #10); every MASTER capability resolves through `requireMaster()`, never a fabricated Membership (FR-018); and every state-changing action — including rejected attempts — produces an audit entry, with SUCCESS entries committing atomically with their mutation and FAILURE entries written independently so a rollback can never erase the record of what was attempted (research.md #6, data-model.md's Writer discipline). |

**Additional Constraints check**: Tenancy — the three wholly-new models are global-scope by design (`MasterIdentity`, `MasterSession`, `AdministrativeAuditEntry` — platform-level, not community-scoped, exactly matching what they represent); the four epoch-bearing models extend an existing community-scoped model without weakening its scoping (research.md #8, #15). Stack — no deviation (same Next.js/Prisma/PostgreSQL/Docker, no new dependency). Migrations & backups — every schema change ships as one versioned Prisma migration; no manual DB edit, no data loss for existing rows (all new columns are nullable or default-valued).

No unjustified violations identified. The Principle I and Principle VI exceptions this feature relies on are not this feature's own ad hoc departures — they are named, standing allowances under Constitution v4.1.0 Principle IX, cited above rather than re-justified here. One genuine design-complexity tradeoff remains, recorded in Complexity Tracking below: the operational-epoch mechanism required by Principle VII's "simplest solution that satisfies its specification" test.

*Re-check after Phase 1 design: data-model.md and contracts/platform-administration-api.md introduce no new violations. Every community-scoped MASTER route takes `communityId`/`membershipId`/`accountId` as explicit path/body parameters and resolves authorization via `requireMaster()` plus the target's own current `status`/`operationalEpoch`, never a caller-supplied trust assumption. Every response shape in the contract that surfaces account data is confined to `app/api/master/*` (Principle IX's bounded exception, not leaked into any `app/api/communities/*` or `app/api/chats` shape) — and the contract never returns a raw `operationalEpoch` integer, only a derived `isCurrent` boolean, keeping the mechanism an internal implementation detail. No route accepts or trusts a client-supplied audit `outcome` or `detail` — both are always server-computed, and the contract's intro paragraph states the SUCCESS-atomic/FAILURE-independent write discipline applies to every route rather than repeating it per-route. No drift discovered during data-model/contract drafting.*

## Project Structure

### Documentation (this feature)

```text
specs/009-platform-administration/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── platform-administration-api.md
└── tasks.md             # Phase 2 output (/speckit-tasks command — not created by /speckit-plan)
```

### Source Code (repository root)

Extends the existing single Next.js/Prisma project established by 002–008 — no new top-level project.

```text
prisma/
└── schema.prisma                          # + MasterIdentity, MasterSession, AdministrativeAuditEntry
                                            #   models; + status/suspendedAt/suspensionReason/
                                            #   archiveScheduledAt/archivedAt/operationalEpoch on
                                            #   Community; + status/deletedAt on Account;
                                            #   + operationalEpoch on Listing, MessageThread,
                                            #   Invitation, Membership (data-model.md). New
                                            #   migration; no existing column changed, all
                                            #   additions nullable/defaulted.

src/
├── lib/
│   ├── auth/
│   │   └── masterSessionCookie.ts         # new: cmarket_master_session cookie name/options,
│   │                                       #      mirrors sessionCookie.ts exactly
│   └── validation/
│       └── masterId.ts                    # new: normalizeMasterId(), isValidMasterId()
│                                           #      (research.md #3)
└── server/
    └── services/
        ├── masterAuthService.ts           # new: createMaster() (bootstrap + MASTER-driven),
        │                                   #      signInAsMaster(), changeMasterPassword(),
        │                                   #      disableMaster()/reactivateMaster()/
        │                                   #      resetMasterPassword() with last-master/self-disable
        │                                   #      guards (research.md #4, #11)
        ├── masterSessionService.ts        # new: createMasterSession(), getValidMasterSession(),
        │                                   #      deleteMasterSession(), deleteAllMasterSessions() —
        │                                   #      parallels sessionService.ts exactly, separate table
        ├── communityLifecycleService.ts   # new: createCommunityAsMaster() (research.md #12),
        │                                   #      suspendCommunity(), reactivateCommunity()
        │                                   #      (touch only Community fields, no child rows —
        │                                   #      research.md #8), archiveDueSuspendedCommunities()
        │                                   #      (research.md #7, also touches only Community),
        │                                   #      restoreCommunity() (increments operationalEpoch,
        │                                   #      moves exactly one Membership row to it —
        │                                   #      research.md #8)
        ├── masterAdministrationService.ts # new: listCommunitiesForMaster(), editCommunity(),
        │                                   #      promoteMembership()/removeMembership() (MASTER
        │                                   #      variants, with disposition handling), plus ordinary-
        │                                   #      account management: editAccount(), suspendAccount(),
        │                                   #      reactivateAccount(), resetAccountPassword(),
        │                                   #      deleteAccount() (research.md #9) — all with the
        │                                   #      last-active-administrator orphan guard (FR-046)
        ├── auditService.ts                # new: writeAuditEntry(client, entry) — takes an explicit
        │                                   #      Prisma client (tx for SUCCESS, plain prisma for an
        │                                   #      independent FAILURE write, research.md #6),
        │                                   #      listAuditEntries() (filtered, paginated, FR-073);
        │                                   #      exports the closed AdministrativeAction TS union
        ├── invitationService.ts           # ~ requireCommunityAdministrator() gains an
        │                                   #      operationalEpoch filter and a
        │                                   #      Community.status === "ACTIVE" check
        │                                   #      (research.md #8, #15); + promoteMember() for the
        │                                   #      new community-administrator-delegation route
        │                                   #      (User Story 6 — no MASTER involved); email-change
        │                                   #      handling explicitly leaves Invitation rows untouched
        │                                   #      (research.md #14, FR-045)
        ├── listingService.ts              # ~ requireCommunityMembership() gains the same
        │                                   #      operationalEpoch filter; existing listing
        │                                   #      read/write paths gain the SUSPENDED/ARCHIVED
        │                                   #      gating table (research.md #15, data-model.md);
        │                                   #      new-listing creation stamps operationalEpoch
        │                                   #      from the community's current value
        ├── messageService.ts              # ~ same operationalEpoch-filter addition wherever it
        │                                   #      currently calls requireCommunityMembership();
        │                                   #      new-thread creation stamps operationalEpoch
        └── accountService.ts              # ~ signInWithPassword()/getValidSession() (via
                                             #      sessionService.ts) add status === "ACTIVE" &&
                                             #      deletedAt === null (research.md #9)

app/
├── master/
│   ├── sign-in/page.tsx                   # new
│   ├── change-password/page.tsx           # new: shown when mustChangePassword is true
│   ├── page.tsx                           # new: dashboard — navigation only, no analytics (FR-021)
│   ├── masters/page.tsx                   # new: list + create + disable/reactivate/reset
│   ├── communities/
│   │   ├── page.tsx                       # new: list, filterable by status
│   │   ├── new/page.tsx                   # new: create (both founder modes)
│   │   └── [communityId]/page.tsx         # new: detail — edit, suspend/reactivate/restore,
│   │                                       #      membership promote/remove
│   ├── accounts/
│   │   ├── page.tsx                       # new: list + search
│   │   └── [accountId]/page.tsx           # new: edit, suspend/reactivate/reset/delete
│   └── audit-log/page.tsx                 # new: filterable, paginated
└── api/
    ├── master/
    │   ├── sign-in/route.ts               # new
    │   ├── sign-out/route.ts              # new
    │   ├── change-password/route.ts       # new
    │   ├── masters/
    │   │   ├── route.ts                   # new: POST create, GET list
    │   │   └── [masterId]/
    │   │       ├── disable/route.ts       # new
    │   │       ├── reactivate/route.ts    # new
    │   │       └── reset-password/route.ts # new
    │   ├── communities/
    │   │   ├── route.ts                   # new: POST create, GET list
    │   │   └── [communityId]/
    │   │       ├── route.ts               # new: GET detail, PATCH edit
    │   │       ├── suspend/route.ts       # new
    │   │       ├── reactivate/route.ts    # new
    │   │       ├── restore/route.ts       # new
    │   │       └── memberships/[membershipId]/
    │   │           ├── promote/route.ts   # new
    │   │           └── remove/route.ts    # new
    │   ├── accounts/
    │   │   ├── route.ts                   # new: GET list
    │   │   └── [accountId]/
    │   │       ├── route.ts               # new: PATCH edit
    │   │       ├── suspend/route.ts       # new
    │   │       ├── reactivate/route.ts    # new
    │   │       ├── reset-password/route.ts # new
    │   │       └── delete/route.ts        # new
    │   └── audit-log/route.ts             # new: GET, filtered/paginated
    └── communities/
        └── [communityId]/
            └── memberships/[membershipId]/
                └── promote/route.ts       # new: community-administrator delegation
                                            #      (User Story 6 — not under /master)

scripts/
├── bootstrap-master.ts                    # new (research.md #5)
└── archive-suspended-communities.ts       # new (research.md #7), scheduled via Dokploy cron

tests/
├── unit/
│   └── test_master_bootstrap_not_networked.ts  # new: architectural test mirroring
│                                                #      test_community_creation_not_networked.ts
├── contract/
│   ├── test_master_auth.ts                # new: masterAuthService.ts + masterSessionService.ts
│   ├── test_community_lifecycle.ts         # new: communityLifecycleService.ts (all four
│                                            #      transitions, idempotency; asserts archival
│                                            #      touches zero Listing/MessageThread/Invitation/
│                                            #      Membership rows; asserts restoration increments
│                                            #      operationalEpoch and moves exactly one
│                                            #      Membership row to it, research.md #8)
│   ├── test_master_administration.ts       # new: masterAdministrationService.ts (community +
│                                            #      account management, orphan guards)
│   ├── test_audit_log.ts                   # new: auditService.ts — writer discipline (a SUCCESS
│                                            #      write commits atomically with its mutation; a
│                                            #      FAILURE write for a rejected guard survives that
│                                            #      guard's own transaction rollback, research.md #6),
│                                            #      no-secrets assertion, filter/pagination
│   ├── test_listings.ts                    # ~ + SUSPENDED/ARCHIVED-community gating coverage,
│                                            #      + operationalEpoch stamping-at-creation and
│                                            #      post-restoration-invisibility coverage
│   ├── test_messaging.ts                   # ~ + SUSPENDED-community read/reply-still-works
│                                            #      coverage, + operationalEpoch coverage as above
│   └── test_invitations_membership.ts      # ~ + operationalEpoch membership-filter coverage,
│                                            #      + community-administrator promoteMember(),
│                                            #      + email-change-does-not-retarget-invitation
│                                            #      coverage (FR-045, research.md #14)
└── integration/
    ├── test_master_flow.spec.ts            # new: Playwright — sign-in, forced password change,
    │                                        #      ordinary-account denial, master CRUD
    ├── test_community_lifecycle_flow.spec.ts # new: Playwright — create (both modes),
    │                                          #      suspend/reactivate/restore, member-visible
    │                                          #      effects
    └── test_account_administration_flow.spec.ts # new: Playwright — suspend/reactivate/reset/
                                                    #      delete, orphan-guard UI
```

**Structure Decision**: Five new service files, one per cohesive responsibility (`masterAuthService`, `masterSessionService`, `communityLifecycleService`, `masterAdministrationService`, `auditService`) rather than one monolithic "admin service" — mirrors how 002–008 already split by domain (`accountService`, `sessionService`, `communityService`, `invitationService`, `listingService`, `messageService`) instead of a shared god-service. All five follow the existing `{ ok, reason }` discriminated-union convention. New routes and pages live entirely under a new `app/master/` and `app/api/master/` namespace (research.md #13), keeping every MASTER-only surface in one place a reviewer can audit for the authorization boundary in isolation. The one route that is deliberately *not* under `/master` is community-administrator peer-promotion (User Story 6) — it extends the existing per-community namespace (`app/api/communities/{communityId}/...`), because it is ordinary community self-governance, not platform escalation (Constitution Check, Principle III row). Existing services (`invitationService.ts`, `listingService.ts`, `messageService.ts`, `accountService.ts`/`sessionService.ts`) are extended in place, not forked, since the underlying data they gate has genuinely changed shape (research.md #8, #9) — forking them would let a "membership exists" check and a "membership's epoch is current" check silently drift apart.

## Complexity Tracking

The Principle I and Principle VI items that appeared here in an earlier draft of this plan are no longer listed: Constitution v4.1.0 Principle IX now names both as standing, bounded exceptions in the constitution itself (see Constitution Check above), so they are no longer this feature's own departures to justify — the constitution's own Rationale is the justification. One genuine complexity tradeoff remains:

| Added complexity | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|---------------------------------------|
| `Community.operationalEpoch` plus one `operationalEpoch` column each on `Listing`, `MessageThread`, `Invitation`, and `Membership`, requiring every existing "is this row currently operational" check across 002–008 (`requireCommunityMembership`, `requireCommunityAdministrator`, `getCurrentAccount`, `listMyThreads`/`listMyListings`, the listing-discovery feed, invitation-acceptance lookup) to add an equality filter | Without it, restoring an archived community would silently and automatically hand marketplace access, and visibility of every pre-archive listing/thread/invitation, back to *everyone* the moment `Community.status` returns to `ACTIVE`, directly violating FR-063/FR-064/FR-077/SC-009 — row existence alone cannot distinguish "this row predates the archival" from "this row is current" once both are simply present in the database (research.md #8) | A `Membership.status` (`ACTIVE`/`ARCHIVED`) enum with a bulk update at archival time — this plan's own earlier draft — was rejected on reflection: it only solved the problem for `Membership`, leaving `Listing`/`MessageThread`/`Invitation` needing some *other*, undesigned mechanism for the same requirement, and it required touching every child row at archival time. The epoch column solves all four entities with one mechanism and, in the end, touches *fewer* rows overall (archival touches none; only restoration's one selected `Membership` row is ever updated) — it was chosen because it is the simpler design once every affected entity is counted, not despite Principle VII. |
