# Feature Specification: Navigation Shell and Community Selector

**Feature Branch**: `015-navigation-shell-community-selector`

**Created**: 2026-07-31

**Status**: Draft

**Input**: User description: "Navigation Shell and Community Selector: Redesign the app's navigation and post-authentication entry so the user picks an active community first, then works entirely within that one community's context. This feature restructures navigation and consolidates access to existing surfaces (chats, listings, transactions, account); it does NOT create new marketplace functionality and does NOT change any existing community-scoped data rule. After sign-in, the user lands on a community-selection screen showing the communities they are a member of; selecting one sets it ACTIVE and takes them into the main app scoped to that community. An account with zero memberships is a valid, inert state (Principle I) — an empty state, never an error, with no community directory/browse/join anywhere. The main app layout per active community: a search bar at top, a feed of that community's listings below it, and a toggle between 'For sale' (005) and 'Wanted' (011) — all scoped ONLY to the active community (Principle II), never combined/cross-community. Left sidebar: CMarket wordmark/logo; the active community's name, tappable to expand the list of the user's OTHER communities to switch (re-scoping the whole app); the user's display name (006); nav entries to existing surfaces only — Chats (008), My listings (005), Transactions (013), Account (change display name 006 / password 002), Sign out — collapsing/adapting for mobile (Principle V). Administrators of the ACTIVE community see one additional 'Admin' entry above Account (the admin surface's contents are a separate feature — only the entry point is in scope here); being an administrator grants no extra data visibility by itself (Principle VI). Reuses existing surfaces (002, 005, 006, 008, 011, 012, 013) without forking their logic (Principle VII); no directory/self-join/request-to-join anywhere (Principle I); no contact data in navigation (Principle VI). Out of scope: the Admin panel's actual contents, any change to how listings/wanted posts/chats/transactions/accounts work internally, notifications. Not a Principle VIII named critical flow, so tests are optional EXCEPT the community-scoping guarantee (search/feed/switch must be tested to return only the active community's data, per Principle II)."

## Clarifications

### Session 2026-07-31

- Q: The input only describes landing on the community-selection screen right after sign-in — what happens when a signed-in member returns to the app's top-level entry point later in the same session (e.g., clicking the CMarket logo, or reopening the app)? → A: The app remembers the member's last active community (for the lifetime of their existing, already-persistent sign-in session) and takes them straight back into it. The selection screen is shown only when there is no valid remembered active community for the current session — the first time in a new session, or if the remembered community is no longer one they belong to (e.g., their membership there was removed) — matching Story 1's zero-communities and Edge Cases' membership-removal handling.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Choosing an active community after signing in (Priority: P1)

A member signs in and, before seeing any marketplace content, is shown the list of communities they currently belong to. Tapping one sets it as their active community and takes them into that community's main view. A member who belongs to no community yet sees a clear, friendly explanation instead of a marketplace screen or an error.

**Why this priority**: Every other part of this feature — the sidebar, the feed, every reachable surface — depends on an active community already being chosen. Without this, there is no context for anything else to scope to.

**Independent Test**: Can be fully tested by signing in as a member of two or more communities and confirming a selection screen lists exactly those communities (and no others); by signing in as a member of exactly one community and confirming that same screen still lists it for selection; and by signing in as a member of zero communities and confirming a defined empty state appears with no directory, browse, or join affordance anywhere on it.

**Acceptance Scenarios**:

1. **Given** a member belonging to communities A and B, **When** they sign in, **Then** they see a community-selection screen listing exactly A and B, and nothing else.
2. **Given** that screen, **When** the member selects community A, **Then** community A becomes their active community and they are taken into A's main view (User Story 2).
3. **Given** a member belonging to zero communities, **When** they sign in, **Then** they see a defined explanatory empty state ("you don't belong to any community yet") — never an error, and never any control to browse, search, or request to join a community.
4. **Given** a signed-in member who already has an active community remembered for their current session, **When** they navigate back to the top-level entry point later in that same session (e.g., clicking the CMarket logo, or reopening the app), **Then** they are taken straight back into that remembered active community's main view — the selection screen is not shown again.
5. **Given** a signed-in member whose remembered active community membership was removed since it was last set, **When** they reach the top-level entry point, **Then** they see the community-selection screen again (or the zero-communities empty state, if that was their only membership), never a broken or stale view of a community they no longer belong to.

