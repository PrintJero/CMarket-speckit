# Research: Invitations & Membership

## 1. Invitation as a single-use, hashed token — mirroring `VerificationToken`

**Decision**: `Invitation` carries a `tokenHash` (SHA-256 of a `randomBytes(32)` base64url raw token, identical scheme to `VerificationToken` in `src/server/services/verificationService.ts`). The raw token is only ever emailed, never persisted. Acceptance is `POST /api/invitations/accept` with the raw token plus the caller's session; `consumedAt` (nullable timestamp) marks it permanently unusable, exactly like `VerificationToken.consumedAt`.

**Rationale**: The constitution names this directly — Principle I: "invitation tokens MUST be single-use" — and the spec's own input says the identity-binding rule is "consistent with the verification pattern already used for VerificationToken." Reusing the same hash/random-token scheme means no new cryptographic pattern is introduced, and single-use is enforced the same proven way (a nullable `consumedAt`, guarded atomically at consumption).

**Alternatives considered**: A short human-typed code (like an access code) — rejected: access codes are a separate, constitutionally-deferred credential form (reusable/bulk, out of scope for this feature per spec). Storing the raw token in plaintext for lookup convenience — rejected for the same reason `VerificationToken` doesn't: a leaked database dump would otherwise hand out live invitations.

## 2. No expiration field on `Invitation`

