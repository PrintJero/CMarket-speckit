# Phase 1 Data Model: Community Invitations

## Entity: User

Represents a person who may hold membership in zero or more communities.

| Field | Type | Notes |
|---|---|---|
| id | UUID (PK) | |
| email | string, unique, nullable | at least one of email/phone MUST be present |
| phone | string, unique, nullable | at least one of email/phone MUST be present |
| name | string | |
| passwordHash | string | for JWT-based login; registration flow is out of scope for this feature |
| createdAt | timestamp | |
| updatedAt | timestamp | |

## Entity: Community

Represents a closed group (university, company, or residential complex)
with its own membership and marketplace.

| Field | Type | Notes |
|---|---|---|
| id | UUID (PK) | |
| name | string | |
| type | enum: `UNIVERSITY`, `COMPANY`, `RESIDENTIAL_COMPLEX` | |
| invitationExpiryDays | integer, nullable | per-community override of the platform default; `null` = use platform default (7) |
| createdAt | timestamp | |
| updatedAt | timestamp | |

## Entity: Membership

Represents one user's relationship to one specific community. A single
user MAY hold independent Membership rows across multiple communities
(FR-012). Unique on `(communityId, userId)`.

| Field | Type | Notes |
|---|---|---|
| id | UUID (PK) | |
| communityId | UUID (FK → Community) | |
| userId | UUID (FK → User) | |
| role | enum: `ADMIN`, `MEMBER` | determines gatekeeper authority (Principle III) |
| status | enum: `ACTIVE`, `REVOKED` | |
| sourceInvitationId | UUID (FK → Invitation), nullable | the invitation whose acceptance created this membership; null for a community's founding administrator, who is provisioned outside this feature's scope |
| joinedAt | timestamp | when status became `ACTIVE` |
| revokedAt | timestamp, nullable | when status became `REVOKED` |
| updatedAt | timestamp | |

**State transitions**:
- *(created)* → `ACTIVE` — only as a side effect of accepting an Invitation (FR-005), never created directly.
- `ACTIVE` → `REVOKED` — administrator revocation (FR-009, FR-010). Terminal for this record; re-admission requires a brand-new Invitation → Membership.
- `REVOKED` is terminal: no direct `REVOKED` → `ACTIVE` transition exists (edge case in spec.md: revoking a non-active membership MUST be rejected, which also implies un-revoking isn't a supported action — re-inviting creates a fresh flow instead).

## Entity: Invitation

Represents a pending offer for a specific contact (email or phone) to join
a specific community, created by an administrator of that community.

| Field | Type | Notes |
|---|---|---|
| id | UUID (PK) | |
| communityId | UUID (FK → Community) | |
| invitedByMembershipId | UUID (FK → Membership) | MUST reference an `ADMIN`-role, `ACTIVE` membership in `communityId` at creation time (FR-015) |
| inviteeEmail | string, nullable | at least one of inviteeEmail/inviteePhone MUST be present (FR-001) |
| inviteePhone | string, nullable | at least one of inviteeEmail/inviteePhone MUST be present (FR-001) |
| matchedUserId | UUID (FK → User), nullable | populated once/if a User with matching email or phone exists; used to surface the invitation to that user (see spec Assumptions) |
| status | enum: `PENDING`, `ACCEPTED`, `DECLINED`, `CANCELLED` | stored status; does not include `EXPIRED` — see Computed Fields below |
| expiresAt | timestamp | `createdAt + community.invitationExpiryDays (or platform default 7)` |
| createdAt | timestamp | |
| respondedAt | timestamp, nullable | when status became `ACCEPTED` or `DECLINED` |

**Computed field — `effectiveStatus`** (not stored, derived on every read):

```text
effectiveStatus =
  status == PENDING && now >= expiresAt  ?  EXPIRED
  : status
```

All business rules (FR-004, FR-006, FR-007, FR-008, FR-016, FR-017) are
expressed against `effectiveStatus`, not the raw stored `status` — this is
what keeps expiration a pure read-time computation with no background job
(see research.md).

**State transitions** (all guarded by `effectiveStatus == PENDING`):
- `PENDING` → `ACCEPTED`: invitee action; also creates/activates the
  corresponding Membership (FR-005).
- `PENDING` → `DECLINED`: invitee action (FR-006).
- `PENDING` → `CANCELLED`: administrator action, only the admin who — or
  any current admin of the same community — may cancel (FR-007).
- `PENDING` (effective `EXPIRED`) → *(no stored transition)*: once
  `now >= expiresAt`, the row's stored status stays `PENDING` forever, but
  every rule treats it as terminal (FR-017); no further writes occur to
  this row as a result of expiry alone.
- `ACCEPTED`, `DECLINED`, `CANCELLED` are terminal — no further transitions
  (FR-008).

## Validation Rules Summary

- Invitation: exactly one of `inviteeEmail`/`inviteePhone` required at
  minimum (both may be present); `invitedByMembershipId` must resolve to an
  `ADMIN` + `ACTIVE` membership in `communityId` (FR-001, FR-015).
- Invitation creation MUST be rejected (FR-013, FR-014) if, within the same
  `communityId` and matching contact (`inviteeEmail`/`inviteePhone`):
  - another Invitation exists with `effectiveStatus == PENDING`, or
  - a Membership already exists with `status == ACTIVE` for the matching
    user.
- Membership: unique `(communityId, userId)` — a user has at most one
  Membership row per community, whose `status`/`role` evolve over time
  rather than creating duplicate rows.
- Community isolation (Principle II): all queries against Invitation and
  Membership MUST include `communityId` in their filter predicate; no
  query spans multiple communities implicitly.
