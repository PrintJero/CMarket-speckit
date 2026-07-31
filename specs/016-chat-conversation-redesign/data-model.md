# Data Model: Chat Conversation UI Redesign

No new entity, no new column, no migration. Almost every field below is already returned by the existing `getThread()` (008-listing-messaging, `src/server/services/messageService.ts`); the one exception (research.md #6) is two fields it already computes the ingredients for internally but doesn't yet return. This document describes how the redesigned conversation panel derives its presentation from that same, already-authorized data.

## Reused, unmodified

- **`MessageThread`** (Prisma model, `prisma/schema.prisma`): `id`, `listingId`, `buyerId`, `createdAt`, `lastMessageAt`, `operationalEpoch`. No field added, no field removed.
- **`Message`** (Prisma model): `id`, `threadId`, `senderId`, `body`, `createdAt`. Append-only, as today — this feature adds no edit/delete capability (out of scope).
- **`getThread({ communityId, threadId, callerAccountId })`**: same input, same authorization gate (`not_a_member` / `not_found` / `not_a_participant`), unchanged. Its success response gains two fields on the existing `thread` object — `thread: { id, listingId, listingTitle, counterpartId, counterpartDisplayName }` — computed with the identical `isOwner ? thread.buyerId : thread.listing.ownerId` (and matching display name) derivation its sibling functions `listThreads()`/`listMyThreads()` already use in the same file (research.md #6). `messages: [{ id, senderId, senderDisplayName, body, createdAt }]` is unchanged.
- **`sendThreadMessage()` / `sendMessageToListingOwner()`**: unchanged. Still the only functions that create a `Message` row; still reached only through the one existing `POST /api/communities/{communityId}/threads/{threadId}/messages` route.
- **`resolveDisplayName(displayName)`**: unchanged. Still the single source of the neutral placeholder shown whenever a display name is absent — never the account's email.

## Conversation View *(conceptual, derived — not stored, not a new model)*

The redesigned page assembles this shape entirely from the reused data above, per thread:

| Field | Derivation | Notes |
| --- | --- | --- |
| `counterpartDisplayName` | `resolveDisplayName(thread.counterpartDisplayName)` | Read directly from `getThread()`'s (extended) `thread` object — not derived from scanning messages, since a thread where the caller has sent every message so far would have no counterpart-authored message to read it from (research.md #6). |
| `listingTitle` | `thread.listingTitle` | Shown in the header when present; omitted (not shown as an error) when a listing is no longer available, per FR-004. |
| `messages[].isOwnMessage` | `message.senderId === callerAccountId` | The single new comparison this feature introduces — a boolean, computed at render time, never stored. Determines right alignment (`true`) vs. left alignment (`false`), FR-007–FR-009. |
| `messages[].timestamp` | `message.createdAt`, formatted for display | Same underlying value already available today; only its visual treatment changes (smaller, lighter — FR-016). |
| `messages[].body` | `message.body`, unmodified | FR-015: displayed exactly as stored, never altered. |
| `isEmpty` | `messages.length === 0` | Drives the "Start the conversation" empty state (FR-024) in place of the message list. |

**No per-message sender-name field is used in the redesigned rendering** (research.md #2) — `senderDisplayName` remains present in `getThread()`'s response (unchanged contract) but the page only consumes it once, to resolve `counterpartDisplayName` for the header; it is not rendered per-message anymore.

## Access and mutation rules (unchanged)

Both are enforced by the exact same, untouched functions this feature calls:

1. **Reading a thread** — `getThread()`'s existing gate: caller must currently hold membership in `communityId` (`allowSuspended: true`, unchanged); the thread must belong to that community; the caller must be either the thread's buyer or the listing's owner. Identical to today.
2. **Sending a message** — `sendThreadMessage()`'s existing gate: same membership check, same participant check, same message-body validation (non-empty, within length limit), same display-name-required check for a caller with no display name yet. Identical to today; this feature's composer submits to the identical endpoint with the identical request body (`{ body: string }`).

No new gate, no new validation, no new state transition is introduced anywhere by this feature.