**Decision**: `Invitation` has no `expiresAt`. It remains acceptable until consumed (accepted) or superseded by a newer invitation to the same (email, community) pair (see #4). No cron/sweep job or time-based cutoff is introduced.

**Rationale**: The spec's Out of Scope explicitly excludes "sophisticated auto-expiration policy beyond what's already decided at the constitution level," and the constitution only ties expiration to the separately-deferred access-code path (Principle I), not to direct email invitations. Adding a time cutoff here would be unrequested scope per Principle VII.

**Alternatives considered**: Copying `VerificationToken`'s 24-hour `expiresAt` — rejected: that duration was chosen for a self-service, low-friction signup flow; nothing in this spec calls for the same value for an administrator-issued credential, and inventing one now would be exactly the "sophisticated policy" the spec defers.

## 3. Revoke = delete the `Membership` row (not a soft-delete flag)

**Decision**: `revokeMembership()` deletes the `Membership` row outright via `prisma.membership.delete`. No `revokedAt` column is added to `Membership`.

**Rationale**: The spec explicitly leaves "deleting or marking it revoked" as an implementation choice. Deleting is simpler (Principle VII: no new column, no filter-out-revoked-rows logic needed anywhere a `Membership` is read) and is exactly what re-invite (User Story 4) needs: with the row gone, `@@unique([accountId, communityId])` no longer blocks a fresh membership from a later re-acceptance — a soft-delete flag would require every existing and future membership query in the codebase to remember to filter it out, which is a correctness trap with no offsetting benefit here (nothing in this feature's scope needs a historical "was once revoked" record). This mirrors the existing precedent in this codebase: `Session` deletion is already how this project models "no longer has access" (`sessionService.ts`'s `deleteSession`), not a revoked flag.

**Alternatives considered**: Soft-delete (`revokedAt` timestamp, kept row) — rejected per above; would also require the last-admin count query (#5) to add a `revokedAt: null` filter everywhere, an easy place for a future feature to introduce a leak by forgetting it.

## 4. Re-inviting supersedes any still-pending invitation for the same (email, community) pair

**Decision**: Issuing an invitation first marks any existing unconsumed `Invitation` for that exact (email, community) pair as consumed (`consumedAt: new Date()`), then creates the new row — both in one `prisma.$transaction`, mirroring `reissueVerificationToken`'s update-then-create pattern.

**Rationale**: Keeping at most one live invitation per (email, community) pair avoids ambiguity about which link is "the real one" and avoids the added complexity of the coexisting-tokens model 002-accounts-authentication uses for sign-up (that model exists there specifically to protect a user's *own* competing sign-up attempts from destroying each other — no analogous concern exists here, since only the community's administrator, a single trusted actor per community, ever issues invitations).

**Alternatives considered**: Rejecting the second invite attempt outright while one is already pending — rejected: it would force an administrator to know and separately revoke a stale invitation before correcting a typo'd email or simply re-sending a lost one, adding friction the spec never asks for. Letting multiple pending invitations coexist per pair — rejected as unnecessary complexity (see Rationale).

## 5. Last-admin guard: count `ADMINISTRATOR` memberships inside the same transaction as the delete

**Decision**: `revokeMembership()` runs inside `prisma.$transaction(async (tx) => ...)`. Inside it: look up the target `Membership` by id; if its role is `ADMINISTRATOR`, count `tx.membership.count({ where: { communityId, role: "ADMINISTRATOR" } })` — if that count is `1` (i.e., the row about to be deleted is the only one), abort and return `{ ok: false, reason: "last_admin" }` without deleting anything; otherwise proceed with the delete in the same transaction.

**Rationale**: This is exactly the guard 003-community-creation's data-model.md anticipated ("a community's administrator count is derived by counting its `Membership` rows with `role = ADMINISTRATOR`") and the one no prior feature could implement because no removal path existed yet (003's FR-010, deferred there). Doing the count-then-delete inside one transaction (the same `prisma.$transaction` pattern `createCommunity()` already uses for its own atomic community+membership insert) closes the race where two concurrent revokes against the last two administrators could otherwise both read "count = 2" and both proceed, leaving zero.

**Alternatives considered**: Checking the count before opening a transaction, then deleting in a separate statement — rejected: reintroduces exactly the race described above (TOCTOU gap between the check and the delete).

## 6. Reusing `assertEmailVerified` and `emailsMatch` for the identity-binding accept gate

**Decision**: `acceptInvitation()` calls the existing `assertEmailVerified(accountId)` from `src/server/services/accountService.ts` and the existing `emailsMatch(a, b)` from `src/lib/validation/email.ts`, rather than re-implementing either check.

**Rationale**: `assertEmailVerified` is already documented in its own source as "the gate consumed by the (separate) invitations feature" — this feature is exactly that consumer. `emailsMatch` already implements the case-insensitive exact-match rule (FR-017 of 002-accounts-authentication) this spec's FR-002 explicitly asks to reuse ("identity binding, consistent with the verification pattern already used for VerificationToken"). Reimplementing either would risk drift between the two features' notions of "verified" and "same email."

**Alternatives considered**: An inline `account.emailVerifiedAt !== null` / `a.toLowerCase() === b.toLowerCase()` check — rejected as needless duplication of already-correct, already-tested logic, and the specific thing 003's own code comment asked the next feature not to do.

## 7. Extending the current-account payload to real memberships without breaking 002/003's existing tests

**Decision**: `CurrentAccountPayload.memberships` changes from the literal type `[]` to `MembershipSummary[]` (`{ communityId, communityName, role }[]`). `toCurrentAccountPayload(session, memberships = [])` gains a second, optional parameter that **defaults to `[]`** when omitted. `getCurrentAccount()` (`src/lib/auth/currentAccount.ts`) is the only caller that now performs a real `prisma.membership.findMany({ where: { accountId }, include: { community: { select: { name: true } } } })` query and passes the result through as that second argument.

**Rationale**: 003-community-creation's FR-015 deliberately kept this payload hardcoded-empty and named the reason explicitly in its own spec: "deferred to a future feature that deliberately surfaces community membership to end users." This is that feature — an administrator needs a way to actually reach their community's admin page, and a member needs to see they belong somewhere, neither of which is possible while this payload stays hardcoded. Making the new parameter optional-with-default means every existing call site in `tests/unit/test_zero_membership_payload.ts` and `tests/contract/test_create_community.ts` (which call `toCurrentAccountPayload({...session fields only...})`) continues to receive `memberships: []` unchanged — those tests keep asserting exactly what they always asserted (the *session-payload-construction* function is still pure and still defaults to empty), while only the async, DB-backed `getCurrentAccount()` wrapper now supplies real data. No existing test needs to change.

**Alternatives considered**: Building a separate, brand-new "my communities" endpoint/page instead of touching the existing payload — rejected: it would leave `app/page.tsx`'s home view (which already reads `getCurrentAccount()` and today renders a hardcoded "you don't belong to any community yet" empty state with a comment pointing at exactly this gap) still wrong, and would duplicate the same membership query in two places. Making the parameter required (forcing every call site to pass memberships explicitly) — rejected: it would force edits to 002/003's own test files for no behavioral reason, when a default achieves the identical result with a strictly smaller diff.

## 8. Authorization: a lightweight per-request administrator check, not a new middleware layer

**Decision**: Both the invite and revoke service functions independently look up the caller's own `Membership` row for the target `communityId` (`prisma.membership.findUnique({ where: { accountId_communityId: { accountId, communityId } } })`) and require `role === "ADMINISTRATOR"` before doing anything else. No new global middleware, session-claims cache, or role-check decorator is introduced.

**Rationale**: This project has no `middleware.ts` and no precedent for centralized route guards — every existing route (`sign-in`, `verify-email`, the operator panel) does its own inline check. A single unique-indexed lookup (`@@unique([accountId, communityId])`) is O(1) and needs no new infrastructure. Principle VII favors this over introducing a new cross-cutting authorization layer for two call sites.

**Alternatives considered**: A shared `requireCommunityAdministrator()` helper function — actually adopted, but as a small shared function in the service layer (not a framework-level middleware), since both invite and revoke need the identical check; this avoids duplicating the same Prisma call twice while still not introducing new infrastructure.

## 9. Testing stack: Vitest (contract/unit) + Playwright (integration) — both needed, unlike 003

**Decision**: Follow 002-accounts-authentication's stack exactly: `tests/contract/*.ts` (Vitest, calling `inviteToCommunity()`/`acceptInvitation()`/`revokeMembership()` directly against the real test Postgres DB) for the critical-flow, red-then-green coverage Principle VIII requires; `tests/integration/*.spec.ts` (Playwright) for the actual HTTP routes and pages a real administrator/invitee would drive in a browser (invite form submission, the accept-link page, the revoke button).

**Rationale**: Unlike 003-community-creation (which had no networked surface at all — FR-002 forbade one), this feature *is* reachable from the end-user app by design (an administrator's invite form, an invitee's accept page) per this spec's own Assumptions. That means, unlike 003, there is real browser-observable behavior for Playwright to exercise, so both layers of the existing stack apply here, exactly as they did for 002's sign-up/verify/sign-in flows.

**Alternatives considered**: Vitest-only, treating the route handlers as thin wrappers not worth a browser test — rejected: Principle VIII's critical-flow list names "membership invitation/acceptance" specifically, and 002's own precedent already covers the equivalent case (verification-link consumption) with a Playwright spec (`test_signup_verification_flow.spec.ts`), which this feature's accept-link flow is structurally identical to.

## 10. Reusing `sendEmail()` for the invitation link

**Decision**: `inviteToCommunity()` sends the invitation link the same way `signUp()` sends its verification link: via `sendEmail()` from `src/lib/email/sendEmail.ts`, with a `${NEXTAUTH_URL}/invitations/accept?token=...` link, so the existing dev/test-capture transport (`EMAIL_TEST_CAPTURE=true` + `getCapturedEmails`/`tests/integration/helpers.ts`'s `last-email` sink) works for this feature's Playwright tests with zero new test infrastructure.

**Rationale**: `sendEmail()` is already provider-agnostic and already has a working test-capture path wired into `tests/api/test/last-email/route.ts` and `tests/integration/helpers.ts`. Reusing it is both the smaller diff and the only way to keep the invitation flow's Playwright tests symmetric with the existing verification-flow test.

**Alternatives considered**: A separate email-sending path for invitations — rejected as pure duplication of an already-generic abstraction with no feature-specific need it doesn't already meet.
