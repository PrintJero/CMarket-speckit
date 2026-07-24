# Quickstart: Platform Administration

Validates the feature end-to-end once implemented. See [data-model.md](./data-model.md) for the schema and [contracts/platform-administration-api.md](./contracts/platform-administration-api.md) for every route.

## Prerequisites

- PostgreSQL running and migrated with this feature's Prisma schema change (`prisma migrate deploy`) — adds `master_identities`, `master_sessions`, `administrative_audit_entries`, and extends `communities`, `accounts`, `memberships` with new columns. No existing column altered.
- The Next.js dev server running (`npm run dev`).
- No `MasterIdentity` rows exist yet (first-run state).

## Scenario 1 — Bootstrap and first sign-in (User Story 2, Story 1)

1. Run `npx tsx scripts/bootstrap-master.ts --master-id root --email root@example.com`.
   - Expect exactly one `MasterIdentity` created, with a temporary password printed once to the console.
   - Run it again. Expect it to refuse — a `MasterIdentity` already exists.
2. Visit `/master/sign-in` and sign in with `root` and the temporary password.
   - Expect to land on `/master`, and to be prompted to change the password before anything else is usable (FR-010).
3. Change the password. Expect subsequent MASTER pages/routes to work normally.
4. In a separate ordinary browser session, sign in as any existing marketplace `Account` (including a community administrator) and attempt to visit `/master` or call any `/api/master/*` route directly.
   - Expect a denial with no administrative data returned (FR-019, SC-001).

## Scenario 2 — A MASTER creates another MASTER, then manages it (User Story 3)

1. As the bootstrap MASTER, create a second MASTER (`ops`) via `/master/masters`.
   - Expect a temporary password shown exactly once.
2. Sign in as `ops` with that temporary password; confirm no administrative action succeeds until the password is changed.
3. As the original MASTER, disable `ops`. Confirm `ops`'s existing session is rejected on its next request and sign-in with valid-but-disabled credentials is refused.
4. Reactivate `ops`, then issue it a password reset; confirm the previous session (if any survived reactivation) is now also rejected and a fresh temporary password is required.
5. Attempt to disable yourself (the currently signed-in MASTER). Expect rejection (FR-014).
6. With only one active MASTER remaining, attempt to disable it. Expect rejection (FR-013).

## Scenario 3 — Creating a community both ways (User Story 4)

1. As a MASTER, create a community selecting an existing verified account as founding administrator.
   - Expect the community and its `ADMINISTRATOR` membership to exist immediately; the MASTER itself has no membership in it.
2. Create a second community, this time entering an email with no existing account and choosing "provision."
   - Expect a new verified `Account` created with a temporary password shown once, and the same atomic community+membership outcome.
3. Sign in as that newly provisioned administrator using the temporary password; confirm normal marketplace access to that one community, and confirm the account is not implicitly a member of any other community.
4. Repeat step 2 with an email that already has an unverified account. Expect the MASTER to be required to explicitly choose the managed-provisioning path or cancel — never a silent grant (Story 4, Scenario 4).

## Scenario 4 — MASTER manages a community from outside (User Story 5)

1. As a MASTER, edit the first community's name. Confirm the change is visible in the marketplace and that the audit log records the prior and new value.
2. Promote an existing member to administrator via the MASTER community-detail view.
3. With two administrators present, remove one, choosing the `revoke_membership` disposition. Confirm the removed account keeps its `Account` (and other memberships) intact but loses this one community's access.
4. With exactly one administrator remaining, attempt to remove them without supplying a replacement in the same request. Expect rejection (FR-030).
5. Confirm the MASTER itself never appears in that community's member roster.

## Scenario 5 — Community administrators share the load (User Story 6)

1. Sign in as a community administrator (not a MASTER) and promote an existing active member of the same community to administrator via the *existing* per-community route (not `/master/*`).
2. Confirm both accounts can now perform administrator actions (e.g. issuing an invitation).
3. Confirm neither can demote/remove the other if doing so would leave zero active administrators.
4. Suspend the community as a MASTER, then attempt the same promotion as a community administrator. Expect rejection.

## Scenario 6 — Ordinary account lifecycle (User Story 7)

