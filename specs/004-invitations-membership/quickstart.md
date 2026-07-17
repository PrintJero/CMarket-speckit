# Quickstart: Invitations & Membership

Validates the feature end-to-end once implemented. See [data-model.md](./data-model.md) for schema and [contracts/invitations-membership-api.md](./contracts/invitations-membership-api.md) for the route/page contracts.

## Prerequisites

- PostgreSQL running and reachable, migrated with this feature's Prisma schema (`prisma migrate deploy`) — adds `Invitation`, extends `MembershipRole` with `MEMBER`.
- An existing `Community` with a founding `ADMINISTRATOR` account (e.g., via `npm run create-community` from 003-community-creation).
- `EMAIL_TEST_CAPTURE=true` set so invitation emails land in the existing `/api/test/last-email` sink (`tests/integration/helpers.ts`), the same convention 002-accounts-authentication's Playwright specs already use.
- The Next.js dev server running (`npm run dev`) for the browser-facing scenarios below — unlike 003, this feature has real pages/routes.

## Scenario 1 — Invite an already-verified person, who accepts (Story 1)

Requires community C with administrator A, and a second, already-verified account M (e.g., signed up and verified via the 002 flow).

1. Sign in as A. Visit `/communities/{C.id}/admin`. Submit the invite form with M's exact email.
   - Expect a `201`-equivalent success in the UI; no membership yet for M.
2. Fetch the captured email for M (`GET /api/test/last-email?to=<M's email>`), extract the `/invitations/accept?token=...` link.
3. Sign in as M (in a separate session/browser context) and open that link.
   - Expect an "Accept invitation to C" confirmation; accept it.
4. Query the database: exactly one `Membership` row links M to C with `role = MEMBER`.
5. Re-open the same accept link (still signed in as M, or as any other account).
   - Expect rejection (`invalid_or_consumed`) — the invitation is single-use (SC-006).

## Scenario 2 — Invite someone with no account yet, who signs up and verifies first (Story 2)

1. As administrator A, invite `new-person@example.com` (no matching `Account` exists) to community C via `/communities/{C.id}/admin`.
2. Fetch the captured invitation email for that address; note the accept link, but do not open it yet.
3. Attempt `POST /api/invitations/accept` with that token while signed out.
   - Expect `401 Unauthorized` — there is nothing to accept against yet (no signed-in account).
4. Sign up with `new-person@example.com` via the existing 002-accounts-authentication flow and complete email verification.
5. Sign in as that new account, then open the invitation accept link from step 2.
   - Expect success: a `MEMBER` `Membership` row now links this account to C (FR-004).

## Scenario 3 — Reject acceptance by a mismatched or unverified account (Story 2, edge cases)

1. As administrator A, invite `bound@example.com` to community C.
2. Sign in as a *different*, verified account (`other@example.com`) and attempt `POST /api/invitations/accept` with `bound@example.com`'s token.
   - Expect `403 Forbidden`, `reason: "email_mismatch"`; no membership created (FR-002).
3. Sign up `bound@example.com` but do **not** verify it; sign in (if possible) or otherwise attempt acceptance as that unverified account.
   - Expect `403 Forbidden`, `reason: "not_verified"`, distinguishable from the mismatch case (FR-003).

## Scenario 4 — Revoke a member (Story 3)

1. Using the `Membership` created in Scenario 1 (M as MEMBER of C), as administrator A visit `/communities/{C.id}/admin` and revoke M's membership.
2. Query the database: no `Membership` row links M to C anymore.
3. Query M's `Account` row: credentials/verification state unchanged from before the revoke.

## Scenario 5 — Revoke, then re-invite the same email successfully (Story 4)

1. Immediately after Scenario 4's revoke, invite M's exact email to C again via the same admin page.
   - Expect success — no cooldown/block error of any kind (FR-008).
2. Fetch the new captured email, accept it as M.
   - Expect a fresh `MEMBER` `Membership` row for M in C, functionally identical to a first-time acceptance (SC-004).

## Scenario 6 — Last-admin guard (Story 5)

1. Create a fresh community D with exactly one administrator, account A2 (e.g., via `npm run create-community`).
2. As A2, attempt to revoke A2's own `ADMINISTRATOR` membership in D via `/communities/{D.id}/admin`.
   - Expect `409 Conflict`, `reason: "last_admin"`; A2's membership is unchanged (FR-009).
3. Note: this feature has no "invite/promote to administrator" action (out of scope — only `MEMBER` is ever produced by acceptance), so a second administrator can only be added directly at the data layer for this manual check. Add one directly (e.g., `prisma.membership.create({ data: { accountId: <A3.id>, communityId: D.id, role: "ADMINISTRATOR" } })` via a one-off script or `prisma studio`), then repeat step 2 revoking A2.
   - Expect success this time, since A3 remains as administrator afterward (Story 5, Scenario 2). The automated contract test for `revokeMembership()` covers this same two-administrator case directly via Prisma, without needing the admin UI.

## Scenario 7 — An account's memberships across communities stay independent (FR-013)

1. Have one account hold an `ADMINISTRATOR` membership in community D (Scenario 6) and, separately, accept a `MEMBER` invitation into community C (Scenario 1/2's flow).
2. Visit `/` signed in as that account: expect both communities listed, with correct, independent roles.
3. Revoke that account's `MEMBER` membership in C.
4. Query the database: the account's `ADMINISTRATOR` membership in D is untouched, and `/` still shows D.

## Scenario 8 — Automated test suite

1. Run `npm run test:unit` — Vitest contract tests for `inviteToCommunity()`, `acceptInvitation()`, `revokeMembership()` (red-then-green per Principle VIII) must pass.
2. Run `npm run test:e2e` — Playwright specs driving the invite form, the accept-link page, and the revoke button through a real browser must pass.
