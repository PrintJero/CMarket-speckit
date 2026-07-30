# Contract: Wanted Posts — Listings API Delta

This feature extends 005-product-listings' and 007-listing-discovery's existing `/api/communities/{communityId}/listings...` routes (see their own `contracts/listings-api.md`) rather than adding a new namespace. Only the changed/new surface is documented here; every unlisted route, status code, and error shape is unchanged.

## POST /api/communities/{communityId}/listings *(extended)*

**Request** *(extended)*: `{ "title": "string", "description": "string", "priceCents"?: number, "kind"?: "FOR_SALE" | "WANTED" }`. Omitting `kind` defaults to `"FOR_SALE"` (unchanged behavior). `priceCents` is required and validated when `kind` is `"FOR_SALE"` (or omitted); optional-but-validated-if-present when `kind` is `"WANTED"`.

**Responses** *(unchanged shape, one new failure case)*:
- `201 Created` — Body: `{ "ok": true, "listing": { ..., "kind", "priceCents": number | null } }`.
- `400 Bad Request` — `title`/`description` blank; `priceCents` missing while `kind = FOR_SALE` (or omitted); or `priceCents` present but not a non-negative integer. Body: `{ "ok": false, "reason": "invalid_input" }`.
- `403 Forbidden` — unchanged (`not_a_member`).

## GET /api/communities/{communityId}/listings *(extended)*

**Query parameters** *(one new, optional)*:

| Param | Type | Notes |
| --- | --- | --- |
| `kind` *(new)* | `"FOR_SALE"` \| `"WANTED"` | Omitted → both kinds returned, interleaved (FR-011). |

**Responses** *(extended shape)*:
- `200 OK` — Body: `{ "ok": true, "listings": [{ ..., "kind", "priceCents": number | null }], "page", "pageSize", "hasMore" }`.

## GET /api/communities/{communityId}/listings/{listingId} *(extended)*

**Responses** *(extended shape)*:
- `200 OK` — Body: `{ "ok": true, "listing": { ..., "kind", "priceCents": number | null, "photos": [...] } }`.

## PATCH /api/communities/{communityId}/listings/{listingId} *(unchanged surface)*

`kind` is immutable (research.md #5) — the request body accepts no `kind` field; if one is sent, it is silently ignored (mirrors how every existing route already ignores unrecognized body fields). No other change.

## POST /api/communities/{communityId}/listings/{listingId}/fulfill *(new)*

Set status to `FULFILLED` (FR-005, FR-006). Caller MUST be the listing's owner — **never** that community's administrator (research.md #3, FR-008). The listing MUST have `kind = "WANTED"`.

**Responses**:
- `200 OK` — Body: `{ "ok": true, "listing": { "id", "status": "FULFILLED" } }`. Idempotent — already-`FULFILLED` returns the same `200`.
- `403 Forbidden` — caller is not the listing's owner (an administrator attempting this gets the same `403`, unlike `/pause`/`/reactivate`). Body: `{ "ok": false, "reason": "not_owner" }`.
- `404 Not Found` — no listing with `listingId` exists in `communityId`.
- `409 Conflict` — the listing's `kind` is `"FOR_SALE"`. Body: `{ "ok": false, "reason": "not_a_wanted_post" }`.
- `409 Conflict` — the community does not currently allow existing-content actions (mirrors `pauseListing()`/`reactivateListing()`'s own `communityAllowsExistingContent()` check). Body: `{ "ok": false, "reason": "community_not_active" }`.

## POST /api/communities/{communityId}/listings/{listingId}/pause *(extended)*, POST .../reactivate *(extended)*

**Responses** *(one new failure case on each, otherwise unchanged)*:
- `403 Forbidden` — caller is neither the owner nor `communityId`'s administrator (unchanged) **or** the listing's current status is `FULFILLED` and the caller is not its owner (new — research.md #3: an administrator cannot move a `FULFILLED` listing in either direction). Both cases share `{ "ok": false, "reason": "not_authorized" }` — the caller-facing distinction is not exposed as a separate reason code, since both are "you may not change this listing's status right now."

## POST /api/communities/{communityId}/listings/{listingId}/messages *(unchanged)*

Sending a message to a wanted post's owner uses this exact, already-shipped route with no change (research.md #1) — the route has no `kind` awareness at all, since messaging never branched on anything but `listingId`/`ownerId`.

## Pages (browser-facing, not a JSON contract)

- `GET /communities/{communityId}/listings/new` (extended): the create form gains a "Selling" / "Looking for" toggle, defaulting to "Selling" — unchanged for anyone who doesn't touch it. Choosing "Looking for" relabels price as "Budget (optional)" and removes the `required` attribute from that field.
- `GET /communities/{communityId}/listings` (extended): each card shows a kind badge ("For sale" / "Wanted"); the discovery controls gain a kind filter alongside the existing search/price-range fields.
- `GET /communities/{communityId}/listings/{listingId}` (extended): shows the kind, the correctly-labeled price/budget (or "Budget not specified" when absent), and — for the owner of a `WANTED` post — a "Mark as fulfilled" / "Reverse" action alongside the existing pause/reactivate/delete actions.

**Non-goals** (explicitly excluded, spec Out of Scope): no category/tag field or filter; no separate feed/route for wanted posts; no min/max budget range; no new messaging route or capability; no cross-community aggregated view of a caller's own wanted posts (unlike 008's `Chats`/`My listings` amendment, this feature's spec does not request one — `listMyListings()` already surfaces a caller's own listings of either kind with no change needed, since it was never kind-filtered to begin with).
