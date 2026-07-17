# Feature Specification: Listing Discovery

**Feature Branch**: `spec007-listing-discovery`

**Created**: 2026-07-17

**Status**: Draft

**Input**: User description: "Listing Discovery: community listing feed, search, basic filters, and pagination — all implemented via Prisma/SQL queries, never filtered/paginated in application memory. Out of scope: saved searches, recommendations, advanced full-text search, external search index. Must satisfy Constitution Principle II (community scoping enforced on every access path) and Principle VII (simplicity/MVP-first — no new dependencies beyond existing Prisma/PostgreSQL stack)."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A member browses their community's listing feed, page by page (Priority: P1)

Any member (any role) of a community can browse that community's active listings as a paginated feed, newest first, without having to load every listing at once.

**Why this priority**: This is the baseline discovery experience — search and filters (User Stories 2-4) only make sense once a browsable, paginated feed already exists. Without it, 005-product-listings' unpaginated feed doesn't scale past a handful of listings.

**Independent Test**: Can be fully tested by seeding a community with more listings than one page holds, requesting page 1 and asserting it returns exactly one page's worth of the newest listings, then requesting page 2 and asserting it returns the remainder with no overlap or omission.

**Acceptance Scenarios**:

1. **Given** a community C with more `ACTIVE` listings than fit on one page, **When** a member of C requests the first page of C's feed, **Then** exactly one page's worth of C's newest `ACTIVE` listings is returned, ordered newest first.
2. **Given** the same community, **When** the member requests the next page, **Then** it returns the next set of listings with no listing repeated and none skipped across the two pages.
3. **Given** the same community, **When** the member requests a page number beyond the last page that has any listings, **Then** an empty result is returned, not an error.
4. **Given** a `PAUSED` listing in C, **When** any member browses C's feed at any page, **Then** that listing never appears.
5. **Given** an account with no membership in C, **When** it requests C's feed, **Then** the request is rejected and no listing data is returned.

---

### User Story 2 - A member searches their community's listings by keyword (Priority: P1)

A member can search within their own community's listings by a keyword that matches a listing's title or description.

**Why this priority**: Once a community has more than a handful of listings, browsing alone no longer finds a specific item; keyword search is the primary way members locate what they're looking for, making it as fundamental as the feed itself.

**Independent Test**: Can be fully tested by creating listings with distinct titles/descriptions in a community, searching for a keyword that appears in exactly one of them, and asserting only that listing is returned; searching for a keyword that matches nothing asserts an empty result.

**Acceptance Scenarios**:

1. **Given** a community C with a listing whose title contains "bicycle", **When** a member of C searches C's listings for "bicycle", **Then** that listing is returned.
2. **Given** a community C with a listing whose description (not title) contains "leather", **When** a member searches for "leather", **Then** that listing is returned.
3. **Given** the same community, **When** a member searches for a term matching no listing, **Then** an empty result is returned, not an error.
4. **Given** a listing in a different community D also matching the search term, **When** a member of C searches C's listings, **Then** D's listing never appears.
5. **Given** a `PAUSED` listing in C matching the search term, **When** a member searches C's listings, **Then** that listing never appears.

---

### User Story 3 - A member filters their community's listings by price range (Priority: P2)

A member can narrow a community's listings to those priced within a minimum and/or maximum amount.

**Why this priority**: Price is the most common budget-driven narrowing a buyer applies; it materially improves discovery but the feed and search (P1s) are already usable without it.

**Independent Test**: Can be fully tested by creating listings at several distinct prices in a community, filtering for a range that includes only some of them, and asserting exactly the listings within that range (inclusive of the bounds) are returned.

**Acceptance Scenarios**:

1. **Given** a community C with listings priced 1000, 5000, and 9000 (smallest currency unit), **When** a member filters for a minimum of 2000 and a maximum of 6000, **Then** only the 5000 listing is returned.
2. **Given** the same community, **When** a member filters using only a minimum (no maximum) or only a maximum (no minimum), **Then** all listings on the open side of that bound are included.
3. **Given** a filter where the minimum exceeds the maximum, **When** a member applies it, **Then** the request is rejected as invalid, and no listings are returned.
4. **Given** a listing priced exactly at a filter's minimum or maximum, **When** that filter is applied, **Then** the listing is included — the bounds are inclusive.

---

### User Story 4 - A member combines search, price filters, and pagination in one query (Priority: P3)

A member can apply a keyword search and a price range together, and still page through the combined result set.

**Why this priority**: This is a natural composition of User Stories 1-3 rather than new capability; it's lower priority because each piece already works on its own, but the combination must be verified explicitly since discovery features are commonly implemented in ways that only work in isolation.

**Independent Test**: Can be fully tested by creating listings where only some satisfy both a keyword and a price range, requesting a paginated result with both applied simultaneously, and asserting only listings satisfying both conditions appear, correctly paginated.

**Acceptance Scenarios**:

1. **Given** a community C with listings of varying titles and prices, **When** a member searches a keyword and applies a price range at the same time, **Then** only listings matching both conditions are returned.
2. **Given** more matching listings than fit on one page, **When** the member requests successive pages of that combined query, **Then** the pages together contain every matching listing exactly once, in the same newest-first order as an unfiltered feed.

---

### Edge Cases