1. As a MASTER, edit an account's display name and email; confirm uniqueness is enforced and the marketplace reflects the new values.
2. Suspend that account. Confirm it can no longer sign in and every existing session is dead immediately.
3. Reactivate it; confirm sign-in works again.
4. Issue a password reset; confirm the old password no longer works and the shown temporary password does, exactly once, then requires nothing further from the account owner (ordinary accounts are not forced to change it — spec.md Assumptions).
5. Attempt to suspend an account that is the sole administrator of a community, without a replacement assignment. Expect rejection with the affected community identified.
6. Repeat, this time supplying a valid replacement assignment. Expect success, and confirm the named community still has an active administrator afterward.
7. Permanently delete an account with existing listings and messages. Confirm: it can no longer sign in; its old email is free for a new sign-up; its historical listings/messages still display without error (an anonymized/placeholder identity reference, never a broken foreign key or another user's identity).
8. Have an administrator issue a pending (unaccepted) invitation to one of an account's email addresses. As a MASTER, edit that same account's email to a different address (step 1). Confirm the pending invitation is untouched — still bound to the original email, still only acceptable by an account verified at that original address — and that it does *not* become acceptable at the account's new email (FR-045). Have the administrator revoke it and issue a fresh invitation to the new address; confirm that one works normally.

## Scenario 7 — Suspension keeps read/reply, blocks growth (User Story 8)

1. As a MASTER, suspend an active community with a reason.
   - Expect `status: SUSPENDED`, `archiveScheduledAt` set ~30 days out.
2. As a current member, browse the community's existing listings and open/reply in an existing thread. Expect both to work.
3. Attempt to create a new listing, start a new thread, issue or accept an invitation, or promote a member. Expect every one of these rejected.
4. Pause an existing listing (allowed); attempt to reactivate a paused listing (rejected while suspended).
5. Reactivate the community as a MASTER before the deadline. Confirm all the above growth actions now work again, and `archiveScheduledAt` is cleared.
6. As a community administrator (not a MASTER), attempt to reactivate a suspended community directly. Expect rejection (FR — Story 8, Scenario 7).

## Scenario 8 — Automatic archival and idempotency (User Story 9)

1. Suspend a community, then directly set its `archiveScheduledAt` to a past timestamp (test-only DB manipulation — no clock-mocking dependency needed, mirrors this repo's existing direct-DB-setup pattern for other date-based tests).
2. Run `npx tsx scripts/archive-suspended-communities.ts`.
   - Expect the community to become `ARCHIVED`. Confirm directly against the database that **no** `Listing`, `MessageThread`, `Invitation`, or `Membership` row for this community was modified — archival only ever changes the `Community` row itself (`status`, `archivedAt`); `operationalEpoch` on every child row, and on the community, is untouched (research.md #8, data-model.md).
3. As a former member, attempt any ordinary marketplace route into that community. Expect denial, indistinguishable from not-found.
4. As a MASTER, inspect the archived community. Expect its full history (members, listings, threads, messages, invitations, audit trail) still visible.
5. Run the archival script again against the same community. Expect no error and no duplicate audit entry (FR-058).
6. Suspend a second community, reactivate it before its deadline, then run the archival script. Expect no state change to that community (its old scheduled job is now moot).

## Scenario 9 — Restoration opens a new operational epoch for exactly one administrator (User Story 10)

1. Take the archived community from Scenario 8 (with at least two prior members, one of them a former administrator). Note its current `operationalEpoch` (e.g. `1`) and the IDs of a pre-archive `Listing`, `MessageThread`/`Invitation`.
2. As a MASTER, restore it, selecting that one former administrator.
   - Expect `status: ACTIVE` and `operationalEpoch` incremented by exactly 1 (e.g. `1 → 2`). Confirm directly against the database that only the selected administrator's `Membership` row now carries the new epoch value — every other pre-restoration `Membership`, and every pre-restoration `Listing`/`MessageThread`/`Invitation`, still carries the *old* epoch value, unchanged.
3. As every *other* former member/administrator, attempt to access the restored community. Expect no automatic access — their membership's epoch no longer matches the community's current one.
4. Confirm the pre-archive `Listing`/`MessageThread`/`Invitation` noted in step 1 do not reappear in active feeds/inboxes/invitation-acceptance flows — each still carries the old epoch, which no longer matches.
5. As the restored administrator, invite a brand-new member and create a new listing. Confirm both are stamped with the community's *new* epoch and behave normally (visible in feeds, acceptable invitation) — normal operation resumes from the new epoch forward.
6. Attempt to restore a community that is currently `ACTIVE` or `SUSPENDED` (not `ARCHIVED`). Expect rejection both times, with no change to `operationalEpoch`.

## Scenario 10 — Every action is audited, no secrets leak, and rejections survive their own rollback (User Story 11)

1. Perform a representative sample of the actions above (master creation, community suspend/restore, account delete, the automatic archival transition).
2. With exactly one active MASTER remaining, attempt to disable it (last-MASTER guard — a deliberately *expected* rejection). Confirm the API response is the rejection (`409 last_active_master`) and, independently, confirm via the database that the target MASTER's `status` is still `ACTIVE` — the guarded mutation genuinely did not commit.
3. As a MASTER, query `/api/master/audit-log` filtered by date range, then by actor, then by target type/id.
   - Expect one entry per attempted action, including the last-MASTER rejection from step 2 with `outcome: FAILURE` and its failure reason — confirming the audit write for a rejected attempt survives even though the mutation it describes was rolled back (research.md #6's independent-write discipline; this is the specific behavior the earlier, incorrect design of writing the FAILURE entry *inside* the same aborted transaction would have silently lost). Every entry carries actor/target/timestamp/outcome, and the automatic archival entry is attributed to a system actor.
4. Inspect every returned `detail` payload. Expect no plaintext password, password hash, session token, invitation token, verification token, or access code anywhere.
5. As an ordinary account or community administrator, attempt to reach the audit log directly. Expect denial.

## Scenario 11 — Automated test suite

1. Run `npm run test:unit` — Vitest contract tests covering `masterAuthService.ts`, `masterSessionService.ts`, `communityLifecycleService.ts`, `masterAdministrationService.ts` (account management), and `auditService.ts`, alongside the full existing 002–008 contract suite unmodified except for the additive `operationalEpoch` filter changes noted in research.md #8 (and the SUCCESS/FAILURE audit-write discipline coverage from research.md #6). Per this feature's own Assumptions, critical-flow tests (MASTER auth/authz, bootstrap, last-MASTER/last-administrator guards, managed provisioning, suspend/archive/restore, audit integrity) are written first and confirmed failing (red) before implementation, per Constitution v4.1.0 Principles VIII and IX.
2. Run `npm run test:e2e` — Playwright specs driving MASTER sign-in, community creation (both founder modes), suspend/reactivate/restore, and account suspend/delete through a real browser, alongside the full existing 002–008 suite (no regressions).
