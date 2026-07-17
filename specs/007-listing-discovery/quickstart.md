# Quickstart: Listing Discovery

Validates the feature end-to-end once implemented. See [data-model.md](./data-model.md) for the query/result shape and [contracts/listing-discovery-api.md](./contracts/listing-discovery-api.md) for the extended endpoint contract.

## Prerequisites

- PostgreSQL running and reachable, migrated with this feature's Prisma schema change (`prisma migrate deploy`) — replaces the `Listing` community index only, no new table.
- An existing `Community` with at least one member (with a `displayName` set — createListing requires one per the existing display-name amendment), and more `ACTIVE` listings in it than one default page size (20).
- The Next.js dev server running (`npm run dev`).

## Scenario 1 — Browse the feed, paginated (Story 1)

1. Sign in as a member M of community C (seeded with 25+ `ACTIVE` listings). Visit `/communities/{C.id}/listings`.
2. Expect exactly 20 listing cards on the first page, newest-first.
3. Follow the "Next" control.
   - Expect the remaining listings, with no listing repeated from page 1.
4. Request a page far beyond the last one with data (e.g., via the API directly with a large `page` value).
   - Expect `200 OK` with an empty `listings` array, not an error.
5. Pause one of C's listings, then reload page 1.
   - Expect it to no longer appear on any page.
6. Sign in as an account with no membership in C and request `GET /api/communities/{C.id}/listings` directly.
   - Expect `403 not_a_member`.

## Scenario 2 — Keyword search (Story 2)

1. As M, create (or confirm from seed data) a listing titled "Mountain bicycle" and another whose description mentions "leather jacket".
2. Search C's listings for `bicycle`.
   - Expect only the title-matching listing to appear.
3. Search for `leather`.
   - Expect only the description-matching listing to appear.
4. Search for a term matching nothing (e.g., `zzz-nonexistent`).
   - Expect `200 OK` with an empty `listings` array.
5. Pause the "Mountain bicycle" listing, then repeat the `bicycle` search.
   - Expect it to no longer appear.

## Scenario 3 — Price range filter (Story 3)

1. Confirm three listings priced 1000, 5000, and 9000 (cents) exist in C.
2. Filter with `minPrice=2000&maxPrice=6000`.
   - Expect only the 5000 listing.
3. Filter with only `minPrice=5000` (no `maxPrice`).
   - Expect the 5000 and 9000 listings.
4. Filter with `minPrice=6000&maxPrice=2000` (min above max).
   - Expect `400 invalid_input`; confirm via a direct API call that no listings are returned in the body.
5. Filter with `minPrice=5000&maxPrice=5000`.
   - Expect exactly the 5000 listing (inclusive bounds).

## Scenario 4 — Combined search, filter, and pagination (Story 4)

1. Seed enough listings that both a keyword and a price range match more than one page's worth.
2. Request page 1 with `q`, `minPrice`, and `maxPrice` all set together.
   - Expect only listings satisfying all three conditions, newest-first.
3. Request page 2 of the same combined query.
   - Expect the remaining matches, with no overlap or omission versus page 1.

## Scenario 5 — Community isolation (FR-001)

1. As an account with a `Membership` in community D but none in C, attempt every discovery variant (`GET .../listings`, with and without `q`/`minPrice`/`maxPrice`/`page`) against C directly.
   - Expect `403 not_a_member` in every case, regardless of D-membership.

## Scenario 6 — Automated test suite

1. Run `npm run test:unit` — Vitest contract tests covering the extended `listListings()` (search, price filter, pagination, combinations, invalid input, non-member rejection) must pass, alongside 005's and 006's original contract tests unmodified.
2. Run `npm run test:e2e` — Playwright specs driving the feed's search box, price inputs, and pagination controls through a real browser must pass, alongside the full existing 002/003/004/005/006 suite (no regressions).
