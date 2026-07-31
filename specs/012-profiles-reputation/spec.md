# Feature Specification: User Profiles and Reputation

**Feature Branch**: `012-profiles-reputation`

**Created**: 2026-07-30

**Status**: Finished

**Input**: User description: "User Profiles and Reputation: CMarket needs public member profiles and a transaction-backed reputation system. Today members can create listings, message each other, and record/confirm transactions through 010-transaction-logging, but there is no dedicated public profile where another member can understand who they are dealing with, and there is no way to build trust from successfully completed transactions. Add a public member profile that can be opened when viewing another member from relevant marketplace surfaces such as listings, message threads, transaction logs, and reviews. A public profile must show only marketplace-safe information: display name, member-since date, active listings owned by that member in the community being viewed, number of confirmed transactions, average rating, number of reviews received, reviews received. The public profile MUST NOT expose email addresses, phone numbers, addresses, authentication information, or other private account data. Reputation must be based exclusively on confirmed transaction logs from 010-transaction-logging. After a Transaction reaches confirmationState = CONFIRMED, each participant may leave one review for the other participant for that specific transaction. Reviews are 1-5 star ratings with an optional comment, immutable after creation, restricted to the two actual participants of a confirmed transaction, one review per participant per transaction, both participants may review independently, and reputation numbers (average rating, review count) must be derived from reviews rather than stored as editable fields. Public profile access must respect community isolation: active listings and reviews shown are scoped to the community being viewed; a user may view their own profile with the same presentation; display names should be clickable from listings, message threads, and transaction views to reach a profile. Existing authentication/Account behavior is unchanged, no contact data is exposed, and no badges/rankings/seller tiers/dispute handling/review editing/deletion/recommendation algorithms are introduced. Must work on mobile and desktop."

## Clarifications

### Session 2026-07-30

- Q: Rule 14 (confirmed-transaction count) doesn't state a community scope, unlike active listings and reviews (rules 16-17). If two members share more than one community, should the count shown on a community-C profile include transactions confirmed in a different shared community? → A: No — global. The confirmed-transaction count shown on a profile is the same number everywhere that profile is viewed from, counting every `CONFIRMED` Transaction the account is a party to across every community, not only the community being viewed. This is a deliberate, narrow exception to this feature's otherwise-uniform community scoping (FR-007, FR-008): a bare count reveals only a magnitude of past marketplace activity, never which other community it happened in, who the counterparty was, or what was transacted — a materially weaker signal than the listing/review detail that community isolation (Constitution Principle II) exists to protect.
- Q: Should average rating and review count also be global across every community, matching the confirmed-transaction count, or stay scoped to the community being viewed? → A: Global, matching the confirmed-transaction count exactly. Of everything shown on a profile, only the member-since date and the active listings remain scoped to the community being viewed; average rating, review count, and confirmed-transaction count are all computed across the account's entire cross-community history.
- Q: Should a rating carry an optional written comment, and should individual ratings/reviews be listed on a profile? → A: No, not for this MVP. A rating is exactly one integer from 1 to 5 — no comment or other free-text field exists at all, and no list of individual ratings is ever displayed. A profile shows only the two derived aggregate numbers: average rating and review count.
- Q: Now that reputation numbers are global, could a profile otherwise reveal which other communities contributed to them (e.g., a per-community breakdown)? → A: No — the profile MUST NOT reveal, list, or otherwise make it inferable which other communities contributed to the global average rating, review count, or confirmed-transaction count. Only the bare aggregate numbers are ever shown.
- Q: Should rating be surfaced only as something a participant can go looking for on the transaction view, or actively prompted at the moment it becomes possible? → A: Actively prompted (post-implementation amendment). Immediately after a participant confirms a transaction, they see a rating prompt for the other participant (1-5 stars, Submit, or Maybe later) — the same post-ride-style pattern common to marketplace and rideshare apps. This is UI-only: it changes when the existing rating action is surfaced, not any eligibility, uniqueness, confirmation, or reputation rule (FR-030, FR-031). Declining leaves the transaction ratable later exactly as before this amendment.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - View a member's profile (Priority: P1)

