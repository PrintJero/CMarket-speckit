# Feature Specification: Account Profile and Shared-Community Member Profiles

**Feature Branch**: `014-account-public-profiles`

**Created**: 2026-07-30

**Status**: Finished

**Input**: User description: "Account Profile and Shared-Community Member Profiles: CMarket already has public member profiles and global reputation through 012-profiles-reputation, but the current profile experience is too limited. Add an improved profile system with separate self-profile and public-profile behavior. Self profile: when a signed-in user opens Account, show a dedicated profile page for their own account with display name, email address, account creation date, global average rating, global rating count, global confirmed/completed transaction count, communities the user currently belongs to (community name, membership role if available, member-since date, active FOR_SALE listings, active WANTED posts), and the user's active marketplace listings grouped by community. The signed-in user's email MUST only be visible on their own Account/Profile page. The existing Account navigation item should open this self-profile experience. Public member profile: when viewing another account, show display name, global average rating, global rating count, global completed/accepted transaction count; never email, phone, address, authentication data, or communities the viewer does not belong to. Instead of showing the viewed account only in the context of one community, show every current community that both the viewer and the viewed account currently belong to (the intersection), each with community name, the viewed account's member-since date, and their active FOR_SALE/WANTED listings in that community. If viewer and target share no current community, the public profile MUST NOT be accessible and no profile data returned. Display names must remain clickable from listings, chats/message threads, transactions, and buying/selling transaction history to open the public profile. Reputation rules from 012-profiles-reputation are unchanged: average rating, rating count, and completed/accepted transaction count remain global across the account, never exposing which community contributed, never showing individual rating records or a per-community breakdown. Use the current evolved Transaction model from 013-purchase-flow-stock: only ACCEPTED transactions count as completed/verifiable, and the old CONFIRMED state is not reintroduced. Reuse the current Listing model, supporting both FOR_SALE and WANTED, showing only ACTIVE listings/posts, with stock shown for FOR_SALE where available. Preserve community isolation: no private account data or non-shared community names/identifiers may appear on another person's public profile; the user's own Account/Profile may show all of their own current communities, their own email, and all their own active listings grouped by those communities. Do not expose another member's email even when multiple communities are shared. Must work on mobile and desktop, consistent with the existing AppShell, listing cards, current public profile, and Transactions page. Out of scope: profile photos/avatars, bios, phone numbers, addresses, social links, followers/following, profile editing beyond existing Account behavior, notifications, badges, seller tiers, per-community reputation, and public visibility of non-shared communities."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A signed-in member views their own Account/Profile (Priority: P1)

A signed-in member clicks "Account" in the navigation and lands on a dedicated profile page for their own account. It shows who they are (display name, email, the date they joined CMarket), their reputation (global average rating, rating count) and marketplace track record (global completed transaction count), and every community they currently belong to — each with that community's name, their role and member-since date there, and their own active FOR_SALE listings and WANTED posts in that community.

**Why this priority**: This replaces the current placeholder "Account settings coming soon" page with the account's single home base — every signed-in member hits this immediately, and every other story in this feature builds on the same underlying data being correct here first.

**Independent Test**: Can be fully tested by signing in as a member who belongs to two or more communities and owns active listings in at least one, opening "Account," and confirming display name, email, account creation date, global rating summary, global completed-transaction count, and a correct per-community breakdown (name, role, member-since date, own active FOR_SALE/WANTED listings) all appear — while no password, session, or authentication-token data appears anywhere on the page or in its underlying data.

**Acceptance Scenarios**:

1. **Given** a signed-in member with two community memberships, **When** they open "Account," **Then** they see their own display name, email address, account creation date, global average rating, global rating count, and global completed-transaction count.
2. **Given** the same page, **When** its communities section is inspected, **Then** every community the member currently belongs to appears, each showing that community's name, the member's role in it (if the underlying membership data provides one), and the date they joined it.
3. **Given** a community where the member owns one active FOR_SALE listing and one active WANTED post, **When** that community's section is viewed, **Then** both are listed with enough detail to recognize them (title, kind, price or budget, and stock quantity for the FOR_SALE listing when it has one declared).
4. **Given** the same page, **When** it is rendered or its underlying data is inspected, **Then** no password, password hash, session token, or other authentication-internal data ever appears.
5. **Given** a member who belongs to no community yet, **When** they open "Account," **Then** the page still renders normally with a defined empty state for communities and listings — never an error.
6. **Given** a community listed on the page, **When** the member clicks that community's name, **Then** they land on that community's marketplace/listings feed.
7. **Given** a listing or post shown in a community's section, **When** the member clicks it, **Then** they land on that listing's detail page.

