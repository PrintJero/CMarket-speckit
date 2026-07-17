# Feature Specification: User Display Names

**Feature Branch**: `006-user-display-names`

**Created**: 2026-07-17

**Status**: Draft

**Input**: User description: "User display names. Every account has a display name shown wherever that person appears to other members of a community — starting with their listings. The account's email address is never shown to fellow members. Why: a listing today reads as \"cmro9vg9v0000v2rc969oj6yy is selling this bike\", because the only human-readable identifier the system holds is the email address, and showing that to fellow members would violate Principle VI (contact data stays private until both parties agree to interact). A display name is what makes a person nameable without exposing contact data, and it is a prerequisite for messaging, since a thread must say who is speaking. Scope: an account has an optional display name, chosen and changed by that account alone; no other account may change it, including a community administrator; display names are not unique; display names are freely chosen and are not verified, moderated, or checked for impersonation by this feature; accounts created through federated identity MUST have their display name populated from the provider's own profile name at the moment the identity is linked, with no prompt; accounts created with email and password have no display name at first and MUST be prompted to choose one at the point where it first becomes visible to others — creating a listing — never during sign-up; everywhere a person is shown to another member, the display name is used, and the email address MUST NOT be rendered to fellow members anywhere; a person MUST be able to see and edit their own display name. Out of scope: avatars/profile photos, bios, public profile pages, per-community display names, name moderation or impersonation reporting, real-name enforcement, demographic data. Constraints: the administrator member list (spec 004) continues to show member emails to that community's own administrator, unchanged; specify whether a federated identity linking to an existing unverified password account (spec 002 FR-018) applies the provider's profile name; display name is account-level, not community-level."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A member sees who they're dealing with, never a raw identifier (Priority: P1)

A member browsing or viewing a community's listings sees the seller's display name on every listing — never the seller's email address, and never an internal identifier.

**Why this priority**: This is the entire point of the feature and its most visible, immediate value: today a listing has no human-readable owner shown at all, and the only identifier the system holds for a person is their email address — which must never reach a fellow member (Principle VI). Without this story, no other part of the feature has anything to display.

**Independent Test**: Can be fully tested by having one member create a listing after setting a display name, then having a different member of the same community view that listing (in the community feed and on its detail page) and confirming the display name appears and the email address appears nowhere in the response or rendered page.

**Acceptance Scenarios**:

1. **Given** a listing owned by an account with a display name, **When** a different member of that community views the community's listing feed, **Then** the listing shows the owner's display name and does not show the owner's email address anywhere.
2. **Given** the same listing, **When** that member opens the listing's detail page, **Then** the owner's display name is shown there too, and the email address is absent from the rendered page and from any data returned to the browser for it.
3. **Given** a listing owned by an account that has no display name, **When** a different member views that listing, **Then** a defined, neutral placeholder is shown in place of a name, and the email address is never shown as a fallback.

---

### User Story 2 - An email/password account is prompted to name themselves before their first listing goes live (Priority: P1)

An account created with email and password has no display name at first. The first time that gap would actually matter — creating a listing, the moment the account becomes visible to other members — the person is asked to choose a display name, and that name is required before the listing exists.

**Why this priority**: This is what makes User Story 1's guarantee actually hold for every listing, not just the lucky ones whose owner happened to set a name earlier. It has to ship alongside Story 1 for the "never leaks a raw identifier" guarantee to be real rather than best-effort.

**Independent Test**: Can be fully tested by signing up a brand-new email/password account (confirming no display-name prompt appears anywhere during sign-up), then attempting to create a listing and confirming a display name must be supplied before the listing is created.

**Acceptance Scenarios**:

1. **Given** a brand-new email/password account, **When** that person completes sign-up, **Then** they are not asked for a display name at any point during sign-up.
2. **Given** an email/password account with no display name yet, **When** that person begins creating a listing, **Then** they are required to set a display name as part of completing that action, and the listing is not created until they do.
3. **Given** an email/password account that already has a display name (set on a prior listing or via account settings), **When** that person creates another listing, **Then** they are not prompted again.

