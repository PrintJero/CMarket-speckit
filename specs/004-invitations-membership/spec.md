# Feature Specification: Invitations & Membership

**Feature Branch**: `004-invitations-membership`

**Created**: 2026-07-16

**Status**: Finished

**Input**: User description: "An administrator of an existing community invites a person by entering their email address. This creates a single-use Invitation record tied to that specific email and that community, referencing the existing Account (if any) and Community models from 002-accounts-authentication and 003-community-creation. The invited person can only accept the invitation if they have an Account with emailVerifiedAt set and that Account's email matches the invited email exactly (identity binding, consistent with the verification pattern already used for VerificationToken). If they don't yet have a verified account, they must sign up and verify that email first, then return to accept. Upon acceptance, a Membership row is created linking that Account to that Community with role MEMBER — this requires extending the existing MembershipRole enum (currently only ADMINISTRATOR) to add a MEMBER value. An administrator can revoke an existing member's Membership at any time (deleting or marking it revoked). Revoking a member must NOT prevent inviting that same email again later — revoke-then-reinvite must always succeed, with no cooldown or block. A community must always have at least one ADMINISTRATOR: any action that would remove or demote the last remaining administrator must be rejected (last-admin guard, countable via existing Membership rows with role ADMINISTRATOR, per the note already left in 003-community-creation's data-model.md). A single Account can hold independent Membership rows across multiple communities simultaneously (already supported by the existing @@unique([accountId, communityId]) constraint). Out of scope: reusable/bulk access codes, mass/bulk invitations (one at a time only), and sophisticated auto-expiration policy beyond what's already decided at the constitution level."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Administrator invites an already-verified person, who accepts (Priority: P1)

An administrator of a community types a single email address into an invite action. The person on the other end already has a CMarket account with that exact email, verified. They return to CMarket, see the invitation, and accept it, immediately becoming a member of that community.

**Why this priority**: This is the ordinary, no-friction path for admin-issued membership per Principle I — without it, a community with an administrator has no way to ever gain a second member. It is the minimum viable slice of this whole feature.

**Independent Test**: Can be fully tested by having an administrator of community C invite the email of an existing, verified account A, then having A accept, and asserting: exactly one `Membership` row exists for A in C with role MEMBER, the invitation is no longer usable a second time, and a different verified account B (never invited) still has no membership in C.

**Acceptance Scenarios**:

1. **Given** an administrator of community C and an existing account A with a verified email `a@example.com`, **When** the administrator invites `a@example.com` to C, **Then** a single-use invitation tied to that email and C is created, and no membership is created yet.
2. **Given** the invitation from Scenario 1, **When** account A (verified, email matches exactly) accepts it, **Then** a `Membership` row is created linking A to C with role MEMBER, and the invitation can never be accepted again.
3. **Given** an accepted invitation, **When** a different, unrelated verified account B attempts to accept the same invitation, **Then** the attempt is rejected because the invitation no longer exists in an acceptable state, and no membership is created for B.
4. **Given** account A already holds an administrator membership in a different community D, **When** A accepts an invitation to join C as a member, **Then** A ends up with two independent membership rows — administrator in D, member in C — and neither is affected by the other.

---

### User Story 2 - Administrator invites someone who must sign up and verify first (Priority: P1)

An administrator invites a person by email who has no CMarket account yet, or has one that isn't verified. That person cannot accept immediately; they must sign up (or complete verification on their existing unverified account) using that exact email, and only after their email is verified can they return and accept the still-pending invitation.

**Why this priority**: This is exactly the scenario Principle I calls out as the reason accounts are self-created: "lets an invited user sign up and accept in one flow." Without this path, invitations only work for people who already happen to have a verified account — an unrealistic restriction for a real onboarding flow.

**Independent Test**: Can be fully tested by inviting an email with no matching account, confirming an immediate acceptance attempt fails (no account exists), then having a new account sign up and verify with that exact email, and confirming acceptance now succeeds and produces the membership.

