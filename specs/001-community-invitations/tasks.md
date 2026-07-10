---

description: "Task list for feature implementation"
---

# Tasks: Community Invitations

**Input**: Design documents from `/specs/001-community-invitations/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/invitations-api.yaml, quickstart.md

**Tests**: This feature IS the constitution's "membership invitation/acceptance" critical flow
(Constitution Principle VIII), so contract and integration tests are **mandatory** for every
user story below, not optional — they MUST be written before their corresponding implementation
task and MUST fail first (red) before that implementation makes them pass (green).

**Organization**: Tasks are grouped by user story (from spec.md) to enable independent
implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1-US5)
- Paths are relative to the repository root: `backend/`, `web/` (Next.js), `mobile/` (Expo/React Native)

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization for all three deliverables

- [X] T001 Create repository top-level structure per plan.md: `backend/`, `web/`, `mobile/` directories
- [X] T002 Initialize backend TypeScript project with Express, Prisma, `pg`, `jsonwebtoken` dependencies in `backend/package.json`
- [X] T003 [P] Initialize web Next.js + TypeScript project in `web/package.json`
- [X] T004 [P] Initialize mobile Expo + React Native + TypeScript project in `mobile/package.json`
- [X] T005 [P] Configure ESLint/Prettier for backend in `backend/.eslintrc.json`
- [X] T006 [P] Configure ESLint/Prettier for web in `web/.eslintrc.json`
- [X] T007 [P] Configure ESLint/Prettier for mobile in `mobile/.eslintrc.json`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T008 Define Prisma schema for `User`, `Community`, `Membership`, `Invitation` (fields/enums per data-model.md) in `backend/prisma/schema.prisma`
- [X] T009 Run initial Prisma migration and generate client (depends on T008)
- [X] T010 [P] Implement JWT auth middleware (verify access token, attach `req.user`) in `backend/src/middleware/auth.ts`
- [X] T011 [P] Implement community-scoped authorization middleware (`requireCommunityMembership`, `requireCommunityAdmin`) in `backend/src/middleware/communityScope.ts`
- [X] T012 [P] Implement invitation expiration helper (`computeExpiresAt`, `computeEffectiveStatus` per data-model.md) in `backend/src/utils/invitationExpiry.ts`
- [X] T013 [P] Implement email integration wrapper (`sendInvitationEmail`) around the existing email-sending capability in `backend/src/integrations/email.ts`
- [X] T014 Wire Express app (router mounting, JSON body parsing, error-handling middleware) in `backend/src/app.ts` (depends on T010, T011)
- [X] T015 [P] Configure Jest + Supertest test database setup/teardown helper in `backend/tests/setupTestDb.ts`
- [X] T016 [P] Configure typed REST API client (base URL, auth header injection) in `web/src/services/apiClient.ts`
- [X] T017 [P] Configure typed REST API client (base URL, auth header injection) in `mobile/src/services/apiClient.ts`

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - Administrator Invites and User Accepts (Priority: P1) 🎯 MVP

**Goal**: An administrator invites a prospective member by email/phone; the invited contact
accepts and immediately gains access to view, list, and buy within that community's marketplace.

**Independent Test**: Have an administrator invite a contact, have that contact accept, and
confirm the now-member can view the community's marketplace — without any other story implemented.

### Tests for User Story 1 (mandatory — critical flow) ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [X] T018 [P] [US1] Contract test `POST /communities/{communityId}/invitations` in `backend/tests/contract/test_create_invitation.ts`
- [X] T019 [P] [US1] Contract test `POST /invitations/{invitationId}/accept` in `backend/tests/contract/test_accept_invitation.ts`
- [X] T020 [P] [US1] Contract test `GET /users/me/invitations` in `backend/tests/contract/test_list_my_invitations.ts`
- [X] T021 [P] [US1] Integration test: full invite → accept → gain marketplace access flow in `backend/tests/integration/test_invite_accept_flow.ts`
- [X] T022 [P] [US1] Integration test: no self-service join/apply route exists anywhere in the API in `backend/tests/integration/test_no_self_join.ts`
- [X] T023 [P] [US1] Integration test: accept attempt on an expired invitation is rejected (FR-016/FR-017) in `backend/tests/integration/test_expired_invitation_accept_rejected.ts`

### Implementation for User Story 1

- [X] T024 [P] [US1] Implement `invitationService.createInvitation` (dedupe checks FR-013/FR-014, sets `expiresAt`) in `backend/src/services/invitationService.ts` (depends on T012)
- [X] T025 [P] [US1] Implement `membershipService.activateMembership` in `backend/src/services/membershipService.ts`
- [X] T026 [US1] Implement `POST /communities/:communityId/invitations` endpoint (admin-only) in `backend/src/api/invitations.ts` (depends on T024, T011)
- [X] T027 [US1] Implement `GET /communities/:communityId/invitations` endpoint (admin listing with `effectiveStatus`) in `backend/src/api/invitations.ts` (depends on T024)
- [X] T028 [US1] Implement `GET /users/me/invitations` endpoint in `backend/src/api/invitations.ts` (depends on T024)
- [X] T029 [US1] Implement `POST /invitations/:invitationId/accept` endpoint in `backend/src/api/invitations.ts` (depends on T024, T025)
- [X] T030 [US1] Implement `GET /communities/:communityId/members` endpoint in `backend/src/api/members.ts` (depends on T025, T011)
- [X] T031 [US1] Wire `sendInvitationEmail` into `invitationService.createInvitation` in `backend/src/services/invitationService.ts` (depends on T024, T013)
- [X] T032 [P] [US1] Build admin "Invite member" form/page in `web/src/pages/communities/[communityId]/invite.tsx` (depends on T016)
- [X] T033 [P] [US1] Build invitee "My invitations" accept screen in `web/src/pages/invitations/index.tsx` (depends on T016)
- [X] T034 [P] [US1] Build admin "Invite member" screen in `mobile/src/screens/InviteMemberScreen.tsx` (depends on T017)
- [X] T035 [P] [US1] Build invitee "My invitations" accept screen in `mobile/src/screens/MyInvitationsScreen.tsx` (depends on T017)
- [X] T036 [US1] Add validation/error handling for invite creation (missing contact info, duplicate invite/member, expired-invite messaging) across `backend/src/api/invitations.ts` and the web/mobile invite forms
- [X] T037 [US1] Add structured logging for invite-create and invite-accept actions in `backend/src/services/invitationService.ts`

**Checkpoint**: User Story 1 should be fully functional and independently testable (MVP)

---

## Phase 4: User Story 2 - Administrator Cancels a Pending Invite (Priority: P2)

**Goal**: The administrator who sent a pending invitation can cancel it before it's accepted.

**Independent Test**: Invite a contact, cancel before acceptance, confirm the contact can no
longer accept it.

### Tests for User Story 2 (mandatory — critical flow) ⚠️

- [ ] T038 [P] [US2] Contract test `DELETE /communities/{communityId}/invitations/{invitationId}` in `backend/tests/contract/test_cancel_invitation.ts`
- [ ] T039 [P] [US2] Integration test: cancel then attempted accept returns 409 in `backend/tests/integration/test_cancel_then_accept_fails.ts`
- [ ] T040 [P] [US2] Integration test: cancel attempt on an already-expired invitation is rejected in `backend/tests/integration/test_cancel_expired_invitation_fails.ts`

### Implementation for User Story 2

- [ ] T041 [US2] Implement `invitationService.cancelInvitation` (guarded by `effectiveStatus === PENDING`) in `backend/src/services/invitationService.ts` (depends on T024, T012)
- [ ] T042 [US2] Implement `DELETE /communities/:communityId/invitations/:invitationId` endpoint in `backend/src/api/invitations.ts` (depends on T041)
- [ ] T043 [P] [US2] Add "Cancel invite" action to admin invitations list in `web/src/pages/communities/[communityId]/invitations.tsx` (depends on T027)
- [ ] T044 [P] [US2] Add "Cancel invite" action to admin invitations list in `mobile/src/screens/CommunityInvitationsScreen.tsx` (depends on T027)

**Checkpoint**: User Stories 1 AND 2 both work independently

---

## Phase 5: User Story 3 - Invited User Declines an Invite (Priority: P2)

**Goal**: An invited person can decline instead of accepting, and the administrator can re-invite
the same contact later.

**Independent Test**: Invite a contact, have them decline, confirm no access is granted and a
later re-invite creates an independent new invitation.

### Tests for User Story 3 (mandatory — critical flow) ⚠️

- [ ] T045 [P] [US3] Contract test `POST /invitations/{invitationId}/decline` in `backend/tests/contract/test_decline_invitation.ts`
- [ ] T046 [P] [US3] Integration test: decline then re-invite same contact creates a new independent invitation in `backend/tests/integration/test_decline_then_reinvite.ts`

### Implementation for User Story 3

- [ ] T047 [US3] Implement `invitationService.declineInvitation` in `backend/src/services/invitationService.ts` (depends on T024, T012)
- [ ] T048 [US3] Implement `POST /invitations/:invitationId/decline` endpoint in `backend/src/api/invitations.ts` (depends on T047)
- [ ] T049 [P] [US3] Add "Decline" action to invitee's "My invitations" screen in `web/src/pages/invitations/index.tsx` (depends on T033)
- [ ] T050 [P] [US3] Add "Decline" action to invitee's "My invitations" screen in `mobile/src/screens/MyInvitationsScreen.tsx` (depends on T035)

**Checkpoint**: User Stories 1, 2, AND 3 all independently functional

---

## Phase 6: User Story 4 - Administrator Revokes a Member's Access (Priority: P2)

**Goal**: An administrator can revoke an existing member's access at any time; the member loses
marketplace access and their listings disappear, but historical transaction logs are untouched.

**Independent Test**: Revoke an existing member's access and confirm they immediately lose
view/list/buy ability while historical transaction logs involving them remain intact.

### Tests for User Story 4 (mandatory — critical flow) ⚠️

- [ ] T051 [P] [US4] Contract test `DELETE /communities/{communityId}/members/{userId}` in `backend/tests/contract/test_revoke_membership.ts`
- [ ] T052 [P] [US4] Integration test: revoke removes marketplace access and hides listings, while transaction logs remain intact in `backend/tests/integration/test_revoke_membership_flow.ts`

### Implementation for User Story 4

- [ ] T053 [US4] Implement `membershipService.revokeMembership` (guarded: target must be `ACTIVE`) in `backend/src/services/membershipService.ts` (depends on T025)
- [ ] T054 [US4] Implement `DELETE /communities/:communityId/members/:userId` endpoint in `backend/src/api/members.ts` (depends on T053, T011)
- [ ] T055 [P] [US4] Add "Revoke member" action to admin members list in `web/src/pages/communities/[communityId]/members.tsx` (depends on T030)
- [ ] T056 [P] [US4] Add "Revoke member" action to admin members list in `mobile/src/screens/CommunityMembersScreen.tsx` (depends on T030)

**Checkpoint**: User Stories 1-4 all independently functional

---

## Phase 7: User Story 5 - User Belongs to Multiple Communities Independently (Priority: P3)

**Goal**: A user with active memberships in multiple communities can act independently in each;
a status change in one community never affects another.

**Independent Test**: Accept invitations to two communities for the same user, revoke access in
one, and confirm access to the other is unaffected.

### Tests for User Story 5 (mandatory — critical flow) ⚠️

- [ ] T057 [P] [US5] Integration test: user active in community A, revoked in community A, remains active in community B in `backend/tests/integration/test_multi_community_independence.ts`

### Implementation for User Story 5

- [ ] T058 [US5] Audit/adjust all `Membership`/`Invitation` queries to strictly scope by `communityId` (and `userId` where relevant) with no implicit cross-community reads in `backend/src/services/membershipService.ts` and `backend/src/services/invitationService.ts` (depends on T024, T025, T053)
- [ ] T059 [P] [US5] Build "My communities" list screen showing independent status per community in `web/src/pages/communities/index.tsx` (depends on T016)
- [ ] T060 [P] [US5] Build "My communities" list screen in `mobile/src/screens/MyCommunitiesScreen.tsx` (depends on T017)

**Checkpoint**: All 5 user stories independently functional

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] T061 [P] Unit tests for `computeEffectiveStatus`/`computeExpiresAt` helper in `backend/tests/unit/test_invitation_expiry.ts`
- [ ] T062 [P] Unit tests for invitation dedupe/validation rules (FR-013, FR-014) in `backend/tests/unit/test_invitation_validation.ts`
- [ ] T063 [P] Documentation: link `contracts/invitations-api.yaml` from `backend/README.md`
- [ ] T064 Run all `quickstart.md` scenarios end-to-end against a local environment and record results
- [ ] T065 Security review pass confirming cross-community access is impossible for every endpoint (Constitution Principle II) across `backend/src/middleware/communityScope.ts` and `backend/src/api/*`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-7)**: All depend on Foundational phase completion
  - US2, US3, US4 build on entities/services created in US1 (`invitationService`, `membershipService`) but each adds an independent, separately testable capability
  - US5 depends on US1 (memberships must exist to observe) and US4 (revocation must exist to test independence after a revoke)
  - Recommended sequential order: US1 → US2 → US3 → US4 → US5 (matches priority and dependency order)
- **Polish (Phase 8)**: Depends on all desired user stories being complete

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- Services before endpoints
- Endpoints before web/mobile UI screens
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel (T003-T007)
- Foundational tasks marked [P] can run in parallel once T008/T009 (schema + migration) land (T010-T013, T015-T017)
- All tests for a user story marked [P] can run in parallel with each other
- Web and mobile UI tasks for the same story are always [P] with each other (different files/platforms)
- Different user stories cannot truly run in parallel by different developers here, since US2-US5 share `invitationService.ts`/`membershipService.ts` with US1 — treat US1 as required first, then US2-US4 can be parallelized across developers since they touch different functions in those shared files (coordinate merges)

---

## Parallel Example: User Story 1

```bash
# Launch all contract/integration tests for User Story 1 together:
Task: "Contract test POST /communities/{communityId}/invitations in backend/tests/contract/test_create_invitation.ts"
Task: "Contract test POST /invitations/{invitationId}/accept in backend/tests/contract/test_accept_invitation.ts"
Task: "Contract test GET /users/me/invitations in backend/tests/contract/test_list_my_invitations.ts"
Task: "Integration test full invite-accept flow in backend/tests/integration/test_invite_accept_flow.ts"
Task: "Integration test no self-service join route in backend/tests/integration/test_no_self_join.ts"
Task: "Integration test expired invitation accept rejected in backend/tests/integration/test_expired_invitation_accept_rejected.ts"

# Launch web + mobile UI for User Story 1 together (after endpoints exist):
Task: "Build admin Invite member form in web/src/pages/communities/[communityId]/invite.tsx"
Task: "Build invitee My invitations screen in web/src/pages/invitations/index.tsx"
Task: "Build admin Invite member screen in mobile/src/screens/InviteMemberScreen.tsx"
Task: "Build invitee My invitations screen in mobile/src/screens/MyInvitationsScreen.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Run quickstart.md Scenarios 1 and 2 independently
5. Deploy/demo if ready — administrators can invite, invitees can accept, no self-join path exists

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Deploy/Demo (MVP!)
3. Add User Story 2 (cancel) → Test independently → Deploy/Demo
4. Add User Story 3 (decline) → Test independently → Deploy/Demo
5. Add User Story 4 (revoke) → Test independently → Deploy/Demo
6. Add User Story 5 (multi-community independence) → Test independently → Deploy/Demo
7. Each story adds value without breaking previous stories

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Tests are mandatory for this feature (Constitution Principle VIII) — verify every test fails before implementing
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Avoid: vague tasks, same-file conflicts, cross-story dependencies that break independence
