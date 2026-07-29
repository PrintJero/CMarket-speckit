# Contract: Transaction Logging API

Four new routes, all under the existing per-community namespace. Every route requires an authenticated session (401 otherwise, matching every existing route in this app); the per-community routes additionally require current membership in `communityId` (403 `not_a_member` otherwise, matching 005/007/008's convention).

## POST /api/communities/{communityId}/threads/{threadId}/transaction

Record a transaction, derived entirely from `threadId` — the counterpart and listing are never accepted as separate fields (research.md #2, FR-001).

**Body**: none.

**Responses**:

- `201 Created` — Body: `{ "ok": true, "transaction": { "id": string, "counterpartDisplayName": string | null, "listingTitle": string, "paymentPath": "OFF_PLATFORM", "confirmationState": "UNCONFIRMED", "createdAt": string } }`
- `403 Forbidden` — caller has no membership in `communityId`. Body: `{ "ok": false, "reason": "not_a_member" }`
- `403 Forbidden` — caller is neither the thread's buyer nor its listing's owner. Body: `{ "ok": false, "reason": "not_a_participant" }`
- `404 Not Found` — `threadId` does not exist in `communityId` (or predates a community restoration — data-model.md gate 1).
- `409 Conflict` — the community is not `ACTIVE` (research.md #4). Body: `{ "ok": false, "reason": "community_not_active" }`
- `409 Conflict` — the derived counterpart is not currently a member of `communityId` (FR-002). Body: `{ "ok": false, "reason": "counterpart_not_a_member" }` — a distinct reason from the caller's own `not_a_member` (403) above, since the two require different status codes.

## POST /api/communities/{communityId}/transactions/{transactionId}/confirm

Confirm a transaction. Only the transaction's `counterpartId` may call this (FR-005).

**Body**: none.

**Responses**:

- `200 OK` — Body: `{ "ok": true, "transaction": { "id": string, "confirmationState": "CONFIRMED", "confirmedAt": string } }`. Returned identically whether this call performed the transition or the transaction was already `CONFIRMED` (idempotent, data-model.md gate 4).
- `403 Forbidden` — caller has no membership in `communityId`. Body: `{ "ok": false, "reason": "not_a_member" }`
- `403 Forbidden` — caller is not this transaction's `counterpartId`. Body: `{ "ok": false, "reason": "not_a_counterpart" }`
- `404 Not Found` — `transactionId` does not exist in `communityId`.

## GET /api/communities/{communityId}/transactions

List every transaction log in `communityId` where the caller is either the `recorderId` or the `counterpartId` (FR-016).

**Responses**:

- `200 OK` — Body: `{ "ok": true, "transactions": [{ "id", "role": "recorder" | "counterpart", "counterpartDisplayName", "listingTitle", "paymentPath", "confirmationState", "createdAt", "confirmedAt" }] }`, ordered by `createdAt` descending. `role` is derived at render time from the caller's relationship to the row (mirrors 008's `role: "owner" | "buyer"` on `listMyThreads()`), never stored.
- `403 Forbidden` — caller has no membership in `communityId`. Body: `{ "ok": false, "reason": "not_a_member" }`

## GET /api/communities/{communityId}/transactions/{transactionId}

Fetch one transaction log's full detail (FR-016, FR-017 — remains reachable even after its source thread/listing no longer exist).

**Responses**:

- `200 OK` — Body: `{ "ok": true, "transaction": { "id", "role", "counterpartDisplayName", "listingTitle", "paymentPath", "confirmationState", "createdAt", "confirmedAt" } }`
- `403 Forbidden` — caller has no membership in `communityId`, OR caller is neither this transaction's `recorderId` nor its `counterpartId`. Body: `{ "ok": false, "reason": "not_a_member" }` or `{ "ok": false, "reason": "not_a_party" }` respectively.
- `404 Not Found` — `transactionId` does not exist in `communityId`.

## Pages (browser-facing, not a JSON contract)

- `GET /communities/{communityId}/threads/{threadId}` (extends 008's existing thread page): shows the non-intermediary disclosure (FR-014) and, for a participant with no existing log on this thread, a "Record transaction" action calling the first route above. Once one or more logs exist on this thread, their state is shown inline, with a "Confirm" action (also showing the disclosure, FR-014) for the named counterpart only.
- `GET /communities/{communityId}/transactions` (new): the caller's own log history in this community, backed by the third route above — this is how a log stays traceable (FR-016) after its source thread is gone (FR-017).
- `GET /communities/{communityId}/transactions/{transactionId}` (new): one log's full detail, backed by the fourth route above, with a "Confirm" action for the named counterpart when still `UNCONFIRMED`.

**Non-goals** (explicitly excluded, spec Out of Scope): no amount field on any route, request, or response; no edit or dispute/appeal endpoint for a transaction; no listing-status side effect of any kind; no in-app payment execution endpoint (only the `paymentPath` field's shape anticipates it, research.md #5); no cross-community aggregated view (research.md #7).
