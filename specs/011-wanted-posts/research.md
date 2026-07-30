# Research: Wanted Posts

## #1 A `kind` discriminator on `Listing`, not a distinct entity

**Decision**: Add `kind ListingKind @default(FOR_SALE)` directly to the existing `Listing` model, where `enum ListingKind { FOR_SALE WANTED }`. A wanted post is a `Listing` row with `kind = WANTED`; every existing row backfills to `FOR_SALE` with no other change.

**Rationale**: 008-listing-messaging's `MessageThread` is tied to `Listing.id` via a required, single-target Prisma relation (`listingId String`, `listing Listing @relation(...)`) — Prisma has no native polymorphic-FK construct. A distinct `WantedPost` entity would force one of: (a) duplicating `MessageThread`/`Message` into a parallel `WantedPostThread`/`WantedPostMessage` pair, doubling the messaging surface for no behavioral difference; or (b) reworking `MessageThread` into a polymorphic `(subjectType, subjectId)` shape, a structural change to an already-shipped, tested feature that this feature's own spec explicitly rules out (FR-016: "no new messaging capability beyond what already exists"). The `kind` discriminator instead makes photos, moderation, discovery, and messaging apply automatically and identically, since none of that code branches on anything but `Listing.id`/`communityId`/`ownerId`/`status` today.

**Alternatives considered**: A distinct entity with its own thread model — rejected per above. A distinct entity reusing `MessageThread` via a nullable second FK (`listingId String?`, `wantedPostId String?`, exactly one set) — rejected as introducing a "sometimes-null-FK" pattern nowhere else in this codebase, for a savings (one enum column vs. one discriminator column) that isn't actually a savings.

## #2 `priceCents` becomes nullable, required only for `FOR_SALE`

**Decision**: `Listing.priceCents` changes from `Int` to `Int?`. `createListing()` validates it as required (existing `isValidPriceCents` check) when `kind = FOR_SALE`, and optional-but-still-valid-if-present when `kind = WANTED`. `updateListing()`'s existing "only validate if provided" pattern needs no change — there was never a way to clear a field to `null` through it, so a `FOR_SALE` listing's price can't accidentally become unset via an edit.

**Rationale**: Directly implements the resolved clarification (single ceiling value, same column, no min/max range) with the smallest possible schema change — one nullability flip, no new column. `formatListingPrice()` (`src/lib/formatting/currency.ts`) gains a `null` branch rendering a defined placeholder ("Budget not specified"), mirroring how `resolveDisplayName()` already handles a `null` display name with a defined placeholder rather than a broken render.

**Alternatives considered**: A separate `budgetCents` column, leaving `priceCents` required-forever and unused for `WANTED` rows — rejected as two columns doing the conceptual job of one, and the resolved clarification was explicit about reusing the same column.

## #3 `FULFILLED` is owner-only to enter *and* to leave — administrator authority is confined to `ACTIVE`↔`PAUSED`

**Decision**: `pauseListing()` and `reactivateListing()` both gain a guard: if the listing's *current* status is `FULFILLED`, only the owner (never an administrator) may transition it — to `PAUSED` via `pauseListing()`, or to `ACTIVE` via `reactivateListing()`. A new `fulfillListing()` function is owner-only from the start (mirrors `deleteListing()`'s ownership-only check, never `canModerateListing()`) and additionally requires `listing.kind === "WANTED"`. Administrator authority over `ACTIVE`↔`PAUSED` transitions is otherwise completely unchanged for both kinds.

**Rationale**: spec.md FR-008 says administrator authority "does NOT extend to setting **or clearing** FULFILLED." Reactivating a `FULFILLED` listing back to `ACTIVE` *is* clearing it — if `reactivateListing()` were left as-is (owner-or-administrator, no status check), an administrator could silently override an owner's own "I found it" claim, which the spec's own wording forbids. Pausing a `FULFILLED` listing is, by the same logic, also "clearing" it away from `FULFILLED`. The guard therefore has to live in both existing transition functions, not just the new one — a `FULFILLED` listing is administrator-untouchable in either direction, while an `ACTIVE`/`PAUSED` listing's moderation is completely unchanged from 005-product-listings.