---

### User Story 3 - A federated (Google) sign-in arrives already named (Priority: P2)

Someone who signs up or signs in with Google never has to choose a display name — it is populated automatically from the name Google already provided, the moment their Google identity is linked to a CMarket account.

**Why this priority**: Federated sign-in already has the information needed to satisfy User Story 1 without ever asking the person anything; shipping this alongside Stories 1-2 avoids federated users hitting a prompt Google users shouldn't need, but the product is usable without it landing first (email/password users still get prompted at listing creation).

**Independent Test**: Can be fully tested by driving the real `/api/auth/[...nextauth]` Google callback route end-to-end — with Google mocked only at its own OAuth boundary (its token and userinfo endpoints), never by calling the adapter's methods in isolation — through to a real session cookie and a real `getCurrentAccount()` resolution, and confirming the resulting account has a non-empty display name immediately, sourced from the mocked profile, with no prompt shown at any point. This is the same seam that hid the session-cookie mismatch documented in 002's 2026-07-17 bug-fix amendment: a test that only calls the adapter directly would pass regardless of whether this feature's display name ever actually reaches a real, cookie-authenticated request.

**Acceptance Scenarios**:

1. **Given** no CMarket account exists yet for a given Google identity, **When** that person completes Google sign-up, **Then** the resulting account's display name is populated from the Google profile's name with no prompt.
2. **Given** an existing, unverified email/password account with no display name, **When** someone completes Google sign-up using that same email (triggering the existing auto-link-and-verify behavior), **Then** the account's display name is populated from the Google profile's name, for the same reason its verification state changes at that moment: this is the first point the account has ever been provably linked to a real person, and it had no display name of its own to protect (an unverified account cannot sign in and therefore could never have reached the listing-creation prompt in User Story 2).
3. **Given** an existing, already-verified email/password account that already has its own, previously chosen display name, **When** that person later links Google to the same account, **Then** their existing display name is left unchanged — Google's profile name is never applied over a name the account holder already chose, since only the account itself may change its own display name.
4. **Given** an existing, already-verified email/password account with no display name yet, **When** that person links Google to the same account, **Then** the display name is populated from the Google profile, since none exists yet to protect.

---

### User Story 4 - Anyone can see and change their own display name (Priority: P2)

An account holder can view their current display name and change it at any time, independent of how their account was created.

**Why this priority**: A name someone didn't choose (a federated default) or picked in a hurry (the listing-creation prompt) must be correctable, but the product functions without this for an initial release since Stories 1-3 already guarantee every visible listing has some name attached.

**Independent Test**: Can be fully tested by having any signed-in account holder — regardless of sign-in method — navigate to view their own account details, change their display name, and confirm the new value is what is shown to other members afterward.

**Acceptance Scenarios**:

1. **Given** a signed-in account with an existing display name, **When** that person views their own account details, **Then** their current display name is shown.
2. **Given** the same account, **When** that person changes their display name to a new value, **Then** the change is saved and is what fellow members see from that point on.
3. **Given** any account, **When** any other account (including a community administrator) attempts to change that account's display name, **Then** the attempt is rejected and the display name is unchanged.

---

### Edge Cases

