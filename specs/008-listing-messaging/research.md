# Research: Listing Messaging

## #1 Community scoping without a denormalized `communityId`

**Decision**: `MessageThread` stores `listingId` and `buyerId` only — no `communityId` column of its own. Every query that must be scoped by community (FR-008) filters through the `listing` relation (`where: { listing: { communityId } }`), and every access check joins to `listing.ownerId`/`listing.communityId` to resolve the counterpart and the scope in the same query.

**Rationale**: A listing's community is fixed for its entire lifetime (005-product-listings: "never reassignable to another"), so a thread's community can never drift from its listing's community — there is nothing to keep in sync by denormalizing. This mirrors the existing `ListingPhoto` precedent in this codebase, which also has no `communityId` of its own and is scoped by joining through `listing` (`getListingPhoto()` checks `photo.listing.communityId !== communityId`), rather than the `Listing` model's own precedent of storing `communityId` directly (which exists because `Listing.communityId` is itself the tenancy-defining foreign key, not a copy of one). Fewer columns, one less thing a migration could get out of sync (Principle VII).

**Alternatives considered**: Denormalizing `communityId` onto `MessageThread` for a simpler index/query shape — rejected as unnecessary duplication of data already reachable in one join, with no correctness or performance need at this feature's scale (no stated volume requirement, Success Criteria have no throughput target).

## #2 Thread identity and reuse

**Decision**: `@@unique([listingId, buyerId])` on `MessageThread`. "Send a message to this listing's owner" is implemented as find-or-create-then-append: look up the unique `(listingId, buyerId)` row; if absent, create it (subject to the gates below) in the same operation that creates the first `Message`.

**Rationale**: Directly satisfies FR-002 ("exactly one thread per (listing, buyer) pair... reuse the existing thread rather than create a new one") as a database constraint, not just application logic — a duplicate insert is rejected by Postgres itself, not merely avoided by a prior `findFirst`.

**Alternatives considered**: Application-level "check then create" without a unique constraint — leaves a race window (two rapid first-messages from the same buyer could create two threads); rejected in favor of letting the database enforce the invariant it is best positioned to enforce.

## #3 Per-actor membership checks, not per-pair

**Decision**: Every thread/message action (send, reply, view) checks only the *acting* caller's current membership in the thread's community via the existing `requireCommunityMembership()` (005-product-listings). It does not additionally check the *other* participant's membership at the moment of the action.

**Rationale**: FR-009 is phrased per-account ("An account that loses its current membership... MUST immediately lose access... for as long as it lacks that membership") — it governs what the departed account can do, not what the remaining member can do. User Story 4's second acceptance scenario confirms this reading: the still-current owner keeps full access to the thread and its prior messages after the buyer's membership lapses. Checking both participants on every send would add a second membership query with no requirement driving it (Principle VII) and would produce a stranger UX: a still-member owner silently unable to reply just because their counterpart happened to leave.

**Alternatives considered**: Checking both participants' membership on every send, so a message is refused if the recipient can't currently read it — rejected as unrequested scope; the spec never asks for delivery guarantees, only that the departed member loses their own access.

## #4 PAUSED-listing gate applies only to thread creation

**Decision**: `status === "ACTIVE"` is checked only in the find-or-create path (when no `(listingId, buyerId)` thread yet exists). Replying in an already-existing thread never re-checks listing status.

**Rationale**: Directly encodes the 2026-07-17 clarification: pausing (007-listing-discovery) only removes a listing from discovery surfaces; it does not touch any relationship — like an open conversation — that already exists independent of discoverability.

**Alternatives considered**: Freezing all messaging (existing and new) on a PAUSED listing — rejected by the clarification. Allowing new threads on PAUSED listings too — rejected by the clarification; a buyer who never had a prior conversation has no way to reach that listing through discovery anyway (007-listing-discovery FR-002), so a directly-guessed/bookmarked URL shouldn't be able to open a new one either.

## #5 Message validation and the display-name gate share one enforcement point

