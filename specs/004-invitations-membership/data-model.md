# Data Model: Invitations & Membership

Derived from [spec.md](./spec.md) Key Entities and Functional Requirements, and [research.md](./research.md) decisions.

## MembershipRole (enum) — *extended*

- `ADMINISTRATOR` — existing value (003-community-creation).
- `MEMBER` — **new value added by this feature** (FR-006). Carries no administrative authority over the community; a MEMBER cannot invite, revoke, or manage other memberships.

Still a native Prisma/Postgres enum (unchanged guarantee from 003: never a bare integer or free-text string), so the last-admin guard (below) can keep reliably counting `ADMINISTRATOR` rows.

## Invitation *(new)*

A single-use credential binding one email address to one `Community`, issued by that community's administrator (research.md #1).

| Field         | Type                       | Notes                                                                                                    |
| ------------- | -------------------------- | --------------------------------------------------------------------------------------------------------- |
| `id`          | identifier                 | Primary key                                                                                                |
| `communityId` | identifier (FK → Community)| The community this invitation would grant membership in                                                   |
| `email`       | string                     | The invited email, stored normalized (lowercased — same rule as `Account.email`, FR-002/FR-017 of 002)     |
| `tokenHash`   | string, unique             | SHA-256 hash of the random raw token; the raw token exists only in the emailed link, never stored (research.md #1) |
| `invitedBy`   | identifier (FK → Account)  | The administrator account that issued this invitation (audit trail)                                        |
| `consumedAt`  | timestamp, nullable        | Set the moment the invitation is accepted, **or** the moment a newer invitation to the same (email, community) pair supersedes it (research.md #4). A consumed invitation MUST NOT be acceptable again. |
| `createdAt`   | timestamp                  |                                                                                                             |

**Validation rules**:

- An invitation MUST NOT be created for an email that already holds an active `Membership` (any role) in the target community (FR-011) — checked by looking up the `Account` for that email (if one exists) and its `Membership` row for that community before any `Invitation` row is written.
- Issuing a new invitation for an (email, community) pair that already has an unconsumed `Invitation` row MUST mark that prior row consumed in the same transaction that creates the new one (FR-012, research.md #4) — at most one live invitation per (email, community) pair at any time.
- Accepting an invitation MUST, atomically: verify the accepting `Account`'s email matches `Invitation.email` via case-insensitive exact match (FR-002, reusing `emailsMatch()`), verify `Account.emailVerifiedAt` is set (FR-003, reusing `assertEmailVerified()`), mark the `Invitation` consumed, and create the `Membership` row — all in one `prisma.$transaction`. The consume step itself MUST be a conditional `tx.invitation.updateMany({ where: { id, consumedAt: null }, data: { consumedAt: new Date() } })` whose returned count is checked (`count === 0` ⇒ someone else already consumed it, reject `invalid_or_consumed`), mirroring `consumeVerificationToken`'s `updateMany`-then-check-count pattern in `verificationService.ts` — a plain read-then-write (`findUnique` then unconditional `update`) is not atomic under `READ COMMITTED` and would let two concurrent acceptances both pass the pre-transaction "not yet consumed" read. If any check fails, no write occurs.
- No `expiresAt` field exists on this model (research.md #2) — an invitation remains acceptable until consumed, by acceptance or by supersession, never by elapsed time.
- Deleting a `Community` cascades to delete its `Invitation` rows (consistent with the existing `onDelete: Cascade` convention on `Membership.community`).

**State transitions**: `created (consumedAt: null)` → `consumed (consumedAt: set)`, by exactly one of: (a) successful acceptance producing a `Membership`, or (b) being superseded by a newer invitation to the same pair. No other transition exists; a consumed invitation never reverts.

## Membership *(existing, from 003-community-creation — extended)*

| Field         | Type                        | Notes                                                                 |
| ------------- | --------------------------- | ---------------------------------------------------------------------- |
| `id`          | identifier                  | Primary key                                                             |
| `accountId`   | identifier (FK → `Account`) |                                                                        |
| `communityId` | identifier (FK → `Community`) |                                                                        |
| `role`        | `MembershipRole`            | `ADMINISTRATOR` (003) or **`MEMBER`** (new, this feature — FR-006, produced only by `acceptInvitation()`) |
| `createdAt`   | timestamp                   |                                                                        |

**Validation rules** *(new, this feature)*:

- A `Membership` row MAY now be deleted — `revokeMembership()` is the first feature-level action able to remove one (FR-007). Deletion is a hard delete, not a soft-delete flag (research.md #3); revoking is exactly what ends that account's access to the community.
- **Last-admin guard (FR-009)**: deleting a `Membership` whose `role` is `ADMINISTRATOR` MUST first count that community's current `ADMINISTRATOR` memberships inside the same transaction as the delete; if the count is `1` (the row being deleted is the only one), the delete MUST be aborted and rejected — the community must never reach zero administrators (research.md #5). This is the guard 003-community-creation's data-model.md anticipated but could not implement, since no removal path existed there yet.
- `(accountId, communityId)` remains unique (existing `@@unique` constraint, unchanged) — deleting a membership frees that pair for a later, independent re-acceptance (this is precisely what makes revoke-then-reinvite (FR-008) work: nothing blocks a fresh `Membership` insert once the old row is gone).
- Only a community's own `ADMINISTRATOR` member(s) may invite to, or revoke a `Membership` within, that community (FR-010) — enforced by both `inviteToCommunity()` and `revokeMembership()` looking up the caller's own `Membership` row for that `communityId` before doing anything else (research.md #8).

## Account *(existing, from 002-accounts-authentication — referenced, not modified)*

Referenced by `Invitation.email`/`Membership.accountId` and `Invitation.invitedBy`. This feature never creates, deletes, or modifies an `Account` row; it only reads `email` (for matching, FR-002) and `emailVerifiedAt` (for the verification gate, FR-003), via the existing `emailsMatch()` and `assertEmailVerified()` functions (research.md #6).

## Community *(existing, from 003-community-creation — referenced, not modified)*

The tenancy an `Invitation` and its resulting `Membership` belong to. This feature never creates, renames, or deletes a `Community` row.

## CurrentAccountPayload *(existing, from 002-accounts-authentication — extended)*

| Field         | Type                                                    | Notes                                                                 |
| ------------- | -------------------------------------------------------- | ---------------------------------------------------------------------- |
| `accountId`   | string                                                    | Unchanged                                                              |
| `email`       | string                                                    | Unchanged                                                              |
| `verified`    | boolean                                                   | Unchanged                                                              |
| `memberships` | `{ communityId: string; communityName: string; role: MembershipRole }[]` | **Changed** from the literal-empty-array type to a real list (research.md #7) — populated only by `getCurrentAccount()`'s live `prisma.membership.findMany()` query; `toCurrentAccountPayload()` itself still defaults this to `[]` when its new second parameter is omitted, so 002/003's existing direct calls to that pure function are unaffected. |

This is the surface 003-community-creation's FR-015 deliberately left hardcoded-empty, naming this feature's exact purpose ("deferred to a future feature that deliberately surfaces community membership to end users") as the reason it would one day change.

## Atomicity

Two operations in this feature require a single Prisma transaction, both reusing the exact `prisma.$transaction(async (tx) => ...)` interactive-transaction pattern `createCommunity()` established in 003-community-creation:

1. **`inviteToCommunity()`**: superseding any prior unconsumed invitation for the same (email, community) pair and creating the new `Invitation` row (FR-012) — either both happen or neither does.
2. **`acceptInvitation()`**: conditionally marking the `Invitation` consumed (via `updateMany`/count-check, not a plain read-then-write — research.md #5's sibling correction) and creating the `Membership` row (FR-005) — either both happen or neither does, preventing a consumed-but-membership-less or membership-but-still-pending inconsistent state, and preventing two concurrent acceptances of the same token from both succeeding.
3. **`revokeMembership()`**: counting remaining administrators and deleting the target `Membership` row (FR-009) — the count-then-delete MUST run at `Serializable` isolation (not merely inside a default-isolation transaction) to actually close the concurrent-revoke race described in research.md #5; a write-conflict from that isolation level is caught and mapped to a rejection.
