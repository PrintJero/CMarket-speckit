# Research: Listing Discovery

## #1 Pagination strategy

**Decision**: Offset-based pagination via Prisma's `skip`/`take`, with a fixed `DEFAULT_PAGE_SIZE = 20` and `MAX_PAGE_SIZE = 50` (server-enforced cap, request values above it are clamped down, never rejected). Ordering is `createdAt desc` with `id desc` as a deterministic tie-breaker, so two listings created in the same millisecond never both land on two different pages or both get skipped.

**Rationale**: `skip`/`take` is the simplest pagination Prisma offers and matches this feature's scale (one community's marketplace, not a global feed) — consistent with Principle VII and 005-product-listings' research.md #3 precedent of picking the simplest mechanism that satisfies the actual scale. `page`/`pageSize` query params are also the simplest thing for the feed page's UI (page-number links) to drive.

**Alternatives considered**:
- **Cursor-based (keyset) pagination** — scales better for very deep pages on huge tables, but adds API surface (opaque cursor tokens) and client-side complexity this feature's scale doesn't need yet; rejected as premature per Principle VII. Revisit only if a community's listing volume ever makes `skip`'s O(offset) cost measurable.
- **No pagination (return everything)** — this is exactly the unpaginated behavior 005-product-listings shipped (`listListings()` returns the full `ACTIVE` set); explicitly what this feature replaces, since it doesn't scale past a small number of listings and is why this feature exists.

## #2 Keyword search implementation

**Decision**: A single `WHERE` clause using Prisma's `contains` with `mode: "insensitive"` against `title` OR `description`, which Prisma compiles to a Postgres `ILIKE '%term%'`. Applied inside the same `findMany` call as the community/status/price filters and pagination — one query, not a separate search step.

**Rationale**: `ILIKE` needs no new Postgres extension, no new index type, and no new dependency — it runs against the existing `Listing` table as-is, matching Principle VII and the spec's explicit exclusion of "advanced full-text search" (FR-009). It directly satisfies FR-004 (case-insensitive substring match against title/description).

**Alternatives considered**:
- **Postgres full-text search (`tsvector`/`to_tsquery`, or `pg_trgm` fuzzy matching)** — would improve relevance ranking and typo tolerance, but requires a generated column or trigram index and is explicitly out of scope per the spec's "advanced full-text search" exclusion (FR-009). Not pursued.
- **External search index (e.g., a dedicated search service)** — explicitly excluded by the spec and Principle VII (no new runtime dependency for MVP-scale, community-sized listing volumes). Not pursued.

## #3 Price range filtering

**Decision**: Optional `minPriceCents`/`maxPriceCents` map to Prisma's `priceCents: { gte, lte }` on the same query. If both are present and `minPriceCents > maxPriceCents`, the service function returns `{ ok: false, reason: "invalid_input" }` before any query runs — mirroring 005-product-listings' existing `invalid_input` convention in `createListing()`/`updateListing()`.

**Rationale**: `gte`/`lte` on an existing integer column needs no new index to be correct (an index is a pure performance optimization, addressed below) and composes naturally with the search and pagination clauses in one `findMany` call, satisfying FR-005 and FR-006 (combinability) in one pass.

**Alternatives considered**: A dedicated price-range validation service/module — rejected as unnecessary indirection for two comparisons (Principle VII); the check belongs directly in the same function that already validates `priceCents` shape in 005.

## #4 Query-level enforcement (no in-memory filtering)

**Decision**: `listListings()` (extended from 005-product-listings) builds one Prisma `findMany` call whose `where` (community scope, status, search, price range), `orderBy` (newest-first, id tie-breaker), `skip`, and `take` are all assembled before the single query executes. No listing row is ever fetched and then filtered, sorted, or sliced by application code.

**Rationale**: This is the spec's explicit, non-negotiable constraint (spec.md Assumptions) and a direct reading of Principle VII — an in-memory filter of a full community's listings would work at small scale but silently becomes an unbounded-memory, unbounded-latency operation as a community's listing count grows, exactly the kind of avoidable complexity/performance risk the principle rejects.

**Alternatives considered**: Fetch all `ACTIVE` listings for the community once (already what 005 does) and filter/paginate in the route handler or a page component — simpler to write, but explicitly forbidden by the spec and reintroduces the scaling problem this feature exists to fix. Rejected.

## #5 Authorization / scoping reuse

**Decision**: Reuse `requireCommunityMembership()` from `src/server/services/listingService.ts` (introduced in 005-product-listings) unchanged, as the sole gate on every discovery query (feed, search, filter, any combination). No new authorization primitive is introduced.

**Rationale**: Discovery introduces no new actor or permission tier beyond "any member of the community" — the same rule 005's `listListings()`/`getListing()` already enforce. Reusing it keeps Principle II's guarantee expressed in exactly one place.

**Alternatives considered**: None seriously — introducing a second membership-check function for the same rule would violate Principle VII (duplication with no behavioral difference).

## #6 Index for query performance

**Decision**: Add a Prisma `@@index([communityId, status, createdAt])` on `Listing` in the same migration this feature ships, supporting the community-scoped, `ACTIVE`-only, newest-first query pattern every discovery path uses. It replaces the existing plain `@@index([communityId])` (a strict prefix of the new composite index, so nothing is lost).

**Rationale**: This is a plain B-tree composite index over columns the query already filters/sorts by — no new index type (unlike `pg_trgm`/GIN, which research #2 already rejected), no new extension, and it directly reduces the cost of the exact query this feature adds. The `title`/`description` `ILIKE` search and the price `gte`/`lte` filter are not indexed (a leading-wildcard `ILIKE` can't use a plain B-tree index anyway), which is an accepted performance trade-off at this feature's expected scale.

**Alternatives considered**: No new index (rely entirely on the existing `communityId`-only index) — would leave the community feed's most common query (scope + status + order) doing more work than necessary for no simplicity benefit, since replacing one plain index with a slightly wider one carries no new dependency or complexity cost. Adding it was the simpler net choice.

## #7 Interaction with the already-shipped cover-photo/display-name amendment

**Decision**: The feed page (`app/communities/[communityId]/listings/page.tsx`) already calls `listListings()` directly (not an inlined duplicate query) and renders a card grid with `coverPhotoId` and `ownerDisplayName`, per a separate amendment that landed on this branch ahead of this feature. This feature extends `listListings()`'s options and return shape additively — `coverPhotoId`/`ownerDisplayName` stay exactly as they are on every returned listing; discovery adds `page`/`pageSize`/`hasMore` alongside them, and the card grid gains search/filter/pagination controls without changing how a card itself renders.

**Rationale**: The feed already funnels through one function (`listListings()`) rather than a duplicated query, which is precisely the shape this feature needs to extend — no refactor is required before adding discovery capability, only additive options and an additive return field set (Principle VII: build on what already exists instead of restructuring it).

**Alternatives considered**: Reverting the feed to a plain table before adding discovery — unnecessary churn against already-shipped, unrelated work; rejected.