**Decision**: A single internal function creates a `Message` row: it trims and length-checks the body (reject empty/whitespace-only, reject over 2,000 characters — FR-012) and checks the sender's `displayName` is set (FR-010) before any insert. Both public entry points — first-message-to-owner and reply-in-thread — call this one function; neither duplicates the checks.

**Rationale**: Mirrors this codebase's own established pattern and rationale from 006-user-display-names (FR-008's note: "the same guarantee cannot be satisfied by client-side prompting alone... enforced at whatever single point actually creates" the record) and 005's `createListing()`, which checks `displayName` server-side at the one function that actually inserts. A thread with an unnamed participant is explicitly called out as "useless" in this feature's own description — enforcing it once, low in the stack, is what makes the guarantee real regardless of which route calls in.

**Alternatives considered**: Checking body validity/display-name at the two API route handlers separately — rejected as exactly the duplicated-enforcement gap 006-user-display-names' own plan already flagged as a known anti-pattern in this codebase (a prior gap where "a listing mutation's authorization lived only in the page, not the underlying capability").

## #6 No administrator access path

**Decision**: `messageService.ts` never imports or calls `requireCommunityAdministrator()` (unlike `listingService.ts`'s `pauseListing`/`reactivateListing`). Every read and write checks only "is this account the listing's owner or this thread's buyer" plus current membership — administrators get no special case.

**Rationale**: Directly encodes the 2026-07-17 clarification. Message content is exactly the kind of personal exchange Principle VI gates behind mutual agreement between the two parties themselves — Principle III's administrator authority is scoped to listings and membership (invite, remove, moderate listing visibility), and neither the constitution nor this feature's description extends it to conversation content.

**Alternatives considered**: Admin read access for moderation, or a report/flag-triggered access path — both considered and rejected during clarification in favor of zero special access, the simplest option consistent with Principle VI.

## #7 No real-time delivery, no new dependency

**Decision**: Messages become visible only on page load/reload — a plain server-rendered read on navigation, or a client re-fetch the user triggers (e.g., revisiting the thread page). No WebSocket, Server-Sent Events, or polling loop is introduced.

**Rationale**: Directly required by FR-014 and the spec's explicit constraint ("No new dependencies, no new services. Postgres and what already exists is enough."). This keeps the feature inside the existing request/response Next.js App Router model with zero new runtime dependency, satisfying Principle VII and the stack constraint.

**Alternatives considered**: Polling via `setInterval` re-fetch on the open thread page — technically dependency-free, but adds unrequested complexity (background timers, cleanup on unmount) for a requirement the spec explicitly excludes. Not pursued.

## #8 Inbox is scoped to one community at a time

**Decision**: The "every thread I'm party to" view (`listThreads()`) takes a `communityId` and returns only threads whose listing belongs to that community, where the caller is either that listing's owner or the thread's buyer. There is no cross-community aggregated inbox.

**Rationale**: FR-008 requires every thread/message query to be scoped by community in the query itself; a cross-community view would either require iterating every community the caller belongs to (still one scoped query per community, just called in a loop) or a query with no community boundary at all, which Principle II forbids outright. This also mirrors 007-listing-discovery's own precedent of one-community-at-a-time browsing (`research.md #1` there: "one community's own listing set at a time").

**Alternatives considered**: A single global inbox route that internally loops over the caller's communities — rejected as premature aggregation the spec never asked for (User Story 2 only requires the owner to see "every thread across all of their listings," which this feature's per-community listings page already scopes to, exactly as every other listing view in this app does).

## #9 No pagination in this iteration

**Decision**: Both `listThreads()` (thread list) and `getThread()` (message history within one thread) return their full result set, unpaginated, ordered by recency.

**Rationale**: No scale requirement is stated anywhere in the spec (no Success Criteria mentions volume), and 005-product-listings' own `listListings()` shipped unpaginated first, adding pagination only once 007-listing-discovery's actual need for it was identified. The same "simplest thing that satisfies today's scale" reasoning applies here (Principle VII); this can be revisited the same way 007 revisited 005 if a real need appears.

**Alternatives considered**: Building pagination into this feature preemptively — rejected as speculative scope with no requirement driving it (Principle VII, "unrequested configurability... MUST NOT be built alongside the requested feature").