---

### User Story 2 - A member views another member's profile across every community they share (Priority: P1)

A member opens a fellow member's public profile — from a listing, a chat thread, a transaction, or their buying/selling history — and sees that person's display name and global reputation (average rating, rating count, completed-transaction count), followed by a section for every community the viewer and that person **currently both belong to**, each showing the target's member-since date there and their active FOR_SALE/WANTED listings in that community. No community that only one of the two currently belongs to is ever mentioned, listed, or otherwise inferable.

**Why this priority**: This is the core upgrade this feature delivers — today's profile shows only the one community the link happened to come from, hiding marketplace context (and trust signal) the viewer would otherwise have. Getting the shared-community intersection right, without leaking either party's non-shared communities, is the crux of this feature's value and its privacy obligation.

**Independent Test**: Can be fully tested by having two accounts share exactly two communities (and each also belong to at least one additional community the other does not), then having one open the other's public profile and confirming both shared communities appear with the target's correct member-since date and active listings in each, while neither account's own non-shared community is named, counted, or otherwise inferable anywhere in the page or its underlying data.

**Acceptance Scenarios**:

1. **Given** two accounts that currently share exactly one community, **When** one opens the other's public profile, **Then** that one shared community is shown normally, with the target's member-since date and active FOR_SALE/WANTED listings in it.
2. **Given** two accounts that currently share two or more communities, **When** one opens the other's public profile, **Then** every shared community appears as its own section, each with the target's member-since date and active listings scoped to that community only.
3. **Given** the viewer's own community that the target does not currently belong to, **When** the target's profile is rendered or its underlying data is inspected, **Then** that community's name, existence, or membership status never appears.
4. **Given** two accounts that currently share no community, **When** one attempts to open the other's public profile, **Then** the attempt is rejected and no profile data — not even the display name or reputation summary — is returned.
5. **Given** a shared community where the target has no active listings, **When** that community's section is viewed, **Then** it still renders with a defined empty state for listings, not an error and not an omitted section.
6. **Given** any public profile, **When** it is rendered or its underlying data is inspected, **Then** no email address, phone number, physical address, authentication data, individual rating record, or per-community reputation breakdown ever appears — only the global average rating, global rating count, and global completed-transaction count.
7. **Given** a shared community listed on the profile, **When** the viewer clicks that community's name, **Then** they land on that community's marketplace/listings feed.
8. **Given** a listing or post shown in a shared community's section, **When** the viewer clicks it, **Then** they land on that listing's detail page.

---

### User Story 3 - Reaching a profile from anywhere a person's name appears (Priority: P2)

From a listing, a chat thread, a transaction detail, or the buying/selling transaction list, a member clicks another member's display name and lands on that person's public profile (User Story 2's shared-community view) — regardless of which specific community that surface happened to be showing.

**Why this priority**: Profiles are only useful if they're reachable from the moments a member actually wants context on someone; this wires the already-clickable names throughout the app to the improved profile rather than the old single-community view.

**Independent Test**: Can be fully tested by clicking a counterpart's display name from each of a listing, a chat thread, a transaction, and the Transactions page's Buying/Selling rows, and confirming every one of them opens the same shared-community profile view for that person.

**Acceptance Scenarios**:

1. **Given** a listing owned by another shared-community member, **When** the viewer clicks that owner's display name, **Then** the owner's shared-community profile opens.
2. **Given** a chat thread with another member, **When** the viewer clicks the counterpart's display name, **Then** that counterpart's shared-community profile opens.
3. **Given** a row in the Transactions page's Buying or Selling view, **When** the viewer clicks the counterpart's display name, **Then** that counterpart's shared-community profile opens.

---

### Edge Cases

- What happens when a member's display name is not set? The neutral placeholder already used elsewhere in the app is shown in its place on both the self profile and public profile — never the email address.
- What happens when the viewer opens their own public-profile link (e.g., their own display name shown to themselves in a transaction)? It behaves like any other public profile from the viewer's perspective (every one of the viewer's own current communities is trivially "shared" with themselves), and never substitutes in private data such as email.
- What happens to a shared community that becomes suspended or archived after both accounts joined it? It stops counting as a current, visible community for either self- or public-profile purposes, consistent with how "current" membership is already treated everywhere else in the app.
- What happens when a target account has zero global ratings? The average rating shows a defined "no ratings yet" state rather than zero or an error, matching the existing profile's behavior.
- What happens if the two accounts' shared communities change while a profile page is open (e.g., one leaves a community)? The next time the profile is opened or refreshed, it reflects the current intersection; a stale open page is not required to update live.

