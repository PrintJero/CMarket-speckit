# Phase 0 Research: Chat Conversation UI Redesign

No item in Technical Context was left as NEEDS CLARIFICATION. This document records the design decisions this feature required, and the direct codebase inspection (mirrored by an independent research pass) that grounds each one.

## 1. Message ownership needs no new data — `getThread()` already returns it

**Decision**: Right/left alignment is computed purely by comparing `message.senderId` (already returned by `getThread()`, `src/server/services/messageService.ts`) to the signed-in caller's own account id (already available to the page via `getCurrentAccount()`). No new field, model, or migration.

**Rationale**: Direct inspection of `getThread()` confirms its `messages` array is already shaped `{ id, senderId, senderDisplayName, body, createdAt }`, ordered ascending by `createdAt`. The current thread page (`app/communities/[communityId]/threads/[threadId]/page.tsx`) already receives `senderId` per message but simply never compares it to anything — every message renders identically today. The comparison this feature needs is a single expression evaluated while mapping over an array the page already has.

**Alternatives considered**: None — there is no reasonable alternative that would require new storage for a fact (who sent this message) the system already tracks and already returns.

## 2. Remove the per-message sender-name link; the header carries the one profile link instead

**Decision**: The existing per-message header line (`{displayName} · {timestamp}`, with the display name as a link to that sender's profile) is removed from each message. The chat header carries the *only* clickable link to the counterpart's profile; each message bubble shows only its timestamp.

**Rationale**: Today, *every* message — including the signed-in account's own — shows a clickable link to its sender's profile, which is redundant with alignment once alignment exists (you already know a right-aligned message is yours) and is exactly the "list of text entries" feel the source request wants replaced (the source request's own example transcript shows no per-message names at all, only bubbles and timestamps). This does not remove any capability: FR-005 still requires the counterpart's name to be clickable, satisfied by the header. `tests/integration/test_profile_view.spec.ts`'s existing check (`page.getByRole("link", { name: "Profile Owner" }).first().click()`) does not depend on *where* that link lives on the page — only that a link named after the counterpart exists and navigates correctly — so it continues to pass once the header is that link's sole remaining location.

**Alternatives considered**: Keep the per-message link only on the counterpart's messages (not the caller's own). Rejected: still redundant once alignment exists, adds visual noise the source request explicitly avoids in its own example, and the header link alone already satisfies every stated requirement (FR-003, FR-005).

## 3. A bottom-attached composer inside a scrolling panel is a new layout shape for this codebase

**Decision**: Build the panel as a flex column — header row, then a `flex-1 overflow-y-auto` message area, then the composer row — rather than adapting any existing pattern, since none matches.

**Rationale**: Direct inspection of `app/_components/AppShell.tsx`, `Card.tsx`, and a codebase-wide search for `sticky`/`fixed`/bottom-anchored patterns found none resembling an in-page, bottom-attached composer. The only existing "fixed" pattern is `RatingModal.tsx`'s full-viewport centered overlay (a modal, not an in-flow panel) and `AppShell`'s own mobile slide-in drawer (an unrelated navigation concern). This feature reuses the *visual vocabulary* already established (`rounded-card`, `shadow-card` on the panel itself; the existing pill-shaped `Button`/`FormField` input styling for the composer's send action and text entry) without borrowing layout structure from either precedent, since neither shape fits.

**Alternatives considered**: A viewport-fixed (`position: fixed`) composer, independent of the panel's own scroll container. Rejected: the source request scopes the redesign to "the main content area" (i.e., inside `AppShell`'s existing content region, which itself scrolls on mobile) — a viewport-fixed composer would fight that existing scroll container and complicate the mobile drawer's own fixed-position elements for no benefit over a simple flex-column panel where the composer is simply the last flex child.

## 4. Scroll-to-latest: one small client component wrapping a server-rendered list

**Decision**: A single new client component (`ChatScrollArea.tsx`) receives the server-rendered message bubbles as `children` plus the current message count as a plain number prop. It renders a scrollable container with an empty "bottom sentinel" element after the children, and runs one `useEffect` keyed on the message-count prop that scrolls the sentinel into view. No other client-side state.

**Rationale**: The message list itself has no interactivity and should stay a Server Component, consistent with this codebase's default (nearly every page in this project is a Server Component; client components exist only where a browser-only concern — like this one — genuinely requires them, e.g. `AppShell.tsx`'s own isolated effect for an unrelated deep-link concern). Keying the effect on message *count* (not the array reference) means it fires exactly once on first mount (positions at the latest message on open, FR-019) and again exactly when a new message arrives after `router.refresh()` re-renders the page with one more message than before (FR-020) — it does not fire on unrelated re-renders that don't change the count.

