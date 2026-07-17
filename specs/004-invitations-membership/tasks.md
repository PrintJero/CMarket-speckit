---

description: "Task list for Invitations & Membership"
---

# Tasks: Invitations & Membership

**Input**: Design documents from `/specs/004-invitations-membership/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/invitations-membership-api.md](./contracts/invitations-membership-api.md), [quickstart.md](./quickstart.md)

**Tests**: This feature creates and revokes membership — "membership invitation/acceptance" is a critical flow per Constitution Principle VIII. Tests are MANDATORY, MUST be written before their corresponding implementation, and MUST be confirmed failing (red) before that implementation is written.

**Organization**: Tasks are grouped by user story (spec.md priorities P1/P1/P2/P2/P2) wherever the stories are genuinely separable. **US1 and US2 are not separable at the service layer** (Phase 3), and **US3 and US5 are not separable at the service layer** (Phase 6) — see each phase's rationale. Each combined phase's tasks are still individually labeled by the story whose acceptance criterion they satisfy. Each story's UI-level delivery (the part that genuinely is separable) gets its own phase afterward.

## Path Conventions

Single existing Next.js/Prisma project (extends `002-accounts-authentication`, `003-community-creation`), per plan.md's Structure Decision — no new top-level project.

---

## Phase 1: Setup (Shared Infrastructure)

- [X] T001 Add the `Invitation` model and extend `MembershipRole` with `MEMBER` in `prisma/schema.prisma` per data-model.md (fields: `id`, `communityId`, `email`, `tokenHash` unique, `invitedBy`, `consumedAt` nullable, `createdAt`; relations to `Community` with `onDelete: Cascade` and `Account` via `invitedBy`), then run `prisma migrate dev --name add_invitation_and_member_role` and `prisma generate`. Never edit the database by hand (constitution: Migrations & Backups).

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: No user story task may begin until this phase is complete.

- [X] T002 [P] Write `tests/unit/test_current_account_memberships.ts` (research.md #7): `toCurrentAccountPayload(session)` called with no second argument still returns `memberships: []` (preserves the exact 003-era behavior `tests/unit/test_zero_membership_payload.ts` already locks in); `toCurrentAccountPayload(session, [{ communityId, communityName, role }])` returns that array verbatim in `memberships`. Confirm it FAILS (red) — the second parameter doesn't exist yet.
- [X] T003 Implement the extension in `src/lib/auth/currentAccount.ts` (research.md #7): change `CurrentAccountPayload.memberships` from the literal `[]` type to `MembershipSummary[]` (`{ communityId: string; communityName: string; role: MembershipRole }[]`); give `toCurrentAccountPayload(session, memberships: MembershipSummary[] = [])` the new optional, default-`[]` second parameter; update `getCurrentAccount()` to query `prisma.membership.findMany({ where: { accountId: session.accountId }, include: { community: { select: { name: true } } } })`, map to `MembershipSummary[]`, and pass it through. Confirm T002 passes (green), and confirm `tests/unit/test_zero_membership_payload.ts` and `tests/contract/test_create_community.ts`'s FR-015 assertion (both from prior features, calling the function with no second argument) still pass unmodified.

**Checkpoint**: Schema migrated; the current-account surface can now carry real membership data without having broken any existing feature's tests. User story implementation can begin.

---

## Phase 3: Core Invitation Issuance & Acceptance (User Stories 1, 2 combined)

**Why this phase is not split by story**: Per Constitution Principle I, the identity-binding check (FR-002, US2's core guarantee: the accepting account's email must exactly match the invited email) and the verification check (FR-003, US2's other guarantee) cannot be deferred past `acceptInvitation()`'s first working version — a version that only handled US1's already-verified-matching-account path and left the mismatch/unverified checks for "later" would, in the interim, let a wrong or unverified account accept someone else's invitation. So US1's and US2's service-level tests are written and confirmed red **together**, before the shared implementation tasks that must satisfy both **at once**.

### Tests ⚠️ Write first, confirm red

- [X] T004 [US1] Write `tests/contract/test_invitations_membership.ts` covering `inviteToCommunity()`, against real accounts/communities in the real test database:
  - Success: an administrator invites a syntactically valid, non-member email → `{ ok: true, invitation }`; exactly one `Invitation` row exists with `consumedAt: null` (FR-001).
  - FR-010: a caller with no `ADMINISTRATOR` membership in the target community (a `MEMBER`, or an unrelated account) → `{ ok: false, reason: "not_administrator" }`; no `Invitation` row created.
  - FR-011: the invited email already has an active `Membership` (any role) in the target community → `{ ok: false, reason: "already_member" }`; no `Invitation` row created.
  - FR-012: inviting the same email to the same community a second time while the first invitation is still unconsumed → the first row's `consumedAt` is set, the second remains the only acceptable one.
  - Invalid email syntax → `{ ok: false, reason: "invalid_email" }`; no row created.

  Confirm this file FAILS (red) — `inviteToCommunity` doesn't exist yet.

- [X] T005 [US1] In the same file, add `acceptInvitation()` coverage for the already-verified-matching-account path: an invitation accepted by an `Account` whose email exactly (case-insensitively) matches and is verified → `{ ok: true, membership }`; exactly one `MEMBER`-role `Membership` row links that account to the community; the `Invitation.consumedAt` is now set; a second acceptance attempt (same or different account) on the same token → rejected, no second `Membership` created (FR-005, SC-006). Confirm this case FAILS (red).

- [X] T006 [US2] In the same file, add `acceptInvitation()` rejection coverage, each distinguishable from the others:
  - No `Account` exists for the invited email → caller passes an accountId that doesn't resolve to any account (simulating the pre-signup state) → rejected, no `Membership` created (FR-004 Scenario 1's underlying guarantee — see contracts.md's note that in the real API this surfaces as `401` before this function is even reached).
  - A matching `Account` exists but is unverified → `{ ok: false, reason: "not_verified" }`; no `Membership` created (FR-003).
  - A verified `Account` whose email does *not* match the invited email → `{ ok: false, reason: "email_mismatch" }`; no `Membership` created, regardless of that account's own verification status (FR-002).
  - Confirm each case FAILS (red).

### Implementation

- [X] T007 [US1] Implement `inviteToCommunity({ communityId, email, invitedByAccountId })` in `src/server/services/invitationService.ts` (contracts/invitations-membership-api.md): validate email via the existing `isValidEmail()`; look up the caller's own `Membership` for `communityId` and require `role === "ADMINISTRATOR"` (`requireCommunityAdministrator()`, research.md #8) before anything else; normalize the email (`normalizeEmail()`) and, if a matching `Account` exists, check its `Membership` for `communityId` — reject `already_member` if found; otherwise, inside one `prisma.$transaction` (research.md #4, mirroring `createCommunity()`'s pattern), mark any existing unconsumed `Invitation` for this (email, communityId) pair consumed and create the new one with a fresh hashed token (same `randomBytes(32)`/SHA-256 scheme as `verificationService.ts`); send the invitation email via the existing `sendEmail()`. Confirm T004 passes (green).
- [X] T008 [US1/US2] Implement `acceptInvitation({ token, accountId })` in the same file, **complete and safe from its first committed version**: look up the `Invitation` by `tokenHash`; if missing or already consumed, reject (`invalid_or_consumed`); look up the `Account` by `accountId` — reuse `assertEmailVerified()` (FR-003) and `emailsMatch()` (FR-002) against `Invitation.email`, rejecting with `not_verified` or `email_mismatch` respectively *before* opening any transaction; otherwise, inside one `prisma.$transaction`, consume the invitation via `tx.invitation.updateMany({ where: { id: invitation.id, consumedAt: null }, data: { consumedAt: new Date() } })` and check the returned `count` — `0` means another request already consumed it in the meantime, reject `invalid_or_consumed` and create nothing — mirroring `consumeVerificationToken`'s `updateMany`-then-check-count pattern (data-model.md's Invitation validation rules) rather than a plain read-then-write, which is not atomic under `READ COMMITTED`; only once `count === 1` create the `MEMBER`-role `Membership` in the same transaction (the existing `@@unique([accountId, communityId])` constraint is the backstop against a duplicate membership, not the primary single-use guarantee). Confirm T005 AND T006 **both** pass together (green) — this is one commit, not two.

**Checkpoint**: `inviteToCommunity()` and `acceptInvitation()` are complete and safe — no code path can accept an invitation for a mismatched, unverified, or nonexistent account, and no invitation can be used twice. This is the minimum safe deliverable of this feature.

---

## Phase 4: User Story 1 - Reachable end-to-end for an already-verified invitee (Priority: P1) 🎯 MVP

**Goal**: An administrator can actually invite someone through the real app, and that person — already holding a verified account with the matching email — can actually accept through the real app.

**Independent Test**: As an administrator, submit the invite form for a second, verified account's email; retrieve the emailed link; open it signed in as that account; accept; confirm the membership is now visible.

### Tests ⚠️ Write first, confirm red

- [X] T009 [US1] Write `tests/integration/test_invitation_membership_flow.spec.ts` (Playwright): administrator signs in, visits `/communities/{communityId}/admin`, submits the invite form with a second, already-verified account's email; test fetches the captured email via the existing `/api/test/last-email` sink (`tests/integration/helpers.ts`) and extracts the `/invitations/accept?token=...` link; signs in as the invitee and opens that link; accepts; asserts the community now appears in the invitee's home page (`/`) membership list. Confirm it FAILS (red) — no routes/pages exist yet.

### Implementation

- [X] T010 [US1] Implement `POST /api/communities/[communityId]/invitations/route.ts`: parses `{ email }`, calls `inviteToCommunity()` with the signed-in caller's accountId, maps its result to the status codes in contracts.md (`201`/`400`/`403`/`409`).
- [X] T011 [US1] Implement `app/api/invitations/accept/route.ts` with both `GET` (returns `{ communityName, email }` metadata for an unconsumed token, or `400 invalid_or_consumed`) and `POST` (parses `{ token }`, requires a signed-in session, calls `acceptInvitation()`, maps to `200`/`400`/`403`/`409` per contracts.md).
- [X] T012 [US1] Implement `app/communities/[communityId]/admin/page.tsx` + `InviteForm.tsx` (mirrors `OperatorCreateCommunityForm`'s client-component pattern): server component calls `requireCommunityAdministrator()`-equivalent check directly (`prisma.membership.findUnique`) and renders `notFound()` for any non-administrator, same convention as the existing `/operator` page; shows the invite form and a read-only list of current members (email, role) — no revoke action yet (Phase 7).
- [X] T013 [US1] Implement `app/invitations/accept/page.tsx`: reads `token` from the URL, calls the new `GET` metadata endpoint; if signed in, shows an "Accept invitation to {communityName}" confirmation that calls the `POST` endpoint; if signed out, shows a message naming the invited email and directing the visitor to sign in or sign up with that exact address, then return to this same link (research.md #9 — no automatic redirect chaining).
- [X] T014 [US1] Extend `app/page.tsx`'s signed-in view: render `account.memberships` (now real, per Phase 2) as a list, linking `ADMINISTRATOR` rows to `/communities/{communityId}/admin`; the existing "you don't belong to any community yet" empty state remains for a genuinely empty list.

Confirm T009 passes (green).

**Checkpoint**: MVP. An administrator and an already-verified invitee can complete the entire invite→accept flow through the real application.

---

## Phase 5: User Story 2 - Sign up and verify first, then return to accept (Priority: P1)

**Goal**: Someone invited without a matching account yet can sign up, verify, and then successfully accept the still-pending invitation — entirely through the real application, using the existing 002-accounts-authentication flow for the sign-up/verify part.

**Independent Test**: Invite an email with no matching account; confirm the accept page correctly guides a signed-out visitor; sign up and verify with that exact email via the existing flow; return to the same accept link; accept succeeds.

### Tests ⚠️ Write first, confirm red

- [X] T015 [US2] Extend `tests/integration/test_invitation_membership_flow.spec.ts`: administrator invites an email with no existing account; test opens the accept link signed out and asserts the page names that email and links to sign-up/sign-in (not a crash or a silent no-op); test then signs up with that exact email via the existing `/sign-up` flow, retrieves and follows the verification link (`getVerificationLink()` helper, reused from 002's tests), signs in, and re-opens the original accept link; asserts acceptance now succeeds and the `MEMBER` `Membership` row exists. Confirm this spec's new assertions FAIL (red) if run before Phase 4's pages exist; if Phase 4 is already merged, confirm it exercises a genuinely new path (the sign-up-first branch) not covered by T009.

### Implementation

- [X] T016 [US2] No new service code is expected — Phase 3's `acceptInvitation()` and Phase 4's pages already implement every check this path needs. If T015 fails, the fix belongs in T013's accept-page copy/flow (e.g., the signed-out guidance not naming the correct email, or not surfacing a link back after verification) — fix forward there rather than adding new logic elsewhere. Confirm T015 passes (green) once addressed.

**Checkpoint**: User Stories 1 and 2 both independently verified end-to-end.

---

## Phase 6: Core Membership Revocation (User Stories 3, 5 combined)

**Why this phase is not split by story**: Per Constitution Principle III's last-admin guard (FR-009, US5's core guarantee), `revokeMembership()` cannot ship a version that only handles US3's ordinary-member happy path and defers the administrator-count check for "later" — doing so would, in the interim, let a community's last administrator be deleted. The count-then-delete guard (research.md #5) must exist from this function's first working version, so US3's and US5's service-level tests are written and confirmed red together, before the one implementation task that satisfies both at once.

### Tests ⚠️ Write first, confirm red

- [X] T017 [US3] In `tests/contract/test_invitations_membership.ts`, add `revokeMembership()` coverage: an administrator revokes an existing `MEMBER`'s membership → `{ ok: true }`; the `Membership` row no longer exists; the revoked account's own credentials/verification state and its memberships in unrelated communities are unchanged (FR-007). Also: a caller with no `ADMINISTRATOR` membership in the target community → `{ ok: false, reason: "not_administrator" }` (FR-010); a `membershipId` that doesn't belong to `communityId` (or doesn't exist) → `{ ok: false, reason: "not_found" }`. Confirm these FAIL (red).
- [X] T018 [US5] In the same file, add the last-admin guard coverage: a community with exactly one `ADMINISTRATOR` membership → attempting to revoke it → `{ ok: false, reason: "last_admin" }`; that membership is unchanged afterward (FR-009). A community with two `ADMINISTRATOR` memberships → revoking one → `{ ok: true }`, and exactly one administrator membership remains. Confirm these FAIL (red).

### Implementation

- [X] T019 [US3/US5] Implement `revokeMembership({ communityId, membershipId, revokedByAccountId })` in `src/server/services/invitationService.ts`: require the caller's own `ADMINISTRATOR` membership in `communityId` (reusing the same `requireCommunityAdministrator()` helper as T007) before anything else; inside one `prisma.$transaction(async (tx) => ..., { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })` — plain default-isolation `$transaction` wrapping does NOT close the concurrent-revoke race (research.md #5's correction: two `READ COMMITTED` transactions can both read `count = 2` before either commits); `Serializable` isolation is what makes Postgres detect and abort one of two conflicting concurrent revokes — look up the target `Membership`, verify it belongs to `communityId` (else `not_found`), and — if its role is `ADMINISTRATOR` — count that community's current `ADMINISTRATOR` memberships; if the count is `1`, abort and return `{ ok: false, reason: "last_admin" }` without deleting anything; otherwise delete the row and return `{ ok: true }`. Catch the Prisma write-conflict error (`P2034`) around the `$transaction` call and map it to `{ ok: false, reason: "conflict" }` rather than letting it surface as an uncaught error. Confirm T017 AND T018 **both** pass together (green).

**Checkpoint**: `revokeMembership()` is complete and safe — no code path can ever leave a community with zero administrators. This, not either story alone, is the minimum safe deliverable of this phase.

---

## Phase 7: User Story 3 - Revocation reachable end-to-end, with the guard visible in the UI (Priority: P2)

**Goal**: An administrator can actually revoke a member through the real admin page, and the last-admin guard (US5) is visibly enforced there too, not just at the service layer.

**Independent Test**: As an administrator, click Revoke next to an ordinary member on `/communities/{communityId}/admin`; confirm they disappear from the list. Attempt the same action on the community's sole administrator; confirm an inline rejection and no change.

### Tests ⚠️ Write first, confirm red

- [X] T020 [US3] Extend `tests/integration/test_invitation_membership_flow.spec.ts`: administrator clicks Revoke next to the `MEMBER` accepted in Phase 4/5's scenarios on `/communities/{communityId}/admin`; asserts that row disappears and the member's account/other-community standing is unaffected. Confirm it FAILS (red) — no revoke route/button exists yet.
- [X] T021 [US5] In the same spec, add: attempting to revoke the community's sole remaining `ADMINISTRATOR` row shows an inline error and the row remains. Confirm it FAILS (red) alongside T020.

### Implementation

- [X] T022 [US3] Implement `DELETE /api/communities/[communityId]/memberships/[membershipId]/route.ts`: calls `revokeMembership()` with the signed-in caller's accountId, maps its result to `204`/`403`/`404`/`409` per contracts.md.
- [X] T023 [US3/US5] Extend `app/communities/[communityId]/admin/page.tsx`'s member list from T012 with a Revoke action per row, calling the new route and refreshing the list on success; render an inline error message when the response is `409 last_admin` or `403 not_administrator`. Confirm T020 AND T021 both pass (green).

**Checkpoint**: All of User Story 3, and User Story 5's visible enforcement, verified end-to-end.

---

## Phase 8: User Story 4 - Revoke-then-reinvite always succeeds (Priority: P2)

**Goal**: Confirm, explicitly and by name, the constitution's invitation-lifecycle guarantee: revoking a member never blocks re-inviting that exact email later.

**Independent Test**: Invite, accept, revoke, then immediately re-invite the same email to the same community; confirm the second invitation is created and can itself be accepted.

- [X] T024 [US4] In `tests/contract/test_invitations_membership.ts`, add a composition test: invite email E to community C, accept it (via `acceptInvitation()`), revoke the resulting membership (via `revokeMembership()`), then immediately invite E to C again (via `inviteToCommunity()`) — assert the second invitation succeeds with no error, no cooldown, and no special-casing (FR-008); accept it and assert a fresh `MEMBER` `Membership` row is created (SC-004). This composes Phase 3's and Phase 6's already-implemented functions and is expected to pass without new production code — if it fails, the fix belongs wherever the accidental block was introduced (most likely FR-011's `already_member` check in `inviteToCommunity()`, which must key off *current* membership state, not history), not in new feature code. Confirm it FAILS if run before Phase 6 exists, and passes (green) once Phase 6 is complete.

**Checkpoint**: All five user stories independently verified.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [X] T025 [P] Run `npm run typecheck` and `npm run lint`; fix any issues introduced by this feature.
- [X] T026 [P] Run `npm run test:unit` (covers `tests/unit` and `tests/contract`, including this feature's full contract-test file) and `npm run test:e2e` (Playwright); confirm the whole suite is green, including a regression check that 002/003's existing tests (`test_zero_membership_payload.ts`, `test_create_community.ts`, all `test_signup_*`/`test_google_*` specs) still pass unmodified.
- [X] T027 Manually execute quickstart.md Scenarios 1–8 end-to-end against the real dev/test PostgreSQL database and a running dev server; record the results.
- [X] T028 Re-check plan.md's Constitution Check against the finished implementation: confirm no new violations, the last-admin guard is enforced (not merely modeled, as 003 left it), and the `CurrentAccountPayload` extension didn't disturb 002/003's own hardcoded-empty assertions.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately.
- **Foundational (Phase 2)**: Depends on Setup (T001's migration must exist before T002/T003's Prisma-backed code compiles). BLOCKS all user stories.
- **Phase 3 (Core invite/accept)**: Depends on Foundational. T004/T005/T006 (tests, same file) MUST all be written and confirmed red before T007/T008 (implementation). BLOCKS Phases 4–5 and Phase 8.
- **Phase 4 (US1 delivery)**: Depends on Phase 3.
- **Phase 5 (US2 delivery)**: Depends on Phase 4 (reuses its pages/routes).
- **Phase 6 (Core revoke)**: Depends on Foundational; independent of Phases 3–5 at the service layer, but shares `tests/contract/test_invitations_membership.ts` with Phase 3 and reuses `requireCommunityAdministrator()` from Phase 3's T007 — start after Phase 3 to avoid merge friction on that shared file/helper. BLOCKS Phase 7 and Phase 8.
- **Phase 7 (US3 delivery)**: Depends on Phase 6 and on Phase 4 (extends the admin page T012 already built).
- **Phase 8 (US4 composition test)**: Depends on Phase 3 AND Phase 6 both being complete (it calls all three service functions together).
- **Polish (Phase 9)**: Depends on all prior phases being complete.

### Parallel Opportunities

- T002 has no sibling in Phase 2 to parallelize against (T003 depends on it) — Phase 2 is effectively sequential.
- T004, T005, and T006 are **NOT** parallel with each other — all three extend the same file (`tests/contract/test_invitations_membership.ts`) and must all exist before T007/T008.
- T017 and T018 are likewise **NOT** parallel — same file, same reason.
- T025 and T026 (Polish) — independent checks, can run in parallel.

---

## Parallel Example: Phase 3 Tests

```bash
# These three all extend the same file and must be written together before implementation,
# so they are sequenced, not parallelized:
Task: "Add inviteToCommunity() coverage to tests/contract/test_invitations_membership.ts"
Task: "Add acceptInvitation() success-path coverage to the same file"
Task: "Add acceptInvitation() rejection coverage to the same file"
```

---

## Implementation Strategy

### MVP First (Core invite/accept + US1's delivery)

1. Complete Phase 1 (Setup) and Phase 2 (Foundational).
2. Complete **all** of Phase 3 (T004–T008) — not optional or story-scoped; per Principle I, the identity-binding and verification gates MUST exist from `acceptInvitation()`'s very first working version.
3. Complete Phase 4 (T009–T014, US1's real-app delivery).
4. **STOP and VALIDATE**: run quickstart.md Scenario 1; confirm T002/T004–T009 are all green.
5. This is a legitimate MVP: an administrator can invite an already-verified person and that person can accept, entirely through the real application.

### Incremental Delivery

1. Setup + Foundational → foundation ready.
2. Phase 3 (invite/accept safety, both stories together) → the flow can never accept a wrong or unverified account.
3. Phase 4 (US1 delivery) → MVP: usable end-to-end for the common case.
4. Phase 5 (US2 delivery) → the sign-up-first path also works end-to-end.
5. Phase 6 (revoke safety, both stories together) → the flow can never orphan a community.
6. Phase 7 (US3 delivery, US5 visible) → revocation and its guard are both usable end-to-end.
7. Phase 8 (US4) → the lifecycle guarantee is verified explicitly, by name.
8. Polish.

---

## Notes

- [P] tasks touch different files with no dependency on each other; within this feature, that applies only to Phase 2's isolated pieces and Phase 9's independent checks — most other tasks share a file with a sibling task and are intentionally sequenced instead.
- [Story] labels map every task to the spec.md story whose acceptance criterion it satisfies — in Phases 3 and 6, multiple story labels attach to tests verified by one shared implementation task; this is documented, not an oversight (mirrors 003-community-creation's Phase 3 precedent).
- Commit after each task or logical group.
- Stop at any checkpoint to validate independently.
- Both Vitest (contract/unit) and Playwright (integration) are used in this feature, unlike 003-community-creation — this feature has real pages/routes for Playwright to exercise (research.md #9).
