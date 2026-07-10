# Feature Specification: Community Invitations

**Feature Branch**: `001-community-invitations`

**Created**: 2026-07-09

**Status**: Draft

**Input**: User description: "An administrator invites a user to join their community (university, company, or residential complex) by entering the user's contact info (e.g. email or phone). The invited user receives a notification/invite and can accept or decline it. Users cannot request to join a community on their own — communities are invite-only for security reasons. Once a user accepts an invite, they gain access to that community's marketplace (can view, list, and buy products). A user can belong to multiple communities simultaneously, each with independent membership status. Administrators can revoke a member's access to their community at any time. Administrators can also cancel a pending invite before it's accepted."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Administrator Invites and User Accepts (Priority: P1)

An administrator of a community enters a prospective member's contact information
(email or phone) to invite them. The invited person receives a notification of
the invitation and accepts it, immediately gaining access to view, list, and buy
within that community's marketplace.

**Why this priority**: This is the entire reason the feature exists — without
it, no member can ever join a community, and the marketplace has no users.
It is the smallest possible slice that delivers the core value: closed,
administrator-controlled community growth.

**Independent Test**: Can be fully tested by having an administrator invite a
contact, having that contact accept the invitation, and confirming the
now-member can view the community's marketplace — without any other story
(decline, cancel, revoke, multi-community) being implemented.

**Acceptance Scenarios**:

1. **Given** an administrator managing a community, **When** they submit a
   prospective member's email or phone to invite them, **Then** the system
   creates a pending invitation and notifies the invited contact.
2. **Given** a user with a pending invitation, **When** they accept it,
   **Then** they immediately gain the ability to view, list, and buy products
   within that community's marketplace.
3. **Given** a user who has never been invited to any community, **When**
   they look for a way to join a community on their own, **Then** no
   request-to-join or apply-to-join option exists anywhere in the product.
4. **Given** a pending invitation that has passed its expiration period
   without being accepted, declined, or cancelled, **When** the invited
   contact attempts to accept or decline it, **Then** the system rejects the
   attempt and shows that the invitation has expired.

---

### User Story 2 - Administrator Cancels a Pending Invite (Priority: P2)

Before an invited person accepts, the administrator who sent the invitation
can cancel it, removing the invited person's ability to accept it later.

**Why this priority**: Lets administrators correct mistakes (wrong contact
info, change of mind) without waiting for the other party to act. Builds on
User Story 1 but is not required for the core loop to deliver value.

**Independent Test**: Can be fully tested by having an administrator invite a
contact, cancel the invitation before it is accepted, and confirming the
invited contact can no longer accept it.

**Acceptance Scenarios**:

1. **Given** a pending invitation to a community, **When** the administrator
   who sent it cancels it, **Then** the invitation is no longer acceptable by
   the invited contact.
2. **Given** an invitation that has already been cancelled, **When** the
   previously-invited contact attempts to accept it, **Then** the system
   rejects the attempt and shows that the invitation is no longer valid.
3. **Given** a pending invitation that has already expired, **When** the
   administrator who sent it attempts to cancel it, **Then** the system
   rejects the cancellation since the invitation is no longer pending.

---

### User Story 3 - Invited User Declines an Invite (Priority: P2)

An invited person who does not want to join a community declines the
invitation instead of accepting it.

**Why this priority**: Completes the primary invite lifecycle (accept vs.
decline) and prevents unwanted community membership, but the product is
still usable end-to-end without it (an unwanted invite could simply be
ignored).

**Independent Test**: Can be fully tested by having an administrator invite a
contact, having that contact decline, and confirming the contact gains no
access to the community and the administrator can see the declined status.

**Acceptance Scenarios**:

1. **Given** a user with a pending invitation, **When** they decline it,
   **Then** they gain no access to that community and the invitation is
   recorded as declined.
2. **Given** a previously declined invitation, **When** the administrator
   invites the same contact again, **Then** a new pending invitation is
   created independent of the earlier declined one.

---

### User Story 4 - Administrator Revokes a Member's Access (Priority: P2)

An administrator removes an existing, already-accepted member's access to
their community at any time.

**Why this priority**: Essential to the administrator's role as gatekeeper
and to community trust/safety, but distinct from — and buildable after — the
core invite/accept loop.

**Independent Test**: Can be fully tested by having an administrator revoke
an existing member's access and confirming that member immediately loses the
ability to view, list, or buy within that community, while the community's
historical transaction logs involving that member remain intact.

**Acceptance Scenarios**:

1. **Given** an active member of a community, **When** the administrator
   revokes that member's access, **Then** the member immediately loses the
   ability to view, list, or buy within that community.
2. **Given** a just-revoked member with active listings in the community,
   **When** other members browse the community marketplace, **Then** the
   revoked member's listings are no longer visible.
3. **Given** a revoked member with past logged transactions in the
   community, **When** an administrator reviews transaction history,
   **Then** those historical transaction logs remain intact and traceable.

---

### User Story 5 - User Belongs to Multiple Communities Independently (Priority: P3)

A user who has accepted invitations to more than one community (e.g., their
university and their residential complex) can use each community's
marketplace independently, and a change in status in one community does not
affect their status in another.

**Why this priority**: Extends the core model to the multi-community case
described in the feature request; valuable but not required for a single
community to function correctly.

**Independent Test**: Can be fully tested by having one user accept
invitations to two separate communities, then revoking that user's access in
one community, and confirming their access to the other community is
unaffected.

**Acceptance Scenarios**:

1. **Given** a user who has accepted invitations to two different
   communities, **When** they use the marketplace, **Then** they can view,
   list, and buy independently within each community they belong to.
2. **Given** a user who belongs to two communities, **When** an
   administrator of one community revokes that user's access, **Then** the
   user's membership and access in the other community remain unaffected.

