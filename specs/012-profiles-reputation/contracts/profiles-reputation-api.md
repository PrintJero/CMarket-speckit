# Contract: User Profiles and Reputation API

Two new routes, both under the existing per-community namespace. Every route requires an authenticated session (401 otherwise, matching every existing route in this app); the per-community routes additionally require current membership in `communityId` (403 `not_a_member` otherwise, matching 005/007/008/010's convention).

## GET /api/communities/{communityId}/members/{accountId}

Fetch one member's public profile as viewed from `communityId` (FR-001, FR-002).

**Responses**:

- `200 OK` — Body: `{ "ok": true, "profile": { "accountId": string, "displayName": string | null, "memberSince": string, "activeListings": [{ "id": string, "title": string, "kind": "FOR_SALE" | "WANTED", "priceCents": number | null, "coverPhotoId": string | null }], "confirmedTransactionCount": number, "averageRating": number | null, "reviewCount": number } }`. `memberSince` and `activeListings` are scoped to `communityId`; `confirmedTransactionCount`, `averageRating`, and `reviewCount` are global across every community the account belongs to (FR-008, FR-009, Clarifications) — the response carries no field, list, or breakdown that names or implies any other community (FR-011).
- `403 Forbidden` — caller has no current membership in `communityId`. Body: `{ "ok": false, "reason": "not_a_member" }`
- `404 Not Found` — `accountId` does not exist, or does not currently hold membership in `communityId` (research.md #1) — identical response either way, so a nonexistent account and a departed member are indistinguishable to the caller.

## POST /api/communities/{communityId}/transactions/{transactionId}/reviews

Leave a 1-5 rating for the other participant of a `CONFIRMED` transaction (FR-010, FR-012). The reviewed account is never accepted as input — it is always derived from the transaction (research.md #3).

**Body**: `{ "rating": number }`

**Responses**:

- `201 Created` — Body: `{ "ok": true, "review": { "id": string, "rating": number, "createdAt": string } }`
- `400 Bad Request` — `rating` is not an integer from 1 to 5. Body: `{ "ok": false, "reason": "invalid_rating" }`
- `403 Forbidden` — caller has no current membership in `communityId`. Body: `{ "ok": false, "reason": "not_a_member" }`
- `403 Forbidden` — caller is neither the transaction's `recorderId` nor its `counterpartId`. Body: `{ "ok": false, "reason": "not_a_participant" }`
- `404 Not Found` — `transactionId` does not exist in `communityId`.
- `409 Conflict` — the transaction's `confirmationState` is not `CONFIRMED`. Body: `{ "ok": false, "reason": "transaction_not_confirmed" }`
- `409 Conflict` — the derived reviewed account is not currently a member of `communityId`. Body: `{ "ok": false, "reason": "reviewed_not_a_member" }` — a distinct reason from the caller's own `not_a_member` (403) above, mirroring 010's `counterpart_not_a_member` precedent.
- `409 Conflict` — the caller has already left a rating for this transaction. Body: `{ "ok": false, "reason": "duplicate_review" }`

## Pages (browser-facing, not a JSON contract)

- `GET /communities/{communityId}/members/{accountId}` (new): the profile page — display name, member-since date, active listings, and the three reputation numbers, backed by the first route above. Rendered identically whether the viewer is looking at their own profile (FR-004) or someone else's.
- `GET /communities/{communityId}/transactions/{transactionId}` (extends 010's existing page): once `confirmationState` is `CONFIRMED`, shows a 1-5 rating control (backed by the second route above) for a caller who has not yet rated it, or their own already-submitted rating (read-only) if they have. The counterpart's display name becomes a link to the first route above.
- `GET /communities/{communityId}/transactions` (extends 010's existing page), `GET /communities/{communityId}/threads` and `GET /communities/{communityId}/threads/{threadId}` (extend 008's existing pages), `GET /communities/{communityId}/listings` and `GET /communities/{communityId}/listings/{listingId}` (extend 005/007's existing pages), and `GET /chats` (extends 008's existing amendment page): each already-rendered display name (a listing owner, a thread's counterpart or message sender, a transaction's counterpart) becomes a link to `GET /communities/{communityId}/members/{accountId}`, using an account id each page already has or gains via research.md #6's small result-shape widening (FR-005).

**Non-goals** (explicitly excluded, spec Out of Scope): no comment/free-text field on any route, request, or response (FR-021); no edit or delete endpoint for a review (FR-022); no list-of-individual-reviews endpoint or field — only the two aggregate numbers are ever returned (FR-010); no per-community reputation breakdown or "your rating in this community" field (FR-011); no badges, rankings, seller tiers, dispute-handling, or recommendation-algorithm endpoint (FR-028); no cross-community aggregated profile view — a profile is always fetched in the context of exactly one `communityId` (research.md #1, #5).