**Acceptance Scenarios**:

1. **Given** an administrator invites `new@example.com`, an email with no matching account, **When** an acceptance is attempted before any account exists, **Then** the attempt is rejected with a clear error, and no membership is created.
2. **Given** the invitation from Scenario 1, **When** a person signs up with `new@example.com` and completes email verification, **Then** they can return and accept the still-pending invitation, producing a MEMBER `Membership` row linking their account to the community.
3. **Given** an account exists for `pending@example.com` but its email is not yet verified, **When** an acceptance is attempted on an invitation to `pending@example.com`, **Then** the attempt is rejected with a clear error distinguishable from the "no account" case, and no membership is created.
4. **Given** an account with a verified email `x@example.com`, **When** it attempts to accept an invitation issued to a different email `y@example.com`, **Then** the attempt is rejected regardless of that account's own verification status — the invited email and the accepting account's email MUST match exactly (case-insensitive), per the identity-binding rule already used for email verification.

---

### User Story 3 - Administrator revokes a member's access (Priority: P2)

An administrator decides an existing member should no longer belong to their community — for any reason, at any time — and revokes that person's membership. The person immediately loses their access to that community, without their underlying CMarket account being touched.

**Why this priority**: Principle III makes membership removal one of the administrator's core gatekeeper powers; without it, membership granted by mistake or later found unwanted is permanent, which is an unacceptable governance gap.

**Independent Test**: Can be fully tested by granting a member M a membership in community C, having the administrator revoke it, then asserting M's membership in C no longer exists (or is marked revoked and no longer grants access), while M's account, credentials, and any memberships in unrelated communities are untouched.

**Acceptance Scenarios**:

1. **Given** an existing MEMBER-role `Membership` linking account M to community C, **When** the administrator revokes it, **Then** M no longer has access to C, and M's account (credentials, verification state) and any memberships in other communities are unchanged.
2. **Given** a revoked membership, **When** M's access to C is checked afterward, **Then** it is indistinguishable from having never been a member — no residual privilege remains.

---

### User Story 4 - Revoking a member never blocks re-inviting the same email (Priority: P2)

Some time after an administrator revokes a member, they change their mind (or the situation changes) and want to invite that exact same email back into the community. This must always work, with no waiting period, flag, or historical block standing in the way.

**Why this priority**: This is an explicit, named constitutional guarantee (Principle III: "revoking an invitation MUST NOT prevent issuing a new invitation" — generalized here to revoking a member). A system that lets an administrator's own action permanently lock out a real address would make revocation a one-way, over-cautious decision administrators would be afraid to use.

**Independent Test**: Can be fully tested by inviting an email, accepting it, revoking the resulting membership, then immediately inviting the exact same email to the exact same community a second time, and asserting the second invitation is created successfully and can itself be accepted to produce a fresh membership.

**Acceptance Scenarios**:

1. **Given** account M's membership in community C was just revoked, **When** the administrator invites M's exact email to C again, **Then** the invitation is created successfully with no cooldown, flag, or rejection tied to the prior revocation.
2. **Given** the re-invitation from Scenario 1, **When** M accepts it, **Then** a new MEMBER `Membership` row is created linking M to C, identical in effect to a first-time acceptance.

---

### User Story 5 - The last administrator of a community cannot be removed (Priority: P2)

