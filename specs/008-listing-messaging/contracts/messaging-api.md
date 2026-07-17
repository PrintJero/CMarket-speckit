# Contract: Listing Messaging API

Four new routes, all under the existing per-community namespace, plus two new cross-community routes added by the 2026-07-17 amendment (Thread & Listing Navigability). Every route requires an authenticated session (401 otherwise, matching every existing route in this app); the per-community routes additionally require current membership in `communityId` (403 `not_a_member` otherwise, matching 005/007's convention) — the two cross-community routes have no single `communityId` to check against, since they scope internally by the caller's own current memberships (see below).

## POST /api/communities/{communityId}/listings/{listingId}/messages

Send a message from the caller (as buyer) to `listingId`'s owner — creates the thread on the caller's first message, or appends to the existing one on any later message (FR-001, FR-002).

**Body**: `{ "body": string }`

**Responses**:

- `201 Created` (first message — thread created) or `200 OK` (subsequent message — existing thread) — Body: `{ "ok": true, "thread": { "id": string }, "message": { "id": string, "body": string, "createdAt": string }, "threadCreated": boolean }` (`threadCreated` distinguishes the 201-vs-200 cases for a caller inspecting the body directly, not just the status code)
- `400 Bad Request` — `body` is empty/whitespace-only or exceeds 2,000 characters. Body: `{ "ok": false, "reason": "invalid_message" }`
- `403 Forbidden` — caller has no membership in `communityId`. Body: `{ "ok": false, "reason": "not_a_member" }`
- `403 Forbidden` — caller is `listingId`'s own owner (FR-013). Body: `{ "ok": false, "reason": "cannot_message_own_listing" }`
- `404 Not Found` — `listingId` does not exist in `communityId`.
- `409 Conflict` — no thread exists yet and `listingId` is `PAUSED` (FR-016). Body: `{ "ok": false, "reason": "listing_paused" }`
- `409 Conflict` — caller has no `displayName` set (FR-010). Body: `{ "ok": false, "reason": "display_name_required" }`

## GET /api/communities/{communityId}/threads

List every thread in `communityId` where the caller is either the thread's buyer or that thread's listing's owner (FR-005, FR-006, FR-008).

**Query parameters** (optional):

| Param | Type | Notes |
| --- | --- | --- |
| `listingId` *(amendment)* | identifier | Narrows the result to threads on this one listing only (My listings, FR-022, links here with `listingId` set). Omitted → every thread in the community, unchanged. |

**Responses**:

- `200 OK` — Body: `{ "ok": true, "threads": [{ "id", "listingId", "listingTitle", "counterpartDisplayName", "lastMessageAt", "lastMessagePreview" }] }`, ordered by `lastMessageAt` descending (database `orderBy`, amendment).
- `403 Forbidden` — caller has no membership in `communityId`. Body: `{ "ok": false, "reason": "not_a_member" }`

## GET /api/communities/{communityId}/threads/{threadId}

Fetch one thread and its full, ordered message history (FR-003, FR-004).

**Responses**:

- `200 OK` — Body: `{ "ok": true, "thread": { "id", "listingId", "listingTitle" }, "messages": [{ "id", "senderId", "senderDisplayName", "body", "createdAt" }] }`, `messages` ordered oldest-first.
- `403 Forbidden` — caller has no membership in `communityId`, OR caller is neither the thread's buyer nor its listing's owner (FR-007, FR-009). Body: `{ "ok": false, "reason": "not_a_member" }` or `{ "ok": false, "reason": "not_a_participant" }` respectively.
- `404 Not Found` — `threadId` does not exist in `communityId`.

## POST /api/communities/{communityId}/threads/{threadId}/messages

Reply within an existing thread, from either the buyer or the listing's owner (FR-003).

**Body**: `{ "body": string }`

**Responses**:

- `201 Created` — Body: `{ "ok": true, "message": { "id": string, "body": string, "createdAt": string } }`
- `400 Bad Request` — invalid `body`. Body: `{ "ok": false, "reason": "invalid_message" }`
- `403 Forbidden` — caller has no membership in `communityId`, OR caller is neither the thread's buyer nor its listing's owner. Body: `{ "ok": false, "reason": "not_a_member" }` or `{ "ok": false, "reason": "not_a_participant" }` respectively.
- `404 Not Found` — `threadId` does not exist in `communityId`.
- `409 Conflict` — caller has no `displayName` set. Body: `{ "ok": false, "reason": "display_name_required" }`

**Note**: no PAUSED-listing check here — replying in an existing thread is unaffected by the listing's current status (FR-016, research.md #4).

## GET /api/chats *(new, 2026-07-17 amendment)*

List every thread the caller currently participates in — as a listing's owner or as a thread's buyer — across every community the caller currently belongs to (FR-017–FR-020). Cross-community: scoped entirely by the caller's own current `Membership` rows, resolved inside the same request, never by a caller-supplied community list.

**Responses**:

- `200 OK` — Body: `{ "ok": true, "threads": [{ "id", "communityId", "communityName", "listingId", "listingTitle", "role": "owner" | "buyer", "counterpartDisplayName", "lastMessageAt", "lastMessagePreview" }] }`, ordered by `lastMessageAt` descending (database `orderBy`). An account with no threads gets `{ "ok": true, "threads": [] }`, never an error.

## GET /api/my-listings *(new, 2026-07-17 amendment)*

List every listing the caller owns, in any status, across every community the caller currently belongs to, each with a count of its threads (FR-021–FR-022). Cross-community, scoped the same way as `/api/chats`.

**Responses**:

- `200 OK` — Body: `{ "ok": true, "listings": [{ "id", "communityId", "communityName", "title", "status": "ACTIVE" | "PAUSED", "threadCount": number }] }`. An account with no owned listings gets `{ "ok": true, "listings": [] }`, never an error.

## Pages (browser-facing, not a JSON contract)

- `GET /communities/{communityId}/listings/{listingId}` (extends the existing listing detail page): for a non-owner viewer, adds a message composer that posts to the first route above, then navigates to the resulting thread page.
- `GET /communities/{communityId}/threads` (extended, amendment): the caller's inbox for this community — every thread they're a participant in, per the second route above, optionally narrowed with `?listingId=`.
- `GET /communities/{communityId}/threads/{threadId}` (new): one thread's full history plus a reply composer, backed by the third and fourth routes above.
- `GET /chats` *(new, amendment)*: cross-community Chats view, grouped by community for rendering, backed by `GET /api/chats`. Reachable in one step from `AppShell`'s sidebar on every authenticated screen.
- `GET /my-listings` *(new, amendment)*: cross-community My listings view, backed by `GET /api/my-listings`. Reachable in one step from `AppShell`'s sidebar on every authenticated screen.

**Non-goals** (explicitly excluded, spec Out of Scope): no attachment/photo upload on any message route; no edit or delete endpoint for a message; no read-receipt or typing-indicator endpoint; no WebSocket/SSE/polling endpoint — message visibility is exclusively a side effect of calling the `GET` routes above. Chats and My listings additionally exclude (spec.md Assumptions, amendment): unread counts, badges, and notifications — reachability only.