---

### User Story 2 - The active community's main view (Priority: P1)

Once a community is active, the member sees that community's own home: a search bar, and beneath it a feed of that community's own listings, with a simple toggle to switch between "For sale" listings and "Wanted" posts. Everything on this screen belongs to the one active community.

**Why this priority**: This is the screen a member spends most of their time on — the actual point of choosing a community in User Story 1. It's tied for first priority because Story 1 has nothing to lead into without it.

**Independent Test**: Can be fully tested by setting community A active, confirming the search bar and the resulting feed show only community A's listings/wanted posts, then switching the toggle to "Wanted" and confirming it shows only community A's wanted posts.

**Acceptance Scenarios**:

1. **Given** community A is active, **When** the member views the main screen, **Then** a search bar and a feed of community A's own active listings are shown.
2. **Given** the same screen, **When** the member switches the toggle to "Wanted," **Then** the feed shows only community A's active wanted posts, replacing the "For sale" listings.
3. **Given** the member enters a search term, **When** results are returned, **Then** every result belongs to community A and to whichever of "For sale"/"Wanted" is currently selected.
4. **Given** community A is active with a search term entered, **When** the member switches their active community to B (User Story 4), **Then** the search bar and feed reset to B's own context — the prior search term or results are not carried over as a cross-community result set.

---

### User Story 3 - Community data never leaks across the switch (Priority: P1)

No matter how a member searches, browses, or switches their active community, they never see another community's listings, wanted posts, or search results mixed in — even momentarily, even if they belong to several communities at once.

**Why this priority**: This is a named, non-negotiable constitutional boundary (Principle II) and the one guarantee this feature explicitly requires automated tests for, regardless of the general test-optionality default. It is inseparable from Stories 1 and 2 being trustworthy at all.

**Independent Test**: Can be fully tested by a member belonging to communities A and B, each with their own distinct listings, confirming that while A is active, no query (search, feed, kind toggle) returns any of B's data, and vice versa after switching, with no combined view ever produced.

**Acceptance Scenarios**:

1. **Given** a member belonging to communities A and B with different listings in each, **When** A is active, **Then** the feed, search, and "For sale"/"Wanted" toggle each return only A's data — never B's, and never a merged set of both.
2. **Given** the same member, **When** they switch their active community to B, **Then** the same three surfaces (feed, search, toggle) now return only B's data.
3. **Given** a member belonging to only one community, **When** they use search or the toggle, **Then** results are still explicitly scoped to that one community (not merely "correct by accident" because no other community exists to leak from).

---

### User Story 4 - Switching communities from the sidebar (Priority: P2)

A member wants to check a different community without signing out. From the sidebar, they tap their current active community's name, see a list of their other communities, and pick one to make it active instead — the whole app re-scopes to the new choice.

**Why this priority**: This is the ongoing, day-to-day version of Story 1's one-time choice. It matters for any member in more than one community, but a member in only one community never needs it, so it ranks below the entry flow and the main view itself.

**Independent Test**: Can be fully tested by a member belonging to communities A and B, with A active, tapping the active community name in the sidebar, confirming exactly B (and any other communities they belong to) appears in the resulting list — not A itself — and selecting B re-scopes the visible feed to B.

**Acceptance Scenarios**:

1. **Given** community A is active, **When** the member taps the active community's name in the sidebar, **Then** a list of their other communities appears (excluding A, the one already active).
2. **Given** that list, **When** the member selects community B, **Then** B becomes the active community and the main view (Story 2) now shows B's own data.
3. **Given** a member belonging to only one community, **When** they view the sidebar, **Then** there is nothing else to switch to, and this is reflected clearly rather than showing an empty or broken expansion.

---

