# Feature Specification: Platform Administration

**Feature Branch**: `009-platform-administration`

**Created**: 2026-07-23

**Status**: Finished

**Input**: User description: "Platform Administration. CMarket needs a global MASTER authority that operates outside every community and outside the marketplace. MASTER accounts use a separate administrative sign-in with Master ID and password, retain an operational email for future recovery and two-factor authentication, and never participate as members, buyers, sellers, or message participants. The first MASTER is created through an initial deployment/bootstrap process; afterward an active MASTER may create additional MASTER accounts, but only as new, dedicated administrative identities — an existing marketplace account can never be promoted into a MASTER. MASTER can create and fully manage communities and ordinary accounts, including creating a community together with either an existing verified account as its first administrator or a newly provisioned account with a temporary password. Communities may contain multiple administrators. MASTER can inspect and manage communities, members, administrators, invitations, and account access from a separate administration area, without becoming a community member or inheriting marketplace permissions. MASTER actions are recorded in an immutable administrative audit log. Communities have an ACTIVE, SUSPENDED, and ARCHIVED lifecycle: suspension creates a 30-day restricted period; members may continue viewing listings and exchanging messages in existing threads, but no new listings or membership growth may occur. Reactivation during the 30 days cancels archival. After 30 days the community is archived automatically and becomes unavailable in the marketplace while all history is retained. A MASTER may later restore the community by selecting exactly one prior administrator to regain active administrator access; all other prior members, listings, chats, invitations, and operational activity remain archived. Analytics, transaction dashboards, access codes, payments, two-factor authentication, and recovery-request intake are separate future specs."

## Constitution and Existing-Spec Impact

This feature introduces deliberate changes to previously shipped behavior and MUST be accompanied by the required constitution/spec amendments before implementation. **Status: satisfied.** Constitution v4.1.0 (amended 2026-07-23) added Principle IX, "Platform Administration Authority," specifically to cover items 1–5 below before this feature's plan proceeded — see `.specify/memory/constitution.md` and this feature's plan.md Constitution Check.

