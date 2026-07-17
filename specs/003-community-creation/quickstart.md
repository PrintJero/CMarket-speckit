# Quickstart: Community Creation & Founding Administrator

Validates the feature end-to-end once implemented. See [data-model.md](./data-model.md) for schema and [contracts/community-creation.md](./contracts/community-creation.md) for the script/function interface.

## Prerequisites

- PostgreSQL running and reachable, migrated with this feature's Prisma schema (`prisma migrate deploy`) — adds `Community`, `Membership`, `MembershipRole`.
- Two existing, email-verified `Account` rows already present (e.g., created and verified via the 002-accounts-authentication sign-up + verify-email flow) — Scenario 1 needs a founder (A) and a genuinely unrelated second account (B) to verify FR-009 meaningfully.
- No running Next.js app is required for this feature — the script talks to the database directly.

## Scenario 1 — Bootstrap a new community (Story 1)

Requires two existing, email-verified accounts: A (the founder) and B (unrelated — never named in the creation call).

1. Run `npx tsx scripts/create-community.ts --name "Riverside Residences" --email "<A's email>" --operator "test-operator"`.
   - Expect exit code `0` and a printed community `id`/`name`/`createdAt`.
2. Query the database: exactly one `Community` row named "Riverside Residences" exists, with `createdByOperator = "test-operator"`.
3. Query the database: exactly one `Membership` row links that community to account A, with `role = ADMINISTRATOR`.
4. **FR-009 (non-discoverability), verified against real data for account B, not A**: query real `Membership` rows for account B — expect zero rows referencing this community. B is the genuine non-member this requirement is about; A is expected to have a real membership, so checking A here would prove nothing (see spec.md FR-009's verification note).
5. **FR-015 (A's own existing session surface is unchanged)**: call `toCurrentAccountPayload()` (or sign in as A through the existing 002-accounts-authentication flow) — `memberships` is still `[]`. This is expected and required by FR-015; it is a *separate* claim from FR-009 and MUST NOT be used as evidence for FR-009. `toCurrentAccountPayload()` currently hardcodes `memberships: []` for every account regardless of real membership data (confirmed by reading `src/lib/auth/currentAccount.ts`) — it would return the same result whether or not B (or even A) had a real membership, so it can only ever demonstrate FR-015 (an intentionally unchanged surface), never non-discoverability, which requires reading real `Membership` rows as step 4 does.

## Scenario 2 — Reject a nonexistent account (Story 2)

1. Run the script with `--email "no-such-account@example.com"`.
   - Expect a non-zero exit and an `account_not_found` message.
2. Query the database: no new `Community`, `Membership`, or `Account` row was created.

## Scenario 3 — Reject an unverified account (Story 3)

1. Sign up a fresh account via the existing sign-up flow but do **not** verify its email.
2. Run the script with `--email` set to that unverified account.
   - Expect a non-zero exit and an `account_not_verified` message, distinguishable from Scenario 2's output.
3. Query the database: that account's `emailVerifiedAt` and `passwordHash` are unchanged from before the attempt; no `Community`/`Membership` row was created.

## Scenario 4 — Reject a blank name (FR-014)

1. Run the script with `--name ""` (or whitespace only) against a valid, verified account.
   - Expect a non-zero exit and an `invalid_name` message.
2. Query the database: no `Community`/`Membership` row was created.

## Scenario 5 — Same account founds a second community (Story 1, scenario 3)

1. Repeat Scenario 1 with a different `--name`, same `--email`.
   - Expect a second, independent `Community` row and a second `Membership` row for the same account; the first community/membership pair is unaffected.

## Scenario 6 — FR-002 static verification

1. Run `npm run test:unit`.
   - `tests/unit/test_community_creation_not_networked.ts` MUST pass: no file under `app/` imports `communityService`.