### User Story 5 - Reaching existing surfaces from one consistent sidebar (Priority: P2)

From any screen, a member can reach chats, their own listings, their transaction history, and their account settings — and can sign out — all from the same sidebar, without hunting for these across different screens. Each entry takes them to the existing surface for that purpose, scoped to context exactly as it already is today.

**Why this priority**: This is pure consolidation of navigation to functionality that already exists and already works; it improves discoverability and consistency but changes no underlying behavior, so it ranks behind the entry flow and the community-scoping guarantees.

**Independent Test**: Can be fully tested by confirming the sidebar always shows entries for Chats, My listings, Transactions, Account, and Sign out, and that activating each one reaches that existing surface with no change to what it shows or how it behaves.

**Acceptance Scenarios**:

1. **Given** any screen within the app, **When** the member views the sidebar, **Then** it shows the CMarket wordmark, the active community's name, the member's own display name, and entries for Chats, My listings, Transactions, and Account, plus Sign out.
2. **Given** the sidebar, **When** the member activates "Account," **Then** they reach the existing account surface where they can change their display name and password — no new account capability is introduced.
3. **Given** the sidebar, **When** the member activates "Sign out," **Then** their session ends exactly as it does today.

---

### User Story 6 - Administrators see one extra entry, and nothing more (Priority: P2)

A member who administers the currently active community sees one additional sidebar entry, "Admin," placed directly above "Account." A member who is not an administrator of the active community — including one who administers a different community they aren't currently viewing — does not see it. Seeing this entry does not, by itself, expose any member's contact data, private conversations, or transactions the administrator wouldn't otherwise be entitled to see.