- What happens when a member is shown a listing whose owner has no display name (e.g., an account created outside the normal flow, or predating this feature)? A defined, neutral placeholder is shown instead of a name — never the email address, in full, truncated, or otherwise.
- What happens when someone submits a blank or whitespace-only display name, whether at the listing-creation prompt or via account settings? It is rejected as if no display name were submitted; the account's display name is not changed to an empty value.
- What happens when a federated sign-in's profile has no name at all (rare, but not impossible depending on the identity provider's own data)? The account is left with no display name, exactly as an email/password account starts out, and is not treated as an error.
- What happens when an account with no display name yet appears somewhere other than a listing (a future surface not yet built)? The same placeholder rule applies: never the email address, always the defined placeholder in the absence of a display name.
- Does the community administrator's existing member list (spec 004), which intentionally shows member emails for membership management, gain a display-name column or lose its email column because of this feature? No — that list is unchanged and out of scope, per the carve-out defined directly in FR-010/FR-015 (not merely an incidental reading of them).
- What happens if an account holds memberships in multiple communities? The exact same display name is shown in every one of them; there is no per-community override.
- What happens when a listing-creation request bypasses the client-side form entirely (e.g., a direct request to the underlying create-listing capability, not the listing-creation page)? It is still blocked for an account with no display name, exactly as if it had come through the form — the guarantee is enforced wherever a listing is actually created, not only in the form that normally submits that request.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: An account MAY have a display name; it is absent (not set) by default for an account created with email and password.
- **FR-002**: Only the account itself may set or change its own display name. No other account — including a community administrator, and regardless of role in any community — may set or change another account's display name.
- **FR-003**: Display names are not required to be unique across accounts, and this feature MUST NOT verify, moderate, check for impersonation, or otherwise validate the content of a display name beyond FR-012's basic format rule.
- **FR-004**: An account created via federated (Google) sign-up MUST have its display name populated from the identity provider's own profile name, when the provider supplies one, at the moment the identity is linked to a CMarket account, with no prompt shown to the person. When the provider supplies no name, the account is left with no display name, exactly as any other account with none — this is not an error condition, and FR-011's placeholder applies wherever that account would otherwise be shown to a fellow member.
- **FR-005**: When a federated identity is linked to an existing account that has no display name yet — whether because the account is brand new, or because it is an existing account (verified or unverified) that has simply never had one — the provider's profile name MUST be applied at the moment of linking, when the provider supplies one (per FR-004's conditional), at the same moment spec 002's existing auto-link behavior, including its FR-018 verification/credential handling for a previously-unverified account, occurs. This includes linking to a previously unverified email/password account: since such an account cannot sign in and therefore can never have reached the listing-creation prompt (User Story 2) beforehand, it is guaranteed to have no display name to protect at that point.
- **FR-006**: When a federated identity is linked to an existing account that already has a display name of its own, that display name MUST NOT be overwritten by the provider's profile name — consistent with FR-002's rule that only the account itself changes its own display name.
- **FR-007**: An account created with email and password MUST NOT be asked for a display name during sign-up.
- **FR-008**: An email/password account that does not yet have a display name MUST be required to set one as part of completing the creation of its first listing, presented at that point in the create-listing flow. This guarantee MUST hold regardless of how the create-listing request arrives: a listing MUST NOT come into existence for an account with no display name, whether the request originates from the listing-creation form or a direct request to whatever server-side capability actually creates the listing — the same guarantee cannot be satisfied by client-side prompting alone. An account that already has a display name MUST NOT be prompted again.
- **FR-009**: Wherever an account is shown to a fellow community member — starting with a listing's owner, shown in the community's listing feed and on that listing's detail page — the system MUST display that account's display name.
- **FR-010**: An account's email address MUST NOT be rendered to a fellow community member anywhere in the product, in full, truncated, obfuscated, or as a fallback when a display name is absent — with exactly one carve-out: the existing community-administrator member list (spec 004, FR-015) is not a "fellow community member" surface for purposes of this requirement, even though its viewer (a community's administrator) also holds a `Membership` in that same community and would otherwise qualify as one. That list is a distinct, administrator-only membership-management view, unchanged by this feature; no other surface this feature touches may claim the same carve-out.
- **FR-011**: When an account has no display name at the moment it would otherwise be shown to a fellow member, the system MUST show a defined, neutral placeholder in its place — never the email address and never an internal identifier.
- **FR-012**: A display name, wherever submitted (the listing-creation prompt or account settings), MUST be non-blank after trimming leading and trailing whitespace, and MUST NOT exceed 50 characters. No other content restriction applies (FR-003).
- **FR-013**: An account holder MUST be able to view their own current display name (or its absence) and change it, at any time, independent of how the account was created or whether it currently has one.
- **FR-014**: Display name is a property of the account, not of any community membership; an account holding memberships in multiple communities MUST show the identical display name in every one of them.
- **FR-015**: This feature MUST NOT change the existing community-administrator member list (spec 004), which continues to intentionally show member email addresses to that community's own administrator for membership management — that list is not a "shown to a fellow member" surface and is out of this feature's scope.
- **FR-016**: This feature MUST NOT implement avatars or profile photos, bios, public profile pages, per-community display names, display-name moderation or impersonation reporting, real-name enforcement, or any demographic data collection.