A member browsing a listing, a message thread, or a transaction log wants to know more about who they might be dealing with. They open that person's public profile and see the person's display name, the date they became a member of the community being viewed, and the active listings that member currently owns in that same community — all without any private contact information ever appearing.

**Why this priority**: This is the entire point of the feature — without a place to actually land, nothing else here (ratings) has anywhere to be shown. It is also independently useful and testable before a single rating ever exists, since display name, member-since date, active listings, and confirmed-transaction count are all derivable from data that already exists (Account, Membership, Listing, and 010's Transaction records).

**Independent Test**: Can be fully tested by having one member open a fellow community member's profile from a listing, a thread, or a transaction log, and confirming the display name, member-since date, that community's active listings, and confirmed-transaction count are shown, while no email, phone, address, or authentication data appears anywhere in the page or its underlying data.

**Acceptance Scenarios**:

1. **Given** two members of the same community, **When** one opens the other's profile from a listing, a message thread, or a transaction log, **Then** the profile shows the viewed member's display name, their member-since date for that community, and their active listings in that community.
2. **Given** the same profile, **When** it is rendered or its underlying data is inspected, **Then** no email address, phone number, physical address, or authentication information appears anywhere.
3. **Given** a member with no active listings in the community being viewed, **When** their profile is opened, **Then** the profile still renders normally with a defined empty state for listings — never an error.
4. **Given** two accounts that do not share a community, **When** one attempts to open the other's profile, **Then** the attempt is rejected and no profile data is returned.

---

### User Story 2 - Leave a rating after a confirmed transaction (Priority: P1)

After a transaction the two of them logged reaches the `CONFIRMED` state, either participant can leave a 1-5 star rating about the other participant, tied to that specific transaction. The participant who confirms is immediately prompted to rate, right at that moment (a post-ride-style prompt) — but rating remains entirely optional, and declining the prompt never forecloses rating the same transaction later from the existing transaction view.

**Why this priority**: Without a way to actually create a rating, reputation has no data to be built from — this is the write path that makes User Story 4's numbers real rather than perpetually empty. Prompting at the moment of confirmation, rather than only leaving rating as something a participant must remember to come back for, is what makes rating something people actually do.

**Independent Test**: Can be fully tested by having two co-members confirm a transaction (010-transaction-logging), then having either one submit a 1-5 rating for the other, and confirming a Review now exists identifying the reviewer, the reviewed account, the transaction, the rating, and a creation timestamp. Separately, confirming a transaction and declining the resulting prompt must still leave that transaction ratable afterward from the transaction view.

**Acceptance Scenarios**:

1. **Given** a `CONFIRMED` transaction between accounts A and B, **When** A submits a rating of 1-5 for that transaction, **Then** a Review is created naming A as reviewer, B as reviewed, referencing that transaction, and it immediately contributes to B's average rating and review count wherever B's profile is viewed.
2. **Given** the same confirmed transaction, **When** B independently submits their own rating of A for the same transaction, **Then** a second, separate Review is created — B's rating neither requires nor is blocked by A's.
3. **Given** a Review that already exists, **When** anyone (including its own reviewer or the reviewed account) attempts to edit or delete it, **Then** the attempt is rejected — no such capability exists.
4. **Given** a rating submission, **When** the value is not a whole number from 1 to 5, **Then** the attempt is rejected and no Review is created.
5. **Given** a participant who has just confirmed a transaction, **When** the confirmation succeeds, **Then** they are immediately prompted to rate the other participant, with no path presented other than submitting a rating or declining for now.
6. **Given** that same prompt, **When** the participant declines it (rather than submitting a rating), **Then** no Review is created, and they can still submit a rating for that same transaction later from the transaction view.

---

### User Story 3 - Prevent fraudulent reputation (Priority: P1)

Anyone who is not an actual participant of a confirmed transaction, or who is trying to rate a transaction that was never confirmed, or trying to rate themselves, or trying to leave a second rating for a transaction they already rated, is rejected — reputation can only ever be built from real, confirmed, two-sided marketplace activity.

**Why this priority**: A reputation system that can be inflated by unconfirmed claims, self-ratings, third-party ratings, or duplicate ratings is worse than no reputation system at all, since it actively misleads members into trusting a fabricated signal. This is why this specification's own success criteria (below) require these rejections to be automatically verified.

**Independent Test**: Can be fully tested by attempting, against the same confirmed (and separately, an unconfirmed) transaction: a rating from a non-participant, a rating naming the reviewer as the reviewed account, and a second rating from a participant who already rated it — and confirming every one of these attempts is rejected and creates no Review row.

**Acceptance Scenarios**:

1. **Given** a `CONFIRMED` transaction between A and B, **When** a third account C attempts to leave a rating of A or B for that transaction, **Then** the attempt is rejected and no Review is created.
2. **Given** an `UNCONFIRMED` transaction between A and B, **When** either A or B attempts to leave a rating for it, **Then** the attempt is rejected and no Review is created.
3. **Given** a `CONFIRMED` transaction between A and B, **When** A attempts to submit a rating naming themselves (A) as the reviewed account, **Then** the attempt is rejected.
4. **Given** a `CONFIRMED` transaction that A has already rated, **When** A attempts to leave a second rating for that same transaction, **Then** the attempt is rejected and the existing Review is unchanged.
5. **Given** a `CONFIRMED` transaction between A and B, **When** either A's or B's membership in that transaction's community has since lapsed, **Then** a new rating attempt by or about the lapsed account is rejected — current co-membership is re-verified at the moment of rating creation, not assumed from when the transaction was confirmed.

---

### User Story 4 - View transaction-backed reputation (Priority: P2)

Once ratings exist, a member's profile shows their average rating and how many ratings they've received — computed across every qualifying rating the account has ever received from a confirmed transaction, in any community, not limited to the community the profile is being viewed from.

**Why this priority**: This is what turns a profile from a simple identity card (User Story 1) into an actual trust signal. It ships after rating creation (User Story 2/3) because there is nothing to display until ratings exist, but the product is meaningfully usable without it for a short time (a new profile simply shows no ratings yet).

**Independent Test**: Can be fully tested by having several confirmed transactions between different pairs of co-members, some rated and some not, across two different communities that a viewer only partially shares with the profile's account, then confirming a profile viewed from community C shows an average rating and review count that include ratings from both communities, and that nothing on the profile reveals that any rating came from a community the viewer doesn't share.

**Acceptance Scenarios**:

1. **Given** an account with three ratings received across any communities it belongs to, **When** their profile is viewed from any community it shares with the viewer, **Then** the average rating shown is the arithmetic mean of all three, and the review count shown is 3.
2. **Given** the same account also has a rating received in a different community D that the viewer does not share with it, **When** their profile is viewed from community C, **Then** that D-community rating is included in the average rating and review count shown, but nothing on the profile names, lists, or otherwise reveals that community D exists or contributed to those numbers.
3. **Given** an account with no ratings received yet anywhere, **When** their profile is opened, **Then** a defined neutral state (e.g., "No ratings yet") is shown instead of an error, a zero-star rating, or any other misleading value.

---

### Edge Cases

- What happens when the same two members have confirmed transactions in more than one shared community? Active listings and the member-since date shown are specific to whichever community the profile is viewed from; average rating, review count, and confirmed-transaction count are the same number everywhere the profile is viewed, since all three are computed across every community (Clarifications).
- What happens when a transaction's referenced listing is later deleted? The profile and its reputation numbers are unaffected — a Transaction (and any Review tied to it) persists independently of the listing it references, exactly as 010-transaction-logging already guarantees (its FR-017).
- What happens when an account has zero ratings received anywhere? A defined, neutral empty state is shown for the average rating — never an error, and never a value that could be misread as an actual 0-star rating.
- What happens when a member's community membership lapses after they already left or received ratings there? Existing Transaction and Review rows are retained unaltered — only creating a *new* rating, or opening a profile, requires current co-membership at that moment; past reputation data is never deleted or hidden retroactively because of a later membership change.
- What happens when a current member opens the profile of someone who has since left that same community? The attempt is rejected (404) — a profile's member-since date is sourced from that account's `Membership` row for the community being viewed, and this codebase's `Membership` model has no soft-delete column, so leaving or removal deletes that row outright, leaving nothing to render a member-since date from. A profile therefore requires the viewed account, not only the viewer, to currently hold membership in the community being viewed (FR-006). That departed member's past listings, threads, and transaction mentions of their display name remain visible as before — only opening a fresh profile link for them from that specific community does not.
- What happens when a member's active listings include both for-sale listings and wanted posts (011-wanted-posts)? Both appear on the profile, each clearly labeled by kind, exactly as they already appear labeled in the community's own feed (011 FR-010).
- What happens when a viewer, who shares only one community with a profile's account, sees an average rating or review count that's clearly higher than what that one shared community's activity alone would suggest? This is expected and by design (Clarifications) — the numbers reflect the account's entire cross-community rating history; the profile never breaks them down, attributes them to a specific other community, or otherwise reveals that other community's existence.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST let a member open another current community co-member's public profile from relevant marketplace surfaces, including at minimum a listing, a message thread, and a transaction log, where a link to that profile is shown.
- **FR-002**: A public profile MUST show exactly: the account's display name, its member-since date for the community being viewed, its active listings owned in that community, its confirmed-transaction count, its average rating, and its review count — and MUST NOT show any other account attribute.
- **FR-003**: A public profile, and any data returned to render it, MUST NOT include the account's email address, phone number, physical address, authentication information (e.g., password hash, session tokens), or any other private account data, under any circumstance.
- **FR-004**: A member viewing their own profile MUST see the exact same presentation used when any other member views it — no additional editing affordance is introduced by this feature.
- **FR-005**: A member's display name, shown on a listing, a message thread, or a transaction view, SHOULD be clickable where practical, linking to that member's public profile scoped to the community the surface belongs to.
- **FR-006**: The system MUST verify, at the moment a profile is opened, that both the viewer and the account whose profile is being opened currently hold membership in the community the profile is being viewed from; otherwise the attempt MUST be rejected and no profile data returned. (The viewed account's own membership is required because its member-since date, FR-002, has no defined value once that account no longer has a membership row for this community to read one from.)
- **FR-007**: Active listings shown on a profile MUST be limited to listings owned by that account with a status of `ACTIVE`, in the community being viewed, of either kind (005-product-listings' for-sale listings and 011-wanted-posts' wanted posts), each labeled by kind exactly as the community's own feed already labels them. Together with the member-since date (FR-002), this is the only profile content scoped to the community being viewed.
- **FR-008**: An account's average rating and review count MUST be computed across every qualifying rating (FR-012 through FR-016) the account has ever received, regardless of which community the underlying confirmed transaction belongs to — never limited to the community the profile is being viewed from.
- **FR-009**: The confirmed-transaction count shown on a profile MUST be the count of `Transaction` records (010-transaction-logging) where the profile's account is either the `recorderId` or the `counterpartId` and `confirmationState` is `CONFIRMED`, counted across every community the account has ever transacted in, exactly like FR-008's ratings.
- **FR-010**: A public profile MUST NOT display a list of individual reviews or ratings — only the two derived aggregate numbers (average rating, review count) are shown.
- **FR-011**: A public profile MUST NOT reveal, list, or otherwise make it inferable which specific communities contributed to its average rating, review count, or confirmed-transaction count — no per-community breakdown and no listing of the underlying transactions or ratings grouped or labeled by community.
- **FR-012**: The system MUST let either participant of a `CONFIRMED` transaction create at most one review of the other participant for that specific transaction.
- **FR-013**: A review's reviewed account MUST be derived server-side as exactly the other participant of the referenced transaction — never accepted as a separate, independently supplied field.
- **FR-014**: A review attempt against a transaction whose `confirmationState` is not `CONFIRMED` MUST be rejected, and no review MUST be created.
- **FR-015**: A review attempt by an account that is not one of the referenced transaction's two participants MUST be rejected.
- **FR-016**: A review naming its own reviewer as the reviewed account MUST be rejected (structurally prevented by FR-013's derivation, not a separate runtime check).
- **FR-017**: A second review attempt by the same reviewer for a transaction they have already reviewed MUST be rejected, and MUST leave their existing review unchanged.
- **FR-018**: Both participants of the same `CONFIRMED` transaction MAY each independently create their own review of the other; neither review MUST require or be blocked by the other.
- **FR-019**: The system MUST verify, at the moment a review is created, that both the reviewer and the reviewed account currently hold membership in the transaction's community; otherwise the attempt MUST be rejected.
- **FR-020**: A review's rating MUST be an integer from 1 to 5 inclusive; any other value MUST be rejected.
- **FR-021**: A review MUST consist of only its rating (FR-020) — this MVP MUST NOT accept, store, or display a written comment or any other free-text field alongside a rating.
- **FR-022**: A review MUST be immutable once created — the system MUST NOT provide any capability to edit or delete a review, for its reviewer, its reviewed account, or a community administrator.
- **FR-023**: An account's average rating MUST be computed by deriving from its qualifying received reviews (FR-008) at the time it is requested, and MUST NOT be stored as a separate, independently editable field.
- **FR-024**: An account's review count MUST likewise be derived from its qualifying received reviews (FR-008) at the time it is requested, and MUST NOT be stored as a separate, independently editable field.
- **FR-025**: This feature MUST NOT change any existing authentication or Account behavior.
- **FR-026**: This feature MUST NOT change any Transaction confirmation rule established by 010-transaction-logging.
- **FR-027**: This feature MUST NOT change any Listing lifecycle behavior established by 005-product-listings or 011-wanted-posts.
- **FR-028**: This feature MUST NOT introduce badges, rankings, seller tiers, dispute handling, review editing, review deletion, or a recommendation algorithm.
- **FR-029**: Every surface this feature introduces (the public profile view and the rating-creation action) MUST be fully usable in a mobile viewport, equivalent to every other core CMarket feature.
- **FR-030**: Immediately after a participant successfully confirms a transaction, the system MUST present that participant with a rating prompt for the transaction's other participant, offering only a 1-5 rating selection, a way to submit it, and a way to decline for now — this prompt MUST use the exact same review-creation action and every gate already required by FR-012 through FR-021; it introduces no new eligibility, uniqueness, or confirmation rule of its own.
- **FR-031**: Declining the post-confirmation rating prompt MUST NOT prevent that participant from creating a review for the same transaction afterward from the existing transaction view (FR-012 continues to govern that action, unchanged).

### Key Entities

- **Review** *(new)*: A single 1-5 star rating left by one participant of a confirmed transaction about the other. Contains no written comment or other free-text field (FR-021). References exactly one reviewer account, one reviewed account (always the transaction's other participant), and one transaction. Immutable once created. At most one per (reviewer, transaction) pair; a transaction may carry up to two reviews total, one from each participant, created independently of each other. Never displayed individually or listed on a profile — contributes only to the reviewed account's average rating and review count, both computed across every community (FR-008, FR-010).
- **Transaction** *(existing, from 010-transaction-logging — referenced, not modified)*: The sole source of reputation truth. A review's eligibility, its two possible participants, and its community are all derived from the transaction it references; only a transaction whose `confirmationState` is `CONFIRMED` can ever have a review.
- **Account** *(existing — referenced, not modified)*: The subject of a public profile. Contributes its display name; contributes no email, phone, address, or authentication data to any profile response.
- **Membership** *(existing — referenced, not modified)*: Supplies a profile's member-since date for the community being viewed, and is the live co-membership check gating both profile access (FR-006) and review creation (FR-019).
- **Listing** *(existing, from 005-product-listings and 011-wanted-posts — referenced, not modified)*: Supplies the active listings shown on a profile, filtered to `status = ACTIVE` and the community being viewed, of either kind.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of reviews contributing to a profile's average rating or review count originate from a transaction whose `confirmationState` is `CONFIRMED`, verified by automated tests.
- **SC-002**: 0% of review attempts by a non-participant, against an unconfirmed transaction, naming the reviewer as the reviewed account, or duplicating an existing (reviewer, transaction) pair are accepted, verified by automated tests.
- **SC-003**: 0% of public-profile or review responses expose an email address, phone number, physical address, or authentication data, verified by automated tests.
- **SC-004**: 100% of a profile's active listings, when viewed from community C, are confirmed to belong to community C, verified by automated tests.
- **SC-005**: 100% of a profile's average rating, review count, and confirmed-transaction count include every qualifying rating and transaction across every community the account belongs to — never only the community being viewed — verified by automated tests.
- **SC-006**: 0% of profile responses reveal, list, or make it inferable which specific other community contributed to the average rating, review count, or confirmed-transaction count, verified by automated tests.
- **SC-007**: A member can navigate from a listing, a message thread, or a transaction to another member's profile, and back to their own marketplace activity, without leaving the application.
- **SC-008**: Every surface introduced by this feature is fully usable on a mobile viewport, matching every other core CMarket feature.
- **SC-009**: A member viewing their own profile is shown the identical presentation used for viewing any other member's profile, verified by automated tests.
- **SC-010**: 100% of successful transaction confirmations immediately present the confirming participant with a rating prompt, and 100% of declined prompts leave that transaction still ratable afterward from the transaction view, verified by automated tests.

## Assumptions

- "Member-since date" is the account's `Membership.createdAt` for the community being viewed (when they joined that specific community), not the account's global creation date — the one identity-level field, alongside active listings, that stays scoped to the community being viewed (FR-007).
- A public profile is always opened in the context of a specific community (reached from a listing, thread, or transaction that itself belongs to that community), never as a global, community-less view — consistent with every prior feature's own community-nested access pattern (005, 007, 008, 010, 011). Community scoping governs *who may open* a profile (FR-006) and *which listings* it shows (FR-007); it deliberately does not govern the reputation numbers (FR-008, FR-009).
- The global average rating, review count, and confirmed-transaction count are computed server-side from all qualifying reviews/transactions account-wide; the response and its rendering deliberately omit any per-transaction or per-community detail (no breakdown, no list, no community name) that could let a viewer infer the account's activity in a community they don't share with it (FR-011).
- There is no blind or double-blind rating mechanism; each participant can leave their own review independently at any time after confirmation, and it counts toward the other's aggregate numbers as soon as it is submitted — consistent with 010-transaction-logging's own precedent of no dispute or mediation mechanism, and with Constitution Principle VII (simplicity, no speculative scope).
- An average rating is displayed rounded to one decimal place; the underlying computation always derives fresh from every currently qualifying review (FR-023) rather than a cached or stored value.
- No notification (email, in-app alert, or otherwise) is sent to anyone when a review is created — consistent with 008-listing-messaging's and 010-transaction-logging's own no-new-notification precedent.
- This feature reads existing `Transaction`, `Account`, `Membership`, and `Listing` data but does not modify any of their existing fields, relations, or lifecycle rules (FR-025, FR-026, FR-027).
- The post-confirmation rating prompt (FR-030, FR-031) is presentation-only: it is shown only to the participant who just performed the confirm action (the transaction's `counterpartId` — 010-transaction-logging FR-005 already restricts confirmation to that account), inviting them to rate the other participant. It is not shown to the other participant automatically on some later visit; that participant still reaches the same rating action the ordinary way, from the transaction view, whenever they next visit it. No new client-supplied field, review shape, or gate is introduced — the prompt calls the exact same action as the transaction view's own rating control.