**Alternatives considered**: A pure-CSS `flex-direction: column-reverse` trick (common in some chat UIs to keep the scroll position pinned to the bottom without JavaScript). Rejected: it would require reversing the DOM order of already-chronologically-ordered messages (fighting FR-012's chronological-order requirement conceptually, even if visually compensated), complicates screen-reader reading order, and is harder to reason about and test via Playwright than an explicit, inspectable scroll effect — this codebase already favors explicit React effects for client-only concerns (research.md's own AppShell precedent) over CSS-only tricks for behavior.

## 5. No pagination is introduced

**Decision**: `getThread()` continues to load a thread's entire message history in one unpaginated call, exactly as it does today.

**Rationale**: The source request's Success Criteria only require long conversations to scroll correctly, not to load incrementally — introducing pagination would be new scope beyond a visual redesign, and this codebase's existing per-thread reads are already unpaginated (mirrors `listMyThreads()`'s and `listMyListings()`'s own documented "unpaginated" precedent elsewhere in this project).

**Alternatives considered**: Cursor-based pagination loading older messages on scroll-up. Rejected as out of scope — the source request never asks for it, and Principle VII (Simplicity & MVP-First) counsels against adding it speculatively.

## 6. `getThread()` needs one small, precedented extension — the counterpart's identity is not always derivable from message senders

**Decision**: Extend `getThread()`'s `thread` result object with `counterpartId` and `counterpartDisplayName`, computed exactly the way `listThreads()`/`listMyThreads()` (both in the same file) already compute the identical fields (`isOwner ? thread.buyerId : thread.listing.ownerId`, and the matching display name). This requires adding one `owner: { select: { displayName: true } }` sub-select under the listing include, and one sibling `buyer: { select: { displayName: true } }` include on the thread query — both of which `listThreads()`/`listMyThreads()` already use, just not yet wired into `getThread()`.

**Rationale**: The header (FR-003, FR-005) must reliably show *the other participant's* identity. Deriving it by scanning `messages[].senderId` for one that isn't the caller's own id — the only data `getThread()` currently exposes — fails whenever the caller has sent every message so far and the other party hasn't replied yet (an entirely normal, common state for a fresh conversation, not just the theoretical zero-message case). Direct inspection of `getThread()` shows it already fetches `thread.buyerId` and `thread.listing.ownerId` internally (both are already selected/included to check thread participation) — it simply never returns them. This exact "expose an id the function already computed internally" move was already made for this same file's list-returning functions, `listThreads()`/`listMyThreads()`, when 012-profiles-reputation needed a `counterpartId` on those responses too — `getThread()` is simply the one function in this file that was never given the same treatment, because until this feature nothing on the single-thread detail page needed a *thread-level* counterpart identity (only a *per-message* sender identity, which it already had). This is a data-shape addition to an already-existing, already-authorized function's response — not a new service, not a new API route, not a schema/migration change — and is "absolutely required for rendering existing information" in the sense the source request itself anticipates (the information already exists and is already computed elsewhere in this same file; this feature only asks for it to also be returned here).

**Alternatives considered**:
- Deriving the counterpart from the messages array alone. Rejected — provably unreliable (see Rationale), would leave the header blank for any thread where only one side has spoken so far.
- Adding a second call to `listThreads()`/`listMyThreads()` from the page just to obtain the counterpart's identity, leaving `getThread()` itself untouched. Rejected — an extra service call and an extra scan to find "the one thread we already fetched" is more code, not less, than adding the two already-computed-elsewhere fields directly to the response the page already receives; it would also require `listThreads()`'s community-scoped list, an unnecessary broader query for one thread's data.

## 7. Visual style for sent vs. received bubbles

**Decision**: The signed-in account's own (right-aligned) bubbles use the existing brand-tint background with brand-dark or ink text; the counterpart's (left-aligned) bubbles use the existing neutral surface background with a hairline border, matching the same color tokens (`brand`, `brand-tint`, `surface`, `border`, `ink`, `ink-muted`) already defined for the rest of the application — no new color is introduced. Both use the existing `rounded-card` radius family (scaled down for a message bubble) rather than a new corner-radius token.

**Rationale**: Direct inspection of `app/globals.css` confirms all design tokens live in one Tailwind v4 `@theme` block, with no dark-mode handling and a single light theme throughout; `brand-tint` already exists specifically as the softer/lighter variant of the brand color, already used elsewhere in the app (e.g., the active-nav-item highlight in `AppShell.tsx`) for "this is the emphasized/selected one" meaning — a natural fit for "these are your own messages."

**Alternatives considered**: Introducing a dedicated new pair of "sent"/"received" color tokens. Rejected — Principle VII favors reusing the four or five tokens already carrying the right meaning over growing the design-token surface for a single feature.
