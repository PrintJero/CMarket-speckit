# Feature Specification: Wanted Posts

**Feature Branch**: `011-wanted-posts`

**Created**: 2026-07-30

**Status**: Draft

**Input**: User description: "Wanted Posts (\"looking for\" / demand-side posts): Members of a community can post what they are looking to buy or acquire, not only what they are selling. Today CMarket supports supply only (listings of items for sale, 005-product-listings); this adds the demand side to attack the cold-start problem — a new community's feed is empty on day one, and letting people post what they want makes the space feel alive before there is enough supply, starting the matching loop: someone posts 'looking for a used laptop,' and a member who was about to sell one reaches out. A wanted post is a variant of the existing Listing, distinguished by a new kind discriminator (FOR_SALE, WANTED; existing and new listings default to FOR_SALE) — chosen specifically because 008-listing-messaging's MessageThread is tied to Listing.id with no polymorphic-FK support, so this reuses messaging, photos, moderation, and discovery/search infrastructure unchanged. priceCents becomes optional (an optional budget ceiling) specifically for WANTED, remains required for FOR_SALE. Reference photos reuse the exact existing photo caps unchanged. No category/tag field. The existing ListingStatus enum gains a reversible FULFILLED value, reachable only for WANTED, toggleable back to ACTIVE exactly like PAUSED — deletion remains the owner's separate, unchanged, irreversible authority. Administrator moderation (pause/reactivate) is unchanged and covers both kinds; it does not extend to FULFILLED, editing, or deleting. Wanted posts appear interleaved in the same community feed as for-sale listings, clearly labeled, with a new optional kind filter added to the existing search function. Only ACTIVE listings of either kind appear in feed/search by default. Community isolation, contact-data gating, and mobile parity all inherit unchanged from the existing Listing/messaging infrastructure, but every query/search path touching wanted posts MUST still be automatically tested for community isolation regardless of this feature's overall test-optionality. Out of scope: the future saved-searches feature (012), any category taxonomy, any change to FOR_SALE behavior beyond the shared kind column, any new messaging capability."

## Clarifications

### Session 2026-07-30

- Q: Should a wanted post be a distinct entity, or a variant of the existing Listing? → A: A variant of `Listing`, via a new `kind` discriminator (`FOR_SALE` | `WANTED`). Decisive reason: 008-listing-messaging's `MessageThread` is tied to `Listing.id` with no polymorphic-FK support in this codebase's ORM; a distinct entity would require either duplicating messaging/photo/moderation infrastructure or reworking a shipped feature's data model into a polymorphic shape. The variant approach inherits all of it — messaging, photos, moderation, discovery/search — with zero structural change to any shipped feature.
- Q: Should marking a wanted post "fulfilled" be reversible or a terminal state? → A: Reversible. `FULFILLED` is a third value in the existing `ListingStatus` enum, toggleable back to `ACTIVE` exactly like `PAUSED` already is. No irreversible listing state is introduced by this feature.
- Q: Should this feature include a category/tag field, since the original idea mentioned one? → A: No, omitted for MVP. This mirrors 005-product-listings' own explicit exclusion of categories (its FR-013) — no taxonomy, filter UI, or precedent exists anywhere in this codebase yet, and existing keyword search (007-listing-discovery) already covers findability by title/description.
- Q: `Listing.priceCents` is currently required on every listing — how should a wanted post's optional budget be modeled? → A: Reuse the same `priceCents` column, made optional specifically when `kind = WANTED` (a single ceiling value, same currency formatting). It remains required, unchanged, for `kind = FOR_SALE`. No separate min/max range field is introduced.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A member posts what they're looking for (Priority: P1)

A member who wants to buy or acquire something, rather than sell something, creates a post describing what they're seeking — a title, a description, optionally a budget ceiling, and optionally one or more reference photos. The post appears in their community's feed, clearly labeled as a request rather than an offer.

**Why this priority**: This is the entire point of the feature — without the ability to create a wanted post, nothing else here has anything to act on. It's also what directly attacks the cold-start problem the feature exists to solve.

**Independent Test**: Can be fully tested by having a member create a wanted post with a title and description (no price, no photos), then confirming it appears in the community's feed labeled as a request, distinct from any for-sale listing shown alongside it.

**Acceptance Scenarios**:

1. **Given** a member of community C, **When** they create a wanted post with a title and description, **Then** it is created scoped to C, owned by them, in the `ACTIVE` status, with no price required.
2. **Given** the same member, **When** they optionally set a budget ceiling and attach one or more reference photos, **Then** both are stored and associated with the post, using the exact same price-formatting and photo mechanics as a for-sale listing.
3. **Given** a community's feed containing both for-sale listings and wanted posts, **When** any member views it, **Then** each item is clearly and visibly labeled as either an offer ("for sale") or a request ("wanted") — no item's nature is ambiguous.
4. **Given** an account with no membership in community C, **When** it attempts to create a wanted post scoped to C, **Then** the attempt is rejected, exactly as for a for-sale listing.

---

### User Story 2 - Someone finds a wanted post and responds (Priority: P1)

A member browsing the feed, or searching, finds a wanted post they can fulfill and opens a conversation with its author — through the same in-app messaging used to respond to a for-sale listing. No contact details are exposed as a side effect.

**Why this priority**: Without a way to respond, a wanted post is a dead end — this is what starts the matching loop the feature exists to create, exactly as messaging is what makes a for-sale listing useful (008-listing-messaging).

**Independent Test**: Can be fully tested by having a member open a wanted post that isn't their own, send a message, and confirming a thread opens between the two of them tied to that post, with neither party's email, phone, or address ever appearing in the exchange.

**Acceptance Scenarios**:

1. **Given** a wanted post authored by another member of the same community, **When** the viewing member sends a message about it, **Then** a thread opens between the two of them tied to that post, exactly as messaging a for-sale listing's owner today.
2. **Given** an open thread on a wanted post, **When** either party views any message in it, **Then** only the sender's display name is shown — never an email, phone number, or address.
3. **Given** a wanted post, **When** its own author attempts to message themselves about it, **Then** the attempt is rejected, exactly as for a for-sale listing.

---

### User Story 3 - The author manages their wanted post's lifecycle (Priority: P2)

The author of a wanted post can pause it (temporarily hide it from the feed), mark it fulfilled (they found what they were looking for), or reverse either of those, or permanently delete it — all without needing anyone else's help.

**Why this priority**: A wanted post that can only ever be created, never updated or retired, quickly clutters a feed with stale requests. This ships after the core create/respond loop because a community is still usable without it for a short time, but it's needed before the feature is considered complete.

**Independent Test**: Can be fully tested by creating a wanted post, marking it fulfilled, confirming it disappears from the feed but remains visible to its owner, then reversing it back to active and confirming it reappears.

**Acceptance Scenarios**:

1. **Given** an `ACTIVE` wanted post owned by A, **When** A marks it fulfilled, **Then** its status becomes `FULFILLED`, it no longer appears in the community's feed or search results, and it remains visible to A (e.g. in their own listing history).
2. **Given** a `FULFILLED` wanted post owned by A, **When** A reverses it, **Then** its status returns to `ACTIVE` and it reappears in the feed — `FULFILLED` is not a dead end.
3. **Given** an `ACTIVE` wanted post owned by A, **When** A pauses it, **Then** its status becomes `PAUSED` and it disappears from the feed, exactly as pausing a for-sale listing today.
4. **Given** a wanted post owned by A, **When** A permanently deletes it, **Then** it and its photos are gone entirely — deletion remains separate from, and does not require, first marking it fulfilled.
5. **Given** a wanted post owned by A, **When** a different account (not A, not that community's administrator) attempts to pause, fulfill, reverse, or delete it, **Then** the attempt is rejected.

---

### User Story 4 - An administrator moderates a wanted post (Priority: P3)

A community's administrator can pause (and later reactivate) a wanted post within their own community, exactly as they moderate a for-sale listing — but has no authority to mark it fulfilled, edit its content, or delete it.

**Why this priority**: This extends an existing, constitutionally-required administrator power (005-product-listings, Principle III) to the new post kind. It's lower priority than the author-driven flows because a community functions without it initially, but the feature isn't complete without it.

**Independent Test**: Can be fully tested by having a community's administrator pause a wanted post owned by a different member of that same community, confirming it becomes `PAUSED`, then confirming an administrator of a different community cannot do the same, and that even this community's administrator cannot mark it `FULFILLED` or edit it.

**Acceptance Scenarios**:

1. **Given** an `ACTIVE` wanted post owned by member M in community C, **When** C's administrator pauses it, **Then** its status becomes `PAUSED`, and M's ownership and the post's content are unchanged.
2. **Given** the same post, **When** the administrator attempts to mark it `FULFILLED`, edit its title/description/budget, or delete it, **Then** every one of those attempts is rejected — moderation authority covers pause/reactivate only.
3. **Given** the same post, **When** an administrator of a different, unrelated community attempts to pause it, **Then** the attempt is rejected.

---

### Edge Cases

- What happens when a member searches or filters a community's feed by kind (e.g., "show only wanted posts")? Only listings of the requested kind appear; omitting the filter shows both kinds interleaved, exactly as today's feed shows all for-sale listings with no kind filter applied.
- What happens when someone tries to view, search, or message about a wanted post from a different community than their own? Rejected — nothing is revealed, identical to today's rule for a for-sale listing (Principle II).
- What happens when a member creates a wanted post with no budget and no photos at all? Allowed — both are optional, exactly as photos already are for a for-sale listing.
- What happens when an account attempts to set a `FULFILLED` status on a `FOR_SALE` listing (e.g., by directly manipulating a request)? Rejected — `FULFILLED` is reachable only for `kind = WANTED`.
- What happens when the owner tries to fulfill an already-fulfilled post, or pause an already-paused one? Idempotent no-op — the status simply stays as it is, no error, mirroring today's pause/reactivate idempotence.
- What happens to a wanted post's existing message threads when it is marked fulfilled or paused? Unaffected — existing threads remain open and usable, exactly as an existing thread on a paused for-sale listing remains usable today; only starting a *new* thread against a non-`ACTIVE` post is blocked.
- What happens to a wanted post's threads and photos when it is deleted? Both are removed along with it — identical to today's for-sale listing deletion cascade.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Any account holding a `Membership` (any role) in a community MUST be able to create a wanted post scoped to that community, with a `kind` of `WANTED`, using the exact same authorization rule as creating a for-sale listing.
- **FR-002**: A wanted post MUST require a title and a description at creation, exactly as a for-sale listing does; it MUST NOT require a price/budget.
- **FR-003**: A wanted post MAY optionally have a single budget-ceiling value at creation or via later edits, using the same storage and currency-formatting mechanism as a for-sale listing's price; a for-sale listing's price MUST remain required, unchanged.
- **FR-004**: A wanted post MUST support zero or more attached reference photos, under the exact same caps, formats, and cover-photo mechanics already enforced for a for-sale listing's photos (005-product-listings).
- **FR-005**: The listing status model MUST gain a third enumerated value, `FULFILLED`, reachable only when `kind = WANTED`; an attempt to set `FULFILLED` on a `kind = FOR_SALE` listing MUST be rejected.
- **FR-006**: The owner of a wanted post MUST be able to toggle it between `ACTIVE`, `PAUSED`, and `FULFILLED` at will; every one of these transitions MUST be reversible — none is a dead end. Repeating a transition into the status a post is already in MUST be a no-op, not an error.
- **FR-007**: The owner of a wanted post MUST be able to permanently delete it, independent of its current status; deletion MUST also remove every photo and message thread attached to it, exactly as for a for-sale listing.
- **FR-008**: A community's administrator MUST be able to pause and reactivate any wanted post within their own community, even one they do not own, exactly as for a for-sale listing; this authority MUST NOT extend to setting or clearing `FULFILLED`, to editing content, or to deleting.
- **FR-009**: No account other than a wanted post's owner, or that community's own administrator (for pause/reactivate only), may modify a wanted post in any way; this MUST hold even for an administrator of a different, unrelated community.
- **FR-010**: A community's feed and search results MUST show for-sale listings and wanted posts interleaved by default, each visibly and unambiguously labeled by its `kind` — no item's nature (offer vs. request) may be ambiguous to a viewer.
- **FR-011**: The community's feed/search MUST support an optional filter by `kind`; omitting it MUST return both kinds together, exactly as omitting today's price-range filter returns every price.
- **FR-012**: Only `ACTIVE` listings of either kind MUST appear in a community's feed or search results by default; a `FULFILLED` or `PAUSED` wanted post MUST NOT appear there, but MUST remain visible to its own owner.
- **FR-013**: Every access path to a wanted post — creation, viewing, editing, status changes, search, messaging, and deletion — MUST be scoped by `communityId`, using the exact same enforcement already required for a for-sale listing (Constitution Principle II); this scoping MUST be covered by an automated test regardless of this feature's overall test-optionality.
- **FR-014**: A member MUST be able to open a message thread with a wanted post's author directly from that post, using the exact same messaging mechanism (008-listing-messaging) already used for a for-sale listing, including its display-name-only, no-contact-data guarantee (Constitution Principle VI).
- **FR-015**: Starting a *new* message thread against a wanted post MUST require it to be `ACTIVE`; an existing thread on a post that later becomes `PAUSED` or `FULFILLED` MUST remain open and usable, exactly as for a for-sale listing's `PAUSED` state today.
- **FR-016**: This feature MUST NOT introduce a category/tag field, a separate feed for wanted posts, any change to a `FOR_SALE` listing's own required fields or lifecycle, or any new messaging capability beyond what already exists for a for-sale listing.
- **FR-017**: Every core feature of this specification (creating, browsing, filtering by kind, responding to, and managing a wanted post) MUST be fully usable in a mobile viewport, exactly as every other core feature of this product (Constitution Principle V).

### Key Entities

- **Listing** *(existing, from 005-product-listings — extended, not replaced)*: Gains a `kind` field (`FOR_SALE` | `WANTED`, defaulting to `FOR_SALE` for every existing and new row) and a third `status` value, `FULFILLED` (reachable only for `kind = WANTED`). Its `price` becomes required only for `kind = FOR_SALE`; optional for `kind = WANTED`. Every other attribute, relationship, and access rule (owner, community, photos, threads) is unchanged from 005/007/008.
- **Listing Photo** *(existing, from 005-product-listings — referenced, not modified)*: Attaches to a wanted post exactly as it attaches to a for-sale listing, same caps.
- **Message Thread** *(existing, from 008-listing-messaging — referenced, not modified)*: Opens against a wanted post exactly as it opens against a for-sale listing — no change to its own shape or rules.
- **Account, Community, Membership** *(existing — referenced, not modified)*: Same authorization roles as for a for-sale listing.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A member can create a wanted post with no price and no photos in under the same time it takes to create a minimal for-sale listing today.
- **SC-002**: 100% of wanted posts and for-sale listings shown in a community's feed are visibly, unambiguously labeled by kind, verified by automated tests.
- **SC-003**: 100% of attempts to view, search, message about, or modify a wanted post from outside its own community are rejected, verified by automated tests.
- **SC-004**: 0% of `FOR_SALE` listings can ever reach the `FULFILLED` status, verified by automated tests.
- **SC-005**: An owner can create, pause, fulfill, reverse, and delete their own wanted post entirely through their own actions, with no administrator intervention ever required.
- **SC-006**: 100% of `FULFILLED` or `PAUSED` wanted posts are absent from a community's default feed and search results, verified by automated tests.
- **SC-007**: A member can open a conversation about a wanted post and receive a reply, exactly as they can for a for-sale listing today, with 0% of exchanged messages ever displaying an email, phone number, or address.

## Assumptions

- Creating a wanted post is offered as an alternate mode of the existing listing-creation flow (a kind selector, e.g. "Selling" vs. "Looking for"), defaulting to the unchanged "Selling" (`FOR_SALE`) experience so no existing user's default flow changes; choosing "Looking for" relabels the price field as an optional budget ceiling. The exact UI presentation is an implementation detail for the planning phase, not specified here.
- `FULFILLED` is an author-only life-cycle claim about their own request, not a moderation signal — it carries no implication that a transaction was logged (010-transaction-logging) or verified; a post can be marked fulfilled with no transaction log at all, and a transaction can be logged with no post ever marked fulfilled. The two features remain independent.
- No notification (email, in-app alert, or otherwise) is sent to anyone when a wanted post changes status or receives a new message beyond what 008-listing-messaging already provides — this feature introduces no new notification behavior.
- Existing for-sale listings, on migration, are all treated as `kind = FOR_SALE` with no data loss or behavior change; this is a purely additive schema change from the perspective of every shipped feature (005, 007, 008, 010).
- The future saved-searches feature (012) is explicitly out of scope and unbuilt; this feature introduces no schema, code, or conceptual coupling to it.
