---
description: "Task list for Platform Administration"
---

# Tasks: Platform Administration

**Input**: Design documents from `/specs/009-platform-administration/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/platform-administration-api.md](./contracts/platform-administration-api.md), [quickstart.md](./quickstart.md)

**Tests**: Per Constitution v4.1.0 Principles VIII and IX, tests are MANDATORY for this feature's critical flows — MASTER authentication/authorization, first-MASTER bootstrap, last-MASTER/last-administrator guards, managed account provisioning, community suspension/archival/restoration, and administrative audit integrity — regardless of what the spec would otherwise require. Tests MUST be written first and confirmed failing (red) before their corresponding implementation.

**Organization**: Tasks are grouped by user story (spec.md priorities: US1–US5, US8, US9, US11 are P1; US6, US7, US10 are P2). **Sequencing note**: within the P1 tier, phases are ordered by real dependency rather than spec.md's listed story order — User Story 2 (bootstrap) is built before User Story 1 (sign-in), because US1's own Independent Test assumes a MASTER identity already exists to sign in as, and the only real mechanism for creating one is US2's bootstrap. Every other P1 phase follows spec.md's listed order. Within the P2 tier, User Story 5 (built in the P1 block) already creates the core `suspendAccount()`/`deleteAccount()` functions User Story 7 needs (because US5's `removeMembership()` disposition options require them) — User Story 7 generalizes those functions to a dedicated, multi-community-aware account-management surface rather than rebuilding them.

## Path Conventions

Single existing Next.js/Prisma project (extends 002-accounts-authentication through 008-listing-messaging), per plan.md's Structure Decision — no new top-level project. `app/master/*` and `app/api/master/*` are the one new namespace this feature introduces.

---

## Phase 1: Setup (Shared Infrastructure)

- [X] T001 Add to `prisma/schema.prisma` per data-model.md: new models `MasterIdentity`, `MasterSession`, `AdministrativeAuditEntry` (with enums `MasterStatus`, `AuditActorType`, `AuditOutcome`); new fields on `Community` (`status CommunityStatus @default(ACTIVE)`, `suspendedAt`, `suspensionReason`, `archiveScheduledAt`, `archivedAt`, `operationalEpoch Int @default(1)`, plus `CommunityStatus` enum); new fields on `Account` (`status AccountStatus @default(ACTIVE)`, `deletedAt`, plus `AccountStatus` enum); one new `operationalEpoch Int @default(1)` column each on `Listing`, `MessageThread`, `Invitation`, `Membership`. No existing column changed. Run `prisma migrate dev --name add_platform_administration` and `prisma generate`. Never edit the database by hand (constitution: Migrations & Backups).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Infrastructure at least two later stories share, or that every later story's tests rely on for correct read/write gating. No task here has its own user-facing "independent test" — each is verified indirectly by the stories that depend on it.

- [X] T002 [P] Create `src/lib/validation/masterId.ts`: `normalizeMasterId()` (trim + lowercase) and `isValidMasterId()` (non-blank after trim, ≤50 chars, `[a-z0-9._-]+` after normalization) — research.md #3.
- [X] T003 [P] Create `src/lib/auth/masterSessionCookie.ts`: `MASTER_SESSION_COOKIE_NAME = "cmarket_master_session"` and `masterSessionCookieOptions`, mirroring `src/lib/auth/sessionCookie.ts` exactly (research.md #1).
- [X] T004 [P] Create `src/server/services/auditService.ts`: the closed `AdministrativeAction` TypeScript union; `writeAuditEntry(client, entry)` — a single insert via whichever client it's given, with no update/delete export anywhere in the module (data-model.md's Writer discipline, research.md #6). `listAuditEntries()` left for T049 (US11) — this task is the writer only.
- [X] T005 [P] Update `src/server/services/listingService.ts`: `requireCommunityMembership()` now accepts `{ allowSuspended? }`, checks `Community.status` (ARCHIVED always denies; SUSPENDED denies unless `allowSuspended`), and requires the caller's membership `operationalEpoch` to match the community's current one (research.md #8, #15); `createListing()` stamps the new `Listing.operationalEpoch`; `listListings()`/`getListing()`/`getListingPhoto()` pass `{ allowSuspended: true }` and filter by current epoch; `updateListing()`/`addListingPhoto()`/`removeListingPhoto()`/`setCoverPhoto()` gain a `community_not_active` check (FR-053); `pauseListing()` explicitly tolerates SUSPENDED (FR-054), `reactivateListing()` does not (FR-053); `listMyListings()` filters via a per-caller community→epoch map (bounded, not a full-table scan).
- [X] T006 [P] Update `src/server/services/invitationService.ts`: `requireCommunityAdministrator()` gains the same `{ allowSuspended? }`/status/epoch checks as T005; `inviteToCommunity()` stamps `Invitation.operationalEpoch`; `acceptInvitation()` rejects a stale-epoch or non-`ACTIVE`-community invitation and stamps the new `Membership.operationalEpoch`; added `promoteMember()` (User Story 6's core function, built here since it only needed this same primitive — test/route/UI wiring remain in Phase 11).
- [X] T007 [P] Update `src/server/services/messageService.ts`: `sendMessageToListingOwner()`'s top gate tolerates SUSPENDED (reply-safe) but its new-thread branch additionally requires `ACTIVE` and stamps `MessageThread.operationalEpoch`; `sendThreadMessage()`/`listThreads()`/`getThread()` pass `{ allowSuspended: true }` and filter by current epoch; `listMyThreads()` filters via the same per-caller community→epoch map pattern as `listMyListings()`.
- [X] T008 [P] Update `src/lib/auth/currentAccount.ts`: `getCurrentAccount()`'s membership listing filters out any membership whose `operationalEpoch` no longer matches its community's current one.

**Checkpoint**: Foundation ready — schema exists, every ordinary read/write gate correctly distinguishes current-epoch/active-status rows from historical ones, and the audit writer is ready for every later phase to call.

---

## Phase 3: User Story 2 - The initial platform bootstrap establishes the first MASTER safely (Priority: P1)

**Goal**: An authorized operator can create exactly one first MASTER through documented tooling outside the application, and the tooling refuses to create an uncontrolled second bootstrap identity.

**Independent Test**: Run the bootstrap against an installation with zero MASTER identities, confirm exactly one active MASTER is created, then run it again and confirm it refuses to create a second one.

### Tests ⚠️ Write first, confirm red

- [X] T009 [US2] Write `tests/contract/test_master_auth.ts`: `createMaster({ masterId, email, createdByMasterId: null })` against an empty `MasterIdentity` table creates exactly one row (`status: ACTIVE`, `mustChangePassword: true`, `createdByMasterId: null`) and writes a `SUCCESS` audit entry in the same transaction (FR-007, FR-008); calling it again against a non-empty table is rejected and writes an independent `FAILURE` audit entry, confirmed present via a direct `prisma.administrativeAuditEntry.findMany()` even though no new `MasterIdentity` row exists (research.md #6's worked example); invalid `masterId`/`email` are rejected (`invalid_master_id`/`invalid_email`); an `email` already used by an existing `Account` is rejected (`email_already_in_use`, research.md #4). Confirm this file FAILS (red) — `masterAuthService.ts` doesn't exist yet.

### Implementation

- [X] T010 [US2] Create `src/server/services/masterAuthService.ts`: `createMaster({ masterId, email, createdByMasterId })` — validates via `normalizeMasterId()`/`isValidMasterId()` (T002) and `isValidEmail()`/`normalizeEmail()` (existing `email.ts`), checks the target `masterId` and both `MasterIdentity.email`/`Account.email` for uniqueness (research.md #4), generates a temporary password (`randomBytes(16).toString("base64url")`) and hashes it via existing `hashPassword()`, inserts the `MasterIdentity` row and writes the `SUCCESS` audit entry inside one `prisma.$transaction` (T004's `writeAuditEntry(tx, ...)`); on any validation/uniqueness rejection, writes an independent `FAILURE` audit entry via the plain `prisma` client before returning `{ ok: false, reason }` (research.md #6). Returns `{ ok: true, master: { id, masterId }, temporaryPassword }` on success. Confirm T009 passes (green).
- [X] T011 [US2] Create `scripts/bootstrap-master.ts` (tsx CLI, research.md #5): parses `--master-id`/`--email` args, refuses with a clear message unless `prisma.masterIdentity.count() === 0`, then calls `createMaster({ ..., createdByMasterId: null })` and prints the resulting `masterId` and one-time `temporaryPassword` to the console.
- [X] T012 [P] [US2] Write `tests/unit/test_master_bootstrap_not_networked.ts`, mirroring `tests/unit/test_community_creation_not_networked.ts`: scan `app/` for any import of `masterAuthService`'s `createMaster` or any reference to `scripts/bootstrap-master.ts`, and assert none exists — the bootstrap path MUST remain unreachable from any user-facing route (FR-007).

**Checkpoint**: The first MASTER can be created safely and exactly once; nothing in `app/` can reach the bootstrap path.

---

## Phase 4: User Story 1 - A dedicated MASTER signs in to a separate administration area (Priority: P1) 🎯 MVP

**Goal**: A MASTER signs in with a Master ID and password, reaches a platform-administration area separate from the marketplace, and is denied from every marketplace action; an ordinary account (including a community administrator) is denied from every MASTER route.

**Independent Test**: Using a MASTER identity created via Phase 3's bootstrap, sign in, verify access to the administration area, and verify that identity is denied from marketplace membership, listing, invitation, discovery, and messaging actions; verify an ordinary account is denied from every MASTER route.

### Tests ⚠️ Write first, confirm red

- [X] T013 [US1] Extend `tests/contract/test_master_auth.ts`: `signInAsMaster(masterId, password)` succeeds for a valid `ACTIVE` identity (creates a `MasterSession`, returns `mustChangePassword`); wrong `masterId`, wrong password, and a `DISABLED` identity all return the same generic `invalid_credentials` (Story 1 Scenarios 2/5, research.md #11's anti-enumeration parity with `signInWithPassword`); `changeMasterPassword(masterId, currentPassword, newPassword)` clears `mustChangePassword` on success, rejects a wrong `currentPassword` (`invalid_current_password`), and rejects a weak `newPassword` via the existing `validatePassword()` (`invalid_password`). Confirm these cases FAIL (red).
- [X] T014 [US1] Write `tests/contract/test_master_session.ts`: `createMasterSession(masterId)` then `getValidMasterSession(rawToken)` returns the master; an expired session returns `null` and is deleted on lookup (mirrors `sessionService.ts`'s `findSessionWithAccount`); `getValidMasterSession()` for a token belonging to a since-`DISABLED` identity returns `null`; `deleteMasterSession(rawToken)` removes exactly that row. Confirm FAILS (red) — `masterSessionService.ts` doesn't exist yet.

### Implementation

- [X] T015 [US1] Create `src/server/services/masterSessionService.ts`, mirroring `sessionService.ts`'s SHA-256 `hashToken()` pattern (research.md #2): `generateMasterSessionToken()`, `createMasterSession(masterId, rawToken?, expiresAt?)`, `getValidMasterSession(rawToken)` (joins `MasterIdentity`, returns `null` if missing/expired/`DISABLED`), `deleteMasterSession(rawToken)`. Confirm T014 passes (green).
- [X] T016 [US1] Extend `masterAuthService.ts`: `signInAsMaster(masterId, password)` — normalizes `masterId`, looks up the identity, returns generic `{ ok: false, reason: "invalid_credentials" }` for not-found/wrong-password/`DISABLED` (never distinguishing which), otherwise calls `createMasterSession()` (T015) and returns `{ ok: true, sessionToken, expiresAt, mustChangePassword }`; `changeMasterPassword(masterId, currentPassword, newPassword)` — verifies `currentPassword` via `verifyPassword()`, validates `newPassword` via `validatePassword()`, updates `passwordHash` and clears `mustChangePassword`. Confirm T013 passes (green).
- [X] T017 [US1] Create `src/lib/auth/currentMaster.ts`, mirroring `currentAccount.ts`: `getCurrentMaster()` (reads the `cmarket_master_session` cookie via T003, calls `getValidMasterSession()`, returns `{ masterId, masterIdValue, email, mustChangePassword } | null`) and `requireMaster()` (throws/returns a `401`-shaped result when `getCurrentMaster()` is `null` — used by every `/master`/`/api/master` page and route from here on).
- [X] T018 [P] [US1] Create `app/api/master/sign-in/route.ts` (`POST`, calls `signInAsMaster()`, sets the T003 cookie, maps to `200`/`401` per contracts/platform-administration-api.md), `app/api/master/sign-out/route.ts` (`POST`, calls `deleteMasterSession()`, clears the cookie), and `app/api/master/change-password/route.ts` (`POST`, calls `changeMasterPassword()`, reachable even when `mustChangePassword` is `true`).
- [X] T019 [P] [US1] Create `app/master/sign-in/page.tsx` (Master ID + password form, posts to T018's sign-in route), `app/master/change-password/page.tsx` (current/new password form, posts to T018's change-password route), and `app/master/page.tsx` (dashboard shell — navigation only, no analytics per FR-021 — gated by `requireMaster()`).
- [X] T020 [US1] Wire `app/master/page.tsx` (and every other `/master/*` page added in later phases) to redirect server-side to `/master/change-password` whenever `requireMaster()` reports `mustChangePassword === true` (FR-010) — implement as a small shared helper called at the top of each page rather than duplicated per page.

### Tests ⚠️ Write first, confirm red

- [X] T021 [US1] Write `tests/integration/test_master_flow.spec.ts` (Playwright): sign in with the bootstrap MASTER's credentials, confirm redirect to the forced password-change screen, complete it, confirm dashboard access; sign out and confirm the dashboard is no longer reachable. Separately: sign in as an existing ordinary `Account` (including a community administrator) and confirm `/master` and every `/api/master/*` route return a denial with no administrative data. Confirm FAILS (red) — none of the pages/routes exist to drive yet.

**Checkpoint**: MASTER sign-in, forced password change, sign-out, and marketplace-account denial are all verified — this is the platform-administration entry point every later phase builds on.

---

## Phase 5: User Story 3 - A MASTER creates and manages another MASTER identity (Priority: P1)

**Goal**: An active MASTER creates a new dedicated MASTER identity, which must change its temporary password before doing anything else, and can later be disabled, reactivated, or issued a new temporary password — subject to the last-MASTER and self-disable guards.

**Independent Test**: Have MASTER A create MASTER B, confirm B cannot act before changing its temporary password, complete the change, then disable and reactivate B while verifying the last-MASTER and self-disable guards.

### Tests ⚠️ Write first, confirm red

- [X] T022 [US3] Extend `tests/contract/test_master_auth.ts`: an authenticated MASTER's `createMaster({ ..., createdByMasterId: callerMasterId })` records who created it (User Story 2 Scenario 3, now exercised via this path); `disableMaster(callerMasterId, targetMasterId)` disables an eligible target and deletes every `MasterSession` for it; disabling the caller itself is rejected (`cannot_disable_self`) with an independent `FAILURE` audit entry and the target's `status` unchanged in the database (research.md #6's worked example, verified directly); disabling the last remaining `ACTIVE` master is rejected (`last_active_master`) the same way; `reactivateMaster()` restores sign-in eligibility; `resetMasterPassword()` issues a new temporary password, sets `mustChangePassword: true`, and deletes every existing `MasterSession` for the target. Confirm FAILS (red).

### Implementation

- [X] T023 [US3] Extend `masterAuthService.ts`: `disableMaster(callerMasterId, targetMasterId)` — inside one `$transaction`: reject if `targetMasterId === callerMasterId` (writes an independent `FAILURE` entry via plain `prisma` and returns before opening the transaction); otherwise count `ACTIVE` masters, reject if the count would drop to zero (independent `FAILURE` entry after the transaction aborts), else update `status: "DISABLED"`, delete every `MasterSession` for the target (extend `masterSessionService.ts`, T015, with `deleteAllMasterSessions(masterId)`), and write the `SUCCESS` entry with `tx` (research.md #6, #11 — this function is research.md #6's own worked example). `reactivateMaster(callerMasterId, targetMasterId)` — sets `status: "ACTIVE"`. `resetMasterPassword(callerMasterId, targetMasterId)` — generates and hashes a new temporary password, sets `mustChangePassword: true`, calls `deleteAllMasterSessions()`. Confirm T022 passes (green).
- [X] T024 [P] [US3] Create `app/api/master/masters/route.ts` (`POST` create via `createMaster()` with the caller's `masterId`, `GET` list — paginated per SC-012), and `app/api/master/masters/[masterId]/disable/route.ts`, `reactivate/route.ts`, `reset-password/route.ts`, each mapping to the T023 functions and the response shapes in contracts/platform-administration-api.md.
- [X] T025 [P] [US3] Create `app/master/masters/page.tsx`: list of existing masters (id, status, createdAt, createdBy) with a create form and disable/reactivate/reset-password actions per row, gated by `requireMaster()` (T017).

### Tests ⚠️ Write first, confirm red

- [X] T026 [US3] Extend `tests/integration/test_master_flow.spec.ts`: MASTER A creates MASTER B via the UI, confirm B's shown temporary password signs in and is immediately forced through the password-change screen before any other administrative action succeeds; A disables B, confirm B's existing session is rejected on its next request and sign-in with valid-but-disabled credentials fails; A reactivates B; A attempts to disable itself (rejected, UI shows the guard's reason); with only A remaining active, A attempts to disable A (still rejected — belt-and-suspenders with the self-disable case, but also exercises the last-MASTER path once B is disabled again). Confirm FAILS (red) — no masters UI exists yet.

**Checkpoint**: Full MASTER lifecycle management (create, forced first password change, disable/reactivate/reset, last-MASTER and self-disable guards) is verified end to end.

---

## Phase 6: User Story 4 - A MASTER creates a community with a usable founding administrator (Priority: P1)

**Goal**: A MASTER creates a community and, in the same atomic action, assigns its first administrator by selecting an existing verified account or provisioning a new one.

**Independent Test**: Create one community using an existing verified account and another using a new account, then assert each community has exactly one founding administrator membership and no partial community/account/membership state survives any failed attempt.

### Tests ⚠️ Write first, confirm red

- [X] T027 [US4] Write `tests/contract/test_community_lifecycle.ts`: `createCommunityAsMaster()` with `administrator: { mode: "existing", email }` against an existing verified account creates the `Community` (`operationalEpoch: 1`) and its `ADMINISTRATOR` `Membership` (`operationalEpoch: 1`) atomically, and the MASTER itself receives no `Membership` row; the same with `mode: "provision"` against an email with no existing account creates a new, already-verified `Account` (`emailVerifiedAt` set, no `VerificationToken` row created — research.md #10) with a temporary password, plus the community and membership, all atomically; rejections: `invalid_name`, `account_not_found` (existing mode, no such account), `account_not_verified` (existing mode, unverified account), `account_already_exists` (provision mode, email already has an account); a simulated mid-operation failure (e.g. throwing after the `Account` insert but before `Community` insert, using Prisma's transaction rollback) leaves zero rows behind (FR-026); each success writes one `SUCCESS` audit entry, each rejection an independent `FAILURE` entry. Confirm FAILS (red) — `communityLifecycleService.ts` doesn't exist yet.

### Implementation

- [X] T028 [US4] Create `src/server/services/communityLifecycleService.ts`: `createCommunityAsMaster({ callerMasterId, name, administrator })` — inside one `$transaction`: validate `name`; for `mode: "existing"`, look up the `Account` by normalized email, reject if missing/unverified; for `mode: "provision"`, reject if an `Account` already exists for that email, otherwise create one with `emailVerifiedAt: now()`, a hashed generated temporary password, and no `VerificationToken` row (research.md #10); create the `Community` (`operationalEpoch: 1`) and its `ADMINISTRATOR` `Membership` (`operationalEpoch: 1`); write the `SUCCESS` audit entry with `tx`. Validation rejections detected before the transaction opens write an independent `FAILURE` entry via plain `prisma`. Confirm T027 passes (green).
- [X] T029 [P] [US4] Create `app/api/master/communities/route.ts` — `POST` calls `createCommunityAsMaster()`, `GET` lists communities (minimal shape here; full filtering/pagination lands in Phase 7) — per contracts/platform-administration-api.md.
- [X] T030 [P] [US4] Create `app/master/communities/new/page.tsx` — a form supporting both founder modes (existing-account email vs. provision-new email+displayName), gated by `requireMaster()`.

### Tests ⚠️ Write first, confirm red

- [X] T031 [US4] Write `tests/integration/test_community_lifecycle_flow.spec.ts` (Playwright): as a MASTER, create a community selecting an existing verified account as founder, confirm it appears with exactly one administrator; create a second community choosing "provision new," sign in as that newly provisioned administrator using the shown temporary password, confirm normal access to that one community and no access to any other; confirm the MASTER's own account never appears in either community's member list. Confirm FAILS (red) — no community-creation UI exists yet.

**Checkpoint**: Community creation, both founder modes, atomic and audited, is verified end to end.

---

## Phase 7: User Story 5 - A MASTER manages communities and their administrators from outside (Priority: P1)

**Goal**: A MASTER can list every community, inspect its state and members, edit its information, add or remove administrators, remove members, and perform account-level actions without becoming a member of that community.

**Independent Test**: Have a MASTER edit a community, promote a member, remove another administrator with an explicit disposition choice, and revoke a member, while confirming the MASTER never gains a Membership and every action is audited.

### Tests ⚠️ Write first, confirm red

- [X] T032 [US5] Write `tests/contract/test_master_administration.ts`: `listCommunitiesForMaster()`/`getCommunityForMaster()` return every community regardless of state, with memberships including a derived `isCurrent` boolean (`operationalEpoch === community.operationalEpoch`, never a stored status — data-model.md), without creating any `Membership` for the caller MASTER; `editCommunity()` updates permitted fields and the audit entry records prior/new values; `promoteMembership()` sets `role: ADMINISTRATOR` for a current member, rejects a non-current/other-community/non-member target; `removeMembership()` supports all four dispositions (`demote`, `revoke_membership`, `disable_account`, `delete_account`) and rejects (`would_orphan_community`) removing a community's last active administrator unless a `replacementAdministratorMembershipId` is supplied in the same request; the `disable_account`/`delete_account` dispositions call through to this same file's `suspendAccount()`/`deleteAccount()` (built in this task) and are scoped to the one affected community's orphan check. Confirm FAILS (red).

### Implementation

- [X] T033 [US5] Create `src/server/services/masterAdministrationService.ts`: `listCommunitiesForMaster({ status?, cursor? })` (paginated, filterable by `Community.status`); `getCommunityForMaster(communityId)` (community + memberships, each with `isCurrent`); `editCommunity(callerMasterId, communityId, { name? })` (updates + audit with before/after); `promoteMembership(callerMasterId, communityId, membershipId)`; `removeMembership(callerMasterId, communityId, membershipId, { disposition, replacementAdministratorMembershipId? })` — for `demote`/`revoke_membership`, apply directly (with the orphan guard: reject if this would leave zero active administrators for `communityId` and no replacement was supplied in the same call); for `disable_account`/`delete_account`, call this same file's new `suspendAccount(callerMasterId, accountId, { replacementAdministratorAssignments })`/`deleteAccount(callerMasterId, accountId, { replacementAdministratorAssignments })` (research.md #9 — soft suspend/soft delete, scoped here to the one community being acted on; User Story 7 generalizes these to accept assignments across multiple communities). Every mutation follows the SUCCESS-atomic/FAILURE-independent audit discipline (research.md #6). Confirm T032 passes (green).
- [X] T034 [P] [US5] Create `app/api/master/communities/[communityId]/route.ts` (`GET` detail, `PATCH` edit), `app/api/master/communities/[communityId]/memberships/[membershipId]/promote/route.ts`, and `app/api/master/communities/[communityId]/memberships/[membershipId]/remove/route.ts`, per contracts/platform-administration-api.md. Also extend T029's `GET /api/master/communities` list route with the full `status` filter and pagination now that `listCommunitiesForMaster()` exists.
- [X] T035 [P] [US5] Create `app/master/communities/page.tsx` (list, filterable by status, links to detail) and `app/master/communities/[communityId]/page.tsx` (detail: edit form, member list with `isCurrent` marking, promote/remove actions with the four-disposition picker).

### Tests ⚠️ Write first, confirm red

- [X] T036 [US5] Extend `tests/integration/test_community_lifecycle_flow.spec.ts`: as a MASTER, edit a community's name and confirm it's reflected in the marketplace; promote an existing member to administrator; with two administrators present, remove one choosing `revoke_membership` and confirm their other memberships/account are untouched; with exactly one administrator remaining, attempt removal without a replacement and confirm rejection; confirm the MASTER never appears in the community's member list at any point. Confirm FAILS (red).

**Checkpoint**: Community/administrator management from outside — including all four account dispositions and the orphan guard — is verified end to end.

---

## Phase 8: User Story 8 - A community enters a reversible 30-day suspension (Priority: P1)

**Goal**: A MASTER suspends a community; existing members retain read/reply access to existing content, but no growth or new publishing can occur, and reactivation before the 30-day deadline fully restores normal function.

**Independent Test**: Suspend an active community and verify existing listings remain viewable and existing threads remain writable, while listing creation, listing editing, invitations, membership acceptance, promotions, and other growth actions are blocked.

### Tests ⚠️ Write first, confirm red

- [X] T037 [US8] Extend `tests/contract/test_community_lifecycle.ts`: `suspendCommunity(callerMasterId, communityId, reason)` records `suspendedAt`/`suspensionReason`/`archiveScheduledAt = suspendedAt + 30d`, rejects a blank `reason` (`invalid_reason`) and a non-`ACTIVE` community (`not_active` — including re-suspending an already-`SUSPENDED` one, confirming `archiveScheduledAt` is NOT pushed forward, FR-056); `reactivateCommunity(callerMasterId, communityId)` clears those fields and returns to `ACTIVE`, rejects a non-`SUSPENDED` community (`not_suspended`). Confirm FAILS (red).
- [X] T038 [US8] Extend `tests/contract/test_listings.ts` and `tests/contract/test_messaging.ts`: against a `SUSPENDED` community, an existing `ACTIVE` listing remains fetchable and an existing thread accepts a new reply, but creating a new listing, creating a new thread, and reactivating a paused listing are all rejected; pausing an existing `ACTIVE` listing is still allowed. Confirm FAILS (red) — the current gate functions (T005/T007) only check `status !== ARCHIVED`-equivalent broadly, not this specific per-action table yet.

### Implementation

- [X] T039 [US8] Extend `communityLifecycleService.ts`: `suspendCommunity()`/`reactivateCommunity()` — each a single `$transaction` touching only `Community` fields (no child rows, research.md #8), with the SUCCESS-atomic/FAILURE-independent audit discipline. Confirm T037 passes (green).
- [X] T040 [US8] Extend `listingService.ts` and `messageService.ts` (built on T005/T007's primitives) with the exact per-action gating table from data-model.md: viewing an existing listing and replying in an existing thread require `Community.status IN (ACTIVE, SUSPENDED)`; creating a listing, creating a thread, and reactivating a paused listing require `Community.status === ACTIVE`; pausing an existing listing requires only that the caller owns it (unaffected by suspension, FR-054). Confirm T038 passes (green).
- [X] T041 [P] [US8] Create `app/api/master/communities/[communityId]/suspend/route.ts` and `reactivate/route.ts`.
- [X] T042 [P] [US8] Update `app/master/communities/[communityId]/page.tsx` (T035) with suspend (reason input) and reactivate actions, shown according to the community's current `status`.

### Tests ⚠️ Write first, confirm red

- [X] T043 [US8] Extend `tests/integration/test_community_lifecycle_flow.spec.ts`: suspend a community with an existing listing and thread, confirm both remain viewable/writable while new-listing/new-thread/new-invitation/promotion attempts are all blocked and pausing/reactivating a listing behaves per the table above; reactivate before the deadline and confirm normal function resumes; confirm a community administrator (not a MASTER) cannot reactivate directly. Confirm FAILS (red).

**Checkpoint**: The suspension lifecycle — entry, effect on existing vs. new content, and reactivation — is verified end to end.

---

## Phase 9: User Story 9 - A suspended community archives automatically without losing history (Priority: P1)

**Goal**: A suspended community that is not reactivated within 30 days is archived automatically, disappearing from the marketplace while every record is retained for MASTER inspection.

**Independent Test**: Advance a suspended community past its deadline, run the archival process, and verify marketplace access ends, all records remain retained, and duplicate/repeated processing is harmless.

### Tests ⚠️ Write first, confirm red

- [X] T044 [US9] Extend `tests/contract/test_community_lifecycle.ts`: `archiveDueSuspendedCommunities()` transitions a community whose `archiveScheduledAt` has passed while still `SUSPENDED` to `ARCHIVED`, touching zero `Listing`/`MessageThread`/`Invitation`/`Membership` rows (confirmed via direct queries before/after — research.md #8) and writing one `SYSTEM`-actor `SUCCESS` audit entry; re-running it against the same now-`ARCHIVED` community is a no-op with no duplicate audit entry (FR-058); a community reactivated before its deadline is untouched by a later run of its now-stale scheduled job. Confirm FAILS (red).
- [X] T045 [US9] Extend `tests/contract/test_listings.ts`, `tests/contract/test_messaging.ts`, and `tests/contract/test_invitations_membership.ts`: every ordinary read/write path (listing view, thread view/reply, invitation lookup/acceptance, membership checks) rejects identically to not-found against an `ARCHIVED` community (FR-059) — this should already pass given T005-T007's `Community.status === ACTIVE` requirement for growth actions plus this phase's read-path table (T040), confirming no gap exists specifically for the `ARCHIVED` state; add any missing case found.

### Implementation

- [X] T046 [US9] Extend `communityLifecycleService.ts`: `archiveDueSuspendedCommunities()` — for each `SUSPENDED` community with `archiveScheduledAt <= now()`, one `$transaction` per community that re-verifies `status === SUSPENDED` and the deadline before flipping to `ARCHIVED` (FR-058's idempotency, research.md #7), writing the `SUCCESS` entry with `actorType: SYSTEM`. Confirm T044 passes (green).
- [X] T047 [US9] Create `scripts/archive-suspended-communities.ts` (tsx CLI wrapping T046, intended to run on a Dokploy-scheduled cron per research.md #7 — no in-process scheduler is added).

### Tests ⚠️ Write first, confirm red

- [X] T048 [US9] Extend `tests/integration/test_community_lifecycle_flow.spec.ts`: suspend a community, force its `archiveScheduledAt` into the past via direct test-database manipulation (quickstart.md Scenario 8 — no clock-mocking dependency needed), run the archival script, confirm a former member is denied ordinary access while a MASTER still sees full history via `app/master/communities/[communityId]/page.tsx`; re-run the script and confirm no error/duplicate; suspend and reactivate a second community before its deadline, then run the script, confirming no change to that one. Confirm FAILS (red).

**Checkpoint**: Automatic archival, its idempotency, and full retention are verified end to end.

---

## Phase 10: User Story 11 - Every platform-administration action is auditable (Priority: P1)

**Goal**: A MASTER can inspect a filterable, paginated log of every platform-administration action — including rejected attempts and the automatic archival transition — with no secrets ever exposed.

**Independent Test**: Execute representative MASTER operations, verify one immutable record per attempted action, and verify failed actions, automatic archival, and bootstrap events are also traceable.

### Tests ⚠️ Write first, confirm red

- [X] T049 [US11] Write `tests/contract/test_audit_log.ts`: `listAuditEntries({ from?, to?, actorMasterId?, action?, targetType?, targetId?, cursor? })` filters entirely via database `WHERE` clauses (assert via a large fixture set that an unfiltered call would return, then confirm each filter narrows correctly) and paginates without loading the full table (SC-012); seed entries from every prior phase's representative actions (a bootstrap, a rejected last-MASTER-disable attempt, a community suspend, the `SYSTEM`-actor archival transition) and confirm each is present with correct actor/target/outcome/timestamp; scan every entry's `detail` JSON for password/hash/token-shaped substrings and confirm none exist (FR-070, FR-071 — no update/delete method exists on the module at all, confirmed by inspecting `auditService.ts`'s exports). Confirm FAILS (red) — `listAuditEntries()` doesn't exist yet (T004 built only the writer).

### Implementation

- [X] T050 [US11] Extend `auditService.ts`: `listAuditEntries()` per T049 — cursor-based pagination, each filter parameter translated to a Prisma `where` clause, never an in-memory filter (FR-073, SC-012). Confirm T049 passes (green).
- [X] T051 [P] [US11] Create `app/api/master/audit-log/route.ts` (`GET`, filtered/paginated per contracts/platform-administration-api.md).
- [X] T052 [P] [US11] Create `app/master/audit-log/page.tsx` (filter controls for date range/actor/action/target, paginated table), gated by `requireMaster()`.

### Tests ⚠️ Write first, confirm red

- [X] T053 [US11] Extend `tests/integration/test_master_flow.spec.ts`: with only one active MASTER remaining, attempt to disable it via the UI (rejected), then visit the audit log, filter to that action, and confirm the `FAILURE` entry is present with its reason — demonstrating the audit record survives the rejected mutation's own rollback (research.md #6, quickstart.md Scenario 10); confirm an ordinary account or community administrator cannot reach `/master/audit-log` or `/api/master/audit-log`. Confirm FAILS (red).

**Checkpoint**: All eight P1 user stories (US1, US2, US3, US4, US5, US8, US9, US11) are independently verified. This is a complete, shippable P1 increment.

---

## Phase 11: User Story 6 - Community administrators can share administration safely (Priority: P2)

**Goal**: An active community administrator can promote an existing active member of the same community to administrator, without any MASTER involvement.

**Independent Test**: Have an administrator promote an active member, confirm both can perform administrator actions, then verify that neither can remove the last remaining administrator.

### Tests ⚠️ Write first, confirm red

- [X] T054 [US6] Extend `tests/contract/test_invitations_membership.ts`: `promoteMember(callerAccountId, communityId, membershipId)` succeeds when the caller is a current active administrator and the target is a current active member of the *same* community; rejects a caller who isn't a current administrator (`not_administrator`), a target who isn't a current member of that community (`not_eligible`, including a non-current/other-community/no-membership target), and any attempt while the community is `SUSPENDED` or `ARCHIVED` (`community_not_active`); confirm the existing `revokeMembership()` (spec 004) also now rejects while the community is `SUSPENDED`/`ARCHIVED` (closing the gap left by Foundational T006, which only updated `requireCommunityAdministrator()` itself — `revokeMembership()`'s own inline checks need the same community-status gate). Confirm FAILS (red).

### Implementation

- [X] T055 [US6] Extend `invitationService.ts`: `promoteMember(callerAccountId, communityId, membershipId)` — reuses `requireCommunityAdministrator()` (T006, already epoch/status-aware) for the caller, verifies the target membership is current (`operationalEpoch` match) and belongs to `communityId`, sets `role: ADMINISTRATOR`. Add the same `Community.status === ACTIVE` check directly to `revokeMembership()`'s existing guard clause if not already covered transitively. Confirm T054 passes (green).
- [X] T056 [P] [US6] Create `app/api/communities/[communityId]/memberships/[membershipId]/promote/route.ts` (the existing per-community namespace — not `/master`, per plan.md's Structure Decision).
- [X] T057 [P] [US6] Add a "Promote to administrator" action to the existing community administration UI (`app/communities/[communityId]/admin/page.tsx`), visible only to current administrators for current members.

### Tests ⚠️ Write first, confirm red

- [X] T058 [US6] Extend `tests/integration/test_invitation_membership_flow.spec.ts`: an administrator promotes an existing member via the UI, confirm both accounts can now perform administrator actions (e.g. issuing an invitation), confirm neither can remove the other if doing so would leave zero active administrators, and confirm the promote action is unavailable/rejected while the community is suspended. Confirm FAILS (red).

**Checkpoint**: Peer administrator delegation, entirely outside the MASTER surface, is verified end to end.

---

## Phase 12: User Story 7 - A MASTER fully manages ordinary accounts with explicit consequences (Priority: P2)

**Goal**: A MASTER can inspect, create, edit, suspend, reactivate, reset credentials for, and permanently delete ordinary accounts, with explicit handling of memberships and retained marketplace history — generalizing Phase 7's single-community account actions to a dedicated, multi-community-aware surface.

**Independent Test**: Create an ordinary account with memberships and content, exercise edit, suspension, reset, and deletion flows, and verify access, ownership attribution, last-admin protection, and audit preservation.

### Tests ⚠️ Write first, confirm red

- [X] T059 [US7] Extend `tests/contract/test_master_administration.ts`: `listAccountsForMaster({ search?, cursor? })` (paginated); `editAccount()` (displayName/email, case-insensitive uniqueness, and — critically — confirm changing `email` does NOT transfer, rewrite, or retarget any existing `Invitation` row: a pending invitation issued to the old email remains bound to it and is unaffected — FR-045, research.md #14); `reactivateAccount()`; `resetAccountPassword()` (new temporary password shown once, all sessions revoked); `deleteAccount()` (soft delete per research.md #9: `deletedAt` set, `email` overwritten with a freed synthetic value, `passwordHash` cleared, every `AuthIdentity`/`Session`/`VerificationToken` row deleted, the `Account` row and every FK to it — `Listing.ownerId`, `Message.senderId`, `Membership.accountId`, `Invitation.invitedBy` — retained); `suspendAccount()`/`deleteAccount()` (already built in T033) generalized to accept `replacementAdministratorAssignments` spanning *multiple* affected communities at once (FR-046, FR-047), rejecting with every affected community identified when assignments are missing or incomplete. Confirm FAILS (red).

### Implementation

- [X] T060 [US7] Extend `masterAdministrationService.ts`: `listAccountsForMaster()`, `editAccount()`, `reactivateAccount()`, `resetAccountPassword()`; generalize T033's `suspendAccount()`/`deleteAccount()` to accept and require a `replacementAdministratorAssignments` array spanning every community the account currently administers alone (not just the one T033 originally scoped to); `deleteAccount()`'s soft-delete per research.md #9. Also extend `src/server/services/accountService.ts` (`signInWithPassword`) and `sessionService.ts` (`getValidSession`) to require `status === "ACTIVE" && deletedAt === null` (research.md #9 — this is the first phase that can actually produce a suspended/deleted account to test against). Confirm T059 passes (green).
- [X] T061 [P] [US7] Create `app/api/master/accounts/route.ts` (`GET` list), `app/api/master/accounts/[accountId]/route.ts` (`PATCH` edit), `suspend/route.ts`, `reactivate/route.ts`, `reset-password/route.ts`, `delete/route.ts`, per contracts/platform-administration-api.md.
- [X] T062 [P] [US7] Create `app/master/accounts/page.tsx` (list + search) and `app/master/accounts/[accountId]/page.tsx` (edit form; suspend/reactivate/reset/delete actions with a multi-community impact preview shown before confirmation, FR-047).

### Tests ⚠️ Write first, confirm red

- [X] T063 [US7] Write `tests/integration/test_account_administration_flow.spec.ts` (Playwright): as a MASTER, edit an account's display name/email; suspend it and confirm sign-in is denied; reactivate and confirm sign-in works again; reset its password and confirm the old one fails while the new one-time password works; attempt to suspend/delete an account that alone administers two communities without assignments (rejected, both communities named), then supply valid assignments for both (succeeds, each community retains an active administrator); permanently delete an account with existing listings and messages, confirm its old email is immediately available for a new sign-up, and confirm its historical listings/messages still render (an anonymized reference, never a broken link or another account's identity). Confirm FAILS (red).

**Checkpoint**: Full ordinary-account lifecycle management, including the multi-community orphan guard, is verified end to end.

---

## Phase 13: User Story 10 - A MASTER restores an archived community without reviving its old marketplace activity (Priority: P2)

**Goal**: A MASTER restores an archived community and selects exactly one prior administrator to regain active access; every other historical membership, listing, thread, and invitation remains archived.

**Independent Test**: Archive a populated community, restore it selecting one prior administrator, and verify only that administrator regains access while historical listings, threads, invitations, and all other memberships remain inaccessible.

### Tests ⚠️ Write first, confirm red

- [X] T064 [US10] Extend `tests/contract/test_community_lifecycle.ts`: `restoreCommunity(callerMasterId, communityId, administratorMembershipId)` rejects a non-`ARCHIVED` community (`not_archived`) and a selected membership that either wasn't `ADMINISTRATOR` at the epoch being restored from or whose account is disabled/deleted (`administrator_not_eligible`); on success, increments `Community.operationalEpoch` by exactly 1, sets `status: ACTIVE`, clears `archivedAt`, and updates *only* the selected `Membership.operationalEpoch` to the new value — confirmed directly against the database that every other pre-restoration `Listing`/`MessageThread`/`Invitation`/`Membership` row for that community still carries the *old* epoch, unchanged; a new listing/thread/invitation created after restoration is stamped with the new epoch and behaves normally. Confirm FAILS (red).

### Implementation

- [X] T065 [US10] Extend `communityLifecycleService.ts`: `restoreCommunity()` — one `$transaction`: verify the selected membership's eligibility, increment `operationalEpoch`, clear `archivedAt`, set `status: ACTIVE`, update that one `Membership.operationalEpoch`, write the `SUCCESS` entry with `tx`; rejections write an independent `FAILURE` entry. Confirm T064 passes (green).
- [X] T066 [P] [US10] Create `app/api/master/communities/[communityId]/restore/route.ts`.
- [X] T067 [P] [US10] Update `app/master/communities/[communityId]/page.tsx` (T035/T042) with a restore action, shown only when `status === ARCHIVED`, listing eligible prior administrators to select from.

### Tests ⚠️ Write first, confirm red

- [X] T068 [US10] Extend `tests/integration/test_community_lifecycle_flow.spec.ts`: archive a populated community (reusing Phase 9's flow), restore it selecting one prior administrator, confirm only that account regains access while every other former member/listing/thread/invitation remains invisible through ordinary marketplace routes; confirm the restored administrator can invite new members and create new listings normally from here; confirm restoring a currently-`ACTIVE` or `-SUSPENDED` community is rejected. Confirm FAILS (red).

**Checkpoint**: All eleven user stories are independently verified — the full feature is complete.

---

## Phase 14: Polish & Cross-Cutting Concerns

- [X] T069 [P] Run `npm run typecheck` and `npx eslint .`; fix any issues introduced by this feature.
- [X] T070 [P] Run `npm run test:unit` (covers `tests/unit` and `tests/contract`, including every new/extended file from this feature) and `npm run test:e2e` (Playwright, including every new/extended spec from this feature); confirm the whole suite is green, including a regression check that 002-008's existing tests still pass unmodified.
- [X] T071 Manually execute quickstart.md Scenarios 1-11 end-to-end against the real dev/test PostgreSQL database and a running dev server; record the results against each scenario's expected outcome.
- [X] T072 Re-check plan.md's Constitution Check against the finished implementation: confirm Principle IX holds by inspection — `grep -rn "requireMaster" app/master app/api/master` shows every master page/route gated; `grep -n "Membership" src/server/services/masterAuthService.ts src/server/services/masterAdministrationService.ts` returns no match (MASTER never gains a fabricated Membership); every mutating function in `masterAuthService.ts`/`communityLifecycleService.ts`/`masterAdministrationService.ts` calls `writeAuditEntry()` on every path (success and rejection); a manual scan of a sample of `AdministrativeAuditEntry.detail` values contains no password/hash/token; `operationalEpoch` equality checks are present at every call site research.md #8's "Consequence" note lists; `package.json`/`package-lock.json` are unchanged (no new runtime dependency, Principle VII).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately.
- **Foundational (Phase 2)**: Depends on Phase 1's migration. BLOCKS every user story phase — every later phase's gate-function and stamping correctness relies on T005-T008.
- **Phase 3 (US2, bootstrap)**: Depends on Foundational. Built before US1 because US1's own Independent Test needs a MASTER identity to already exist.
- **Phase 4 (US1, sign-in)**: Depends on Phase 3 (needs a bootstrapped MASTER to sign in as during its own tests) and Foundational (T003's cookie config). BLOCKS every subsequent phase — all of them are reached only through an authenticated MASTER session.
- **Phase 5 (US3, MASTER lifecycle)**: Depends on Phase 4 (`requireMaster()`, T017) and extends `masterAuthService.ts`/`masterSessionService.ts` (T010/T015-T016).
- **Phase 6 (US4, community creation)**: Depends on Phase 4 (`requireMaster()`). Independent of Phase 5.
- **Phase 7 (US5, community/administrator management)**: Depends on Phase 6 (communities must exist to manage) and builds the `suspendAccount()`/`deleteAccount()` core functions Phase 12 (US7) later generalizes.
- **Phase 8 (US8, suspension)**: Depends on Phase 6 (a community to suspend) and extends the Foundational gate functions (T005/T007) with the per-action gating table.
- **Phase 9 (US9, auto-archival)**: Depends on Phase 8 (a suspended community to archive).
- **Phase 10 (US11, audit log)**: Depends on Foundational's writer (T004) having something to show — practically sequenced last among P1 phases so there's a rich set of prior actions to inspect, though it has no strict functional dependency beyond Phase 4 (`requireMaster()` to gate the log itself).
- **Phase 11 (US6, peer promotion)**: Depends only on Foundational (T006) — no MASTER involvement at all. Sequenced here to match spec.md's P2 tier, not because of a technical dependency on Phases 3-10.
- **Phase 12 (US7, account management)**: Depends on Phase 7 (generalizes T033's `suspendAccount()`/`deleteAccount()`).
- **Phase 13 (US10, restoration)**: Depends on Phase 9 (an archived community to restore).
- **Polish (Phase 14)**: Depends on every phase above being complete.

### Parallel Opportunities

- T002-T008 (Foundational) are all [P] — seven distinct files, each depending only on T001's migration.
- T018 and T019 (US1) are [P] — route files vs. page files, both depending only on T015-T017.
- T024 and T025 (US3) are [P]; T029 and T030 (US4) are [P]; T034 and T035 (US5) are [P]; T041 and T042 (US8) are [P]; T051 and T052 (US11) are [P]; T056 and T057 (US6) are [P]; T061 and T062 (US7) are [P]; T066 and T067 (US10) are [P] — in every case, one is a route file and the other a page file, both depending only on that phase's already-green service-layer task.
- T069 and T070 (Polish) are independent checks, can run in parallel.
- Tasks extending the same shared test file within one phase (e.g. T037/T038 both extending contract test files, but *different* files from each other — T037 extends `test_community_lifecycle.ts`, T038 extends `test_listings.ts`/`test_messaging.ts`) are sequenced relative to any other task touching the *same* file, per the Notes below.

---

## Parallel Example: Phase 4 (US1)

```bash
# T018 and T019 touch different files and both depend only on the already-green T015-T017:
Task: "Create app/api/master/sign-in/route.ts, sign-out/route.ts, change-password/route.ts"
Task: "Create app/master/sign-in/page.tsx, change-password/page.tsx, page.tsx"
```

---

## Implementation Strategy

### MVP First (through User Story 1)

1. Complete Phase 1 (Setup) and Phase 2 (Foundational).
2. Complete Phase 3 (US2, bootstrap) — needed to have a MASTER to sign in as.
3. Complete Phase 4 (US1, sign-in).
4. **STOP and VALIDATE**: run quickstart.md Scenario 1; confirm T009/T013/T014/T021 are all green.
5. This is a legitimate first increment: a MASTER can be bootstrapped and can sign in to a fully isolated administration area, with marketplace access provably denied.

### Incremental Delivery

1. Setup + Foundational → gate functions and schema ready for every later phase.
2. Phase 3 (US2) + Phase 4 (US1) → MVP: bootstrap and sign in.
3. Phase 5 (US3) → full MASTER lifecycle management.
4. Phase 6 (US4) → community creation, both founder modes.
5. Phase 7 (US5) → community/administrator management from outside, including account dispositions.
6. Phase 8 (US8) → suspension.
7. Phase 9 (US9) → automatic archival.
8. Phase 10 (US11) → audit log inspection — P1 scope complete.
9. Phase 11 (US6) → peer administrator delegation.
10. Phase 12 (US7) → full ordinary-account management, generalizing Phase 7's account functions.
11. Phase 13 (US10) → restoration — full feature complete.
12. Polish.

### Parallel Team Strategy

With multiple developers, after Setup + Foundational + Phases 3-4 (US2, US1 — the shared entry point every other phase needs):

- Developer A: Phase 6 (US4) → Phase 7 (US5) → Phase 12 (US7)
- Developer B: Phase 8 (US8) → Phase 9 (US9) → Phase 13 (US10)
- Developer C: Phase 5 (US3), then Phase 10 (US11), then Phase 11 (US6) (no dependency on the others)

---

## Notes

- [P] tasks touch different files with no dependency on each other; tasks sharing a file with a sibling task in the same or an earlier phase are intentionally sequenced instead.
- [Story] labels map every task to the spec.md story whose acceptance criterion it satisfies.
- Commit after each task or logical group.
- Stop at any checkpoint to validate independently.
- Both Vitest (contract) and Playwright (integration) are used, matching 002-008 — every new/extended contract test hits the real test database; every integration spec drives a real page.
- Every SUCCESS/FAILURE audit-write assertion (research.md #6) should include a direct database check, not just an API response check — the whole point of the independent-write discipline is that a rejected mutation's rollback must not also erase its own audit record, which is only provable by querying the database directly after a rejection.
