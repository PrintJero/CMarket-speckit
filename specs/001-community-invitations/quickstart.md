# Quickstart: Community Invitations

Validates the invitation/membership lifecycle end-to-end against the
backend API described in [contracts/invitations-api.yaml](./contracts/invitations-api.yaml)
and [data-model.md](./data-model.md).

## Prerequisites

- PostgreSQL running and reachable, with the Prisma schema for `User`,
  `Community`, `Membership`, and `Invitation` migrated in.
- Backend running locally with the existing email-sending service
  reachable (or its integration point stubbed/mocked for local runs).
- Two seeded users: an administrator (with an `ADMIN`, `ACTIVE`
  Membership in a seeded Community) and a prospective member (a plain
  `User` row with a known email, not yet a member of that Community).
- A valid JWT for the administrator and, later, for the prospective member
  (obtained via whatever login flow exists outside this feature's scope).

## Scenario 1: Invite → Accept (User Story 1, P1)

1. As the administrator, call `POST /communities/{communityId}/invitations`
   with the prospective member's email.
   - **Expect**: `201`, response body has `effectiveStatus: "PENDING"`.
2. Confirm the email-sending integration was invoked once for this
   invitation (via mock/log in local runs).
3. As the prospective member, call `GET /users/me/invitations`.
   - **Expect**: the invitation appears with `effectiveStatus: "PENDING"`.
4. As the prospective member, call
   `POST /invitations/{invitationId}/accept`.
   - **Expect**: `200`, response includes a `membership` with
     `status: "ACTIVE"`.
5. As the prospective member, call
   `GET /communities/{communityId}/members`.
   - **Expect**: `200` (access now granted — was `403`/`404` before
     acceptance).

## Scenario 2: No self-service join path (User Story 1, edge case)

1. Search the API contract and running server for any route that lets a
   user request/apply to join a community without an existing invitation.
   - **Expect**: no such route exists in `contracts/invitations-api.yaml`
     or in the deployed API.

## Scenario 3: Administrator cancels a pending invite (User Story 2, P2)

1. As the administrator, create a new invitation (as in Scenario 1, step 1).
2. Call `DELETE /communities/{communityId}/invitations/{invitationId}`.
   - **Expect**: `204`.
3. As the invited contact, attempt
   `POST /invitations/{invitationId}/accept`.
   - **Expect**: `409` (no longer PENDING).

## Scenario 4: Invitee declines (User Story 3, P2)

1. As the administrator, create a new invitation for a different contact.
2. As that contact, call `POST /invitations/{invitationId}/decline`.
   - **Expect**: `200`, `effectiveStatus: "DECLINED"`.
3. Confirm `GET /communities/{communityId}/members` for that user still
   returns `403`/`404` (no access granted).
4. As the administrator, invite the same contact again.
   - **Expect**: `201` — a fresh, independent `PENDING` invitation.

## Scenario 5: Administrator revokes an active member (User Story 4, P2)

1. Using the now-active member from Scenario 1, as the administrator call
   `DELETE /communities/{communityId}/members/{userId}`.
   - **Expect**: `204`.
2. As the revoked user, call `GET /communities/{communityId}/members`.
   - **Expect**: `403`/`404` (access removed).
3. Confirm any listings previously created by that member no longer appear
   in the community's marketplace listing feed (once the listings feature
   exists; note as a follow-up check if listings aren't built yet).
4. Confirm any prior transaction logs involving that member (once the
   transaction-logging feature exists) are still retrievable by the
   administrator — not deleted by the revocation.

## Scenario 6: Invitation expiration (Assumptions / FR-016, FR-017)

1. As the administrator, create an invitation, then directly set its
   `expiresAt` to a past timestamp in the test database (simulating the
   default 7-day window having elapsed).
2. As the invited contact, call `POST /invitations/{invitationId}/accept`.
   - **Expect**: `409`, `effectiveStatus` reported as `EXPIRED`.
3. As the administrator, call
   `DELETE /communities/{communityId}/invitations/{invitationId}` on the
   same expired invitation.
   - **Expect**: `409` (no longer cancellable).
4. As the administrator, send a brand-new invitation to the same contact.
   - **Expect**: `201` — succeeds independently of the expired one.

## Scenario 7: Multi-community independence (User Story 5, P3)

1. Repeat Scenario 1 for the same prospective member against a second,
   separate community.
2. Revoke that user's membership in the first community (Scenario 5).
3. As that user, call `GET /communities/{secondCommunityId}/members`.
   - **Expect**: `200` — access to the second community is unaffected.

## Success check

All scenarios above passing is the runnable proxy for Success Criteria
SC-001 through SC-005 in [spec.md](./spec.md).