- What happens when an account with no membership in a community requests that community's feed, search, or filtered results? Rejected — no listing data is returned, consistent with Principle II.
- What happens when a search keyword is empty or omitted? Treated as no search filter — the request behaves as an unfiltered, paginated feed browse.
- What happens when a requested page has no listings (beyond the last page, or a search/filter with fewer results than one page)? An empty result, never an error.
- What happens when a price filter's minimum is greater than its maximum? Rejected as invalid input before any listings are queried.
- What happens when a requested page size exceeds the maximum allowed? Capped at the maximum rather than honored as requested or rejected outright.
- What happens to `PAUSED` listings under search, filters, or pagination? They never appear in any discovery result, in any combination, exactly as in 005-product-listings' feed.
- What happens when the same listing would otherwise appear on two different pages due to a tie in ordering (e.g., identical creation timestamps)? A stable, deterministic tie-breaker (e.g., listing id) ensures every listing appears on exactly one page.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every discovery query — feed browsing, keyword search, price filtering, and any combination of these — MUST be scoped to a `communityId` and MUST require the caller to hold a `Membership` (any role) in that community; non-members MUST receive no listing data (Constitution Principle II).
- **FR-002**: Discovery results MUST include only `ACTIVE` listings; a `PAUSED` listing MUST NEVER appear in a feed, search, or filter result, regardless of parameters.
- **FR-003**: The listing feed MUST be paginated with a bounded, fixed-maximum page size, ordered newest-first with a deterministic tie-breaker, enforced by the data layer — never by loading a community's full listing set and slicing it in application code.
- **FR-004**: Members MUST be able to search a community's listings by a keyword matched against a listing's title and/or description, case-insensitively, as a substring match — not stemming, ranking, or relevance scoring.
- **FR-005**: Members MUST be able to filter a community's listings by a minimum price, a maximum price, or both, with inclusive bounds; a minimum greater than a maximum MUST be rejected as invalid input, with no listings queried.
- **FR-006**: Keyword search, price filtering, and pagination MUST be combinable in a single request, all enforced together at the data layer, never through separate in-memory post-processing steps.
- **FR-007**: A discovery query with zero matching listings (no search match, an empty page range, or an empty community) MUST return an empty result, never an error.
- **FR-008**: A request for a page beyond the last page containing results MUST return an empty result, never an error.
- **FR-009**: This feature MUST NOT implement saved/persisted search queries, personalized or algorithmic recommendations, advanced full-text search (stemming, relevance ranking, fuzzy matching), or any external search index or service.
- **FR-010**: This feature introduces no new way to create, edit, or moderate a listing — it only adds read paths (feed, search, filter, pagination) over listings that already exist per 005-product-listings.

### Key Entities

- **Listing** *(existing, from 005-product-listings — referenced, not modified)*: The record being discovered. Its `communityId`, `status`, `title`, `description`, and `priceCents` are the fields this feature reads and queries against; no new field is added to it. (Its `coverPhotoId` and owner `displayName`, added by a separate, already-shipped amendment, continue to be surfaced by the feed for display purposes but are not new to this feature and are not searched or filtered on.)
- **Community** *(existing, from 003-community-creation — referenced, not modified)*: The tenancy every discovery query is scoped to.
- **Membership** *(existing, from 003/004 — referenced, not modified)*: Determines who may run a discovery query against a given community (any role).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A member can locate a specific `ACTIVE` listing in their own community by keyword search in a single request, verified by automated tests.
- **SC-002**: 100% of discovery requests (feed, search, or filter) scoped to a community the caller is not a member of return no listing data, verified by automated tests.
- **SC-003**: Paging through a community's entire result set (feed, search, or filtered) returns every matching `ACTIVE` listing exactly once, with no duplicates and no omissions across pages, verified by automated tests.
- **SC-004**: 100% of invalid filter inputs (e.g., a minimum price above the maximum) are rejected without querying any listings, verified by automated tests.
- **SC-005**: Search keyword, price filters, and pagination combined in a single request produce results consistent with applying each condition independently, in 100% of tested combinations, verified by automated tests.

## Assumptions

- Default and maximum page sizes are implementation-decided constants (not user-configurable beyond choosing a page within that bound), consistent with keeping this MVP simple (Principle VII); exact values are decided during planning.
- Result ordering is fixed to newest-first (by creation time, with a deterministic tie-breaker); no user-selectable sort order is introduced in this MVP.
- "Basic filters" is limited to price range in this feature; no additional filter dimensions (e.g., by owner, by photo presence) are introduced — consistent with the explicit out-of-scope list.
- Per the user's explicit direction, every discovery query (feed, search, filter, pagination, and their combinations) MUST be executed as a single database query with filtering/ordering/pagination expressed at the query level — never by fetching a full result set into application memory and filtering, sorting, or slicing it there. This is a non-negotiable technical constraint carried into planning, not a business requirement, and reflects Principle VII's rejection of avoidable complexity and the performance risk of full in-memory scans.
- This feature reads only the existing `Listing` entity from 005-product-listings; it introduces no new entity, no new field on `Listing`, and no new runtime dependency (no external search index/service). It builds on top of the listing feed as it exists today (card layout, cover photo, owner display name — from an already-shipped, separate amendment), not the plain table this feature was originally scoped against.