An administrator (or the system acting on an administrator's behalf) attempts an action that would leave a community with zero administrators — for example, revoking the membership of the sole remaining administrator. This must be rejected outright; the community must never be left without anyone able to govern it.

**Why this priority**: An orphaned community — one with members but no administrator able to invite, revoke, or moderate — cannot recover through any normal action once it happens. Principle III names this guard explicitly as a non-negotiable safeguard.

**Independent Test**: Can be fully tested by creating a community with exactly one administrator, attempting to revoke that administrator's own membership, and asserting the action is rejected with a clear error and the administrator's membership remains fully intact.

**Acceptance Scenarios**:

1. **Given** a community with exactly one `Membership` row carrying role ADMINISTRATOR, **When** an attempt is made to revoke that membership, **Then** the attempt is rejected with a clear error, and the administrator's membership is unchanged.
2. **Given** a community with two administrators, **When** one administrator's membership is revoked, **Then** the action succeeds, because at least one administrator still remains afterward.

---

### Edge Cases

- What happens when an administrator invites an email that already holds an active membership (any role) in that same community? The invitation attempt MUST be rejected with a clear error — there is nothing to accept, since membership already exists.
- What happens when an administrator issues a second invitation to an email that already has a pending (unaccepted) invitation for the same community? The newer invitation supersedes the older one; only the most recently issued invitation for that (email, community) pair can be accepted — mirroring the existing multiple-sign-up-attempt-token pattern is intentionally not followed here since only one invitation per pair needs to remain live (see Assumptions).
- What happens when the invited person's account email is spelled with different letter casing than the invited email (e.g., invited as `Jane@Example.com`, account is `jane@example.com`)? The comparison MUST be case-insensitive exact match, consistent with the existing account-email comparison rule (FR-017 of 002-accounts-authentication) — this still counts as a match.
- What happens if an already-accepted invitation is attempted again (by the same or a different account)? Rejected — an invitation is single-use and MUST NOT produce a second membership.
- What happens if a non-administrator (an ordinary member, or an unrelated account) attempts to invite or revoke within a community they don't administer? Rejected — only that community's own administrator(s) may invite or revoke within it (Principle III).
- What happens when revoking would remove the community's last administrator? Rejected outright (User Story 5) — the community must always retain at least one administrator.
- What happens to an account's memberships in unrelated communities when one of its memberships is revoked, or when it accepts a new invitation? Untouched — every membership row is independent per the existing `@@unique([accountId, communityId])` constraint.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: An administrator of a community MUST be able to invite exactly one person at a time by entering their email address, creating a single-use invitation tied to that specific email and that specific community.
- **FR-002**: An invitation MUST NOT be acceptable by any account whose email does not match the invited email using a case-insensitive exact match — the same identity-binding rule already applied to email verification (FR-017 of 002-accounts-authentication).
- **FR-003**: An invitation MUST NOT be acceptable unless the matching account exists and has a verified email (`emailVerifiedAt` set). An acceptance attempt against a nonexistent account and one against an existing-but-unverified account MUST fail with distinguishable, clear errors, and MUST NOT create a membership in either case.
- **FR-004**: A person invited without a verified account MUST be able to sign up (or complete verification on an existing unverified account) using the exact invited email, and afterward return to accept the still-pending invitation without requiring the administrator to re-issue it.
- **FR-005**: Upon successful acceptance, exactly one `Membership` row MUST be created linking the accepting account to the invited community with role MEMBER, and the invitation MUST become permanently unusable for any further acceptance attempt (single-use).
- **FR-006**: The system MUST support a MEMBER role value on memberships, distinct from ADMINISTRATOR, so that invited members are not granted administrator authority.
- **FR-007**: An administrator MUST be able to revoke an existing member's membership in their community at any time, immediately ending that member's access to the community, without modifying the member's account, credentials, verification state, or memberships in any other community.
- **FR-008**: Revoking a member's membership MUST NOT create any obstacle — cooldown, flag, or historical block — to inviting that exact same email to that same community again; a subsequent invitation and its acceptance MUST succeed exactly as a first-time invitation would.
- **FR-009**: The system MUST reject any action that would leave a community with zero memberships carrying role ADMINISTRATOR, whether the action is a direct revocation of the last administrator's own membership or any other action with that same effect. The rejected action MUST leave the existing administrator membership(s) fully unchanged.
- **FR-010**: Only a community's own administrator(s) MUST be able to invite to, or revoke membership within, that community; no other account — including an administrator of an unrelated community — may perform these actions there.
- **FR-011**: An invitation MUST NOT be issuable for an email that already holds an active membership (any role) in the target community; such an attempt MUST be rejected with a clear error before any invitation record is created.
- **FR-012**: Issuing a new invitation to an email that already has a pending, unaccepted invitation for the same community MUST supersede the prior one — only the newest invitation for that (email, community) pair remains acceptable.
- **FR-013**: A single account MUST be able to hold independent membership rows across multiple communities at once, each unaffected by actions (invite, accept, revoke) taken on the others.
- **FR-014**: This feature MUST NOT introduce reusable or bulk access codes, MUST only support inviting one email at a time (no mass/bulk invitation of multiple recipients in a single action), and MUST NOT implement any auto-expiration policy for invitations beyond what the project constitution already establishes.

### Key Entities

- **Invitation**: A single-use credential binding one email address to one Community, created by that community's administrator. Attributes: the invited email, the target community, the administrator who issued it, creation time, and whether/when it has been accepted (or superseded by a newer invitation to the same email+community). References the existing `Account` only if one already exists for that email at issuance time or acceptance time — never requires one to exist up front.
- **Membership** *(existing, from 003-community-creation — extended)*: The link between one Account and one Community, carrying a role. This feature adds MEMBER as a second possible role value alongside the existing ADMINISTRATOR, and adds the ability to remove (revoke) a membership row — the first feature able to do so, which is what makes the last-admin guard (already anticipated in 003's data model) actually enforceable.
- **Account** *(existing, from 002-accounts-authentication — referenced, not modified)*: Must have a verified email matching the invited email exactly to accept an invitation. This feature reads its identity/verification state but never creates, modifies, or deletes an Account.
- **Community** *(existing, from 003-community-creation — referenced, not modified)*: The tenancy an invitation and its resulting membership belong to.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An administrator can bring a new member into their community with a single email entry followed by that person's own acceptance — no manual data-store edits, and no second administrator action required regardless of whether the invited person already had an account.
- **SC-002**: 100% of acceptance attempts where the accepting account's email does not exactly match the invited email, or where the matching account's email is not verified, are rejected, verified by automated tests.
- **SC-003**: 100% of attempts that would leave any community with zero administrators are rejected, verified by automated tests, with the existing administrator membership(s) left fully intact.
- **SC-004**: Revoking a member and re-inviting the exact same email to the exact same community succeeds every time, with no cooldown period, verified by automated tests.
- **SC-005**: An account's memberships across different communities remain fully independent — inviting, accepting, or revoking in one community produces zero observable change to that account's standing in any other community.
- **SC-006**: An invitation can be accepted at most once; every attempt to accept it a second time (by any account) fails, verified by automated tests.

## Assumptions

- Invitations are issued and accepted through an authenticated, end-user-facing surface (unlike 003-community-creation's operator-only tooling) — an administrator acts from within their own community's context, and an invited person acts from within their own account's context, consistent with Principle V (single web application).
- When an email already has a pending, unaccepted invitation for the same community and is invited again, the newer invitation supersedes the older one (only the newest stays acceptable) rather than allowing multiple simultaneously-valid invitations for the same (email, community) pair — kept deliberately simpler than 002-accounts-authentication's coexisting-VerificationToken model, since nothing here requires multiple concurrent attempts to coexist.
- "Revoke" is described by the input as either deleting the Membership row or marking it revoked; this specification treats both as satisfying the same functional guarantee (member immediately loses access) and leaves the specific representation to the implementation plan.
- No time-based auto-expiration is required for invitations by this feature; the constitution permits expiration as a property of the (separately out-of-scope) access-code path, and does not mandate one for direct email invitations. Single-use consumption, not elapsed time, is what retires an invitation here.
- Demoting an administrator to a non-administrator role is not an action this feature introduces (no role-change action is in scope) — the last-admin guard (FR-009) is written to cover both "remove" and "demote" per the constitution's wording, but the only action this feature actually implements that could trigger it is revocation.
- Notifying the invited email address (e.g., by sending a link) is expected but is a delivery-mechanism detail left to the implementation plan, not a functional requirement of this spec.