## Requirements *(mandatory)*

### Functional Requirements

**Self profile (Account)**

- **FR-001**: The system MUST provide a dedicated self-profile page reachable exclusively from the existing "Account" navigation item, replacing the current placeholder screen.
- **FR-002**: The self-profile page MUST show the signed-in account's own display name, email address, and account creation date.
- **FR-003**: The self-profile page MUST show the signed-in account's global average rating and global rating count.
- **FR-004**: The self-profile page MUST show the signed-in account's global completed-transaction count, counting only transactions in the `ACCEPTED` state.
- **FR-005**: The self-profile page MUST list every community the signed-in account currently belongs to, each showing that community's name, the account's membership role in it, and the date the account became a member of it.
- **FR-006**: For each community listed, the self-profile page MUST show the signed-in account's own active `FOR_SALE` listings and active `WANTED` posts in that community.
- **FR-007**: Each listing or post shown MUST include its title, kind (`FOR_SALE` or `WANTED`), its price or budget, and — for a `FOR_SALE` listing with stock declared — its stock quantity. A listing's status is not shown, since only `ACTIVE` listings ever appear in this section.
- **FR-008**: The signed-in account's email address MUST appear only on that account's own self-profile page, and MUST NOT be included in any public-profile response or view.
- **FR-009**: The self-profile page MUST NOT expose passwords, password hashes, session identifiers, authentication tokens, or any other authentication-internal data.
- **FR-009a**: Each community name shown on the self-profile page MUST be clickable and MUST navigate to that community's marketplace/listings feed.
- **FR-009b**: Each listing or post shown on the self-profile page MUST be clickable and MUST navigate to that listing's detail page.

**Public member profile**

- **FR-010**: The system MUST provide a public profile for any account, reachable by clicking that account's display name from a listing, a chat thread, a transaction, or the Transactions page's Buying/Selling views.
- **FR-011**: A public profile MUST show the viewed account's display name, global average rating, global rating count, and global completed-transaction count (counting only `ACCEPTED` transactions).
- **FR-012**: A public profile MUST NOT show the viewed account's email address, phone number, physical address, or any authentication data.
- **FR-013**: A public profile MUST show, for every community that the viewer and the viewed account **both currently belong to** (the intersection of their current memberships), that community's name, the viewed account's member-since date there, and the viewed account's active `FOR_SALE` listings and `WANTED` posts in that community.
- **FR-014**: A public profile MUST show every such shared community — one when exactly one is shared, all of them when more than one is shared — with no arbitrary limit.
- **FR-015**: A public profile MUST NOT reveal the name, existence, membership status, or any identifying detail of a community that the viewer does not currently belong to, even if the viewed account belongs to it.
- **FR-016**: A public profile MUST NOT show listings or posts from any community outside the viewer/viewed-account shared set.
- **FR-017**: When the viewer and the viewed account currently share no community, the system MUST reject the request and MUST NOT return any profile data for that account — including display name and reputation summary.
- **FR-017a**: Each shared community name shown on a public profile MUST be clickable and MUST navigate to that community's marketplace/listings feed.
- **FR-017b**: Each listing or post shown on a public profile MUST be clickable and MUST navigate to that listing's detail page.

**Reputation and transaction compatibility**

