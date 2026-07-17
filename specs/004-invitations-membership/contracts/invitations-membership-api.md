# Contract: Invitations & Membership API

Endpoints this feature exposes. All routes require an authenticated session (existing `Session` cookie from 002-accounts-authentication) unless noted; an absent/invalid session returns `401 Unauthorized` with no further processing.

## POST /api/communities/{communityId}/invitations

Invite one email to the community (FR-001). Caller MUST be an `ADMINISTRATOR` of `communityId`.

**Request**:
```json
{ "email": "string" }
```

**Responses**:
- `201 Created` — invitation created (or a prior unconsumed invitation to the same email was superseded, research.md #4). Body: `{ "ok": true, "invitation": { "id": "string", "email": "string" } }`. The raw acceptance link is emailed to `email`, never returned in the response.
- `400 Bad Request` — `email` is not a syntactically valid address. Body: `{ "ok": false, "reason": "invalid_email" }`.
- `403 Forbidden` — caller has no `ADMINISTRATOR` membership in `communityId` (FR-010). Body: `{ "ok": false, "reason": "not_administrator" }`.
- `409 Conflict` — `email` already holds an active membership (any role) in this community (FR-011). Body: `{ "ok": false, "reason": "already_member" }`.

**Side effects**: If an unconsumed `Invitation` already exists for this exact (email, community) pair, it is marked consumed in the same transaction that creates the new one (FR-012) — the older acceptance link stops working. No `Account` is created, modified, or required to exist at this step (FR-001's whole point — the invited person may not have one yet).

---

## DELETE /api/communities/{communityId}/memberships/{membershipId}

Revoke an existing member's membership (FR-007). Caller MUST be an `ADMINISTRATOR` of `communityId`.

**Responses**:
- `204 No Content` — membership deleted. The account's own credentials, verification state, and memberships in any other community are untouched (FR-007).
- `403 Forbidden` — caller has no `ADMINISTRATOR` membership in `communityId`. Body: `{ "ok": false, "reason": "not_administrator" }`.
- `404 Not Found` — no membership with `membershipId` exists in `communityId`.
- `409 Conflict` — `membershipId` is the community's last remaining `ADMINISTRATOR` membership (FR-009, the last-admin guard). Body: `{ "ok": false, "reason": "last_admin" }`. The membership is left fully intact.

**Side effects**: Deleting this membership never blocks a future invitation to the same email in this same community (FR-008) — nothing about revocation is recorded anywhere that a later `POST /invitations` checks.

---

## GET /api/invitations/accept?token=...

Fetch minimal, public metadata about a pending invitation, so the accept page can tell a signed-out visitor which email/community the link is for before requiring sign-in (needed for Story 2's "sign up, verify, then return to accept" UX — the visitor needs to know which exact email to sign up with). No authentication required: the raw token itself is the secret, and revealing which email/community it targets is not a new disclosure beyond what its recipient already received by email.

**Responses**:
- `200 OK` — token is syntactically well-formed and currently unconsumed. Body: `{ "ok": true, "communityName": "string", "email": "string" }`.
- `400 Bad Request` — token is missing, malformed, or already consumed (accepted or superseded). Body: `{ "ok": false, "reason": "invalid_or_consumed" }`.

---

## POST /api/invitations/accept

Accept a pending invitation using its raw token (FR-004, FR-005). Caller MUST be signed in; the signed-in account is the one that gains membership (there is no "accept on someone else's behalf").

**Request**:
```json
{ "token": "string" }
```

**Responses**:
- `200 OK` — invitation accepted: exactly one `MEMBER`-role `Membership` row is created linking the caller's account to the invitation's community, and the invitation becomes permanently unusable. Body: `{ "ok": true, "membership": { "communityId": "string", "role": "MEMBER" } }`.
- `400 Bad Request` — token is missing, malformed, or already consumed (by acceptance or by supersession — indistinguishable from the caller's point of view, same as `VerificationToken`'s existing "no longer valid" convention). Body: `{ "ok": false, "reason": "invalid_or_consumed" }`.
- `403 Forbidden` — the signed-in account's email does not match the invitation's email (case-insensitive exact match, FR-002), or the signed-in account's email is not verified (FR-003). Body: `{ "ok": false, "reason": "email_mismatch" }` or `{ "ok": false, "reason": "not_verified" }` respectively — distinguishable, per the spec's requirement that the "no account"/"not verified" cases be told apart (Story 2).
- `409 Conflict` — the signed-in account already holds an active membership (any role) in that community (defensive re-check of FR-011 at acceptance time, research.md #1's transaction). Body: `{ "ok": false, "reason": "already_member" }`.

**Note on the "no matching account yet" case (FR-004 Scenario 1)**: this is not a distinct HTTP response — it is simply the `401 Unauthorized` a signed-out visitor gets from hitting this endpoint at all. There is no account to check against until one exists and is signed in; the invitation itself is unaffected and remains acceptable once that happens (User Story 2).

---

## Pages (browser-facing, not a JSON contract but part of this feature's reachable surface)

- `GET /communities/{communityId}/admin` — administrator-only page: invite-by-email form, current member list with a Revoke action per row. Renders `404` (via `notFound()`, same convention as the existing `/operator` page) for any signed-in account without an `ADMINISTRATOR` membership in `communityId`, and redirects to sign-in when signed out.
- `GET /invitations/accept?token=...` — reads `token` from the URL; if signed in, shows an "Accept invitation to {community name}" confirmation that calls `POST /api/invitations/accept`; if signed out, shows a message directing the visitor to sign in or sign up (with that exact invited email) and return to this same link afterward — no automatic redirect chaining is built (research.md #9's simplicity note).
- `GET /` (existing home page, extended) — the signed-in view now lists the caller's real communities (from the extended `CurrentAccountPayload.memberships`, research.md #7), linking `ADMINISTRATOR` rows to their `/communities/{communityId}/admin` page. Accounts with zero memberships still see the existing empty state.
