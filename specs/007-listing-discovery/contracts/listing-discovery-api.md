# Contract: Listing Discovery API

Extends 005-product-listings' `GET /api/communities/{communityId}/listings` with search, price filters, and pagination. No new route is introduced — the existing endpoint gains optional query parameters. All routes require an authenticated session, as in 005.

## GET /api/communities/{communityId}/listings

List `communityId`'s own `ACTIVE` listings, optionally narrowed by keyword and price range, paginated (FR-001–FR-008). Caller MUST hold a `Membership` (any role) in `communityId`.

**Query parameters** (all optional):

| Param      | Type    | Notes                                                                                   |
| ---------- | ------- | ---------------------------------------------------------------------------------------- |
| `q`        | string  | Keyword matched case-insensitively against `title` OR `description` (FR-004). Empty/omitted → no search filter. |
| `minPrice` | integer | Inclusive lower bound on `priceCents` (FR-005).                                          |
| `maxPrice` | integer | Inclusive upper bound on `priceCents` (FR-005).                                          |
| `page`     | integer | 1-based page number. Defaults to `1`; values below `1` are clamped to `1`.                |
| `pageSize` | integer | Defaults to `20`; clamped to a maximum of `50` (never rejected for being too large).      |

**Responses**:

- `200 OK` — Body: `{ "ok": true, "listings": [{ "id", "title", "priceCents", "status", "ownerId", "createdAt", "coverPhotoId", "ownerDisplayName" }], "page": number, "pageSize": number, "hasMore": boolean }`. (`coverPhotoId`/`ownerDisplayName` are pre-existing fields from a separate amendment, unchanged by this feature.)
- `400 Bad Request` — `minPrice` is present, `maxPrice` is present, and `minPrice > maxPrice`. Body: `{ "ok": false, "reason": "invalid_input" }`.
- `403 Forbidden` — caller has no `Membership` in `communityId`. Body: `{ "ok": false, "reason": "not_a_member" }`.

**Examples**:

- `GET /api/communities/C1/listings` — first page, unfiltered, newest-first (identical behavior to 005's original endpoint).
- `GET /api/communities/C1/listings?q=bicycle` — keyword search only.
- `GET /api/communities/C1/listings?minPrice=1000&maxPrice=6000` — price range only.
- `GET /api/communities/C1/listings?q=bicycle&minPrice=1000&maxPrice=6000&page=2&pageSize=10` — every filter combined (FR-006).

**Non-goals** (explicitly excluded, FR-009): no endpoint or parameter persists a query as a "saved search"; no endpoint returns algorithmic/personalized recommendations; `q` performs substring matching only — no relevance ranking, stemming, or fuzzy matching; no parameter selects an external search backend.

## Pages (browser-facing, not a JSON contract but part of this feature's reachable surface)

- `GET /communities/{communityId}/listings` (extends the existing card-grid feed page) — adds a search box, min/max price inputs, and pagination controls (Prev/Next), all reflected in the URL's query string so a link to a specific search/filter/page is shareable and reloadable. Still member-only (`404` via `notFound()` for non-members). Each card's cover photo/owner display name rendering is unchanged.