---

### Edge Cases

- What happens when an administrator invites a contact who already has a
  pending invitation to the same community? The system MUST NOT create a
  duplicate invitation and instead MUST show the administrator the existing
  pending invite's status.
- What happens when an administrator invites a contact who is already an
  active member of that same community? The system MUST reject the
  duplicate invite attempt and inform the administrator the contact is
  already a member.
- What happens when the contact info entered (email or phone) does not
  match any existing CMarket user? The invitation MUST remain pending
  against that contact info until a matching user is available to accept
  or decline it (see Assumptions).
- What happens when an administrator tries to cancel an invitation that has
  already been accepted, declined, or expired? The system MUST reject the
  cancellation since the invitation is no longer pending.
- What happens when a pending invitation reaches its expiration period
  without being accepted, declined, or cancelled? The system MUST
  automatically mark it expired, and it MUST no longer be acceptable or
  declinable by the invited contact; the administrator MUST send a new
  invitation to try again.
- What happens when an administrator tries to revoke access for a user who
  is not currently an active member (e.g., already revoked, or only has a
  pending invite)? The system MUST reject the action since there is no
  active membership to revoke.
- What happens when the same contact is invited to two different
  communities at the same time? Each invitation MUST be tracked and acted
  upon independently.
- How does the system handle an administrator inviting themselves or
  another existing administrator of the same community? The invite MUST be
  rejected since that person already has access as an administrator.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow a community administrator to create an
  invitation to their community by entering a prospective member's contact
  information (email or phone).
- **FR-002**: System MUST NOT provide any mechanism for a user to request,
  apply for, or otherwise self-initiate membership in a community —
  invitations MUST always originate from that community's administrator.
- **FR-003**: System MUST notify an invited contact that they have a pending
  invitation to a specific community.
- **FR-004**: System MUST allow an invited contact to either accept or
  decline a pending invitation.
- **FR-005**: Upon acceptance, system MUST immediately grant the user the
  ability to view, list, and buy products within that community's
  marketplace.
- **FR-006**: Upon decline, system MUST grant the user no access to that
  community and MUST record the invitation's status as declined.
- **FR-007**: System MUST allow the administrator who sent a pending
  invitation to cancel it at any time before it is accepted, declined, or
  expired.
- **FR-008**: Once an invitation is cancelled, declined, accepted, or
  expired, the system MUST NOT allow it to be accepted or declined again.
- **FR-009**: System MUST allow a community administrator to revoke an
  existing member's access to their community at any time, independent of
  that member's activity history.
- **FR-010**: Upon revocation, system MUST immediately remove the member's
  ability to view, list, or buy within that community, and MUST hide that
  member's active listings from other community members.
- **FR-011**: Revocation MUST NOT delete or alter historical transaction
  logs associated with the revoked member; those logs MUST remain
  traceable.
- **FR-012**: System MUST track membership status (invited/pending,
  active, declined, revoked) independently per user per community, and
  MUST allow a single user to simultaneously hold active membership in
  multiple communities.
- **FR-013**: System MUST prevent duplicate pending invitations for the
  same contact within the same community, surfacing the existing pending
  invitation's status to the administrator instead.
- **FR-014**: System MUST prevent an administrator from inviting a contact
  who is already an active member of that same community.
- **FR-015**: System MUST restrict an administrator's invite, cancel, and
  revoke actions to only the communities they administer.
- **FR-016**: Pending invitations MUST automatically expire after a
  configurable number of days if not accepted, declined, or cancelled
  before that period elapses. The default expiration period is 7 days.
- **FR-017**: Once an invitation has expired, the system MUST NOT allow it
  to be accepted or declined; the administrator MUST send a new invitation
  for the contact to have another opportunity to join.

### Key Entities

- **Community**: A closed group (university, company, or residential
  complex) with its own membership and marketplace, administered by one or
  more administrators.
- **Invitation**: A pending offer for a specific contact (email or phone) to
  join a specific community; has a status of pending, accepted, declined,
  cancelled, or expired, records which administrator created it, and has an
  expiration period after which a still-pending invitation automatically
  becomes expired.
- **Membership**: A user's relationship to one specific community; has a
  status (active or revoked) that is tracked independently per user per
  community.
- **User**: A person who may hold independent memberships across multiple
  communities simultaneously.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An administrator can create and send a new invitation in
  under 1 minute.
- **SC-002**: 100% of users who accept a pending invitation gain access to
  that community's marketplace with no manual follow-up action required
  from the administrator.
- **SC-003**: 0% of community access is achievable without a corresponding
  accepted invitation from that community's administrator, verified by
  security review.
- **SC-004**: A revoked member loses visibility into and interaction with
  their former community's marketplace within seconds of the revocation
  being submitted.
- **SC-005**: Users who belong to multiple communities can view and act
  within each community's marketplace independently, with 0% of status
  changes in one community affecting their status in another.

## Assumptions

- If the contact info entered by an administrator does not match an
  existing CMarket user account, the invitation is held against that
  contact info; the corresponding person can view and act on the invitation
  once they have (or create) an account associated with that email or
  phone. Account creation/registration itself is a separate critical flow
  covered outside this feature.
- Invited-contact notification is delivered through the contact channel
  used for the invite (email or SMS/phone) and, additionally, as an in-app
  notification if the invited person already has an account.
- The expiration period is configurable with a platform-wide default of 7
  days; each community's administrator(s) may override this default for
  their own community. Exact minimum/maximum bounds on the configurable
  range are left to implementation.
- A community may have more than one administrator, and any of them may
  invite, cancel, or revoke within that community; reconciling simultaneous
  conflicting actions by multiple administrators is out of scope for this
  feature.
- There is no cap on the number of communities a single user may belong to.
