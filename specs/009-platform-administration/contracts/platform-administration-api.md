# Contract: Platform Administration API

All routes below live under `app/api/master/...` (research.md #13) and require an authenticated `MasterSession` (401 `{ "ok": false, "reason": "not_authenticated" }` otherwise) — **never** an `Account` session, which is rejected identically to having no session at all (FR-019). Every route except `POST /api/master/sign-in` and the one-time bootstrap script additionally requires `mustChangePassword === false` on the caller (409 `{ "ok": false, "reason": "password_change_required" }` otherwise, FR-010). One exception, noted inline: the password-change route itself is reachable while `mustChangePassword` is still `true`.

Every state-changing route writes exactly one `AdministrativeAuditEntry` — a `200`/`201` response's `SUCCESS` entry commits atomically with its mutation, and every `4xx` rejection below still produces its own independent `FAILURE` entry, written after the rejected attempt's own transaction (if any) has already rolled back (data-model.md's Writer discipline, research.md #6). This is not repeated per-route below.

## Authentication

### POST /api/master/sign-in

**Body**: `{ "masterId": string, "password": string }`

**Responses**:

- `200 OK` — Body: `{ "ok": true, "mustChangePassword": boolean }`. Sets the `cmarket_master_session` cookie.
- `401 Unauthorized` — wrong `masterId`, wrong password, or a `DISABLED` identity — one generic reason for all three (Story 1, Scenario 2 and 5; research.md #11's anti-enumeration parity with `signInWithPassword`). Body: `{ "ok": false, "reason": "invalid_credentials" }`.

### POST /api/master/sign-out

**Responses**: `200 OK` — deletes the current `MasterSession` row and clears the cookie.

### POST /api/master/change-password

Reachable even when `mustChangePassword === true` (this is the route that clears it).

**Body**: `{ "currentPassword": string, "newPassword": string }`

**Responses**:

- `200 OK` — `mustChangePassword` cleared. Body: `{ "ok": true }`.
- `400 Bad Request` — `newPassword` fails the existing password-strength check (too short / breached, reused from `validatePassword()`). Body: `{ "ok": false, "reason": "invalid_password", "passwordReason": "too_short" | "breached" }`.
- `401 Unauthorized` — `currentPassword` incorrect. Body: `{ "ok": false, "reason": "invalid_current_password" }`.

## MASTER management (User Story 3)

### POST /api/master/masters

Create a new dedicated MASTER identity (FR-009, FR-010).

**Body**: `{ "masterId": string, "email": string }`

**Responses**:

- `201 Created` — Body: `{ "ok": true, "master": { "id", "masterId" }, "temporaryPassword": string }`. `temporaryPassword` appears in this one response only — never retrievable again (Edge Cases).
- `400 Bad Request` — Body: `{ "ok": false, "reason": "invalid_master_id" }` or `{ "ok": false, "reason": "invalid_email" }`.
- `409 Conflict` — `masterId` already exists. Body: `{ "ok": false, "reason": "master_id_already_in_use" }`.
- `409 Conflict` — `email` already exists in either identity store (research.md #4). Body: `{ "ok": false, "reason": "email_already_in_use" }`.

### GET /api/master/masters

**Responses**: `200 OK` — Body: `{ "ok": true, "masters": [{ "id", "masterId", "email", "status", "createdAt", "createdByMasterId" }] }`, paginated (SC-012).

### POST /api/master/masters/{masterId}/disable

**Responses**:

- `200 OK` — Body: `{ "ok": true }`. Deletes every `MasterSession` for the target.
- `403 Forbidden` — target is the caller. Body: `{ "ok": false, "reason": "cannot_disable_self" }` (FR-014).
- `409 Conflict` — target is the last active MASTER. Body: `{ "ok": false, "reason": "last_active_master" }` (FR-013).

### POST /api/master/masters/{masterId}/reactivate

**Responses**: `200 OK` — Body: `{ "ok": true }`.

### POST /api/master/masters/{masterId}/reset-password

**Responses**: `200 OK` — Body: `{ "ok": true, "temporaryPassword": string }`. Deletes every existing `MasterSession` for the target; sets `mustChangePassword = true`.

## Community management (User Stories 4–6, 8–10)

### POST /api/master/communities

Create a community with a founding administrator, atomically (FR-022–026).

**Body**: `{ "name": string, "administrator": { "mode": "existing", "email": string } | { "mode": "provision", "email": string, "displayName": string } }`

**Responses**:

- `201 Created`, mode `"existing"` — Body: `{ "ok": true, "community": { "id", "name" } }`.
- `201 Created`, mode `"provision"` — Body: `{ "ok": true, "community": { "id", "name" }, "temporaryPassword": string }`.
- `400 Bad Request` — Body: `{ "ok": false, "reason": "invalid_name" }`.
- `404 Not Found`, mode `"existing"` — no account for that email. Body: `{ "ok": false, "reason": "account_not_found" }`.
- `409 Conflict`, mode `"existing"` — account exists but is unverified (FR — Scenario 4). Body: `{ "ok": false, "reason": "account_not_verified" }`.
- `409 Conflict`, mode `"provision"` — email already belongs to an existing account. Body: `{ "ok": false, "reason": "account_already_exists" }` — the MASTER must switch to `"existing"` mode.

### GET /api/master/communities

**Query**: `status` (optional, filters by `ACTIVE`/`SUSPENDED`/`ARCHIVED`), pagination params.

**Responses**: `200 OK` — Body: `{ "ok": true, "communities": [{ "id", "name", "status", "createdAt", "suspendedAt", "archiveScheduledAt", "archivedAt", "memberCount", "administratorCount" }] }`.

### GET /api/master/communities/{communityId}

**Responses**: `200 OK` — Body: `{ "ok": true, "community": {...}, "memberships": [{ "id", "accountId", "displayName", "email", "role", "isCurrent" }] }` — `isCurrent` is derived at read time (`membership.operationalEpoch === community.operationalEpoch`, data-model.md; never a stored status), and the list includes non-current (pre-restoration) memberships when the community has been through at least one restore cycle, or is itself `ARCHIVED` (FR-027, Story 5 Scenario 6) — the raw `operationalEpoch` integer is an internal implementation detail and is never returned by this or any route.

### PATCH /api/master/communities/{communityId}

Edit community-managed fields (FR-028).

**Body**: `{ "name"?: string }`

**Responses**: `200 OK` — Body: `{ "ok": true, "community": {...} }`. Audit entry records prior and new values (Story 5, Scenario 1).

### POST /api/master/communities/{communityId}/suspend

**Body**: `{ "reason": string }`

**Responses**:

- `200 OK` — Body: `{ "ok": true, "community": { "status": "SUSPENDED", "suspendedAt", "archiveScheduledAt" } }`.
- `400 Bad Request` — blank reason. Body: `{ "ok": false, "reason": "invalid_reason" }`.
- `409 Conflict` — community is not currently `ACTIVE` (FR-056 — re-suspending an already-suspended community does not extend its deadline). Body: `{ "ok": false, "reason": "not_active" }`.

### POST /api/master/communities/{communityId}/reactivate

**Responses**:

- `200 OK` — Body: `{ "ok": true, "community": { "status": "ACTIVE" } }`. Cancels scheduled archival.
- `409 Conflict` — community is not currently `SUSPENDED`. Body: `{ "ok": false, "reason": "not_suspended" }`.

### POST /api/master/communities/{communityId}/restore

**Body**: `{ "administratorMembershipId": string }`

**Responses**:

- `200 OK` — Body: `{ "ok": true, "community": { "status": "ACTIVE" }, "administrator": { "accountId", "displayName" } }`.
- `409 Conflict` — community is not currently `ARCHIVED`. Body: `{ "ok": false, "reason": "not_archived" }`.
- `409 Conflict` — the selected membership was not `ADMINISTRATOR` at the epoch being restored from, or its account is disabled or deleted. Body: `{ "ok": false, "reason": "administrator_not_eligible" }` (User Story 10, Scenario 4).

### POST /api/master/communities/{communityId}/memberships/{membershipId}/promote

**Responses**: `200 OK` — Body: `{ "ok": true }`. Sets `role: ADMINISTRATOR`.

- `409 Conflict` — target membership is not current (its `operationalEpoch` predates the community's current one — data-model.md) or the community is not `ACTIVE`. Body: `{ "ok": false, "reason": "not_eligible" }`.

### POST /api/master/communities/{communityId}/memberships/{membershipId}/remove

Removing/replacing an administrator requires an explicit disposition (FR-032).

**Body**: `{ "disposition": "demote" | "revoke_membership" | "disable_account" | "delete_account", "replacementAdministratorMembershipId"?: string }`

**Responses**:

- `200 OK` — Body: `{ "ok": true }`.
- `409 Conflict` — this would leave the community with zero active administrators and no `replacementAdministratorMembershipId` was supplied in the same request (FR-030, Story 5 Scenario 4). Body: `{ "ok": false, "reason": "would_orphan_community" }`.

## Community-administrator delegation (User Story 6 — not a MASTER route)

This story extends the **existing** community-administrator surface, not the MASTER namespace — a community administrator promoting a peer member never touches `app/api/master/*`.

### POST /api/communities/{communityId}/memberships/{membershipId}/promote *(new)*

**Responses**:

- `200 OK` — Body: `{ "ok": true }`.
- `403 Forbidden` — caller is not a current administrator of `communityId`. Body: `{ "ok": false, "reason": "not_administrator" }`.
- `409 Conflict` — target is not a current member of the same community (its `operationalEpoch` predates the community's current one, or it was never a member). Body: `{ "ok": false, "reason": "not_eligible" }`.
- `409 Conflict` — community is `SUSPENDED` or `ARCHIVED` (FR — Story 6 Scenario 5). Body: `{ "ok": false, "reason": "community_not_active" }`.

## Ordinary account management (User Story 7)

### GET /api/master/accounts

**Query**: search/pagination params.

**Responses**: `200 OK` — Body: `{ "ok": true, "accounts": [{ "id", "email", "displayName", "status", "deletedAt", "createdAt" }] }`.

### PATCH /api/master/accounts/{accountId}

**Body**: `{ "displayName"?: string, "email"?: string }`

**Responses**:

- `200 OK` — Body: `{ "ok": true, "account": {...} }`. Changing `email` MUST NOT transfer, rewrite, or retarget any existing `Invitation` row for this account — a pending invitation stays bound to the address it was issued to (FR-045, research.md #14). An administrator revokes and reissues (spec 004's existing capability) if the invitation should now reach the new address; this route does not do that automatically.
- `409 Conflict` — new email already in use. Body: `{ "ok": false, "reason": "email_already_in_use" }`.

### POST /api/master/accounts/{accountId}/suspend

**Body**: `{ "replacementAdministratorAssignments"?: [{ "communityId": string, "membershipId": string }] }`

**Responses**:

- `200 OK` — Body: `{ "ok": true }`. Deletes every `Session` for the account.
- `409 Conflict` — account is the last active administrator of one or more communities and no (or incomplete) replacement assignments were supplied (FR-046). Body: `{ "ok": false, "reason": "would_orphan_communities", "affectedCommunityIds": string[] }`.

### POST /api/master/accounts/{accountId}/reactivate

**Responses**: `200 OK` — Body: `{ "ok": true }`.

### POST /api/master/accounts/{accountId}/reset-password

**Responses**: `200 OK` — Body: `{ "ok": true, "temporaryPassword": string }`. Deletes every `Session` for the account.

### POST /api/master/accounts/{accountId}/delete

**Body**: `{ "replacementAdministratorAssignments"?: [{ "communityId": string, "membershipId": string }] }`

**Responses**:

- `200 OK` — Body: `{ "ok": true }`. Irreversible (FR-034).
- `409 Conflict` — same orphaning guard as suspend. Body: `{ "ok": false, "reason": "would_orphan_communities", "affectedCommunityIds": string[] }`.

## Administrative audit log (User Story 11)

### GET /api/master/audit-log

**Query** (FR-073, all optional, combinable): `from`, `to` (ISO date range), `actorMasterId`, `action`, `targetType`, `targetId`, plus pagination params.

**Responses**: `200 OK` — Body: `{ "ok": true, "entries": [{ "id", "actorType", "actorMasterId", "action", "targetType", "targetId", "outcome", "detail", "createdAt" }], "nextCursor": string | null }`. Every filter is applied as a database `WHERE` clause, never an in-memory filter over a full table scan (SC-012).
