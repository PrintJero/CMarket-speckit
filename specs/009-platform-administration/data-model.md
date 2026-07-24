# Data Model: Platform Administration

Three new entities (`MasterIdentity`, `MasterSession`, `AdministrativeAuditEntry`). Five existing entities gain fields: `Community` (lifecycle state + operational epoch), `Account` (status + soft delete), and `Listing`, `MessageThread`, `Invitation`, `Membership` (each gains one `operationalEpoch` column — research.md #8). No existing column is removed or repurposed.

## MasterIdentity *(new)*

A dedicated platform-operator identity, wholly separate from `Account` (research.md #1).

| Field | Type | Notes |
| --- | --- | --- |
| `id` | identifier | Primary key |
| `masterId` | string, unique | Normalized (trim + lowercase, research.md #3) at write time. Immutable after creation (Edge Cases) — no update path exists for this field. |
| `email` | string, unique | Operational email; normalized like `Account.email`. Unique across `MasterIdentity` and, by application-level check, also unique against `Account.email` (research.md #4, FR-015, Constitution v4.1.0 Principle IX). Not a sign-in identifier (FR-003). |
| `passwordHash` | string | Argon2id, via existing `hashPassword()` (research.md #2). |
| `status` | enum `ACTIVE` \| `DISABLED` | Default `ACTIVE`. |
| `mustChangePassword` | boolean | `true` on creation (new MASTER or after a reset); cleared on the first successful password change (FR-010, FR-011). |
| `createdAt` | timestamp | |
| `createdByMasterId` | string?, nullable FK | Null only for the bootstrap MASTER (FR-007); every later MASTER records who created it (traceability, User Story 2 Scenario 3). |
| `statusChangedAt` | timestamp? | Set on disable/reactivate. |

**Constraints**: `@@unique([masterId])`, `@@unique([email])`.

**Lifecycle**: Created by bootstrap (exactly once, when the table is empty) or by an active MASTER (`createMaster()`). Never physically deleted (FR-016) — only `status` changes between `ACTIVE`/`DISABLED`. A password reset regenerates `passwordHash` and sets `mustChangePassword = true`, without changing `status`.

**Validation rules**:

- `masterId`, after normalization, must be non-blank, ≤ 50 chars, and match `[a-z0-9._-]+` (research.md #3) — `invalid_master_id`.
- `email` must pass the existing `isValidEmail()` check and must not already exist in either `MasterIdentity.email` or `Account.email` (research.md #4) — `email_already_in_use`.
- A newly created identity always starts `status: ACTIVE`, `mustChangePassword: true`.

## MasterSession *(new)*

An authenticated administrative session belonging only to a `MasterIdentity` (research.md #1).

| Field | Type | Notes |
| --- | --- | --- |
| `id` | identifier | Primary key |
| `masterId` | identifier (FK) | `onDelete: Cascade` — but `MasterIdentity` rows are never deleted (FR-016), so this cascade never actually fires; kept only for schema consistency with every other FK in this codebase. |
| `sessionTokenHash` | string, unique | SHA-256 of the raw token (research.md #2), never the raw value. |
| `createdAt` | timestamp | |
| `expiresAt` | timestamp | Same 30-day pattern as `Session` (`sessionService.ts`). |

**Lifecycle**: Created on successful MASTER sign-in. Deleted on sign-out, on disable, and on password reset (research.md #11) — deleting every row for a `masterId` is exactly "revoke all active sessions."

## AdministrativeAuditEntry *(new)*

Immutable record of every platform-administration action and lifecycle automation event (research.md #6).

| Field | Type | Notes |
| --- | --- | --- |
| `id` | identifier | Primary key |
| `actorType` | enum `MASTER` \| `SYSTEM` | `SYSTEM` only for the automatic archival transition (FR-069). |
| `actorMasterId` | identifier?, nullable FK | Set when `actorType = MASTER`; null for `SYSTEM`. |
| `action` | string | e.g. `"master.create"`, `"master.disable"`, `"community.suspend"`, `"community.restore"`, `"account.delete"` — see the closed TypeScript union `AdministrativeAction` in `src/server/services/auditService.ts` for the authoritative, extensible list (research.md #6: plain string column, compile-time-checked union, not a DB enum). |
| `targetType` | string | `"MasterIdentity"` \| `"Community"` \| `"Account"` \| `"Membership"` |
| `targetId` | string? | Nullable — e.g. a rejected repeat-bootstrap attempt has no target. |
| `outcome` | enum `SUCCESS` \| `FAILURE` | |
| `detail` | JSON? | Sanitized before/after values or failure reason. Never a password, hash, session token, invitation token, verification token, access code, or payment credential (FR-070) — enforced by a single serialization helper, never by ad hoc `JSON.stringify()` at each call site. |
| `createdAt` | timestamp | |

**Constraints**: `@@index([createdAt])`, `@@index([actorMasterId])`, `@@index([targetType, targetId])` — supports FR-073's required filters (date range, actor, action type, target type/id) via database-level filtering and pagination, never an in-memory scan.

**Lifecycle**: Insert-only. No route or service function ever updates or deletes a row (FR-071) — enforced by omission, the same way `Message`'s "no edit/delete" is enforced in 008 (research.md #6).

**Writer discipline (research.md #6 — transaction discipline is load-bearing, not incidental)**: `writeAuditEntry(client, entry)` always takes an explicit Prisma client argument, used one of two ways:

- **SUCCESS** entries are written with the *same* `tx` transaction client as the mutation they describe, as its last statement — the mutation and its audit record commit together, or neither commits. There is no code path in which a state-changing MASTER action succeeds without producing an audit record.
- **FAILURE** entries, for an *expected* rejection (a guard intentionally refusing an action — last-MASTER, last-administrator/orphan, self-disable, "not eligible," a conflicting state, etc.), are written with the plain top-level `prisma` client, as an independent statement executed **after** the guarded attempt's own transaction has already rolled back. A FAILURE entry is never nested inside the transaction whose rollback it records — Constitution v4.1.0 Principle IX requires a rejected attempt's audit record to survive that exact rollback, and nesting the write inside it would erase the record along with the rejected mutation. Genuinely unexpected errors (e.g. a database connectivity fault) are not required to produce a FAILURE entry — they are an infrastructure fault, not an evaluated-and-rejected "attempted action."

## Community *(existing, extended)*

Gains lifecycle state and an operational-epoch counter. Its existing identity/tenancy fields (`id`, `name`, `createdByOperator`, `createdAt`) are unchanged.

| Field *(new)* | Type | Notes |
| --- | --- | --- |
| `status` | enum `ACTIVE` \| `SUSPENDED` \| `ARCHIVED` | Default `ACTIVE` (FR-049). |
| `suspendedAt` | timestamp? | Set when transitioning to `SUSPENDED`; cleared on reactivation. |
| `suspensionReason` | string? | Free text, required input when suspending (FR-051), cleared on reactivation. |
| `archiveScheduledAt` | timestamp? | Set to `suspendedAt + 30 days` when suspended; cleared on reactivation (research.md #7, #8). |
| `archivedAt` | timestamp? | Set when the background process (or, in principle, a future direct action) transitions to `ARCHIVED`. Cleared on restoration. |
| `operationalEpoch` | integer | Default `1` (research.md #8). Incremented by exactly 1 on every restoration; otherwise never changes. The current "operational generation" of this community — every `Listing`/`MessageThread`/`Invitation`/`Membership` row is stamped with the epoch value that was current at its own creation time, and only rows whose stamped epoch equals this column's *current* value are operational. |

**State machine** (FR-048–FR-065):

```text
ACTIVE ──suspend (MASTER)──▶ SUSPENDED ──reactivate (MASTER, before deadline)──▶ ACTIVE
                                 │
                                 └─ archiveScheduledAt reached (SYSTEM, idempotent) ──▶ ARCHIVED
                                                                                            │
                                                                                            └─ restore (MASTER, selects 1 admin) ──▶ ACTIVE, operationalEpoch += 1
```

- `ACTIVE → SUSPENDED`: only by an active MASTER (FR-050); records `suspendedAt`, `suspensionReason`, `archiveScheduledAt = suspendedAt + 30d` (FR-051). `operationalEpoch` is untouched.
- `SUSPENDED → ACTIVE` (reactivation): only by an active MASTER, only before `archiveScheduledAt` (FR-055); clears `suspendedAt`/`suspensionReason`/`archiveScheduledAt`. `operationalEpoch` is untouched — this is the *same* operational generation resuming, not a new one. A community-administrator attempting this is rejected (Story 8, Scenario 7).
- `SUSPENDED → SUSPENDED` (re-suspend while already suspended): rejected as a deadline-extension; MUST NOT silently push `archiveScheduledAt` forward (FR-056) — a new 30-day cycle requires reactivation first.
- `SUSPENDED → ARCHIVED`: only by the background process, only when `archiveScheduledAt <= now()` AND `status` is still `SUSPENDED` under the *same* suspension cycle (checked by re-reading the row inside the transition, not by trusting a stale job payload — FR-058, research.md #7). Sets `archivedAt`. **Touches no `Listing`/`MessageThread`/`Invitation`/`Membership` row** — while `status !== ACTIVE`, every ordinary marketplace path is already blocked outright (FR-059), so nothing about child rows needs to change yet (research.md #8's "consequence" note).
- `ARCHIVED → ACTIVE` (restoration): only by an active MASTER, selecting exactly one eligible prior administrator (FR-062). In one transaction: `operationalEpoch` is incremented by 1, `archivedAt` is cleared, `status` becomes `ACTIVE`, and the selected administrator's own `Membership.operationalEpoch` is updated to the *new* `operationalEpoch` value. Every other `Listing`/`MessageThread`/`Invitation`/`Membership` row for this community keeps its old epoch number, permanently, and therefore never again matches `Community.operationalEpoch` — this is what makes them stay historical after restoration (FR-063, FR-064, FR-077; research.md #8). `ACTIVE → restore` and `SUSPENDED → restore` are both rejected as no-ops on a non-`ARCHIVED` community (Edge Cases).

**Read-path gating** (research.md #15): every existing membership/listing/message gate function checks **both** `Community.status` and, for the four epoch-bearing entities, `operationalEpoch`:

| Community status | View existing listings / read+send in existing threads | Create/edit listing, new thread, invite, admit, promote, reactivate a paused listing |
| --- | --- | --- |
| `ACTIVE` | ✅ (current-epoch rows only) | ✅ (writes always stamp the current epoch) |
| `SUSPENDED` | ✅ (FR-052, current-epoch rows only) | ❌ (FR-053) — pausing an *existing*, current-epoch listing remains allowed (FR-054) |
| `ARCHIVED` | ❌ (FR-059, indistinguishable from not-found on ordinary routes) | ❌ |

A community that has never been restored has every row at epoch 1, so this table's "current-epoch rows only" qualifier is a no-op for it — the distinction only becomes observable the first time a community is restored.

## Account *(existing, extended)*

Gains suspension and non-destructive-deletion support (research.md #9). Existing fields (`id`, `email`, `passwordHash`, `emailVerifiedAt`, `displayName`, `createdAt`) are unchanged in meaning.

| Field *(new)* | Type | Notes |
| --- | --- | --- |
| `status` | enum `ACTIVE` \| `SUSPENDED` | Default `ACTIVE`. |
| `deletedAt` | timestamp? | Null unless permanently deleted (FR-034). Once set, permanent — no path clears it. |

**Validation / transition rules**:

- Suspend (FR-042): only by an active MASTER; sets `status = SUSPENDED`, deletes every `Session` row for this account. Rejected if this account is the last active administrator of any community unless replacement administrators for every affected community are assigned in the same atomic operation (FR-046).
- Reactivate (FR-043): sets `status = ACTIVE`. Restores sign-in eligibility; does **not** recreate any `Membership` row a separate action revoked, and community-level access still depends on that community's own `status`/`operationalEpoch` (a reactivated account in a still-`SUSPENDED`/`ARCHIVED` community, or whose own membership predates a later restoration's new epoch, is still gated accordingly).
- Password reset (FR-044): regenerates `passwordHash` from a freshly generated temporary password shown once, deletes every `Session` row. Does not change `status`.
- Permanent deletion (FR-034, research.md #9): sets `deletedAt = now()`, overwrites `email` with a non-reusable synthetic value (freeing the original for reuse per Edge Cases), clears `passwordHash`, deletes every `AuthIdentity`/`Session`/`VerificationToken` row. The `Account` row itself, and every FK pointing at it (`Listing.ownerId`, `Message.senderId`, `Membership.accountId`, `Invitation.invitedBy`), is **never** deleted — this is what makes historical attribution "non-reassignable" (FR-034) rather than orphaned or reassigned. Rejected if this account is the last active administrator of any community unless replacement assignments are included atomically (FR-046), same guard as suspension.
- Sign-in and session validation (`signInWithPassword`, `getValidSession`) both additionally require `status === "ACTIVE" && deletedAt === null`.

## Listing, MessageThread, Invitation, Membership *(existing, each gains one field)*

Each gains a single `operationalEpoch Int` column (research.md #8), stamped at creation with `Community.operationalEpoch`'s value *at that moment* and otherwise immutable — with exactly one exception, noted below.

| Model | Column | Stamped at creation from | Ever updated after creation? |
| --- | --- | --- | --- |
| `Listing` | `operationalEpoch` | The listing's `communityId`'s current `Community.operationalEpoch` | Never |
| `MessageThread` | `operationalEpoch` | The thread's listing's community's current `Community.operationalEpoch` | Never |
| `Invitation` | `operationalEpoch` | The invitation's `communityId`'s current `Community.operationalEpoch` | Never |
| `Membership` | `operationalEpoch` | The membership's `communityId`'s current `Community.operationalEpoch` | **Yes, exactly once**: the restored administrator's own row is updated to the community's *new* `operationalEpoch` at the moment of restoration (see Community's state machine above). Every other `Membership` row is never updated. |

**Existing behavior is unaffected**: every pre-009 row (created before this feature ships) is stamped `operationalEpoch: 1`, and every community starts at `operationalEpoch: 1` — so `operationalEpoch: community.operationalEpoch` holds for all of them until the first time a community is restored, a state that cannot have existed before this feature. Ordinary revocation (004's `revokeMembership()`, a hard delete) is entirely unaffected by this column — it deletes the row outright, regardless of its epoch.

**Consequence for existing call sites** (research.md #8): `requireCommunityMembership()`, `requireCommunityAdministrator()`, `getCurrentAccount()`'s membership listing, `listMyThreads()`/`listMyListings()`'s community-id resolution, the listing-discovery feed, and invitation-acceptance lookup each add `operationalEpoch: <community's current operationalEpoch>` to their existing filter, alongside the pre-existing `Community.status` check (research.md #15) — both conditions must hold for an ordinary operational read/write to succeed.

## Prisma schema changes

```prisma
enum MasterStatus {
  ACTIVE
  DISABLED
}

model MasterIdentity {
  id                 String       @id @default(cuid())
  masterId           String       @unique
  email              String       @unique
  passwordHash       String
  status             MasterStatus @default(ACTIVE)
  mustChangePassword Boolean      @default(true)
  createdAt          DateTime     @default(now())
  createdByMasterId  String?
  statusChangedAt    DateTime?

  sessions MasterSession[]

  @@map("master_identities")
}

model MasterSession {
  id               String   @id @default(cuid())
  masterId         String
  sessionTokenHash String   @unique
  createdAt        DateTime @default(now())
  expiresAt        DateTime

  master MasterIdentity @relation(fields: [masterId], references: [id], onDelete: Cascade)

  @@index([masterId])
  @@map("master_sessions")
}

enum AuditActorType {
  MASTER
  SYSTEM
}

enum AuditOutcome {
  SUCCESS
  FAILURE
}

model AdministrativeAuditEntry {
  id            String         @id @default(cuid())
  actorType     AuditActorType
  actorMasterId String?
  action        String
  targetType    String
  targetId      String?
  outcome       AuditOutcome
  detail        Json?
  createdAt     DateTime       @default(now())

  @@index([createdAt])
  @@index([actorMasterId])
  @@index([targetType, targetId])
  @@map("administrative_audit_entries")
}

enum CommunityStatus {
  ACTIVE
  SUSPENDED
  ARCHIVED
}

enum AccountStatus {
  ACTIVE
  SUSPENDED
}

// Additions to existing models:
// model Community {
//   status             CommunityStatus @default(ACTIVE)
//   suspendedAt        DateTime?
//   suspensionReason   String?
//   archiveScheduledAt DateTime?
//   archivedAt         DateTime?
//   operationalEpoch   Int             @default(1)
// }
// model Account {
//   status    AccountStatus @default(ACTIVE)
//   deletedAt DateTime?
// }
// model Listing {
//   operationalEpoch Int @default(1)
// }
// model MessageThread {
//   operationalEpoch Int @default(1)
// }
// model Invitation {
//   operationalEpoch Int @default(1)
// }
// model Membership {
//   operationalEpoch Int @default(1)
// }
```

## Atomicity

- `createMaster()` (bootstrap or MASTER-driven): single-row insert; no transaction needed beyond the pre-insert uniqueness checks (research.md #4's accepted narrow race). Its own SUCCESS/FAILURE audit write follows research.md #6's discipline like every other action below.
- `createCommunityAsMaster()` (research.md #12): one `$transaction` — resolve-or-create `Account` (if provisioning), create `Community` (`operationalEpoch: 1`), create its `ADMINISTRATOR` `Membership` (`operationalEpoch: 1`), write the SUCCESS audit entry with the same `tx`. All four or none (FR-026). A rejected attempt (e.g. `account_not_verified`) writes its FAILURE entry independently, via the plain `prisma` client, after returning — no transaction was ever opened for a rejection detected before any write.
- `disableMaster()` / last-MASTER and self-disable guards (research.md #6's worked example, #11): the mutating path (count check, `status` update, `MasterSession` deletion, SUCCESS audit write) is one `$transaction`; a guard rejection aborts that transaction and triggers an independent FAILURE audit write via the plain `prisma` client afterward — never nested inside the aborted transaction.
- `suspendCommunity()` / `reactivateCommunity()`: one `$transaction` — update `Community` fields, write the SUCCESS audit entry with the same `tx`. No `Listing`/`MessageThread`/`Invitation`/`Membership` row touched (research.md #8). A rejected attempt (e.g. "not currently ACTIVE") writes its FAILURE entry independently.
- `archiveDueSuspendedCommunities()` (system, per-community): one `$transaction` per community — re-verify `status === SUSPENDED && archiveScheduledAt <= now()`, update `Community.status/archivedAt` only, write one `SYSTEM`-actor SUCCESS audit entry with the same `tx`. Re-running against an already-`ARCHIVED` community is a no-op (the re-verify guard fails and the transaction makes no change) — no FAILURE entry is written for this internal no-op, since it is not a rejected *attempt* in the FR-068 sense, it is the idempotency check working as designed (FR-058).
- `restoreCommunity()`: one `$transaction` — verify the selected administrator's membership row exists, was `ADMINISTRATOR` at the epoch being restored from, and is eligible (account not disabled/deleted, research.md #9); increment `Community.operationalEpoch`, clear `archivedAt`, set `status: ACTIVE`; update that one `Membership.operationalEpoch` to the new value; write the SUCCESS audit entry with the same `tx`. A rejected attempt (not `ARCHIVED`, or the selected administrator is ineligible) writes its FAILURE entry independently.
- `deleteAccount()` (research.md #9): one `$transaction` — verify no orphaned-community guard (or apply the atomic replacement-administrator assignments passed alongside it, FR-046), scrub `Account` fields, delete `AuthIdentity`/`Session`/`VerificationToken` rows, write the SUCCESS audit entry with the same `tx`. The orphan-guard rejection writes its FAILURE entry independently.
