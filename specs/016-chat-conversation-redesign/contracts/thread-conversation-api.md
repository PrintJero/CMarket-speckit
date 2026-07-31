# Contract: Chat Conversation UI Redesign

**This feature introduces zero new routes and changes zero existing route contracts.** It exists to document that fact explicitly, and to confirm the one route the redesigned page's composer calls.

## POST /api/communities/{communityId}/threads/{threadId}/messages

**Unchanged.** The redesigned composer (`ThreadReplyForm.tsx`, restyled only) submits to this exact existing route with the exact existing request shape.

**Body**: `{ "body": string }`

**Responses** (identical to the pre-existing contract):

- `201 Created` — Body: `{ "ok": true, "message": { "id": string, "body": string, "createdAt": string } }`
- `400 Bad Request` — `body` is empty or exceeds the existing length limit. Body: `{ "ok": false, "reason": "invalid_message" }`
- `403 Forbidden` — caller has no current membership in `communityId`, or is not a participant of this thread. Body: `{ "ok": false, "reason": "not_a_member" | "not_a_participant" }`
- `404 Not Found` — `threadId` does not exist in `communityId`.
- `409 Conflict` — the caller has no display name set yet (`display_name_required`) or another existing conflict reason.

## Pages (browser-facing, not a JSON contract)

- `GET /communities/{communityId}/threads/{threadId}` (rewritten): the redesigned conversation panel — header (counterpart display name linking to their existing public profile, listing title when available), the message list rendered as right/left-aligned bubbles, an empty state when the thread has no messages yet, and the composer. Backed by the exact same `getThread()` call the page already made before this feature. No new query parameter, no new route segment.
- `GET /chats` and `GET /communities/{communityId}/threads` (both **unchanged**): continue to link into the route above exactly as before — neither embeds any thread-conversation markup itself, so neither requires any change for this feature.

**Non-goals** (explicitly excluded, spec.md Out of Scope): no new endpoint for reading a thread (the page still calls `getThread()` directly, as today); no message-edit or message-delete endpoint; no read-receipt, typing-indicator, reaction, attachment, or presence endpoint of any kind; no pagination parameter added to the existing read path.
