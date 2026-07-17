# Contract: Product Listings API

Endpoints this feature exposes. All routes require an authenticated session (existing `Session` cookie from 002-accounts-authentication) — an absent/invalid session returns `401 Unauthorized` with no further processing.

Prices (`priceCents`) are always displayed formatted as Mexican pesos (MXN, `es-MX` locale) by clients of this API — *2026-07-17 amendment, FR-022*. `priceCents` itself is unchanged, currency-agnostic.

## GET /api/communities/{communityId}/listings

List `communityId`'s own `ACTIVE` listings (FR-011, FR-012). Caller MUST hold a `Membership` (any role) in `communityId`.

**Responses**:
- `200 OK` — Body: `{ "ok": true, "listings": [{ "id", "title", "priceCents", "status", "ownerId", "createdAt", "coverPhotoId" }] }`. `coverPhotoId` is `null` when the listing has no cover *(field added 2026-07-17 amendment, FR-014)*.
- `403 Forbidden` — caller has no `Membership` in `communityId`. Body: `{ "ok": false, "reason": "not_a_member" }`.

## POST /api/communities/{communityId}/listings

Create a listing scoped to `communityId` (FR-001, FR-002, FR-005). Caller MUST hold a `Membership` (any role) in `communityId`.

**Request**: `{ "title": "string", "description": "string", "priceCents": number }`

**Responses**:
- `201 Created` — Body: `{ "ok": true, "listing": { "id", "title", "description", "priceCents", "status": "ACTIVE", "ownerId", "communityId", "createdAt" } }`.
- `400 Bad Request` — `title`/`description` blank, or `priceCents` not a non-negative integer. Body: `{ "ok": false, "reason": "invalid_input" }`.
- `403 Forbidden` — caller has no `Membership` in `communityId`. Body: `{ "ok": false, "reason": "not_a_member" }`.

## GET /api/communities/{communityId}/listings/{listingId}

Fetch one listing (FR-011, FR-012). Caller MUST hold a `Membership` (any role) in `communityId`.

**Responses**:
- `200 OK` — Body: `{ "ok": true, "listing": { ...same shape as create..., "coverPhotoId", "photos": [{ "id", "position" }] } }`. `photos` is ordered by `position` ascending (FR-019). `coverPhotoId` added 2026-07-17 amendment, FR-014.
- `403 Forbidden` — caller has no `Membership` in `communityId`. Body: `{ "ok": false, "reason": "not_a_member" }`.
- `404 Not Found` — no listing with `listingId` exists in `communityId`.

## PATCH /api/communities/{communityId}/listings/{listingId}

Edit title/description/price (FR-006). Caller MUST be the listing's owner.

**Request**: any subset of `{ "title": "string", "description": "string", "priceCents": number }`

**Responses**:
- `200 OK` — Body: `{ "ok": true, "listing": { ... } }`.
- `400 Bad Request` — an included field fails validation. Body: `{ "ok": false, "reason": "invalid_input" }`.
- `403 Forbidden` — caller is not the listing's owner (includes that community's own administrator — FR-006's edit authority is owner-only). Body: `{ "ok": false, "reason": "not_owner" }`.
- `404 Not Found` — no listing with `listingId` exists in `communityId`.

## DELETE /api/communities/{communityId}/listings/{listingId}

Permanently delete a listing and its photos (FR-008). Caller MUST be the listing's owner.

**Responses**:
- `204 No Content` — listing and all its photos deleted.
- `403 Forbidden` — caller is not the listing's owner (includes that community's own administrator — FR-010). Body: `{ "ok": false, "reason": "not_owner" }`.
- `404 Not Found` — no listing with `listingId` exists in `communityId`.

## POST /api/communities/{communityId}/listings/{listingId}/pause

Set status to `PAUSED` (FR-007, FR-009). Caller MUST be the listing's owner OR `communityId`'s administrator.

**Responses**:
- `200 OK` — Body: `{ "ok": true, "listing": { "id", "status": "PAUSED" } }`. Idempotent — already-`PAUSED` returns the same 200.
- `403 Forbidden` — caller is neither the owner nor `communityId`'s administrator. Body: `{ "ok": false, "reason": "not_authorized" }`.
- `404 Not Found` — no listing with `listingId` exists in `communityId`.

