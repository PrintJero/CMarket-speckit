# Feature Specification: Product Listings

**Feature Branch**: `spec005-product-listing`

**Created**: 2026-07-17

**Status**: Draft

**Input**: User description: "Product Listings: An administrator or member of a community can create a product listing scoped to that community (communityId is mandatory and every query MUST be scoped by it, per Constitution Principle II). A listing has a status represented as an enum (not a free-text/boolean flag) with at least ACTIVE and PAUSED states. The listing owner can create, edit, pause (toggle back to active), and delete their own listing. Listings support photos (one or more images attached to a listing). Out of scope for this feature: nested/hierarchical categories, product variants (size/color/etc.), inventory/stock tracking, draft state before publishing, and dynamic/scheduled pricing. This is a critical flow (product listing) per Constitution Principle VIII, so tests are mandatory and must be written before implementation (red before green). Constitution gates to satisfy: Principle II (Community Isolation — every access path scoped by community membership), Principle VII (Simplicity & MVP-First — no speculative scope beyond what's listed above), Principle VIII (Test Discipline for Critical Flows). Clarification: administrator moderation over listings they don't own IS in scope, satisfying Principle III's 'moderate (edit visibility of, take down) listings' guarantee — implemented as an administrator's ability to pause/reactivate any listing within their own community; deletion remains the owner's sole authority."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A member creates a product listing in their community (Priority: P1)

Any account holding a membership (administrator or member) in a community can list a product for sale within that community, giving it a title, description, price, and optionally one or more photos.

**Why this priority**: Without the ability to create a listing, no other part of this feature (or the marketplace itself) has anything to act on. This is the minimum viable slice.

**Independent Test**: Can be fully tested by having a member of community C create a listing with a title, description, price, and one photo, then asserting the listing exists, is scoped to C, starts in the ACTIVE state, and is attributed to that member as owner.

**Acceptance Scenarios**:

1. **Given** an account with a membership (any role) in community C, **When** it creates a listing with a title, description, and price, **Then** a new listing is created scoped to C, owned by that account, in the ACTIVE state.
2. **Given** the same account, **When** it attaches one or more photos to the listing at creation, **Then** all attached photos are stored and associated with that listing.
3. **Given** the same account, **When** it creates a listing with no photos at all, **Then** the listing is still created successfully — photos are optional.
4. **Given** an account with no membership in community C, **When** it attempts to create a listing scoped to C, **Then** the attempt is rejected and no listing is created.

---

### User Story 2 - The owner edits their own listing (Priority: P1)

The account that created a listing can change its title, description, price, and photos at any time.

**Why this priority**: A listing with a typo, a wrong price, or an outdated photo is unsellable but common; without editing, sellers would have to delete and recreate listings for any correction — a straightforward MVP gap.

**Independent Test**: Can be fully tested by having the owner of an existing listing change its title, description, price, and photos, then asserting the stored listing reflects every change and nothing else about it (owner, community, status) changed.

**Acceptance Scenarios**:

1. **Given** a listing owned by account A, **When** A edits its title, description, price, or photos, **Then** the listing reflects the new values, and its owner, community, and status are unchanged.
2. **Given** the same listing, **When** a different account (not A, not an administrator of that community) attempts to edit it, **Then** the attempt is rejected and the listing is unchanged.
3. **Given** the same listing, **When** an administrator of that same community (not A) attempts to edit its title, description, price, or photos, **Then** the attempt is rejected — moderation authority (User Story 5) covers visibility only, not content.

---

### User Story 3 - The owner pauses and reactivates their own listing (Priority: P2)

The owner can take their listing off the active market temporarily (pause) and bring it back later (reactivate), without losing the listing or its data.

**Why this priority**: Sellers routinely need to temporarily stop a listing (item on hold, seller unavailable) without permanently destroying it — a real, common need, but the marketplace is still usable without it (P1s cover the core loop).

