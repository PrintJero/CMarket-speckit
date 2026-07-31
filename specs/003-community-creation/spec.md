# Feature Specification: Community Creation & Founding Administrator

**Feature Branch**: `003-community-creation`

**Created**: 2026-07-16

**Status**: Finished

**Input**: User description: "Community creation and founding administrator. A community is created by CMarket platform tooling, not by end users. There is no public \"create a community\" action anywhere in the product. When a community is created, an existing CMarket account is designated as its founding administrator in the same act, producing that account's first membership in that community. Per Constitution Principle I, all membership originates from an administrator-issued credential, which makes the first administrator of a new community impossible to create through the normal path — this is the sole bootstrap exception. Community creation is operator-driven because communities correspond to real institutions (a university, a residential complex) onboarded deliberately, not to anything a user can self-provision. Scope: platform tooling that creates a community with a name and designates a founding administrator, who MUST be an existing account with a verified email; the tooling MUST NOT create accounts, set/modify credentials, or bypass verification, and MUST fail with a clear error if the target account doesn't exist or isn't verified; creation produces exactly one membership (the founding account, administrator role); a community MUST always have at least one administrator (last-admin guard at the model level); the operator path MUST be documented (who may run it, how it's requested). Out of scope: community settings, branding, deleting/archiving a community, transferring/adding administrators, any community directory or discovery, inviting members, any end-user UI. Constraints: no community is discoverable/enumerable by non-members; the community identifier MUST be a first-class dimension of the data model from the start. Critical flow per Principle VIII: tests written first, must fail first, implementation proceeds only to make them pass."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Bootstrap a new community with its founding administrator (Priority: P1)

An operator uses CMarket's platform tooling to bring a new institution (a university, a residential complex) onto the platform. They provide a community name and the email of an existing, verified CMarket account belonging to the person who will run that community. That single act creates the community and makes the named account its first — and initially only — administrator, with no other setup step required to reach a usable, gated state.

**Why this priority**: Without this, no community can ever exist, and every other membership feature (invitations, access codes, listings) has nothing to attach to. This is the literal root of the tenancy tree.

**Independent Test**: Can be fully tested by invoking the creation tooling with a valid, verified account (A) and a name, then asserting: the community record exists, exactly one membership record exists for A in that community with the administrator role, A's own credentials/verification state are unchanged from before the call, a *second* unrelated verified account (B) has no real membership record in that community and no trace of it in its own data-backed view (FR-009 — verified using B, never A, since A is the one account this feature permits to have real access), and A's existing session/current-account view is itself unchanged (FR-015).

**Acceptance Scenarios**:

1. **Given** an existing account with a verified email and no prior memberships, **When** an operator creates a community naming that account as founding administrator, **Then** the community is created and that account has exactly one membership in it, with the administrator role.
2. **Given** a newly created community founded by account A, **When** a *different*, unrelated account B (never named in that creation) is examined, **Then** the community does not appear anywhere in B's real, data-backed view of its own community memberships, and nothing about the community's existence is exposed to B. (This scenario is specifically about a second account, not A itself — see Scenario 5 for what A's own view shows.)
3. **Given** an account that is already the founding/sole administrator of one community, **When** an operator creates a second, distinct community naming the same account as founding administrator, **Then** the account gains a separate membership in the new community, and its membership in the first community is unaffected.
4. **Given** a successful creation, **When** the resulting community record is inspected, **Then** it records which operator invoked the creation and when, independent of and distinct from the end-user account/authentication system.
5. **Given** a successful creation, **When** the founding administrator's own existing account-facing session/current-account view (established in 002-accounts-authentication) is examined immediately afterward, **Then** it still reports an empty memberships list, unchanged — this feature does not extend that particular surface to reflect the membership it just created (FR-015).

---

### User Story 2 - Reject creation naming a nonexistent account (Priority: P2)

An operator mistypes or otherwise supplies an email that does not match any existing CMarket account as the intended founding administrator.

**Why this priority**: Constitution Principle I requires membership to always trace back to a real, identity-bound account. Silently creating a community with no valid administrator (or worse, auto-creating an account to paper over the mistake) would violate that guarantee at the very first community ever onboarded.

**Independent Test**: Can be fully tested by invoking the creation tooling with an email that matches no existing account, then asserting: the call fails with a clear, specific error, no community record was created, and no account was created as a side effect.

**Acceptance Scenarios**:

1. **Given** no account exists with a given email, **When** an operator attempts to create a community naming that email as founding administrator, **Then** the attempt fails with a clear error identifying that the account does not exist, and no community or membership is created.
2. **Given** a failed attempt due to a nonexistent account, **When** the underlying accounts table is inspected, **Then** no new account was created as a result of the attempt.

---

### User Story 3 - Reject creation naming an unverified account (Priority: P2)

An operator supplies the email of an account that exists but has not yet completed email verification as the intended founding administrator.

**Why this priority**: Identical rationale to User Story 2 — an unverified account is not yet a trustworthy identity per Principle I, so granting it administrator authority over a brand-new community would be a pre-hijacking-style gap (an attacker who merely claims an email, without proving control of it, could otherwise seize administration of a community).

**Independent Test**: Can be fully tested by invoking the creation tooling with the email of an existing but unverified account, then asserting: the call fails with a clear, specific error distinguishable from the "account not found" case, no community or membership is created, and the target account's verification state and credentials are unchanged.

**Acceptance Scenarios**:

1. **Given** an existing account whose email is not verified, **When** an operator attempts to create a community naming that account as founding administrator, **Then** the attempt fails with a clear error identifying that the account is not verified, and no community or membership is created.
2. **Given** a failed attempt due to an unverified account, **When** that account is inspected afterward, **Then** its verification state, password/credential, and any other stored attribute are byte-for-byte unchanged from before the attempt.

---

### User Story 4 - Documented, accountable operator path (Priority: P3)

Someone other than the original implementer — a new engineer, an on-call operator, an auditor — needs to know who is allowed to bootstrap a new community and how they are supposed to request or trigger it.

**Why this priority**: A bootstrap exception that exists only as tribal knowledge is a governance gap: Principle I permits this path specifically because it is the sole, deliberate exception to admin-issued membership, and an undocumented exception is indistinguishable from an unguarded one.

**Independent Test**: Can be tested by confirming that project documentation (independent of this spec) states, in one findable place, which role(s)/people may invoke the tooling and what request/approval process (if any) precedes an invocation.

**Acceptance Scenarios**:

1. **Given** the shipped feature, **When** someone consults its documentation, **Then** they can identify who is authorized to run the community-creation tooling and the process by which its use is requested, without needing to ask a teammate.

---

### Edge Cases

- What happens when the target account is already the founding administrator of another community? It gains an additional, independent membership; its existing memberships are untouched (User Story 1, Scenario 3).
- What happens when the community name is empty or blank? Creation MUST be rejected with a clear error before any record is written (FR-014).
- What happens when two creation attempts are made with the same community name? Both MUST succeed independently — the system does not enforce name uniqueness; operators are trusted to avoid confusing duplicates (see Assumptions).
- What happens when an attempt fails partway (e.g., after the community row is written but before the membership row is)? The action MUST be atomic — a failure at any point MUST leave neither the community nor the membership persisted.
- What happens if someone proposes reaching this tooling over the network (an HTTP route, an API endpoint, a server action)? That proposal MUST be rejected as a routine change — it can only be adopted as a deliberate amendment carrying its own operator-credential design, recorded and justified in the plan's Complexity Tracking table (FR-002). **2026-07-17 update**: this scenario has now occurred, in the narrow, disabled-by-default form described in FR-016 — a development-only panel, inert (404) unless explicitly enabled, never permitted in production. It does not carry a separate operator-credential design because it isn't reachable in any real deployment in the first place; that requirement still applies to any interface that would be.
- Given that no removal or demotion path exists yet, how is "a community can never have zero administrators" verified by this feature? It isn't — and can't be, without a code path that removes the only administrator to try to break. This feature is responsible only for representing roles in a way that makes the guard enforceable later (FR-010); the guard's actual enforcement, and its test, ship together with the first feature that can remove or demote an administrator.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Platform tooling MUST provide an operator-invoked action that creates a new community from a name and the email of an existing CMarket account designated as its founding administrator. This action MUST NOT be reachable from any end-user-facing surface.
- **FR-002**: Community creation tooling MUST NOT be reachable over the network from the user-facing application — no HTTP route, API endpoint, or server action in the application MUST invoke it. It MUST run with direct database access, invoked directly by an operator who already holds server/database access. If a networked interface to this tooling is ever proposed, it MUST require an operator credential that is entirely separate from the end-user authentication system, and adopting it MUST be recorded and justified in the implementation plan's Complexity Tracking table. (The sole exception is the disabled-by-default, development-only panel described in FR-016: because it is inert — returning 404 — unless explicitly enabled, and MUST NOT ever be enabled in a real deployment, it substitutes that disabled-by-default gate for the operator-credential requirement above; any interface intended to be reachable in a real deployment still requires its own separate operator-credential design as stated here.)
- **FR-003**: The tooling MUST verify that the target account exists before creating anything. If no account matches, creation MUST fail with a clear error identifying that the account does not exist, and MUST NOT create a community, a membership, or an account.
- **FR-004**: The tooling MUST verify that the target account's email is verified before creating anything. If the account exists but is unverified, creation MUST fail with a clear error identifying that the account is not verified — distinguishable from the FR-003 error — and MUST NOT create a community or a membership.
- **FR-005**: The tooling MUST NOT create, provision, or otherwise bring into existence any account; the founding administrator's account MUST already exist independent of this action.
- **FR-006**: The tooling MUST NOT set, change, reset, or otherwise touch the founding administrator's credentials, verification state, or any other existing account attribute, whether the action succeeds or fails.
- **FR-007**: On successful validation, the community and its founding administrator's membership MUST be created together as a single atomic outcome: after any invocation, either both exist or neither does.
- **FR-008**: The membership produced by this action MUST carry the administrator role, and MUST be the only membership produced — no other memberships, invitations, or pending records may be created as a side effect.
- **FR-009**: A newly created community MUST NOT be visible, listed, searchable, or otherwise enumerable by any account other than its founding administrator — no directory, discovery surface, or cross-account query may reveal its existence to a non-member. Verification of this requirement MUST use an account genuinely distinct from the founding administrator (a non-member), checked against real, persisted membership data — the founding administrator's own account is the one this requirement explicitly permits to differ, so testing against it (or against any surface that returns the same fixed result regardless of who is asked) proves nothing about this requirement.
- **FR-010**: The Membership model MUST represent roles in a way that makes administrator count enforceable (see Key Entities) — the last-admin guard itself MUST be implemented together with the first feature that can remove or demote an administrator, since no such path exists yet for the guard to protect.
- **FR-011**: An account MAY be designated founding administrator of more than one community over time; each designation MUST produce its own independent membership without altering the account's other memberships.
- **FR-012**: The process for invoking this tooling — who is authorized to run it, and how its use is requested or approved — MUST be documented as a deliverable of this feature.
- **FR-013**: Every community creation MUST record who invoked it and when, persisted with the community itself. Because this is the sole membership path that bypasses administrator-issued credentials (Principle I's bootstrap exception), it MUST remain traceable to a specific invocation on the same standard Principle IV already sets for transaction traceability.
- **FR-014**: The tooling MUST reject a blank, empty, or whitespace-only community name with a clear error before any record is written, and MUST NOT create a community, a membership, or an account in that case.
- **FR-015**: The founding administrator's own existing account-facing session/current-account payload (established in 002-accounts-authentication, which reports an empty memberships list for every account) MUST continue to report an empty memberships list immediately after this feature creates their membership. This feature MUST NOT extend that surface to reflect real community/membership data — doing so is out of scope, deferred to a future feature that deliberately surfaces community membership to end users.
- **FR-016** *(2026-07-17, development-only exception)*: A development-only operator panel MAY expose `createCommunity()` over the network at a dedicated route (`/operator` and its supporting API route), strictly for local development convenience. This MUST be gated behind an environment variable (e.g. `OPERATOR_PANEL_ENABLED`) that defaults to disabled; when not explicitly enabled, every part of this surface — the page and its route handler, each independently — MUST return 404, not a redirect or an error page, and MUST NOT be enabled in a real deployment. This panel MUST reuse `createCommunity()` unchanged: it introduces no new validation, no bypass of FR-003 through FR-008/FR-013/FR-014's guarantees, no user or membership creation beyond what `createCommunity()` itself already produces, and no cross-community data view (a bare list of existing communities' own name/id/audit fields is permitted; their members or contents are not). A production-facing operator panel is out of scope here and would require its own separate operator-authentication design, per FR-002.

### Key Entities

- **Community**: A tenancy boundary corresponding to a real institution. Attributes: name, unique identifier, creation timestamp, and the invoking operator's identifier (recorded at creation for audit purposes — FR-013; this identifier is separate from the end-user Account/authentication system, per FR-002). All future community-scoped data (memberships, listings, transactions) hangs off this identifier from the start.
- **Membership**: The link between one Account and one Community, carrying a role (initially only "administrator" is produced by this feature). Attributes: role (an enumerated type — e.g., `administrator` — never a bare integer or free-text string), creation timestamp. A community's administrator count is derived from counting its memberships with the administrator role.
- **Account** *(existing, from 002-accounts-authentication)*: Referenced, not modified, by this feature. Must already exist and have a verified email to be eligible as a founding administrator.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An operator can bootstrap a brand-new community — name plus founding administrator — in a single tooling invocation, with no manual data-store edits required.
- **SC-002**: 100% of creation attempts naming a nonexistent or unverified account are rejected before any community, membership, or account record is written, as verified by automated tests.
- **SC-003**: Every community produced by this feature has exactly one administrator membership immediately after creation, and its role is stored in a form (enumerated, not free-text) that a future removal/demotion feature can reliably count on to enforce the last-admin guard.
- **SC-004**: A newly created community is invisible to every account other than its founding administrator immediately upon creation — no propagation delay or eventual-consistency window.
- **SC-005**: Any engineer or operator can determine who is authorized to run the community-creation tooling and how to request it from documentation alone, without asking a teammate.
- **SC-006** *(2026-07-17)*: The development-only operator panel (FR-016) returns 404 for both its page and its API route in 100% of requests when its environment variable is unset, verified by automated tests — not merely by convention.

## Assumptions

- The founding administrator is identified to the tooling by their verified email address, consistent with the account model established in 002-accounts-authentication.
- Community names are free-text labels with no system-enforced global uniqueness; operators are trusted to avoid confusing duplicates.
- Expected volume is low and operator-driven (deliberate institutional onboarding), not self-service scale — no specific throughput target beyond correctness is required.
- Administrator removal, transfer, multi-administrator management, and any community directory/discovery are explicitly out of scope for this feature (backlog). This feature only makes the guard enforceable later (an enumerated role the future feature can count on, per FR-010) — it does not implement or test the guard's enforcement itself, since no path exists yet that could violate it.
- The non-discoverability requirement (FR-009) is proven against real, persisted membership data for a genuinely unrelated second account — not against the existing current-account/session payload from 002-accounts-authentication, which returns an empty memberships list unconditionally (by design, per FR-015) and so cannot distinguish a member from a non-member; checking it would be unfalsifiable regardless of who's asked. Proving FR-009 does not require building a full discovery/directory feature — only reading the real `Membership` rows for the two accounts under test.
- The invoking operator's recorded identifier (FR-013) is a plain identifying value supplied at invocation time (e.g., an operator name or username) — it is not tied to the end-user Account system and does not imply building any operator-account/login feature.
- The development-only operator panel (FR-016) is not a substitute for FR-012's documented operator path — it is a convenience layer over the same `createCommunity()` function, deliberately gated to be inert everywhere except a developer's own, explicitly-configured environment.