1. Constitution Principle III currently reserves ordinary community gatekeeping actions to that community's own administrators except through a documented support/escalation path. This spec defines the MASTER administration area as that explicit, auditable platform support/escalation path; it MUST NOT become an invisible shortcut inside ordinary marketplace authorization. *(Formalized by Principle IX's "MASTER as Principle III's documented escalation path" clause.)*
2. Spec 003 currently restricts community bootstrap tooling to an existing verified account and forbids account creation. This feature supersedes that restriction only for the authenticated MASTER community-creation flow. *(Formalized by Principle IX's "managed account provisioning exception to Principle I.")*
3. Spec 002 currently defines email/password credential attachment through email verification. A MASTER-created ordinary account is a new provisioning path: the platform creates a verified account with a temporary password credential and records who provisioned it. This exception MUST be documented explicitly rather than implemented as an accidental bypass. *(Same Principle IX clause as item 2.)*
4. Constitution Principle I remains unchanged in its core guarantee: a normal account alone grants zero community access. A MASTER-created ordinary account receives access only because the same atomic action creates an administrator or member Membership for a specific community.
5. MASTER identities are not ordinary `Account` identities and are not memberships. They use a separate administrative identity model and authentication surface. *(Now Principle IX's own first paragraph.)*

## Clarifications

### Session 2026-07-23

- Q: Does public self-registration remain available? → A: Yes. Anyone may still create an ordinary CMarket account. MASTER provisioning is an additional onboarding path, not a replacement.
- Q: Is "client" a third permission role? → A: No. "Client" is the business-facing name for an ordinary user. Within a community, that user is either `MEMBER` or `ADMINISTRATOR`.
- Q: Is MASTER a community role? → A: No. MASTER is a global platform authority, completely separate from `MembershipRole`.
- Q: Can a MASTER participate in the marketplace? → A: No. A MASTER is never a community member, cannot create listings, buy, send messages, accept invitations, or redeem access codes.
- Q: How is the first MASTER created? → A: Through an initial deployment/bootstrap process. Later MASTER accounts are created only by an active MASTER.
- Q: Can an existing ordinary account be promoted to MASTER? → A: No. Every MASTER must be a newly created, dedicated administrative identity.
- Q: How does a MASTER sign in? → A: With a unique Master ID and password. An email is retained for future security features but is not accepted as a sign-in identifier in this spec.
- Q: What happens on first MASTER sign-in? → A: A newly created MASTER receives a temporary password and must replace it before any other administrative action.
- Q: Can a MASTER be physically deleted? → A: No. MASTER identities may be disabled and reactivated, preserving audit history.
- Q: Can the last active MASTER be disabled? → A: No. The platform must always retain at least one active MASTER.
- Q: Can a MASTER disable their own currently authenticated identity? → A: No.
- Q: Can a community have multiple administrators? → A: Yes. A community must always retain at least one active administrator.
- Q: What happens when an administrator is replaced or removed? → A: The MASTER must explicitly choose whether that account becomes a normal member, loses only that community membership, or has its entire ordinary account disabled/deleted according to the account-management rules.
- Q: What can a suspended community do? → A: Existing members may view existing listings and continue sending and receiving messages in existing threads. The community cannot create or edit listings, issue or accept invitations, admit members, promote administrators, or start other growth/creation flows.
- Q: How long does suspension last? → A: 30 days.
- Q: What happens after 30 days? → A: The community is archived automatically, not physically deleted.
- Q: Can a suspended community be reactivated? → A: Yes. Reactivation before the deadline cancels scheduled archival.
- Q: Can an archived community be restored? → A: Yes, manually by a MASTER.
- Q: What regains access after restoration? → A: Exactly one prior administrator selected by the MASTER. All other historical memberships and marketplace content remain archived.
- Q: Can a restored administrator later add another administrator? → A: Yes, by promoting an active member of that community, subject to the last-admin guard and ordinary community-administration rules.
- Q: Are statistics and transaction dashboards included? → A: No. The administration shell may contain navigation placeholders, but analytics are a later spec.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A dedicated MASTER signs in to a separate administration area (Priority: P1)

A platform operator signs in with a Master ID and password and enters a platform-administration area that is separate from the marketplace. The operator can administer CMarket globally but cannot participate in any community activity.

**Why this priority**: Every capability in this feature depends on a secure, explicit global authority that cannot be confused with a community administrator or ordinary user.

**Independent Test**: Create an active MASTER identity, sign in using its Master ID and password, verify access to the administration area, and verify that the same identity is denied from marketplace membership, listing, invitation, discovery, and messaging actions.

**Acceptance Scenarios**:

1. **Given** an active MASTER with a valid Master ID and password, **When** they sign in through the administrative sign-in surface, **Then** an administrative session is created and the platform-administration area is shown.
2. **Given** a valid MASTER email and password, **When** the operator submits the email instead of the Master ID, **Then** sign-in is rejected without revealing whether that email belongs to a MASTER.
3. **Given** an authenticated MASTER, **When** they attempt to access a community as a member, create a listing, start or send a message, accept an invitation, or redeem an access code, **Then** the action is rejected because MASTER authority is not marketplace membership.
4. **Given** an ordinary account, including a community administrator, **When** it attempts to access any MASTER route or administrative capability, **Then** access is denied and no administrative data is returned.
5. **Given** a disabled MASTER, **When** valid credentials are submitted, **Then** sign-in is rejected and no session is created.

---

### User Story 2 - The initial platform bootstrap establishes the first MASTER safely (Priority: P1)

During the first deployment, an authorized operator creates the first MASTER through a documented bootstrap process outside the user-facing application.

**Why this priority**: No MASTER can create another MASTER until one already exists. This is the root authority of the entire administration system.

**Independent Test**: Run the bootstrap against an installation with zero MASTER identities, confirm exactly one active MASTER is created, then run it again and confirm it refuses to create an uncontrolled second bootstrap identity.

**Acceptance Scenarios**:

1. **Given** an installation with no MASTER identities, **When** an authorized operator runs the documented bootstrap with a unique Master ID, email, and initial secret, **Then** exactly one active MASTER identity is created.
2. **Given** an installation that already contains at least one MASTER identity, **When** the bootstrap is invoked again, **Then** it is rejected and no new MASTER is created.
3. **Given** a successful bootstrap, **When** its audit data is inspected, **Then** the creation time and bootstrap origin are traceable without pretending that another MASTER performed the action.
4. **Given** the bootstrap process, **When** an ordinary user or community administrator examines the application, **Then** no user-facing route or control exposes that bootstrap capability.

---

### User Story 3 - A MASTER creates and manages another MASTER identity (Priority: P1)

An active MASTER creates a new dedicated platform operator using a unique Master ID and operational email. The new operator receives a temporary password, changes it on first sign-in, and can later be disabled, reactivated, or issued another temporary password.

**Why this priority**: A single global operator is an operational and security risk. Controlled creation of additional dedicated MASTER identities provides redundancy without allowing ordinary accounts to gain platform authority.

**Independent Test**: Have MASTER A create MASTER B, confirm B cannot perform administrative actions before changing the temporary password, complete the password change, then disable and reactivate B while verifying the last-master and self-disable guards.

**Acceptance Scenarios**:

1. **Given** an active MASTER, **When** they create a new MASTER with a unique Master ID and email, **Then** a dedicated MASTER identity is created with a system-generated temporary password shown exactly once.
2. **Given** a newly created MASTER using its temporary password, **When** it signs in for the first time, **Then** it must choose a new password before accessing any other administrative capability.
3. **Given** an existing ordinary account using the same email, **When** a MASTER attempts to create a MASTER identity, **Then** the system does not promote or reuse that ordinary account; MASTER identities remain separate. Email-collision policy between the two identity stores is defined in FR-015.
4. **Given** an active MASTER B and at least one other active MASTER A, **When** A disables B, **Then** B's active sessions are revoked and future sign-ins are rejected.
5. **Given** a disabled MASTER B, **When** another active MASTER reactivates B, **Then** B may sign in again with its current valid credential unless a reset is also issued.
6. **Given** a MASTER that forgot its password, **When** another active MASTER generates a reset, **Then** a new temporary password is shown once, all previous sessions are revoked, and the password must be changed at the next sign-in.
7. **Given** exactly one active MASTER remains, **When** any action attempts to disable that identity, **Then** the action is rejected and the identity remains active.
8. **Given** a signed-in MASTER, **When** it attempts to disable its own identity, **Then** the action is rejected even if another active MASTER exists.
9. **Given** any MASTER identity, **When** another MASTER attempts to physically delete it, **Then** the operation is unavailable; disablement is the terminal administrative action supported by this spec.

---

### User Story 4 - A MASTER creates a community with a usable founding administrator (Priority: P1)

A MASTER creates a community and, in the same atomic action, assigns its first administrator by selecting an existing verified ordinary account or provisioning a new ordinary account.

**Why this priority**: This replaces the operator-only community bootstrap with a safe, accountable product workflow while preserving the guarantee that every community begins with an administrator.

**Independent Test**: Create one community using an existing verified account and another using a new account, then assert each community has exactly one founding administrator membership and no partial community/account/membership state survives any failed attempt.

**Acceptance Scenarios**:

1. **Given** an existing verified ordinary account, **When** a MASTER creates a community and selects that account, **Then** the community and an `ADMINISTRATOR` membership for that account are created atomically.
2. **Given** no ordinary account exists for an entered email, **When** a MASTER creates a community and chooses to create its administrator, **Then** the system creates a verified ordinary account, assigns the supplied display name, generates a temporary password shown once, and creates the administrator membership in the same atomic outcome.
3. **Given** a newly provisioned ordinary administrator, **When** they sign in using the temporary password, **Then** they may keep it or change it; this spec does not force a first-login password change for ordinary accounts.
4. **Given** an unverified existing ordinary account, **When** a MASTER selects it as founding administrator, **Then** the MASTER must explicitly choose either to provision it through the managed-account path (which verifies it and replaces any unusable pending credential state) or to cancel; the system must not silently grant membership to an unverified identity.
5. **Given** any validation or persistence failure, **When** community creation does not complete, **Then** no community, new ordinary account, or founding membership remains partially created.
6. **Given** a newly created community, **When** its memberships are inspected, **Then** at least one active administrator exists and the creating MASTER is not among its members.

---

### User Story 5 - A MASTER manages communities and their administrators from outside (Priority: P1)

A MASTER can list every community, inspect its state and members, edit its information, add or remove administrators, remove members, and perform account-level actions without becoming a member of that community.

**Why this priority**: Global support and customer onboarding require platform-level intervention, but that intervention must stay distinct from normal community participation and be fully accountable.

**Independent Test**: Have a MASTER edit a community, promote a member, remove another administrator with an explicit disposition choice, and revoke a member, while confirming the MASTER never gains a Membership and every action is audited.

**Acceptance Scenarios**:

1. **Given** an active community, **When** a MASTER changes its editable information, **Then** the community reflects the new values and an audit entry records the prior and new values.
2. **Given** an active member of a community, **When** a MASTER promotes that member, **Then** their membership role becomes `ADMINISTRATOR`.
3. **Given** a community with multiple administrators, **When** a MASTER removes one administrator, **Then** the MASTER must explicitly choose one disposition: demote to `MEMBER`, revoke only that community membership, disable the entire ordinary account, or permanently delete the ordinary account under FR-034.
4. **Given** a community with exactly one active administrator, **When** a MASTER attempts an action that would remove or demote that administrator without first designating another active administrator in the same atomic operation, **Then** the action is rejected.
5. **Given** an active member, **When** a MASTER revokes that membership, **Then** the member immediately loses access to that community while unrelated memberships and the ordinary account remain unchanged unless a broader account action was explicitly selected.
6. **Given** a MASTER viewing a community's administration data, **When** the data is returned, **Then** the MASTER may see operational account and membership information needed for support, but no marketplace participant authorization is inferred from that visibility.
7. **Given** a MASTER action over a community, **When** authorization is evaluated, **Then** it passes through the dedicated platform-administration policy, never by fabricating an administrator Membership for the MASTER.

---

### User Story 6 - Community administrators can share administration safely (Priority: P2)

An active community administrator can promote an existing active member of the same community to administrator, allowing multiple administrators to share onboarding and moderation work.

**Why this priority**: Larger communities cannot depend on one person to issue every invitation, admit every member, and moderate every listing.

**Independent Test**: Have an administrator promote an active member, confirm both can perform administrator actions, then verify that neither can remove the last remaining administrator.

**Acceptance Scenarios**:

1. **Given** an active administrator and an active member of the same community, **When** the administrator promotes that member, **Then** the membership role becomes `ADMINISTRATOR`.
2. **Given** an account that is not an active member of that community, **When** an administrator attempts to promote it, **Then** the action is rejected.
3. **Given** an ordinary member or an administrator from another community, **When** it attempts the promotion, **Then** the action is rejected.
4. **Given** a community with multiple administrators, **When** one administrator demotes or removes another under the community's permitted management flow, **Then** the action may succeed only if at least one active administrator remains.
5. **Given** a suspended or archived community, **When** a community administrator attempts to add, promote, demote, invite, or remove membership, **Then** the action is rejected under that community state's restrictions.

---

### User Story 7 - A MASTER fully manages ordinary accounts with explicit consequences (Priority: P2)

A MASTER can inspect, create, edit, suspend, reactivate, reset credentials for, and permanently delete ordinary accounts, with explicit handling of memberships and retained marketplace history.

**Why this priority**: Platform support needs a recovery and enforcement path broader than any one community, but destructive actions must not erase auditability or silently break community governance.

**Independent Test**: Create an ordinary account with memberships and content, exercise edit, suspension, reset, and deletion flows, and verify access, ownership attribution, last-admin protection, and audit preservation.

**Acceptance Scenarios**:

1. **Given** an ordinary account, **When** a MASTER edits its display name or email, **Then** the new value is stored, uniqueness and identity rules are enforced, and the change is audited.
2. **Given** an ordinary account, **When** a MASTER suspends it, **Then** all active sessions are revoked and the account cannot sign in or use any membership until reactivated.
3. **Given** a suspended ordinary account, **When** a MASTER reactivates it, **Then** sign-in is allowed again and any still-active memberships resume access, subject to community state.
4. **Given** an ordinary account, **When** a MASTER generates a password reset, **Then** a new temporary password is shown once, previous sessions are revoked, and no plaintext credential is retained.
5. **Given** an ordinary account that is the last active administrator of any community, **When** a MASTER attempts to suspend or delete it, **Then** the action is rejected unless replacement administrator assignments for every affected community are included in the same atomic operation.
6. **Given** an ordinary account selected for permanent deletion, **When** the MASTER confirms the action, **Then** the account can no longer authenticate, its personal sign-in identifiers are removed or irreversibly anonymized, and historical listings, messages, memberships, transactions, and audit entries retain a non-reassignable internal actor reference rather than being reassigned or silently erased.
7. **Given** a deleted ordinary account's former email, **When** a future visitor registers, **Then** the product may permit reuse only if identity and historical-attribution rules prevent the new account from inheriting the deleted account's records.
8. **Given** a MASTER managing an ordinary account, **When** the action would affect several communities, **Then** the impact is previewed and must be confirmed explicitly.

---

### User Story 8 - A community enters a reversible 30-day suspension (Priority: P1)

A MASTER suspends a community, usually because service has been cancelled or payment is unresolved. Existing members retain limited read/conversation continuity, but the community cannot grow or publish new marketplace content.

**Why this priority**: Suspension provides a reversible enforcement window without immediately destroying access to ongoing conversations or historical information.

**Independent Test**: Suspend an active community and verify existing listings remain viewable and existing threads remain writable, while listing creation, listing editing, invitations, membership acceptance, promotions, and other growth actions are blocked.

**Acceptance Scenarios**:

1. **Given** an active community, **When** a MASTER suspends it with a reason, **Then** its state becomes `SUSPENDED`, `suspendedAt` and `archiveScheduledAt` are recorded, and archival is scheduled exactly 30 days later.
2. **Given** a suspended community, **When** a current member browses its existing listings, **Then** existing listings remain viewable under their pre-suspension visibility rules.
3. **Given** a suspended community and an existing thread, **When** either current participant sends a valid message, **Then** the message is accepted.
4. **Given** a suspended community, **When** any member attempts to create or edit a listing, create a new thread, issue or accept an invitation, admit a member, promote an administrator, or use an access-code membership path when later implemented, **Then** the action is rejected.
5. **Given** a suspended community, **When** a listing owner pauses an existing listing, **Then** the action is allowed because it reduces marketplace exposure; reactivating a paused listing is rejected until the community returns to `ACTIVE`.
6. **Given** a suspended community before its archival deadline, **When** a MASTER reactivates it, **Then** the state returns to `ACTIVE`, the scheduled archival is cancelled, and normal community functionality resumes.
7. **Given** a suspended community, **When** a community administrator attempts to reactivate it, **Then** the action is rejected; only a MASTER controls platform-level community state.

---

### User Story 9 - A suspended community archives automatically without losing history (Priority: P1)

If a suspended community is not reactivated within 30 days, the system archives it automatically. It disappears from the marketplace but remains available to MASTER operators as retained history.

**Why this priority**: Automatic archival enforces the suspension policy consistently while preserving records needed for audit, future transactions, and possible restoration.

**Independent Test**: Advance a suspended community past its deadline, run the archival process, and verify marketplace access ends, all records remain retained, and duplicate/repeated processing is harmless.

**Acceptance Scenarios**:

1. **Given** a community that has remained continuously suspended through `archiveScheduledAt`, **When** the archival process runs, **Then** the community state becomes `ARCHIVED`.
2. **Given** an archived community, **When** a former member or administrator attempts to access it through any marketplace route, **Then** access is denied and the community does not appear in their normal community navigation.
3. **Given** an archived community, **When** a MASTER inspects it, **Then** the community and its retained memberships, listings, threads, messages, invitations, and audit history remain available through the administration area.
4. **Given** an archival job that is delivered or executed more than once, **When** the same community is processed repeatedly, **Then** the result remains one archived community and duplicate audit transitions are not created.
5. **Given** a community reactivated before its prior deadline, **When** the old archival job later executes, **Then** it performs no state change because the community is no longer suspended under that suspension cycle.

---

### User Story 10 - A MASTER restores an archived community without reviving its old marketplace activity (Priority: P2)

A MASTER restores an archived community and selects exactly one prior administrator to regain active administrator access. Historical members and content remain archived.

**Why this priority**: A customer may return after archival, but restoring every old member, listing, and conversation would unexpectedly revive stale access and marketplace activity.

**Independent Test**: Archive a populated community, restore it selecting one prior administrator, and verify only that administrator regains access while historical listings, threads, invitations, and all other memberships remain inaccessible.

**Acceptance Scenarios**:

1. **Given** an archived community with one or more prior administrators, **When** a MASTER restores it and selects one eligible prior administrator, **Then** the community becomes `ACTIVE` and exactly that account receives an active `ADMINISTRATOR` membership.
2. **Given** the restored community, **When** any other former administrator or member signs in, **Then** they do not regain membership or access automatically.
3. **Given** listings, threads, messages, and invitations from before archival, **When** the community is restored, **Then** they remain historical/archived and do not return to marketplace feeds, active chats, invitation acceptance, or operational counts.
4. **Given** the selected prior administrator is disabled or deleted, **When** a MASTER attempts restoration with that account, **Then** the operation is rejected until an eligible account is selected or a new ordinary administrator is provisioned under an explicitly supported restoration path.
5. **Given** a successful restoration, **When** the administrator begins rebuilding the community, **Then** they may invite new members and later promote active members to administrator.
6. **Given** a successful restoration, **When** audit history is inspected, **Then** the original community identity and all prior lifecycle transitions remain continuous; restoration does not create a new community.

---

### User Story 11 - Every platform-administration action is auditable (Priority: P1)

Every security-sensitive or state-changing MASTER action creates an immutable administrative audit record identifying the actor, target, action, time, and result.

**Why this priority**: Global authority without traceability would weaken every trust boundary in the product and make support intervention indistinguishable from unauthorized data changes.

**Independent Test**: Execute representative MASTER operations, verify one immutable record per attempted action, and verify failed actions, automatic archival, and bootstrap events are also traceable.

**Acceptance Scenarios**:

1. **Given** a successful MASTER action, **When** it completes, **Then** an audit entry records the acting MASTER, action type, target type and identifier, timestamp, outcome, and relevant before/after values.
2. **Given** a rejected or failed destructive MASTER action, **When** it ends, **Then** an audit entry records the attempted action and failure reason without recording secrets.
3. **Given** an automatic archival transition, **When** it occurs without an interactive MASTER, **Then** the audit entry identifies the platform lifecycle process as actor.
4. **Given** any audit entry, **When** a MASTER uses the application, **Then** no edit or delete capability exists for that entry.
5. **Given** a password creation or reset, **When** the audit record is written, **Then** it never contains the plaintext temporary password, password hash, session token, or verification secret.
6. **Given** an ordinary user or community administrator, **When** they attempt to access the platform audit log, **Then** access is denied.

---

### Edge Cases

- A MASTER identity and an ordinary account are separate identities even when they use the same human-controlled email. This spec SHOULD prevent reuse of the same email across the two identity stores to reduce confusion unless migration constraints require otherwise; the chosen policy MUST be enforced consistently and documented.
- A Master ID is case-insensitive for uniqueness and sign-in, is trimmed, and cannot be changed in this spec.
- Blank Master IDs, emails, community names, display names, reasons, and passwords are rejected after trimming where applicable.
- Temporary passwords are generated by the system, displayed exactly once, never recoverable afterward, and never written to audit logs.
- A MASTER-created ordinary account uses a managed provisioning path; it must not leave an attacker-supplied pending password or verification token able to take control afterward.
- If an email belongs to an existing verified ordinary account, the MASTER must select that account rather than create a duplicate.
- If a community-creation operation creates a new account but fails to create the community or membership, the new account must not remain.
- A MASTER does not bypass current-membership checks by being global. Every MASTER operation uses dedicated administrative capabilities.
- Suspending an already suspended community is idempotent only when no new suspension cycle is requested; it must not silently extend the 30-day deadline. Extending or restarting the deadline requires an explicit reactivation followed by a new suspension.
- Reactivating an `ACTIVE` community is a no-op; restoring a non-`ARCHIVED` community is rejected.
- Archiving retains data; it never cascades physical deletion.
- Archived historical content must be distinguishable from active content without rewriting its original business state.
- Restoring a community creates a new active operational epoch; pre-archive listings and threads remain historical even if their stored pre-archive status was `ACTIVE`.
- If the selected restoration administrator was the only prior administrator but is no longer eligible, restoration cannot proceed silently with no administrator.
- Account deletion cannot orphan a community. Replacement administrators for every affected community are mandatory in the same atomic action.
- Disabling an account that participates in existing threads prevents that account's access but does not erase the other participant's historical messages.
- Changing an ordinary account's email must not reveal account existence through public authentication responses and must preserve invitation identity-binding rules.
- MASTER actions that expose personal data are restricted to the administration area and must not alter ordinary marketplace rendering or privacy rules.
- A community administrator's ability to add another administrator applies only to an existing active member of the same active community.
- No administrative action may create a state that violates the last-admin or last-master guards.

## Requirements *(mandatory)*

### Functional Requirements

#### MASTER Identity and Authentication

- **FR-001**: The system MUST maintain MASTER identities separately from ordinary marketplace `Account` identities and separately from community `Membership` roles.
- **FR-002**: A MASTER identity MUST include a unique immutable Master ID, an operational email, a password credential, a status (`ACTIVE` or `DISABLED`), creation time, and whether a mandatory first-login password change is pending.
- **FR-003**: MASTER sign-in MUST accept Master ID and password only. Email MUST NOT be accepted as an alternative sign-in identifier in this spec.
- **FR-004**: A MASTER MUST operate exclusively through a dedicated platform-administration authentication and authorization boundary.
- **FR-005**: A MASTER MUST NOT hold a community Membership or gain marketplace permissions by virtue of MASTER status.
- **FR-006**: MASTER identities MUST be denied from creating, owning, buying, or discovering listings as a marketplace participant; sending or receiving marketplace messages; accepting invitations; redeeming access codes; or appearing in community member rosters.
- **FR-007**: The first MASTER MUST be created through a documented deployment/bootstrap process unavailable from user-facing application routes.
- **FR-008**: The bootstrap MUST succeed only when no MASTER identity exists and MUST be rejected otherwise.
- **FR-009**: An active MASTER MUST be able to create another MASTER only as a new dedicated MASTER identity; an ordinary account MUST NOT be promoted, converted, or reused as a MASTER.
- **FR-010**: New MASTER identities MUST receive a system-generated temporary password displayed exactly once and MUST change it before performing any other administrative action.
- **FR-011**: An active MASTER MUST be able to disable, reactivate, and issue a new temporary password to another MASTER.
- **FR-012**: Disabling or resetting a MASTER MUST revoke all of that MASTER's active administrative sessions.
- **FR-013**: The system MUST reject any action that would leave zero active MASTER identities.
- **FR-014**: A signed-in MASTER MUST NOT disable its own currently authenticated identity.
- **FR-015**: MASTER emails MUST be unique among MASTER identities. The implementation plan MUST choose and enforce one explicit cross-store policy: either MASTER emails are also prohibited from matching ordinary account emails (preferred) or the two stores may overlap but are always presented as separate identities. This decision MUST NOT be left implicit during implementation.
- **FR-016**: MASTER identities MUST NOT be physically deleted through the application.
- **FR-017**: Password recovery by email, two-factor authentication, and security alerts for MASTER identities MUST NOT be implemented by this feature.

#### Platform Administration Boundary

- **FR-018**: Every MASTER capability MUST be implemented through a dedicated platform-administration policy and MUST NOT be implemented by creating a hidden community Membership or by modifying ordinary marketplace authorization checks to treat MASTER as a member.
- **FR-019**: Ordinary accounts, including community administrators, MUST be denied all MASTER routes and data.
- **FR-020**: The administration area MUST be responsive and fully usable on a mobile viewport, consistent with Constitution Principle V.
- **FR-021**: The administration area's initial dashboard MAY provide navigation and operational summaries required by this spec, but MUST NOT implement transaction analytics, sales rankings, revenue charts, or other analytics reserved for a later feature.

#### Community Creation and Management

- **FR-022**: An active MASTER MUST be able to create a community and assign its first administrator in one atomic operation.
- **FR-023**: The founding administrator MAY be an existing verified ordinary account or a newly provisioned ordinary account.
- **FR-024**: When provisioning a new ordinary administrator, the system MUST require an email and display name, create the account as verified, generate a temporary password shown exactly once, and create its `ADMINISTRATOR` Membership atomically with the community.
- **FR-025**: A MASTER-provisioned ordinary account MUST NOT inherit or preserve any untrusted pending password credential or verification token capable of taking control after provisioning.
- **FR-026**: If any part of community, account, or founding-membership creation fails, none of the records created by that operation may remain.
- **FR-027**: A MASTER MUST be able to list and inspect all communities regardless of state without becoming a member.
- **FR-028**: A MASTER MUST be able to edit all community-managed descriptive/configuration fields introduced by this and prior specs, subject to each field's validation.
- **FR-029**: A community MAY have multiple active administrators.
- **FR-030**: The system MUST reject any action that would leave an active or suspended community with zero active administrators.
- **FR-031**: A MASTER MUST be able to promote an active member to administrator, demote an administrator to member, revoke a membership, and add or provision an administrator.
- **FR-032**: Removing or replacing an administrator MUST require an explicit disposition for the affected ordinary account: retain as member, revoke only that community Membership, disable the ordinary account, or permanently delete the ordinary account under FR-034.
- **FR-033**: A MASTER MUST be able to inspect and manage community memberships and invitations through the administration area. Until access codes are implemented, no access-code management capability may be exposed.
- **FR-034**: Permanent ordinary-account deletion MUST remove authentication capability and personal sign-in identifiers while retaining non-reassignable historical attribution required for listings, messages, memberships, audit entries, and future transaction records. The implementation plan MUST define the anonymization/retention mechanism and must not use unrestricted cascading deletion.
- **FR-035**: MASTER intervention in invitations, memberships, and administrator roles constitutes the documented support/escalation path required by Constitution Principle III and MUST be separately auditable from ordinary community-administrator actions.

#### Community-Administrator Delegation

- **FR-036**: An active administrator of an active community MUST be able to promote an existing active member of that same community to `ADMINISTRATOR`.
- **FR-037**: Promotion MUST be rejected for non-members, inactive/revoked memberships, members of another community, suspended ordinary accounts, or any caller who is not an active administrator of that community.
- **FR-038**: Administrator demotion/removal by another community administrator MUST preserve at least one active administrator and MUST comply with the ordinary membership-management policy.
- **FR-039**: Community administrators MUST NOT be able to assign MASTER status, create MASTER identities, change community lifecycle state, or access the platform audit log.

#### Ordinary Account Management

- **FR-040**: An active MASTER MUST be able to create an ordinary account independently or as part of community creation, edit permitted account attributes, suspend, reactivate, reset its password, and permanently delete it subject to FR-034.
- **FR-041**: Creating an ordinary account outside community creation MUST NOT grant community access by itself; membership still requires an explicit administrator- or MASTER-originated community action.
- **FR-042**: Suspending an ordinary account MUST revoke all sessions and deny all marketplace access while preserving its data and memberships.
- **FR-043**: Reactivating an ordinary account MUST restore sign-in eligibility but MUST NOT recreate memberships that were separately revoked or restore access to suspended/archived communities.
- **FR-044**: A MASTER-issued ordinary-account password reset MUST generate a temporary password shown exactly once, revoke active sessions, and never store or expose plaintext afterward.
- **FR-045**: Editing an ordinary account's email MUST enforce case-insensitive uniqueness, update authentication identity consistently, and preserve public anti-enumeration behavior. Changing an account's email MUST NOT transfer, rewrite, or otherwise retarget any existing `Invitation` row: a pending invitation remains bound to the email address it was originally issued to, exactly as Principle I's credential-binding rule already requires. If that invitation should now reach the account's new email, an administrator MUST revoke it and issue a new one to the new address using the existing invitation capability (spec 004) — this feature adds no new capability for that case.
- **FR-046**: Suspending or deleting an ordinary account that is the last active administrator of any community MUST be rejected unless replacement administrator assignments for every affected community are completed atomically.
- **FR-047**: Ordinary-account management actions affecting more than one community MUST present their impact for explicit MASTER confirmation.

#### Community Lifecycle

- **FR-048**: Community state MUST be an enum containing at least `ACTIVE`, `SUSPENDED`, and `ARCHIVED`.
- **FR-049**: New communities MUST begin in `ACTIVE`.
- **FR-050**: Only an active MASTER may transition a community between lifecycle states.
- **FR-051**: Suspending an active community MUST record the acting MASTER, reason, `suspendedAt`, and `archiveScheduledAt` exactly 30 days later.
- **FR-052**: While a community is `SUSPENDED`, existing current members MUST remain able to view existing listings and send/view messages in existing threads.
- **FR-053**: While a community is `SUSPENDED`, the system MUST reject: listing creation; listing content edits; reactivation of paused listings; new thread creation; invitations; invitation acceptance; new memberships; administrator promotion/demotion/removal; access-code issuance/redemption when implemented; and any equivalent growth or publishing action.
- **FR-054**: While a community is `SUSPENDED`, listing owners and administrators MAY pause an existing listing because that action reduces visibility.
- **FR-055**: A MASTER MAY reactivate a suspended community before archival; reactivation MUST cancel that suspension cycle's scheduled archival and restore normal functionality.
- **FR-056**: Suspending an already suspended community MUST NOT silently extend its deadline. A new 30-day cycle requires reactivation followed by a new suspension.
- **FR-057**: A background lifecycle process MUST transition a continuously suspended community to `ARCHIVED` when its current `archiveScheduledAt` is reached.
- **FR-058**: Automatic archival MUST be idempotent and MUST verify the community is still suspended under the same suspension cycle before changing state.
- **FR-059**: An archived community MUST be inaccessible and non-enumerable through every ordinary marketplace path.
- **FR-060**: Archival MUST retain the community, memberships, listings, photos, threads, messages, invitations, audit history, and future transaction/payment records; it MUST NOT physically delete them.
- **FR-061**: An active MASTER MUST be able to inspect archived community history through the administration area.
- **FR-062**: An active MASTER MUST be able to restore an archived community by selecting exactly one eligible prior administrator or by provisioning an eligible administrator through an explicitly supported restoration action.
- **FR-063**: Restoring an archived community MUST reactivate the community and exactly one administrator Membership; all other historical memberships MUST remain inactive/archived.
- **FR-064**: Pre-archive listings, threads, messages, invitations, and other marketplace activity MUST remain historical and MUST NOT return to operational feeds, chats, acceptance flows, or active counts after restoration.
- **FR-065**: Restoration MUST preserve the same community identity and complete lifecycle/audit history; it MUST NOT create a replacement community.
- **FR-066**: The mechanism by which a former administrator requests restoration is outside this feature's scope.

#### Administrative Audit Log

- **FR-067**: The system MUST maintain an immutable administrative audit log separate from marketplace transaction logging.
- **FR-068**: Every MASTER state-changing action and every rejected destructive attempt MUST create an audit entry containing actor identity or system actor, action type, target type and identifier, timestamp, outcome, and sufficient non-secret context to reconstruct what changed.
- **FR-069**: Bootstrap creation, MASTER creation/status/reset actions, community creation/edit/state transitions/restoration, membership/administrator changes, ordinary-account creation/edit/status/reset/deletion, and automatic archival MUST be audited.
- **FR-070**: Audit entries MUST NOT contain plaintext passwords, password hashes, session tokens, invitation tokens, verification tokens, access codes, payment credentials, or other secrets.
- **FR-071**: Audit entries MUST NOT be editable or deletable through the application.
- **FR-072**: Only an active MASTER may view the platform administrative audit log.
- **FR-073**: Audit queries MUST support at minimum filtering by date range, actor, action type, target type, and target identifier, using database-level filtering and pagination.
- **FR-074**: This audit log MUST NOT be used as a substitute for the future marketplace Transaction Log required by Constitution Principle IV.

#### Explicit Exclusions

- **FR-075**: This feature MUST NOT implement access codes, bulk onboarding, transaction logging, in-app payments, platform billing, subscription charging, analytics dashboards, sales rankings, revenue charts, notifications, two-factor authentication, email-based MASTER recovery, or security alerts.
- **FR-076**: This feature MUST NOT implement the user-facing process for requesting restoration of an archived community.
- **FR-077**: This feature MUST NOT reactivate historical listings, memberships, invitations, or message threads automatically when a community is restored.
- **FR-078**: This feature MUST NOT allow a MASTER to participate in marketplace activity by overriding community isolation or participant-only message access.

## Key Entities

- **Master Identity** *(new)*: A dedicated platform-operator identity, separate from `Account`. Attributes include immutable normalized Master ID, operational email, password credential, status, first-login-password-change flag, creation time, creator/bootstrap origin, and status-change timestamps.
- **Master Session** *(new)*: An authenticated administrative session belonging only to a Master Identity; never interchangeable with an ordinary account session.
- **Administrative Audit Entry** *(new)*: Immutable record of platform-administration actions and lifecycle automation. Stores actor/system origin, action, target, outcome, timestamp, and sanitized before/after context.
- **Community** *(existing, extended)*: Gains lifecycle state and suspension/archive metadata, while preserving its existing community identity and tenancy meaning.
- **Community Lifecycle Event** *(new or represented immutably through audit entries)*: Identifies each suspension cycle, scheduled archival deadline, reactivation, archival, and restoration so stale background work cannot affect a newer lifecycle state.
- **Account** *(existing, extended by managed provisioning and platform status)*: Ordinary marketplace identity. Gains whatever status/retention attributes are required to support suspension, reactivation, managed temporary credentials, and non-destructive historical deletion.
- **Membership** *(existing, extended)*: Continues to express `ADMINISTRATOR` or `MEMBER` within one community. Must distinguish active access from retained historical membership so archival/restoration never revives everyone automatically.
- **Invitation** *(existing, referenced)*: Remains the direct administrator-issued membership credential. MASTER may inspect/revoke it through the documented escalation path; issuance and acceptance are blocked when the community is suspended or archived.
- **Listing / Message Thread / Message** *(existing, referenced)*: Their pre-archive records are retained but excluded from operational marketplace surfaces after community restoration.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of MASTER routes and capabilities reject ordinary accounts, including community administrators, and 100% of marketplace mutation attempts made using only a MASTER identity are rejected.
- **SC-002**: The first MASTER can be bootstrapped once, and every later MASTER can be created only by an active MASTER as a new dedicated identity.
- **SC-003**: 100% of newly created MASTER identities must replace their temporary password before any other administrative action succeeds.
- **SC-004**: 0% of tested actions can leave the platform with zero active MASTER identities or an active/suspended community with zero active administrators.
- **SC-005**: A MASTER can create a community with an existing or newly provisioned founding administrator in one atomic operation, with zero partial records after any simulated failure.
- **SC-006**: 100% of suspended-community tests allow viewing existing listings and continuing existing threads while rejecting all tested growth, membership, new-thread, and listing-publishing actions.
- **SC-007**: Every continuously suspended community transitions to archived state on or after its 30-day deadline, while every community reactivated before that deadline remains active when stale archival work executes.
- **SC-008**: 0% of archived communities or their retained records appear through ordinary marketplace queries.
- **SC-009**: Restoring an archived community gives active access to exactly one selected administrator and restores 0 historical members, listings, invitations, or threads to operational status automatically.
- **SC-010**: 100% of tested MASTER state-changing actions, failed destructive attempts, and automatic archival transitions produce an immutable sanitized audit entry.
- **SC-011**: 0 audit entries contain temporary passwords, password hashes, tokens, or other secrets.
- **SC-012**: A MASTER can find a community, ordinary account, MASTER identity, or audit event through paginated administration views without loading all platform records into application memory.
- **SC-013**: The platform-administration area is usable end-to-end at a mobile viewport width for MASTER sign-in, community management, account management, lifecycle actions, and audit inspection.

## Assumptions

- `MASTER` is the product term for a platform operator. It is not added to `MembershipRole`.
- "Client" is product/business language for an ordinary account; it is not stored as a separate permission role.
- The administration area lives in the same Next.js application and deployment, but behind a separate authentication/session and authorization boundary.
- The first MASTER bootstrap is operational tooling, not a public route, and is documented with who may run it and how credentials are transferred.
- MASTER temporary passwords require mandatory first-login replacement; ordinary accounts provisioned by a MASTER may keep their temporary password in this MVP, though they can change it.
- No plaintext password is stored, logged, emailed by this feature, or retrievable after its one-time display.
- An operational MASTER email is collected now so future recovery, alerts, and two-factor authentication can use it, but none of those behaviors ship here.
- Community descriptive/configuration fields available for MASTER editing are limited to fields already present or explicitly introduced by this feature; analytics and billing settings are not introduced indirectly.
- Suspension is a platform lifecycle state, not a billing implementation. A future billing spec may trigger suspension, but this feature only provides the state and MASTER/manual lifecycle operations.
- The 30-day deadline is exactly 30 calendar days from the recorded suspension instant.
- Existing listing visibility while suspended follows each listing's stored status. ACTIVE listings remain viewable; PAUSED listings remain excluded from discovery.
- Existing threads remain usable during suspension only while both participants still hold current active memberships and ordinary account access.
- Archived data retention is intentionally indefinite at this stage so future financial and audit obligations are not destroyed. A later legal/data-retention spec may define retention periods or anonymization requirements but must not retroactively erase mandatory transaction/audit history.
- Restoration creates a new operational epoch for the same community. Historical data remains queryable by MASTER but is not operational.
- A former administrator's request for restoration happens outside this feature; the MASTER action that performs restoration is in scope.
- The administrative audit log and future transaction log are distinct domains, even when a future analytics dashboard reads both.
- Critical-flow tests are mandatory before implementation for MASTER authentication/authorization, community bootstrap, last-master/last-admin guards, managed ordinary-account provisioning, community suspension/archival/restoration, and administrative audit integrity.
