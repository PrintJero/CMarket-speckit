# Contract: Purchase Flow API

Five new routes, all under the existing per-community namespace, plus one field added to the existing listing-update route. Every route requires an authenticated session (401 otherwise). Retires two 010-transaction-logging routes outright (thread-derived creation and confirmation no longer exist — FR-027, spec.md Relationship to Feature 010).

## Retired routes

- `POST /api/communities/{communityId}/threads/{threadId}/transaction` — **removed**. Creation is listing-derived now (research.md #3), not thread-derived.
- `POST /api/communities/{communityId}/transactions/{transactionId}/confirm` — **removed**. Replaced by `/accept` and `/reject` below.

## PATCH /api/communities/{communityId}/listings/{listingId} *(existing route, extended)*

Adds an optional `stockQuantity` field to the existing body, alongside `title`/`description`/`priceCents`. Owner-only, same gates as today (`updateListing()`).

**Body** (extends the existing shape): `{ "stockQuantity"?: number }`

**Responses** (extends the existing shape):

- `200 OK` — listing body gains `"stockQuantity": number | null`.
- `400 Bad Request` — `stockQuantity` is present but not a non-negative integer. Body: `{ "ok": false, "reason": "invalid_input" }` (same reason as an invalid `priceCents` today — no new reason string).
- `403 Forbidden` / `404 Not Found` / `409 Conflict` (`community_not_active`) — unchanged from today.

## POST /api/communities/{communityId}/listings/{listingId}/proposals

Propose a purchase ("Buy"). Quantity and total are supplied by the buyer; seller and community are derived from the listing (research.md #3, FR-003/FR-004).

**Body**: `{ "quantity": number, "totalCents": number }`

**Responses**:

- `201 Created` — Body: `{ "ok": true, "transaction": { "id", "sellerDisplayName": string | null, "listingTitle", "quantity", "totalCents", "paymentPath": "OFF_PLATFORM", "state": "PENDING", "createdAt": string } }`
- `400 Bad Request` — `quantity` or `totalCents` is not a positive integer. Body: `{ "ok": false, "reason": "invalid_input" }`
- `403 Forbidden` — caller has no `ACTIVE`-community membership in `communityId`. Body: `{ "ok": false, "reason": "not_a_member" }`
- `403 Forbidden` — caller is the listing's own owner. Body: `{ "ok": false, "reason": "self_purchase" }`
- `404 Not Found` — `listingId` does not resolve to a `FOR_SALE` listing in `communityId` (a `WANTED` post or nonexistent id both read as `not_found`, research.md #7/data-model.md gate 3).
- `409 Conflict` — the listing's `status` is not `ACTIVE`. Body: `{ "ok": false, "reason": "listing_not_active" }`
- `409 Conflict` — the listing's stock has not been declared. Body: `{ "ok": false, "reason": "stock_not_specified" }`
- `409 Conflict` — `quantity` exceeds the listing's current `stockQuantity`. Body: `{ "ok": false, "reason": "exceeds_stock" }`
- `409 Conflict` — the listing's owner is no longer a member of `communityId`. Body: `{ "ok": false, "reason": "seller_not_a_member" }`

## POST /api/communities/{communityId}/transactions/{transactionId}/accept

Accept a `PENDING` proposal. Seller-only (FR-013).

**Body**: none.

**Responses**:

- `200 OK` — Body: `{ "ok": true, "transaction": { "id", "state": "ACCEPTED", "resolvedAt": string } }`. Also reflects the listing's decremented `stockQuantity` (data-model.md's guarded `$transaction`).
- `403 Forbidden` — caller has no membership in `communityId`. Body: `{ "ok": false, "reason": "not_a_member" }`
- `403 Forbidden` — caller is not this transaction's `sellerId`. Body: `{ "ok": false, "reason": "not_a_seller" }`
- `404 Not Found` — `transactionId` does not exist in `communityId`.
- `409 Conflict` — the transaction is not currently `PENDING` (already resolved by an earlier accept/reject/cancel). Body: `{ "ok": false, "reason": "not_pending" }`
- `409 Conflict` — `quantity` now exceeds the listing's current `stockQuantity` (someone else was accepted first, or the seller reduced stock). Body: `{ "ok": false, "reason": "exceeds_stock" }`

## POST /api/communities/{communityId}/transactions/{transactionId}/reject

Reject a `PENDING` proposal. Seller-only. No side effect beyond the state change (FR-016).

**Body**: none.

**Responses**:

- `200 OK` — Body: `{ "ok": true, "transaction": { "id", "state": "REJECTED", "resolvedAt": string } }`
- `403 Forbidden` — caller has no membership in `communityId`. Body: `{ "ok": false, "reason": "not_a_member" }`
- `403 Forbidden` — caller is not this transaction's `sellerId`. Body: `{ "ok": false, "reason": "not_a_seller" }`
- `404 Not Found` — `transactionId` does not exist in `communityId`.
- `409 Conflict` — not currently `PENDING`. Body: `{ "ok": false, "reason": "not_pending" }`

## POST /api/communities/{communityId}/transactions/{transactionId}/cancel

Cancel a `PENDING` proposal. Buyer-only (FR-017).

**Body**: none.

**Responses**:

- `200 OK` — Body: `{ "ok": true, "transaction": { "id", "state": "CANCELLED", "resolvedAt": string } }`
- `403 Forbidden` — caller has no membership in `communityId`. Body: `{ "ok": false, "reason": "not_a_member" }`
- `403 Forbidden` — caller is not this transaction's `buyerId`. Body: `{ "ok": false, "reason": "not_a_buyer" }`
- `404 Not Found` — `transactionId` does not exist in `communityId`.
- `409 Conflict` — not currently `PENDING`. Body: `{ "ok": false, "reason": "not_pending" }`

## GET /api/communities/{communityId}/transactions *(existing route, evolved response shape)*

List every transaction in `communityId` where the caller is either `buyerId` or `sellerId` (FR-020), any state, newest first. An optional `?state=ACCEPTED` filter serves the "purchase history" / "sales history" views (data-model.md's read-view section) — the same query, filtered.

**Responses**:

- `200 OK` — Body: `{ "ok": true, "transactions": [{ "id", "role": "buyer" | "seller", "counterpartDisplayName", "listingTitle", "quantity", "totalCents", "paymentPath", "state", "createdAt", "resolvedAt" }] }`. `role` replaces `"recorder" | "counterpart"`; `counterpartDisplayName` is the seller's name when `role: "buyer"` and vice versa.
- `403 Forbidden` — caller has no membership in `communityId`. Body: `{ "ok": false, "reason": "not_a_member" }`

## GET /api/communities/{communityId}/transactions/{transactionId} *(existing route, evolved response shape)*

Fetch one transaction's full detail (FR-020, FR-028 — remains reachable after the listing it references is deleted).

**Responses**:

- `200 OK` — Body: `{ "ok": true, "transaction": { "id", "role", "counterpartDisplayName", "listingTitle", "quantity", "totalCents", "paymentPath", "state", "createdAt", "resolvedAt" } }`
- `403 Forbidden` — caller has no membership in `communityId`, OR caller is neither `buyerId` nor `sellerId`. Body: `{ "ok": false, "reason": "not_a_member" }` or `{ "ok": false, "reason": "not_a_party" }` respectively.
- `404 Not Found` — `transactionId` does not exist in `communityId`.

## Pages (browser-facing, not a JSON contract)

- `GET /communities/{communityId}/listings/{listingId}` (005-product-listings, extended): shows stock as "seller indicates N available" (FR-002) or "stock not specified" when `null`; shows a "Buy" action (calling the proposals route above) for any non-owner co-member, with the non-intermediary disclosure (FR-006) shown before submission. Owners see a stock field in their edit form (`ListingForm`) alongside price.
- `GET /communities/{communityId}/transactions` (existing page, evolved): the caller's own proposals across all states, each showing `state` and, for a `PENDING` row, an "Accept"/"Reject" action (seller) or a "Cancel" action (buyer).
- `GET /communities/{communityId}/transactions/{transactionId}` (existing page, evolved): one transaction's full detail, with the same state-appropriate actions as the list.

**Non-goals** (explicitly excluded, spec.md Assumptions): no payment-method selection; no seller counter-offer endpoint; no stock-reservation behavior for `PENDING` proposals; no notification (email/in-app) on any state change; no in-app payment execution endpoint (only `paymentPath`'s shape anticipates it, unchanged from 010 research.md #5).
