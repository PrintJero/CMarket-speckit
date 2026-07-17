# Quickstart: Product Listings

Validates the feature end-to-end once implemented. See [data-model.md](./data-model.md) for schema and [contracts/listings-api.md](./contracts/listings-api.md) for the route/page contracts.

## Prerequisites

- PostgreSQL running and reachable, migrated with this feature's Prisma schema (`prisma migrate deploy`) — adds `Listing`, `ListingPhoto`, `ListingStatus`.
- An existing `Community` with at least one `ADMINISTRATOR` and one `MEMBER` (e.g., via 004's invite/accept flow, or `npm run create-community` plus a manual second `Membership` row for a quick local check).
- The Next.js dev server running (`npm run dev`).

## Scenario 1 — A member creates a listing with photos (Story 1)

1. Sign in as a member M of community C. Visit `/communities/{C.id}/listings`. Click "New listing".
2. Submit a title, description, price, and one photo.
   - Expect the listing to appear in C's feed, `status: ACTIVE`, owned by M, with the photo visible.
3. Query the database: exactly one `Listing` row scoped to `C.id`, one `ListingPhoto` row scoped to it.
4. Sign in as an account with no membership in C and attempt to visit `/communities/{C.id}/listings/new` directly.
   - Expect `404` (FR-001, FR-011).

## Scenario 2 — The owner edits their listing (Story 2)

1. As M, open the listing from Scenario 1, change its title, description, and price.
   - Expect the stored listing to reflect every change; owner, community, and status unchanged.
2. Sign in as a different member of C (not M, not an administrator) and attempt to edit the same listing via the API directly.
   - Expect `403 not_owner`; the listing is unchanged.
3. Sign in as C's administrator (not M) and attempt to edit the same listing.
   - Expect `403 not_owner` — moderation authority does not extend to content edits (FR-009).

## Scenario 3 — The owner pauses and reactivates their listing (Story 3)

1. As M, pause the listing from the detail page.
   - Expect `status: PAUSED`; the listing no longer appears in `/communities/{C.id}/listings`' active feed.
2. Reactivate it.
   - Expect `status: ACTIVE` again; it reappears in the feed.
3. Pause it twice in a row.
   - Expect no error either time; it simply stays `PAUSED`.

## Scenario 4 — The owner deletes their listing (Story 4)

1. As M, add a second photo to the listing, then delete the listing entirely.
2. Query the database: the `Listing` row and both its `ListingPhoto` rows no longer exist (SC-006).
3. Sign in as C's administrator and attempt to delete a *different* listing owned by another member.
   - Expect `403 not_owner` — deletion is never available to an administrator (FR-010).

## Scenario 5 — Administrator moderation (Story 5)

1. Create a second listing owned by a different member M2 of C.
2. As C's administrator (not M2), pause M2's listing via the detail page's moderation action.
   - Expect `status: PAUSED`; M2's ownership and the listing's data are unchanged.
3. As M2 (the owner), reactivate the same listing.
   - Expect success — reactivation is not restricted to whoever paused it.
4. Create a second, unrelated community D with its own administrator. As D's administrator, attempt to pause M2's listing in C.
   - Expect `403 not_authorized` (FR-009, FR-010 — moderation is scoped to the administrator's own community).

## Scenario 6 — Community isolation (FR-011, FR-012)

1. As an account with a `Membership` in community D but none in C, attempt `GET /api/communities/{C.id}/listings` and `GET /api/communities/{C.id}/listings/{listingId}` directly.
   - Expect `403 not_a_member` for both, regardless of D-membership.
2. Confirm C's listings never appear in any view scoped to D, and vice versa.

## Scenario 7 — Photo limits (research.md #1)

1. As M, attempt to add a 7th photo to a listing that already has 6.
   - Expect `409 photo_limit_reached`; no new photo row created.
2. Attempt to add a photo over 5MB, or of an unsupported MIME type (e.g., `image/gif`).
   - Expect `400 invalid_photo` in both cases; no new photo row created.

## Scenario 8 — Automated test suite

1. Run `npm run test:unit` — Vitest contract tests for `createListing()`, `updateListing()`, `pauseListing()`, `reactivateListing()`, `deleteListing()`, `addListingPhoto()`, `removeListingPhoto()` (red-then-green per Principle VIII) must pass.
2. Run `npm run test:e2e` — Playwright specs driving the listing feed, create/edit forms, and pause/reactivate/delete actions through a real browser must pass, alongside the full existing 002/003/004 suite (no regressions).