### Key Entities

- **Account** *(existing, from 002-accounts-authentication — extended by this feature)*: gains a single new attribute, an optional display name (absent by default for email/password accounts; populated automatically for federated accounts per FR-004/FR-005). Ownership of this attribute — who may read and who may write it — follows FR-002, FR-009–FR-011, and FR-013.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of listings viewed by a fellow community member display the owner's display name (or the defined placeholder when absent), and 0% expose the owner's email address in any form — verified by test.
- **SC-002**: 100% of accounts created through a completed Google sign-in whose Google profile carries a name have a non-empty display name immediately afterward, with zero display-name prompts shown during that sign-in — verified by a test that drives the real `/api/auth/[...nextauth]` callback route with Google mocked at its OAuth token/userinfo endpoints, through to a real session cookie and a real `getCurrentAccount()` resolution, never by invoking adapter code in isolation.
- **SC-003**: 100% of attempts to create a listing for an email/password account with no display name are blocked until one is supplied, regardless of whether the attempt goes through the listing-creation form or a direct request to the underlying create-listing capability — verified by test.
- **SC-004**: 0% of attempts by an account to change a display name other than its own succeed, including attempts by a community administrator — verified by test.
- **SC-005**: 100% of federated sign-ins that link to an account already holding a self-chosen display name leave that display name unchanged — verified by test.
- **SC-006**: An account holder can view and update their own display name in a single, direct step from their own account settings, without needing outside help.

## Assumptions

- The placeholder shown for an account with no display name is a fixed, generic label distinct from any real name, an email address, or an internal identifier (e.g., "A member"); the exact wording is a presentation detail, not a functional requirement, so long as it never reveals contact information.
- The listing-creation display-name prompt is a required (blocking) step when no display name exists yet, not a skippable suggestion — this is what makes User Story 1's "never a raw identifier" guarantee hold for every listing rather than only for accounts that happened to set a name earlier.
- A maximum display name length of 50 characters is a reasonable default in the absence of one specified in the feature description; it exists to bound storage and rendering, not to police content (FR-003 explicitly excludes content moderation).
- Today, a listing's owner is not shown by name, email, or identifier anywhere in the product; this feature is what introduces showing an attributable person on a listing at all, and it does so exclusively via the display name defined here.
- The only existing surface where one member is shown to another today is a community's product listings (feed and detail page); any future member-facing surface (e.g., messaging, a membership roster) will need to adopt this same display-name convention when it is built, but is not itself in scope here.
- The community-administrator member list (spec 004) is unchanged by this feature in every respect, including that it continues to show member emails to that community's own administrator only.
- Verifying User Story 3 end-to-end requires mocking Google only at its own OAuth boundary (the token and userinfo endpoints the real callback route calls), never the adapter itself — this is what exercises the real `/api/auth/[...nextauth]` route, the real session cookie, and a real `getCurrentAccount()` resolution, closing the exact seam that let 002's session-cookie mismatch ship undetected behind four adapter-only Google tests. That mocked boundary is a standalone process outside this application entirely (plan.md, research.md #2) — never a route this application itself exposes — so it carries no production-reachability question at all, independent of any environment variable.
- The create-listing guarantee in FR-008 must be enforced at whatever single point actually creates a listing (so every caller passes through it), not duplicated separately in the client form and left unenforced elsewhere — mirroring the gap already on record in this codebase where a listing mutation's authorization lived only in the page, not the underlying capability.