**Why this priority**: This affects only the subset of members who administer a community, and only changes how they reach an existing surface (per this feature's explicit scope) rather than what that surface can do — a real but narrower improvement than the entry flow and scoping guarantees every member relies on.

**Independent Test**: Can be fully tested by a member who administers community A but not B: confirming the "Admin" entry appears directly above "Account" while A is active, and disappears once they switch their active community to B.

**Acceptance Scenarios**:

1. **Given** a member who administers the active community, **When** they view the sidebar, **Then** an "Admin" entry appears directly above "Account."
2. **Given** the same member, **When** they switch their active community to one they do not administer, **Then** the "Admin" entry no longer appears.
3. **Given** a member who administers no community at all, **When** they view the sidebar in any community, **Then** no "Admin" entry ever appears.
4. **Given** the "Admin" entry is visible, **When** it is inspected on its own, **Then** it exposes no member's contact data, private chat content, or transaction detail — it is only a link to the existing admin surface.

---

### Edge Cases

- What happens if a member's last remaining community membership is removed while it is their remembered active community? The next time they reach the entry point, their remembered active community is treated as invalid (FR-001b) and they see the zero-communities empty state (Story 1, Scenario 3) rather than a broken or stale active-community view.
- What happens if a member's remembered active community membership is removed, but they still belong to at least one other community? The next time they reach the entry point, they see the community-selection screen again (FR-001b), listing their remaining current memberships — not the removed one.
- What happens when a member signs out and later signs back in? Signing out ends the session that the active community was remembered for (FR-001a); signing back in starts a new session with no remembered active community, so the selection screen is shown again per FR-001.
- What happens if a member is a member of a community but not its administrator, and separately administers a different community? The "Admin" entry only ever reflects the currently active community's own administrator relationship — it is never shown based on an administrator role held in some other, inactive community.
- What happens when a member deep-links directly to a surface scoped to a specific community (e.g., a shared listing link) without having gone through the selection screen first? The linked community becomes their active community for that visit, exactly as if they had selected it, provided they are currently a member of it; if they are not currently a member, existing access-denial behavior for that surface is unchanged by this feature.
- What happens to the search term or scroll position when switching the active community? Both reset — the new active community's main view starts fresh (Story 2, Scenario 4), since carrying over state from a different community's context risks implying a connection between two communities that must never appear connected (Principle II).

## Requirements *(mandatory)*

### Functional Requirements

**Entry and community selection (User Story 1)**

- **FR-001**: The system MUST present a community-selection screen, listing exactly the communities the signed-in member currently belongs to, whenever the member reaches the app's top-level entry point with no valid active community remembered for their current sign-in session (FR-001a).
- **FR-001a**: The system MUST remember the member's active community for the lifetime of their current sign-in session; reaching the top-level entry point while a valid remembered active community exists MUST take the member straight into that community's main view (FR-006) without showing the selection screen again.
- **FR-001b**: A remembered active community MUST be treated as invalid — falling back to FR-001's selection screen (or the zero-communities empty state, FR-004) — if the member is no longer a current member of it.
- **FR-002**: Selecting a community on the selection screen MUST set it as the member's active community for the remainder of the session (FR-001a) and take them into that community's main view (FR-006).
- **FR-003**: The community-selection screen MUST list only communities the member is a current member of; it MUST NOT show any directory, browse, search, or request-to-join affordance for any community the member does not already belong to.
- **FR-004**: A member belonging to zero communities MUST see a defined, explanatory empty state at the entry point — never an error — and that empty state MUST NOT contain any directory, browse, or join affordance (Constitution Principle I).
- **FR-005**: A member belonging to exactly one community MUST still see the selection screen and make an explicit selection the first time in a session (no valid remembered active community yet, FR-001) — the single-community case is not special-cased into an automatic entry.

**Active community's main view (User Story 2)**

- **FR-006**: The active community's main view MUST show a search control and, beneath it, a feed of that community's own active listings by default.
- **FR-007**: The main view MUST provide a control to toggle the feed between "For sale" listings and "Wanted" posts belonging to the active community.
- **FR-008**: Switching the active community MUST reset the search term, selected toggle state, and displayed results to that community's own default main view — no state from the previously active community MUST carry over.

**Community isolation (User Story 3)**

- **FR-009**: The search control, the listings feed, and the wanted-posts feed MUST each return results only from the currently active community.
- **FR-010**: No screen or query introduced by this feature MUST combine or aggregate data from more than one community at a time.
- **FR-011**: Switching the active community MUST fully re-scope every surface driven by it (search, feed, toggle) to the newly active community — none MUST continue reflecting the previously active community after the switch completes.

**Sidebar and community switching (User Story 4)**

- **FR-012**: The sidebar MUST display the CMarket wordmark/logo, the active community's name, and the signed-in member's display name.
- **FR-013**: Activating the active community's name in the sidebar MUST reveal the list of the member's other current community memberships (excluding the one already active).
- **FR-014**: Selecting a community from that revealed list MUST set it as the new active community and re-scope the main view (FR-011) accordingly.
- **FR-015**: A member belonging to only one community MUST see that they have no other community to switch to, rather than a broken, silently-empty, or misleading expansion control.

**Consolidated navigation to existing surfaces (User Story 5)**

- **FR-016**: The sidebar MUST provide navigation entries to: chats/messaging (008-listing-messaging), the member's own listings (005-product-listings), the member's transaction history (013-purchase-flow-stock), and account settings (display name via 006-user-display-names, password via 002-accounts-authentication).
- **FR-017**: The sidebar MUST provide a control to sign out, ending the member's session.
- **FR-018**: Every navigation entry in this feature MUST link to the existing corresponding surface unchanged — this feature MUST NOT alter what any of those surfaces does, validates, or displays once reached.

**Administrator entry point (User Story 6)**

- **FR-019**: The sidebar MUST show exactly one "Admin" entry, positioned directly above "Account," when and only when the signed-in member currently administers the active community.
- **FR-020**: The "Admin" entry MUST reflect only the administrator relationship for the currently active community — an administrator role held in a different, currently-inactive community MUST NOT cause the entry to appear.
- **FR-021**: The "Admin" entry itself MUST NOT expose any member's contact data, private message content, or transaction detail; it MUST function only as a navigation link to the existing admin surface (whose contents are out of scope for this feature).

**Cross-cutting constraints**

- **FR-022**: This feature MUST NOT introduce, change, or fork the underlying logic, validation, or data rules of any surface it links to (002, 005, 006, 008, 011, 012, 013) — it changes only how those surfaces are reached and framed.
- **FR-023**: The community-selection screen, the active community's main view, and the sidebar MUST all remain fully usable in a mobile viewport, with the sidebar collapsing or adapting appropriately (Constitution Principle V).
- **FR-024**: No screen introduced by this feature MUST display any member's contact data (phone number, email address, or exact address).

### Key Entities

This feature changes no existing entity's business meaning. "Active community" (per Clarifications) is remembered for the lifetime of the member's current sign-in session — how that association is stored (e.g., alongside the existing session record from 002-accounts-authentication) is a planning-level concern, not a new marketplace entity.

- **Account / Membership** *(existing, 002/003/004 — referenced, not modified)*: The set of communities a member currently belongs to, which is exactly what the selection screen (FR-001) and the sidebar's switch list (FR-013) enumerate; administrator role on a specific membership is what gates the "Admin" entry (FR-019).
- **Community** *(existing, 003-community-creation — referenced, not modified)*: The active community is which one of these is currently remembered for the member's session; its name is what the sidebar displays (FR-012).
- **Listing / Wanted Post** *(existing, 005/011 — referenced, not modified)*: What the main view's feed and search surface, scoped to the active community only (FR-006, FR-007, FR-009).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of members with at least one community membership see a community-selection screen listing exactly their own current memberships the first time they reach the entry point in a new session.
- **SC-001a**: 100% of members returning to the entry point later in the same session, with a still-valid remembered active community, are taken directly into that community's main view with zero additional selection step.
- **SC-002**: 100% of members with zero community memberships see the defined empty state, with zero directory/browse/join affordances present.
- **SC-003**: 100% of search, feed, and toggle results, across every combination of two or more communities a test member belongs to, contain only the currently active community's data — zero cross-community leakage — verified by automated tests (Constitution Principle II). This is the one criterion in this list requiring automated coverage; per this feature's Testing note, the rest are verified through the quickstart.md validation scenarios rather than automated tests, since this is not a Principle VIII named critical flow.
- **SC-004**: Switching the active community from the sidebar re-scopes the main view's feed, search, and toggle to the new community in the same interaction, with zero carryover of the previous community's search term or results.
- **SC-005**: 100% of accounts that administer the active community see exactly one "Admin" entry above "Account"; 0% of accounts that don't (including admins of a different, inactive community) see it.
- **SC-006**: A member can reach chats, their own listings, transactions, and account settings from the sidebar on every screen in the app, without needing to return to a separate menu first.
- **SC-007**: The community-selection screen, main view, and sidebar remain fully operable at a mobile viewport width, with no loss of any navigation entry or function compared to desktop.
- **SC-008**: 0% of screens introduced by this feature display any member's phone number, email address, or exact address.

## Assumptions

- "Active community" is remembered for the lifetime of the member's current sign-in session (per Clarifications) — it is session-scoped state, not a new persisted field on Account or Membership itself; a new session (a fresh sign-in) always starts with no remembered active community.
- A member with exactly one community membership still sees the selection screen and makes an explicit (if trivial) selection the first time in a session, rather than being silently placed into that community's main view without ever seeing the entry point — this keeps the first-time-in-session entry behavior identical regardless of membership count, while still remembering the choice for the rest of that session like any other.
- Search on the main view is scoped both to the active community and to whichever of "For sale"/"Wanted" is currently toggled, reusing 007-listing-discovery's and 011-wanted-posts' existing search/filter behavior unchanged, per this feature's own no-forked-logic constraint.
- Deep-linking directly into a specific community's surface (e.g., an existing shared listing link) sets that community as active for the visit, provided the member currently belongs to it; this feature does not change what happens when a member without current membership attempts to reach a community-scoped surface directly.
- The "Admin" entry point (Story 6) governs visibility of the link only; the admin surface's own contents, and any change to how community administration works, remain explicitly out of scope, per 009-platform-administration and 003-community-creation's existing, unmodified behavior.
