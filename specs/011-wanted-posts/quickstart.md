# Quickstart: Wanted Posts

Validates the feature end-to-end once implemented. See [data-model.md](./data-model.md) for the schema change and [contracts/listings-api.md](./contracts/listings-api.md) for the delta routes.

## Prerequisites

- PostgreSQL running and migrated with this feature's Prisma schema change (`prisma migrate deploy`) — adds `Listing.kind`, drops `Listing.priceCents`'s `NOT NULL`, adds `FULFILLED` to `ListingStatus`. No existing row's data is altered beyond the automatic `kind = FOR_SALE` backfill.
- A `Community` with at least two members.

## Scenario 1 — A member posts what they're looking for, with no price (Story 1)

1. Sign in as member B. Go to "New listing," choose "Looking for," fill in a title and description, leave the budget blank, submit.
   - Expect the post to be created, `kind = WANTED`, `status = ACTIVE`, `priceCents = null`.
2. View the community feed.
   - Expect the post to appear, labeled "Wanted," interleaved with any `FOR_SALE` listings — not in a separate section.
3. Optionally set a budget ceiling and attach a reference photo via the same edit form a for-sale listing already uses.
   - Expect both to be stored using the exact same mechanics (price formatting, photo caps) as a for-sale listing.

## Scenario 2 — Someone responds through messaging, with no contact data exposed (Story 2)

1. Sign in as a different member, A. Open B's wanted post and send a message ("I have one of these!").
   - Expect a thread to open between A and B, tied to that post — identical to messaging a for-sale listing's owner.
2. Inspect every message in the thread.
   - Expect only display names, never an email, phone number, or address.
3. As B, attempt to message their own wanted post.
   - Expect the attempt to be rejected, exactly as for a for-sale listing.

## Scenario 3 — The owner manages the post's lifecycle (Story 3)

1. As B, mark the wanted post fulfilled.
   - Expect its status to become `FULFILLED`; it disappears from the community feed but B can still see it (e.g. via "My listings").
2. Reverse it back to active.
   - Expect it to reappear in the feed — `FULFILLED` is not a dead end.
3. Pause it instead.
   - Expect it to disappear from the feed, exactly as pausing a for-sale listing.
4. Delete it permanently.
   - Expect it and its photos to be gone entirely, regardless of its status at the time.
5. As a third member (not B, not an administrator), attempt any of the above.
   - Expect every attempt to be rejected.

## Scenario 4 — Administrator moderation is confined to ACTIVE↔PAUSED (Story 4)

1. As B, create a wanted post and mark it fulfilled.
2. As that community's administrator (not B), attempt to reactivate it back to `ACTIVE`.
   - Expect `403 not_authorized` — an administrator cannot clear `FULFILLED` (research.md #3).
3. As B, reactivate it themselves back to `ACTIVE`.
4. As the administrator, pause it.
   - Expect this to succeed — pause/reactivate on an `ACTIVE`/`PAUSED` post works exactly as for a for-sale listing.
5. As the administrator, attempt to mark it `FULFILLED`, edit its content, or delete it.
   - Expect every attempt to be rejected.
6. As an administrator of a *different* community, attempt to pause it.
   - Expect the attempt to be rejected.

## Scenario 5 — Community isolation holds for wanted posts (FR-013, mandatory regardless of test-optionality)

1. Create a `WANTED` post in community A and a separate `WANTED` post in community B.
2. As a member of A, browse and search A's feed, with and without the `kind` filter.
   - Expect B's post to never appear, in any combination.
3. As a member of A, attempt to fetch B's wanted post directly by id, or message its owner.
   - Expect every attempt to be rejected, identical to today's rule for a for-sale listing.

## Scenario 6 — A `FOR_SALE` listing's own behavior is completely unchanged

1. Create a listing without touching the new kind selector (default "Selling").
   - Expect it to behave exactly as before this feature: `kind = FOR_SALE`, price required, `FULFILLED` unreachable.
2. Attempt to mark it `FULFILLED` directly via the API.
   - Expect `409 not_a_wanted_post`.

## Scenario 7 — Automated test suite

1. Run `npm run test:unit` — extended `tests/contract/test_listings.ts` (kind/price validation at creation, `fulfillListing()`'s owner-only/WANTED-only gates, the administrator-confinement guard on `pauseListing()`/`reactivateListing()`) and extended `tests/contract/test_listing_discovery.ts` (the new `kind` filter, and the mandatory cross-community isolation case for `WANTED` posts) must pass, alongside the full existing 002-010 contract suite unmodified.
2. Run `npm run test:e2e` — a minimal Playwright spec covering create-as-WANTED → respond → fulfill must pass, alongside the full existing suite (no regressions).