**Independent Test**: Can be fully tested by pausing an active listing and asserting its status becomes PAUSED and it no longer appears in the community's active listing views, then reactivating it and asserting it returns to ACTIVE and reappears.

**Acceptance Scenarios**:

1. **Given** an ACTIVE listing owned by A, **When** A pauses it, **Then** its status becomes PAUSED and no listing data is lost.
2. **Given** a PAUSED listing owned by A, **When** A reactivates it, **Then** its status returns to ACTIVE.
3. **Given** an already-PAUSED listing, **When** A pauses it again, **Then** the action is a no-op — it remains PAUSED, no error.

---

### User Story 4 - The owner permanently deletes their own listing (Priority: P2)

The owner can permanently remove a listing they no longer want to exist at all, including its photos.

**Why this priority**: Distinct from pausing — some listings should stop existing entirely (sold elsewhere, listed by mistake). Deletion is a real but less frequent need than pause/reactivate.

**Independent Test**: Can be fully tested by deleting an existing listing (with photos attached) and asserting the listing and every one of its photos no longer exist afterward.

**Acceptance Scenarios**:

1. **Given** a listing owned by A with photos attached, **When** A deletes it, **Then** the listing and all of its photos are permanently removed.
2. **Given** a listing owned by A, **When** a different account (not A, including that community's administrator) attempts to delete it, **Then** the attempt is rejected and the listing is unchanged — deletion is the owner's sole authority.

---

### User Story 5 - An administrator moderates a listing within their own community (Priority: P3)

A community's administrator can pause (and later reactivate) any listing within their own community, even one they don't own, as a moderation action — but cannot edit its content or delete it outright.

**Why this priority**: Constitution Principle III names listing moderation as a non-negotiable administrator power. It is lower priority than the owner-driven flows because a community can function without it initially, but it must exist before this feature is considered constitutionally complete.

**Independent Test**: Can be fully tested by having a community's administrator pause a listing owned by a different member of that same community, asserting it becomes PAUSED, then asserting an administrator of a *different*, unrelated community cannot do the same.

**Acceptance Scenarios**:

1. **Given** an ACTIVE listing owned by member M in community C, **When** C's administrator pauses it, **Then** its status becomes PAUSED, and M's ownership and the listing's data are unchanged.
2. **Given** the listing paused by the administrator, **When** the administrator or M reactivates it, **Then** its status returns to ACTIVE — reactivation is not restricted to whoever paused it.
3. **Given** the same listing, **When** an administrator of a *different* community (not C) attempts to pause it, **Then** the attempt is rejected.

---

### Edge Cases

- What happens when an account with no membership in a community attempts to view that community's listings? Rejected — nothing is revealed, consistent with Principle II.
- What happens when an ordinary member (not the owner, not an administrator) attempts to pause, reactivate, edit, or delete someone else's listing? Rejected in every case.
- What happens when a community administrator attempts to moderate a listing belonging to a different community? Rejected — moderation authority is scoped to the administrator's own community only, never a peer or unrelated one.
- What happens when a listing with attached photos is deleted? All of its photos are removed along with it — no orphaned photo records remain.
- What happens when a listing is created with zero photos? Allowed — photos are optional, not required, at creation or ever.
- What happens when the owner tries to reactivate a listing that is already ACTIVE, or pause one already PAUSED? Idempotent no-op — the status simply stays as it is, no error.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Any account holding a `Membership` (any role — administrator or member) in a community MUST be able to create a product listing scoped to that community's `communityId`.
- **FR-002**: A listing MUST include a title, a description, and a price at creation; the price is a simple, fixed value with no scheduling or dynamic adjustment.
- **FR-003**: A listing MUST support zero or more attached photos, both at creation and via later edits; photos are never required.
- **FR-004**: A listing's status MUST be represented as an enumerated value with at least `ACTIVE` and `PAUSED` — never a free-text field or boolean flag.
- **FR-005**: A newly created listing MUST start in the `ACTIVE` status.
- **FR-006**: The listing's owner MUST be able to edit its title, description, price, and photos at any time, regardless of its current status.
- **FR-007**: The listing's owner MUST be able to pause it (`ACTIVE` → `PAUSED`) and reactivate it (`PAUSED` → `ACTIVE`); repeating either action while already in that state MUST be a no-op, not an error.
- **FR-008**: The listing's owner MUST be able to permanently delete their own listing; deletion MUST also remove every photo attached to it.
- **FR-009**: A community's administrator MUST be able to pause and reactivate any listing within their own community, even one they do not own, as a moderation action (Constitution Principle III); this authority MUST NOT extend to editing a listing's content or to deleting it.
- **FR-010**: No account other than a listing's owner, or that community's own administrator (for pause/reactivate only), may modify a listing in any way; this MUST hold even for an administrator of a different, unrelated community.
- **FR-011**: Every access path to a listing — creation, viewing, editing, pausing, reactivating, deleting, and any listing feed or browse view — MUST be scoped by `communityId`; a listing MUST NEVER be visible or actionable outside its own community's context (Constitution Principle II).
- **FR-012**: Only accounts holding a `Membership` (any role) in a community may view that community's listings; non-members MUST see nothing about them.
- **FR-013**: This feature MUST NOT implement nested or hierarchical categories, product variants (size, color, or similar), inventory or stock-count tracking, a draft/pre-publish state, or dynamic or scheduled pricing.

### Key Entities

- **Listing**: A product offered for sale within exactly one `Community`. Attributes: title, description, price, status (`ACTIVE` or `PAUSED`), the owning `Account`, the owning `Community` (`communityId`, required), creation time. Always belongs to exactly one community for its entire lifetime — never reassignable to another.
- **Listing Photo**: An image attached to exactly one `Listing`. Removed automatically when its parent listing is deleted.
- **Account** *(existing, from 002-accounts-authentication — referenced, not modified)*: The identity that owns a listing.
- **Community** *(existing, from 003-community-creation — referenced, not modified)*: The tenancy every listing and its photos belong to.
- **Membership** *(existing, from 003/004 — referenced, not modified)*: Determines who may view a community's listings (any role) and who may create one (any role) or moderate one (administrator role only, own community only).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of listing-creation attempts by an account with no membership in the target community are rejected, verified by automated tests.
- **SC-002**: 100% of attempts to view, edit, pause, reactivate, or delete a listing from outside its own community are rejected, verified by automated tests.
- **SC-003**: An owner can create, edit, pause, reactivate, and delete their own listing entirely through their own actions, with no administrator intervention ever required for these five actions.
- **SC-004**: 100% of content-edit or delete attempts by any account other than the listing's owner are rejected, verified by automated tests, including attempts by that community's own administrator.
- **SC-005**: A community administrator can pause any listing within their own community without the owner's cooperation, and this action never destroys the listing's data — verified by automated tests.
- **SC-006**: Deleting a listing removes 100% of its attached photo records — zero orphaned photo rows remain, verified by automated tests.

## Assumptions

- A listing requires a title, description, and a simple fixed price at creation; no minimum photo count is enforced — a listing with zero photos is valid and complete.
- Per today's clarification, Constitution Principle III's "moderate (edit visibility of, take down)" guarantee is implemented as administrator pause/reactivate authority only; full deletion of another account's listing is not granted to administrators in this feature — deletion remains the owner's sole, irreversible authority, consistent with keeping the more destructive action the more tightly held one.
- Reactivating a listing that an administrator paused is available to both the listing's owner and any administrator of that same community — no record of "who paused it" is introduced, keeping the status model to the single enum (Principle VII).
- Listing browsing/viewing is limited to a community's own members (any role); this feature introduces no public, unauthenticated listing browsing.
- The mechanism used to store photo files (e.g., object storage, CDN) is an implementation detail decided during planning, not specified here.
- No search, filtering, sorting, or pagination behavior beyond viewing a single community's own listings is in scope for this feature.
