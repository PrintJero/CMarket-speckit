# Data Model: Community Creation & Founding Administrator

Derived from [spec.md](./spec.md) Key Entities and Functional Requirements, and [research.md](./research.md) decisions.

## Community

A tenancy boundary corresponding to a real institution (FR-001). The root of all future community-scoped data (Constitution Principle II).

| Field               | Type                | Notes                                                                                                          |
| ------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------- |
| `id`                | identifier           | Primary key                                                                                                     |
| `name`               | string               | Free-text label; no system-enforced uniqueness (spec Assumptions); MUST NOT be blank/whitespace-only (FR-014)  |
| `createdByOperator` | string               | The invoking operator's identifier, supplied at invocation time (e.g. a name or username) — **not** a foreign key to `Account`; entirely separate from the end-user authentication system (FR-002, FR-013) |
| `createdAt`         | timestamp            | Also serves as "when" for FR-013's audit requirement                                                            |

**Validation rules**:

- `name`, after trimming whitespace, MUST have length ≥ 1 (FR-014). Rejected before any row is written.
- `createdByOperator` MUST be a non-empty string (the script requires it as a mandatory argument — see contracts/community-creation.md); this feature does not validate it against any account/identity system, since it deliberately isn't one (FR-002).
- No uniqueness constraint on `name` (spec Assumptions: operators are trusted to avoid confusing duplicates).

## MembershipRole (enum)

- `ADMINISTRATOR` — the only value this feature ever produces. Represented as a native Prisma/Postgres enum, never a bare integer or free-text string (Key Entities amendment, FR-010).

## Membership

The link between one `Account` and one `Community`, carrying a role.

| Field         | Type                        | Notes                                                                 |
| ------------- | --------------------------- | ---------------------------------------------------------------------- |
| `id`          | identifier                  | Primary key                                                             |
| `accountId`   | identifier (FK → `Account`) | The founding administrator for this feature; never a nonexistent/unverified account (FR-003/FR-004) |
| `communityId` | identifier (FK → `Community`) |                                                                        |
| `role`        | `MembershipRole`            | Always `ADMINISTRATOR` for memberships this feature produces (FR-008) |
| `createdAt`   | timestamp                   |                                                                        |

**Validation rules**:

- `(accountId, communityId)` is unique — an account has at most one membership row per community. This feature only ever inserts one such row per invocation (FR-008: "the only membership produced").
- A community's administrator count is derived by counting its `Membership` rows with `role = ADMINISTRATOR` — this is what makes the (not-yet-enforced) last-admin guard countable for a future feature (FR-010).
- Creating a `Membership` row here MUST NOT create, modify, or touch the referenced `Account` row in any way (FR-005/FR-006) — the foreign key is a read-only reference at creation time.

**State transitions**: None. This feature only ever inserts; no update or delete path for `Community` or `Membership` exists yet (removal/transfer/settings are explicitly out of scope — spec Assumptions).

## Account *(existing, from 002-accounts-authentication — referenced, not modified)*

Referenced by `Membership.accountId`. Must already exist and have `emailVerifiedAt` set (verified via the existing `assertEmailVerified()` — research.md #3) to be eligible as a founding administrator. No field on `Account` is read, written, or otherwise touched by this feature beyond that existence/verification check.

## Atomicity (FR-007)

`Community` creation and its founding administrator's `Membership` creation happen inside a single Prisma transaction (`prisma.$transaction`, mirroring the existing `consumeVerificationToken` interactive-transaction pattern from `002-accounts-authentication`): if either insert fails, neither is persisted. Validation (name non-blank, account exists, account verified) happens *before* the transaction opens, so a validation failure never begins a transaction at all.