- **FR-018**: Average rating, rating count, and completed-transaction count MUST remain computed globally across the account's entire history, unchanged from 012-profiles-reputation's existing rules, on both the self profile and every public profile.
- **FR-019**: Neither the self profile nor any public profile MAY reveal which community contributed to the global average rating, rating count, or completed-transaction count.
- **FR-020**: Neither the self profile nor any public profile MAY display individual rating records or any per-community reputation breakdown.
- **FR-021**: Only transactions in the `ACCEPTED` state (013-purchase-flow-stock's evolved Transaction model) MUST count toward the completed-transaction count shown on either profile type; the retired `CONFIRMED` state MUST NOT be reintroduced anywhere in this feature.

**Listing compatibility**

- **FR-022**: Both profile types MUST support showing both `FOR_SALE` listings and `WANTED` posts, each clearly labeled by kind.
- **FR-023**: Only listings/posts currently in `ACTIVE` status MUST appear in either profile's marketplace sections.
- **FR-024**: A `FOR_SALE` listing's stock quantity MUST be shown when the underlying listing has one declared, and omitted (not shown as zero or an error) when it does not.

**Privacy and isolation**

- **FR-025**: The system MUST NOT expose another member's email address on any public profile, even when the viewer and that member currently share more than one community.
- **FR-026**: The self profile MUST be able to show all of the signed-in account's own current communities, its own email address, and all of its own active listings/posts grouped by those communities, without the shared-community restriction that applies to public profiles.

### Key Entities *(reuses existing data, introduces no new stored entity)*

- **Account** *(existing)*: Source of display name, email, and account creation date shown only on the self profile; email is never part of any public-profile response.
- **Membership** *(existing)*: Source of which communities an account currently belongs to, its role, and its member-since date per community; the intersection of the viewer's and the viewed account's current Membership rows determines a public profile's visible communities.
- **Listing** *(existing)*: Source of both `FOR_SALE` and `WANTED` entries shown per community, filtered to `ACTIVE` status and, on a public profile, to the shared-community set.
- **Transaction** *(existing, 013's evolved model)*: Source of the completed-transaction count on both profile types, counting only `ACCEPTED` rows the account is a party to, globally.
- **Review** *(existing, 012)*: Source of the global average rating and rating count on both profile types; individual reviews are never displayed.
- **Self Profile View** *(conceptual, derived)*: The account-owner-only aggregation of the above for the signed-in account across all of its current communities.
- **Public Profile View** *(conceptual, derived)*: The viewer-scoped aggregation of the above for another account, restricted to the current shared-community intersection.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A signed-in member can find their own display name, email, join date, reputation summary, and every current community they belong to, all on one screen reached directly from "Account," with no navigation beyond that single click.
- **SC-002**: When two members share exactly one community, opening either one's profile from the other shows that one community's context; when they share several, all of them appear, with zero non-shared communities ever named or otherwise inferable in the response.
- **SC-003**: 100% of public-profile views and their underlying data contain no email address, phone number, physical address, authentication data, individual rating record, or per-community reputation breakdown, across every tested pair of accounts.
- **SC-004**: A member's display name is clickable and opens their shared-community profile from every one of: a listing, a chat thread, a transaction detail, and the Transactions Buying/Selling views.
- **SC-005**: An attempt to view a profile of an account sharing no current community with the viewer returns no profile data, 100% of the time.
- **SC-006**: The self-profile and public-profile pages render correctly and remain fully usable at common mobile and desktop viewport widths.
- **SC-007**: Every community name and every listing/post shown on either profile type is clickable, landing on that community's marketplace feed or that listing's detail page respectively, 100% of the time.

## Assumptions

- The self-profile page replaces the current "Account settings coming soon" placeholder at the existing Account navigation destination; no new top-level navigation entry is introduced.
- "Currently belongs to" for both the Membership intersection (public profile) and the self profile's own community list follows the same "current membership" definition already used elsewhere in the app (e.g., a lapsed membership from before a community's most recent restoration does not count).
- Where a natural ordering is not specified (e.g., the order communities are listed), a stable, consistent order such as community name is used; this is a presentational detail with no functional impact.
- Viewing one's own public-profile link (e.g., one's own name shown to oneself somewhere) is treated the same as any other public-profile view for that same account, since every one of a person's own current communities is trivially in the intersection with themselves.
- The public profile's route/entry point may continue to originate from a specific community context for navigation purposes, even though its content aggregates every currently shared community, not only that originating one.
- No new database entity is introduced; this feature is an aggregation and access-control change over existing Account, Membership, Listing, Transaction, and Review data.
- Profile editing, avatars, bios, phone/address fields, social links, follower/following relationships, notifications, badges, seller tiers, and per-community reputation remain explicitly out of scope, per 012-profiles-reputation's existing precedent and this feature's own instructions.