## POST /api/communities/{communityId}/listings/{listingId}/reactivate

Set status to `ACTIVE` (FR-007, FR-009 — Story 5 Scenario 2: not restricted to whoever paused it). Caller MUST be the listing's owner OR `communityId`'s administrator.

**Responses**: same shape as `/pause`, with `"status": "ACTIVE"`.

## POST /api/communities/{communityId}/listings/{listingId}/photos

Add a photo (FR-003, FR-006). `multipart/form-data` with a single `photo` file field. Caller MUST be the listing's owner.

**Responses**:
- `201 Created` — Body: `{ "ok": true, "photo": { "id", "position" } }`.
- `400 Bad Request` — missing file, wrong MIME type (not `image/jpeg`/`image/png`/`image/webp`), or over 5MB. Body: `{ "ok": false, "reason": "invalid_photo" }`.
- `403 Forbidden` — caller is not the listing's owner. Body: `{ "ok": false, "reason": "not_owner" }`.
- `409 Conflict` — the listing already has 6 photos (research.md #1). Body: `{ "ok": false, "reason": "photo_limit_reached" }`.
- `404 Not Found` — no listing with `listingId` exists in `communityId`.

## GET /api/communities/{communityId}/listings/{listingId}/photos/{photoId}

Stream one photo's bytes (FR-003, FR-012). Caller MUST hold a `Membership` (any role) in `communityId`.

**Responses**:
- `200 OK` — raw bytes, `Content-Type` set to the stored `mimeType`.
- `403 Forbidden` — caller has no `Membership` in `communityId`. Body: `{ "ok": false, "reason": "not_a_member" }`.
- `404 Not Found` — no such photo on that listing in that community.

## DELETE /api/communities/{communityId}/listings/{listingId}/photos/{photoId}

Remove one photo (FR-006). Caller MUST be the listing's owner. Removing the current cover photo promotes the remaining photo with the lowest `position` to cover, or leaves the listing coverless if none remain (FR-017) *(behavior added 2026-07-17 amendment)*.

**Responses**:
- `204 No Content` — photo removed.
- `403 Forbidden` — caller is not the listing's owner. Body: `{ "ok": false, "reason": "not_owner" }`.
- `404 Not Found` — no such photo on that listing in that community.

## PATCH /api/communities/{communityId}/listings/{listingId}/cover *(new, 2026-07-17 amendment)*

Designate one of the listing's existing photos as its cover (FR-016). Caller MUST be the listing's owner.

**Request**: `{ "photoId": "string" }`

**Responses**:
- `200 OK` — Body: `{ "ok": true, "listing": { "id", "coverPhotoId" } }`.
- `403 Forbidden` — caller is not the listing's owner. Body: `{ "ok": false, "reason": "not_owner" }`.
- `404 Not Found` — no listing with `listingId` exists in `communityId`, or `photoId` is not one of that listing's own photos.

## Pages (browser-facing, not a JSON contract but part of this feature's reachable surface)

- `GET /communities/{communityId}/listings` — member-only feed of that community's `ACTIVE` listings, rendered as cards (cover photo, title, price — never a table, and never through an inlined query; the page calls `listListings()` directly, FR-021) with a "New listing" action; a listing with no cover photo shows a defined placeholder (FR-018). Renders `404` (via `notFound()`, same convention as `/communities/{communityId}/admin`) for any signed-in account without a `Membership` in `communityId`, and redirects to sign-in when signed out. *(Card rendering and `listListings()` call added 2026-07-17 amendment — this page previously rendered a two-column table via an inlined Prisma query.)*
- `GET /communities/{communityId}/listings/new` — member-only creation form (title, description, price, optional photos).
- `GET /communities/{communityId}/listings/{listingId}` — member-only detail view; displays a gallery of every one of the listing's photos, in `position` order, to any member including the owner (FR-019) *(added 2026-07-17 amendment — the owner previously saw only an edit form, never their own listing's photos)*; shows Edit/Pause/Reactivate/Delete actions only when the caller is the owner, and a Pause/Reactivate-only moderation action when the caller is that community's administrator (and not the owner).