**Alternatives considered**: Only gating the new `fulfillListing()` function and leaving `pauseListing()`/`reactivateListing()` untouched — rejected once FR-008's "or clearing" was read literally; it would let an administrator silently reactivate a fulfilled post, which is exactly what FR-008 forbids. A single generic `setListingStatus()` replacing all three functions — rejected as a larger refactor than this feature needs; the three-function shape (plus one new one) with one added guard clause each is the smaller change (Principle VII).

## #4 The community feed/search gains one optional `kind` filter, mirroring the price-range pattern

**Decision**: `ListListingsOptions` gains `kind?: "FOR_SALE" | "WANTED"`. When present, `listListings()` adds `kind` to the same `where` clause already carrying `communityId`/`status`/search/price-range; when absent, both kinds are returned, exactly as omitting today's price-range filter returns every price. No second query, no in-memory branch.

**Rationale**: Directly satisfies FR-011 ("omitting it MUST return both kinds together") using the exact optional-spread pattern `minPriceCents`/`maxPriceCents` already established (`...(minPriceCents !== undefined ? {...} : {})`) — one more spread, same shape, same single `findMany` call, honoring 007-listing-discovery's own non-negotiable "never filter in application memory" constraint.

**Alternatives considered**: A separate `listWantedPosts()` function — rejected as an unrequested parallel API for data that already lives in the same table and query, directly contradicting spec.md's explicit "not a separate feed" framing (FR-010).

## #5 `kind` is immutable after creation

**Decision**: No route or service function allows changing a `Listing.kind` after creation. `updateListing()`'s input shape gains no `kind` field.

**Rationale**: Not explicitly stated in spec.md, decided here per Principle VII: `kind` determines whether `priceCents` is required, and a listing already has (or lacks) a price by the time anyone would want to change its kind — allowing the change would require deciding what happens to an existing price when a `FOR_SALE` listing becomes `WANTED`, or demanding one be added when a `WANTED` post becomes `FOR_SALE`. `communityId` and `ownerId` are already immutable for a `Listing` (005-product-listings); treating `kind` the same way avoids inventing a transition problem the spec never asked for. A user who wants to change kind creates a new post of the other kind — same one-extra-step cost as changing a listing's community would be today.

**Alternatives considered**: Allowing `kind` changes with `priceCents` becoming `null` on a `FOR_SALE → WANTED` change and rejecting a `WANTED → FOR_SALE` change unless a price is supplied in the same request — rejected as solving a problem (mid-life kind changes) nobody asked for, at the cost of new branching logic in `updateListing()`.

## #6 Community isolation for wanted posts is proven by extending 007's own existing cross-community test, not a new mechanism

**Decision**: `tests/contract/test_listing_discovery.ts` gains one case: create a `WANTED` post in community A and a `WANTED` post in community B, then assert a member of A's `listListings()` call (with or without a `kind` filter) never returns B's post, and vice versa — the same shape as 007's existing "a listing in a different community D also matching the search term... never appears" case, just with `kind = WANTED` rows instead of `FOR_SALE` ones.

**Rationale**: Directly satisfies spec.md FR-013's mandatory-regardless-of-feature-optionality community-isolation requirement. Since every wanted-post query rides through the exact same `communityId`-scoped `where` clause a for-sale listing already does (research.md #1), the correctness argument is "this is the same code path 007 already tests, with one more `where` key" — but the spec requires the assertion to exist explicitly for wanted posts too, not merely to be implied by 007's existing coverage of for-sale listings, so this test is written regardless.

**Alternatives considered**: Relying on 007's existing `FOR_SALE`-only cross-community test as sufficient coverage — rejected; it would leave FR-013's explicit requirement unmet on paper even though the underlying code path is shared, and a future refactor that accidentally special-cased `kind` inside the `where` clause could silently break isolation for one kind without either existing test catching it.
