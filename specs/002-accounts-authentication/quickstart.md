# Quickstart: Accounts and Authentication

Validates the feature end-to-end once implemented. See [data-model.md](./data-model.md) for schema and [contracts/auth-api.md](./contracts/auth-api.md) for request/response shapes.

## Prerequisites

- PostgreSQL running and reachable, migrated with this feature's Prisma schema (`prisma migrate deploy`).
- App running locally (`next dev`) with Google OAuth test credentials configured in the environment.
- A test-only email sink (e.g., a local inbox catcher) so verification links can be read without a real mailbox.

## Scenario 1 — Email/password signup gated by verification (Story 1)

1. `POST /api/auth/sign-up` with a fresh email and a valid password (≥8 chars, not breached).
   - Expect `202 Accepted`; expect a verification email to arrive at the test inbox.
2. Attempt to accept any community invitation while signed in as this account.
   - Expect rejection: verification required.
3. Open the verification link from the email (`GET /api/auth/verify-email?token=...`).
   - Expect `200 OK`; `Account.emailVerifiedAt` is now set.
4. Retry accepting the same invitation.
   - Expect it to proceed normally.

## Scenario 2 — Sign-up non-enumeration (Story 1, scenario 4)

1. Repeat step 1 above using the **same email** again.
   - Expect the identical `202 Accepted` response as a first-time signup — no indication the account already existed.

## Scenario 3 — Sign in, persistent session, sign out (Story 2)

1. Sign in with the verified account's credentials.
   - Expect a session to be established.
2. Restart the app/browser (simulate by clearing in-memory state but keeping the session cookie/storage).
   - Expect the account to still be signed in without re-entering credentials.
3. Attempt sign-in with the correct email and a wrong password.
   - Expect a generic invalid-credentials error, not a specific "wrong password" vs "no such account" distinction.
4. Sign out.
   - Expect the session to no longer grant access (verify the underlying `Session` row is gone, not just a client cookie cleared).

## Scenario 4 — Google signup/sign-in, verified immediately (Story 3)

1. Complete Google sign-in with a Google account whose email has never been used on CMarket.
   - Expect a new, already-verified `Account` with zero memberships.
2. Attempt to accept a community invitation immediately.
   - Expect it to succeed with no extra verification step.
3. Sign out, then sign in again via Google with the same identity.
   - Expect the same `Account` (no duplicate created).

## Scenario 5 — Google/password account linking (Story 3, scenario 4)

1. Create an email/password account for `person@example.com` (verified or not).
2. Complete Google sign-in using a Google identity whose email is also `person@example.com` (case can differ, e.g. `Person@Example.com`).
   - Expect this to link to the **same** `Account` (per FR-017's case-insensitive match) — not create a second account.
   - Expect `Account.emailVerifiedAt` to now be set if it was not already.
   - Expect any prior memberships to be unchanged.

## Scenario 6 — Zero-membership account sees nothing (FR-003, FR-013)

1. Sign in as any account with zero community memberships.
   - Expect no listings, member rosters, activity, or list of communities to be visible or fetchable, regardless of verification status or signup method.

## Test suite

Run the automated critical-flow tests (must exist and pass per Constitution Principle VIII):

```sh
npx vitest run tests/contract tests/unit
npx playwright test tests/integration
```
