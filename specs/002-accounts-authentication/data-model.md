# Data Model: Accounts and Authentication

Derived from [spec.md](./spec.md) Key Entities and Functional Requirements, and [research.md](./research.md) decisions.

## Account

The person's single, global CMarket identity. Independent of any community membership.

| Field             | Type                | Notes                                                                                                                                           |
| ----------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`              | identifier          | Primary key                                                                                                                                     |
| `email`           | string              | Stored lowercased; unique (FR-017: case-insensitive exact match)                                                                                |
| `passwordHash`    | string, nullable    | Argon2id hash; **null until the account is verified** (security amendment #2, 2026-07-16 — FR-019). Also null for a Google-only account that has never separately set a password |
| `emailVerifiedAt` | timestamp, nullable | Null = unverified. Set at signup for Google-created accounts (FR-006); set on verification-token consumption for email/password accounts (FR-005, FR-020) |
| `createdAt`       | timestamp           |                                                                                                                                                 |

**Validation rules**:

- `email` MUST be a syntactically valid address, normalized to lowercase before uniqueness checks and storage (FR-017).
- `passwordHash` is only ever produced by Argon2id over a password that is ≥8 characters and not present on the breached-password list (FR-016); the plaintext password itself is never persisted (FR-011).
- An unverified email/password `Account`'s `passwordHash` MUST always be `null` (FR-019) — the submitted password lives only on the pending `VerificationToken.candidatePasswordHash` until consumption applies it.
- Consuming a token whose `candidatePasswordHash` is `null` MUST NOT set `Account.passwordHash`/`emailVerifiedAt` on an `Account` whose `passwordHash` is also `null` (FR-022, security amendment #3) — that combination would leave a permanently verified-but-passwordless account with no way to ever authenticate, since no password-recovery flow exists in this spec.
- An `Account` with zero linked `CommunityMembership` rows is a valid, permanent, terminal-free state (FR-004) — no field marks it as "incomplete."

**State transitions**:

- `emailVerifiedAt`: `null → set`, one-way, triggered by either (a) consuming an email-verification token (FR-020), (b) signing up via Google (verification inherited from the provider), or (c) linking a Google identity to a previously-unverified password account (FR-018).
- `passwordHash`: `null → set`, primarily by consuming a verification token while the account is still unverified — this applies that token's `candidatePasswordHash` (FR-019/FR-020) in the same operation that sets `emailVerifiedAt`. (A Google-first account separately setting a password later is still an allowed but out-of-scope transition, unrelated to this mechanism.) The old `set → null` transition described here before security amendment #2 (clearing a password on Google auto-link) is now normally vacuous, since an unverified account's `passwordHash` is never set in the first place — FR-018 still defensively ensures it is null after linking, in case that invariant is ever violated by other means.

## AuthIdentity

A federated identity (Google) linked to an `Account`. Kept as a separate table (rather than a column on `Account`) because an `Account` may in principle hold more than one linked identity, and because it is the natural place to satisfy FR-015's auto-link behavior without mutating the `Account` row's own credential fields.

| Field               | Type                      | Notes                                                                                            |
| ------------------- | ------------------------- | ------------------------------------------------------------------------------------------------ |
| `id`                | identifier                | Primary key                                                                                      |
| `accountId`         | identifier (FK → Account) |                                                                                                  |
| `provider`          | string                    | `"google"` for this spec; column exists to keep the table meaningful if a provider is ever added |
| `providerAccountId` | string                    | The stable ID Google assigns to that Google identity                                             |
| `linkedAt`          | timestamp                 |                                                                                                  |

**Validation rules**:

- `(provider, providerAccountId)` MUST be unique — one Google identity links to exactly one `Account`.
- Creating a row here for a `provider`/`providerAccountId` not yet seen, against an `email` that matches an existing `Account` (FR-017 matching rule), MUST attach to that existing `Account` rather than creating a new one (FR-015/FR-018) — this is the auto-link rule expressed at the data-model level. If that existing `Account` was unverified, creating this row is bundled, in the same transaction, with marking it verified and the `Session`/`VerificationToken` teardown described under `Session` and `VerificationToken` (FR-018) — a half-applied state (identity linked, teardown not yet done) would itself be a vulnerability.

## Session

A persistent, server-revocable, authenticated instance of an `Account` signed in on a device (research.md #2: database-backed, not stateless).

| Field          | Type                      | Notes                                             |
| -------------- | ------------------------- | ------------------------------------------------- |
| `id`           | identifier                | Primary key                                       |
| `accountId`    | identifier (FK → Account) |                                                   |
| `sessionToken` | string (hashed at rest)   | Presented by the client to authenticate a request |
| `createdAt`    | timestamp                 |                                                   |
| `expiresAt`    | timestamp                 | Natural expiry (FR-008)                           |

**Validation rules**:

- Deleting a `Session` row is exactly what "sign out" means (Story 2, scenario 3) — the row's absence is the sole source of truth for "signed out," not a client-side flag.
- An expired `Session` (`expiresAt` in the past) MUST be treated identically to a deleted one.
- All `Session` rows for an `Account` MUST be deleted when a Google identity links to that `Account` while it was still unverified (FR-018) — defense-in-depth: under the FR-019/FR-020 model an unverified account normally has no way to have created a session in the first place (no password credential exists to sign in with), but this guard still fires in case that invariant is ever violated.

## VerificationToken

A single-use credential proving control of the email address on an unverified `Account` (research.md #3), and — as of security amendment #2 (2026-07-16) — the sole holder of that sign-up attempt's candidate password credential until consumption applies it (FR-019). As of security amendment #3, an `Account` MAY have more than one pending (unconsumed, unexpired) row at once — one per independent sign-up attempt.

| Field                  | Type                      | Notes                                                                                                                    |
| ---------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `id`                   | identifier                | Primary key                                                                                                              |
| `accountId`            | identifier (FK → Account) |                                                                                                                          |
| `tokenHash`            | string                    | Hash of the random token; the raw token is only ever in the emailed link, never stored                                  |
| `candidatePasswordHash`| string, nullable          | Argon2id hash of the password submitted with the sign-up (or resend) attempt that issued this token (FR-019). Applied to `Account.passwordHash` only if the account is still unverified at consumption (FR-020), and only if not null or the account already has a credential of its own (FR-022) |
| `expiresAt`            | timestamp                 | 24 hours from issuance                                                                                                  |
| `consumedAt`           | timestamp, nullable       | Set the moment the token is used, or the moment a sibling token's consumption verifies the account (FR-020); a consumed or expired token MUST NOT verify an account again                         |

**Validation rules**:

- Requesting a resend (FR-014) MUST invalidate (mark consumed, or delete) any prior unconsumed, unexpired token for that `Account` before issuing a new one, so only the most recently sent link ever works; the resend's new token MUST carry forward the same `candidatePasswordHash` as the token(s) it replaces, since no new password is collected on a resend.
- **Revised, security amendment #3**: each email/password sign-up attempt against an already-existing, unverified `Account` MUST issue its own independent token with its own `candidatePasswordHash`, and this issuance MUST NOT invalidate, consume, or otherwise disturb any other still-pending token for that `Account` (FR-019). Multiple tokens, each carrying a different candidate credential from a different sign-up attempt, MAY coexist for the same `Account` at once. (This replaces the amendment #2 rule that a new sign-up token invalidated its predecessor — that rule was itself the amendment #3 defect: it let a competing sign-up destroy the legitimate holder's own pending token.)
- A token MUST resolve to exactly one `Account`. Consuming it MUST, in one atomic operation guarded by `Account.emailVerifiedAt IS NULL` (and, when `candidatePasswordHash` is null, additionally guarded by `Account.passwordHash IS NOT NULL` — FR-022): apply `candidatePasswordHash` as `Account.passwordHash` and set `Account.emailVerifiedAt`, **but only if the account is still unverified at that moment, and only if doing so wouldn't leave a permanently passwordless verified account**. If the account was already verified by any other means, consuming the token MUST NOT modify `Account.passwordHash`, though the token is still marked consumed either way. If the candidate is null and the account has no credential of its own, the consumption MUST fail explicitly (FR-022) rather than verifying the account.
- **New, security amendment #3**: the moment a token's consumption is what verifies its `Account` (i.e., the guarded update above actually took effect), every other still-pending token for that same `Account` MUST also be marked consumed in that same operation (FR-020) — this is the concrete mechanism that makes a losing token in the coexisting-tokens model (FR-019) observably "dead" (a later attempt to consume it returns the same "no longer valid" result as any other already-consumed token) rather than merely inert.
- Any pending (unconsumed, unexpired) token for an `Account` MUST also be invalidated when a Google identity links to that `Account` while it was still unverified (FR-018) — this is what actually neutralizes an attacker's candidate credential under the new model (there is no longer a `passwordHash` to strip from the `Account` itself, since FR-019 never let one attach): invalidating the token is what prevents that candidate credential from ever being applied later.
- **New, security amendment #3**: issuing a token for a given `Account` — whether via a sign-up attempt or a resend — MUST be rejected (no row created, no email sent) once a specified number of tokens have already been created for that `Account` within a specified recent time window (FR-021); the caller-facing response MUST remain identical to a non-rate-limited request (FR-009).

## Community Membership _(external reference, not owned by this feature)_

Referenced only to state the dependency this spec's gate protects: the existing invitation-acceptance flow MUST check `Account.emailVerifiedAt IS NOT NULL` before creating or activating a membership row (FR-005, FR-007). This spec does not define or migrate that table.
