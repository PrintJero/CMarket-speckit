# Feature Specification: Listing Messaging

**Feature Branch**: `008-listing-messaging`

**Created**: 2026-07-17

**Status**: Draft

**Input**: User description: "Messaging within a community. A member can message a listing's owner from that listing. A thread opens between those two people, tied to that product. Text only. Why: today someone sees a product and has no way to ask anything about it. Without this, there is no transaction. Scope: One thread per (listing, interested buyer). The owner sees every thread on their listings; a buyer sees only their own. Text only, one message at a time. Each message shows who wrote it (the display name from spec 006) and when. Both people MUST hold a current membership in that listing's community. If someone loses their membership, they lose access to that community's threads. An account with no display name MUST choose one before sending its first message, exactly as it must before creating its first listing (spec 006, FR-008). A thread where nobody has a name is useless. Never show anyone's email, phone, or any contact data (Principle VI). Display name only. Messages load when the page loads. No real-time delivery. Out of scope: attachments, photos, reactions, editing or deleting messages, notifications, read receipts, typing indicators, threads not attached to a listing, and real-time. Constraints: Every query is scoped by community in the database query itself, and the caller MUST hold a current membership there (Principle II). No new dependencies, no new services. Postgres and what already exists is enough. If a listing is deleted, decide and state what happens to its threads."

## Clarifications

### Session 2026-07-17

- Q: Can messaging happen on a PAUSED listing (per 007-listing-discovery, PAUSED listings never appear in feeds/search)? → A: Existing threads on a PAUSED listing stay open — both people can keep exchanging messages — but a new thread cannot be started against a PAUSED listing.
- Q: Do community administrators (moderation authority, Principle III) have any way to view message thread contents in their community? → A: No — administrators have no access to thread contents at all, same as any other non-participant member.
- Q: What is the maximum length of a single message? → A: 2,000 characters.

### Session 2026-07-17 (amendment — thread & listing navigability)

- Q: The original feature shipped threads and an inbox page, but nothing links to either — the only path to a thread is the listing page it started from, and a buyer's only way back is to send another message. Does this amendment introduce a new shared layout so navigation persists across pages, or does it live on the signed-in home only? → A: No new layout is introduced. `AppShell` (`app/_components/AppShell.tsx`) already is the app's one persistent, authenticated navigation shell — every existing screen (home, community pages, account, admin) already renders it. This amendment extends `AppShell`'s existing sidebar with two new links, "Chats" and "My listings," which makes both reachable from every authenticated screen, not the home page alone.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A buyer asks the owner about a listing (Priority: P1)

A member browsing a community's listings finds one they're interested in and wants to ask the owner something about it. From the listing, they send a message, which opens a thread between just the two of them, tied to that listing. The owner can reply, and the two can go back and forth.

**Why this priority**: This is the entire point of the feature. Today a listing is a dead end — there is no way to ask anything about it, and without a way to start a conversation there is no path to a transaction at all.

**Independent Test**: Can be fully tested by having a member open a listing that isn't their own, send a message, and confirming the listing's owner sees the new thread with that message and can reply, with both people seeing the full back-and-forth in order.

**Acceptance Scenarios**:

1. **Given** a listing owned by another member of the same community, **When** the viewing member sends a message from that listing, **Then** a thread is created between the two of them tied to that listing, and the message appears in it.
2. **Given** an existing thread between a buyer and a listing's owner, **When** either person sends another message, **Then** the message is added to the same thread in order, showing who sent it and when.
3. **Given** a buyer who already has an open thread with a listing's owner, **When** that buyer sends the owner another message from the same listing, **Then** it is added to the existing thread — a second thread is not created.

---

### User Story 2 - Everyone sees only the threads they belong to (Priority: P1)

A listing owner has one inbox view showing every thread across all of their listings, so they never miss a buyer inquiry. A buyer sees only the threads they personally started — never another buyer's conversation about the same listing, and never a conversation happening on someone else's listing.

**Why this priority**: Without correct scoping, the feature either leaks one buyer's conversation to another (a privacy failure) or forces an owner to hunt listing-by-listing for inquiries, which defeats the purpose of a single, reliable way to be reached about a sale.

**Independent Test**: Can be fully tested by having two different buyers each open separate threads with the same listing's owner, then confirming the owner sees both threads, each buyer sees only their own thread, and neither buyer can see the other's messages.

**Acceptance Scenarios**:

1. **Given** a listing owner with threads from multiple buyers across multiple listings, **When** the owner views their threads, **Then** every thread on every one of their listings is shown.
2. **Given** two buyers who each have their own thread with the same listing's owner, **When** either buyer views their threads, **Then** they see only the thread they started, not the other buyer's.
3. **Given** a member with no threads of their own, **When** they attempt to view a thread they did not start and do not own the listing for, **Then** access is denied.

---

### User Story 3 - A nameless account is asked to choose a name before it can speak (Priority: P2)

An account that has never set a display name tries to send its first message. Before the message goes through, the account is required to choose a display name — the same gate already in place before that account can create its first listing.

**Why this priority**: A thread is only useful if both sides know who they're talking to. Without this gate, User Story 1 and 2 could surface a thread where one side is unidentified, which is functionally useless and undermines the whole feature. It ships right after the core flow rather than with it because most accounts will already have a name by the time they message (from creating a listing).

**Independent Test**: Can be fully tested by having a brand-new email/password account, with no listings and no display name, attempt to send a message to a listing owner, and confirming it is required to set a display name before the message is accepted, and is not asked again afterward.

**Acceptance Scenarios**:

1. **Given** an account with no display name, **When** that account attempts to send its first message, **Then** it is required to set a display name before the message is sent, and the message does not exist until it does.
2. **Given** an account that already has a display name, **When** it sends a message, **Then** it is not prompted for a name.
3. **Given** an account with no display name attempting to send a message, **When** it sets a display name as part of that flow, **Then** future messages from that account do not prompt again.

---

### User Story 4 - Losing membership closes the door on that community's threads (Priority: P3)

Someone who is removed from a community, or whose membership otherwise ends, can no longer view or send messages in that community's threads — even ones they were previously part of.

**Why this priority**: This enforces the same community boundary that governs every other part of the product. It is lower priority than the core conversation flow because it only matters once membership changes occur, but it must ship before this feature is trusted with real conversations.

**Independent Test**: Can be fully tested by having a buyer with an open thread lose their membership in that community, then confirming that buyer can no longer view or send messages in that thread, while the still-current-member owner is unaffected.

**Acceptance Scenarios**:

1. **Given** a buyer with an existing thread who then loses membership in that thread's community, **When** that former member attempts to view or send a message in the thread, **Then** access is denied.
2. **Given** the same scenario, **When** the listing owner — still a current member — views their threads, **Then** the thread and its prior messages remain visible to the owner.

---

### User Story 5 - Returning to a conversation without sending a new message (Priority: P1)

A member who already has one or more threads — as a buyer who reached out, or as an owner who was contacted — can find and reopen any of them from a single "Chats" view, reachable from anywhere in the app, without needing to revisit the listing that started it or remember a URL.

**Why this priority**: Today the only way back to a thread is the listing page it started from — a buyer has no path back except sending another message, and an owner has no way to discover who has contacted them at all. This makes the entire messaging feature effectively undiscoverable outside the one moment a thread is created.

**Independent Test**: Can be fully tested by having two accounts exchange messages on a listing, then having each of them navigate to "Chats" from a page other than that listing, and confirming their thread appears, grouped under the right community, marked correctly as buyer or owner, and clicking it opens the full conversation.

**Acceptance Scenarios**:

1. **Given** an account that participates in threads across two different communities, **When** they open Chats, **Then** both communities appear, each showing only that community's own threads.
2. **Given** an account that owns a listing with an incoming thread and separately reached out on someone else's listing, **When** they view Chats, **Then** the incoming thread is marked as theirs-as-owner and the outgoing one as theirs-as-buyer.
3. **Given** an account with a thread in Community A last active an hour ago and a thread in Community B last active a minute ago, **When** they view Chats, **Then** Community B's thread is ordered ahead of Community A's.
4. **Given** an account signed in on any page of the app, **When** they look at the navigation, **Then** a way to reach Chats is present, with no need to know or type a URL.
5. **Given** an account with no threads at all, **When** they open Chats, **Then** no community section appears, and no error occurs.

---

### User Story 6 - Finding all of your own listings, whatever their status, and who's asked about each (Priority: P2)

A member who owns listings — active or paused — across one or more communities can see all of them in one place, along with how many people have messaged about each, and jump straight into those conversations.

**Why this priority**: Once a listing is paused, it disappears from the community feed entirely (007-listing-discovery) — its owner is left with no page that shows it, let alone how many people asked about it before or after pausing. This is scoped as its own story because it is specifically about listing management from the owner's side, distinct from Chats' conversation-history focus.

**Independent Test**: Can be fully tested by having an account own one ACTIVE and one PAUSED listing (in the same or different communities), with threads on each, then confirming "My listings" shows both regardless of status, with correct thread counts, and that following a listing's link reaches its threads.

**Acceptance Scenarios**:

1. **Given** an account that owns one ACTIVE and one PAUSED listing, **When** they open My listings, **Then** both appear, regardless of status.
2. **Given** a listing with three threads on it, **When** it appears in My listings, **Then** it shows a count of 3.
3. **Given** a listing with zero threads, **When** it appears in My listings, **Then** it shows a count of 0, without linking to a page that looks broken or like an error.
4. **Given** an account signed in on any page of the app, **When** they look at the navigation, **Then** a way to reach My listings is present, with no need to know or type a URL.
5. **Given** an account with owned listings in two different communities, **When** they open My listings, **Then** listings from both appear.

---

### Edge Cases

- What happens when a member tries to message their own listing? The system prevents an account from opening a thread with itself.
- What happens when a listing is deleted? Its threads and messages are deleted along with it, so no thread outlives the listing it was tied to (see Assumptions).
- What happens if a message is empty or only whitespace? The system rejects it; a thread cannot contain a blank message.
- What happens if someone submits a very long message? The system rejects messages beyond the 2,000-character maximum.
- What happens when a buyer sends a second message before the owner has replied to the first? Both messages are added to the same thread in order — messaging does not require waiting for a reply.
- What happens if the owner and the buyer are no longer in the same community by the time a message is sent (e.g., one left after the thread was created)? Access is denied per the current-membership requirement — see User Story 4.
- What happens when a member tries to start a new thread on a listing that is currently PAUSED? The system blocks it — new threads may only be started against an ACTIVE listing.
- What happens to a thread already open on a listing that its owner later pauses? The thread is unaffected — both participants can keep exchanging messages in it.
- What happens in Chats or My listings when someone has left a community they used to have threads or listings in? Nothing from that community appears — not the thread, not the listing, not its count *(amendment)*.
- What happens when an account has zero threads, or owns zero listings? The corresponding view renders empty, not an error *(amendment)*.
- What happens to a listing's thread count in My listings when one of its buyers loses membership in that community? The thread and its count are unaffected — only that buyer's own access is revoked (FR-009); the owner, still a member, keeps full visibility of the thread and is still counted *(amendment)*.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST let a member open a message thread with a listing's owner directly from that listing, provided the member is not the listing's owner.
- **FR-002**: System MUST maintain exactly one thread per (listing, buyer) pair — sending another message to the same listing's owner from the same buyer MUST reuse the existing thread rather than create a new one.
- **FR-003**: Threads MUST contain text-only messages, added one at a time, ordered by the time they were sent.
- **FR-004**: Every message MUST display its sender's display name and the time it was sent.
- **FR-005**: A listing owner MUST be able to view every thread tied to any of their own listings.
- **FR-006**: A buyer MUST be able to view only the thread(s) they themselves started; a buyer MUST NOT be able to view another buyer's thread on the same or any other listing.
- **FR-007**: System MUST deny thread access (viewing or sending) to any account that is neither the listing's owner nor the thread's initiating buyer — including a community administrator, who has no special access to thread contents by virtue of their role.
- **FR-008**: Every thread and message query MUST be scoped by community in the database query itself, and MUST require the requesting account to currently hold membership in that community.
- **FR-009**: An account that loses its current membership in a community MUST immediately lose access — view and send — to that community's threads, for as long as it lacks that membership.
- **FR-010**: An account with no display name MUST be required to set one before its first message can be sent, at the point of sending — mirroring the existing requirement before an account's first listing (spec 006, FR-008). An account that already has a display name MUST NOT be prompted again.
- **FR-011**: System MUST NOT display any participant's email address, phone number, or other contact data anywhere in a thread or message — only the sender's display name.
- **FR-012**: System MUST reject messages that are empty or contain only whitespace, or that exceed 2,000 characters.
- **FR-013**: System MUST prevent an account from opening a thread with itself on its own listing.
- **FR-014**: Messages MUST become visible to participants when the thread is loaded or reloaded; the system is not required to deliver messages in real time or notify participants of new messages.
- **FR-015**: When a listing is deleted, all of its threads and their messages MUST be deleted along with it.
- **FR-016**: System MUST NOT allow a new thread to be started against a PAUSED listing. A thread that already exists on a listing at the time it becomes PAUSED MUST remain open — both participants MUST still be able to send and view messages in it.
- **FR-017** *(new, amendment)*: System MUST provide a "Chats" view listing every thread the signed-in account currently participates in — as a listing's owner or as a thread's buyer — across every community the account currently belongs to.
- **FR-018** *(new, amendment)*: The Chats view MUST group threads by community; a community the account has no thread in MUST NOT appear.
- **FR-019** *(new, amendment)*: Within the Chats view, each thread MUST be visibly marked as either "owner" (the account owns the thread's listing) or "buyer" (the account is the thread's buyer). This distinction MUST be derived at render time from the account's relationship to the thread's listing — no new stored field for it.
- **FR-020** *(new, amendment)*: Threads in the Chats view MUST be ordered by the time of their most recent message, most recent first.
- **FR-021** *(new, amendment)*: System MUST provide a "My listings" view listing every listing the signed-in account owns, in any status (`ACTIVE` or `PAUSED`), across every community the account currently belongs to, each showing a count of the threads that exist on it.
- **FR-022** *(new, amendment)*: Each listing shown in the My listings view MUST link to that listing's own threads.
- **FR-023** *(new, amendment)*: Both the Chats view and the My listings view MUST be reachable in exactly one navigation step from every authenticated screen, via the app's existing persistent navigation — never only by a typed URL.
- **FR-024** *(new, amendment)*: Every thread or listing shown in the Chats view or the My listings view MUST belong to a community the account currently holds membership in. A community the account has left MUST NOT appear, and nothing from it MUST be listed or counted.
- **FR-025** *(new, amendment)*: Neither the Chats view nor the My listings view MUST display any participant's email, phone, or other contact data — display name only, consistent with FR-011.

### Key Entities

- **Message Thread**: A conversation between exactly one listing's owner and one interested buyer, tied to that one listing. Attributes: the listing it belongs to, the owner account, the buyer account, creation time, the time of its most recent message *(added, amendment — drives Chats' ordering, FR-020)*. Exactly one thread exists per (listing, buyer) pair; deleted automatically when its listing is deleted.
- **Message**: A single text message within a thread. Attributes: the thread it belongs to, the sending account, body text, sent time. Ordered chronologically within its thread.
- **Listing** *(existing, from 005-product-listings — referenced, not modified)*: The product a thread is about, and the source of the owner side of every thread on it. My listings (FR-021) reads this entity's `status` directly, unlike the community feed (007-listing-discovery), which reads only its `ACTIVE` subset.
- **Account** *(existing, from 002-accounts-authentication — referenced, not modified)*: The identity that sends and receives messages; contributes its display name (006-user-display-names) to every message it sends.
- **Community** *(existing, from 003-community-creation — referenced, not modified)*: The tenancy boundary; current membership in a thread's community is required to view or send within it, and to have that thread (or an owned listing in it) appear in Chats or My listings *(amendment)*.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A member can send a first message to a listing's owner in under 30 seconds from the moment they open the listing.
- **SC-002**: 100% of messages shown to any user display only the sender's display name — never an email address, phone number, or other contact identifier.
- **SC-003**: In testing, 0% of threads are accessible to any account other than the listing's owner and that thread's initiating buyer, and 0% are accessible to an account lacking current membership in the thread's community.
- **SC-004**: A listing owner can find and respond to every buyer inquiry across all of their listings from one view, without needing to check listings individually.
- **SC-005**: 100% of message-send attempts by an account with no display name are blocked until a display name is set, with zero messages ever recorded from a nameless account.
- **SC-006** *(new, amendment)*: A member can reach both Chats and My listings in one step from any screen — verified by automated tests starting navigation from at least two different pages, neither of which is a page specific to a single thread or listing.
- **SC-007** *(new, amendment)*: In testing, 0% of threads or listings from a community the account no longer belongs to appear in Chats or My listings.

## Assumptions

- Deleting a listing cascades to delete its threads and messages, rather than preserving them as read-only history. This mirrors the existing precedent in this codebase where a listing's photos are removed automatically when the listing is deleted (005-product-listings), and keeps behavior simple: a thread's entire context is the listing it was tied to, and that context no longer exists once the listing is gone.
- "Current membership," used throughout, relies on the existing membership state established by 004-invitations-membership; no new membership concept is introduced by this feature.
- Because handling other members' personal data (identity, conversation content) is involved, automated tests for this feature's critical paths (thread creation/access scoping, membership-loss revocation, and the display-name gate) are written first and confirmed failing before implementation begins, even though messaging is not on the constitution's default list of critical flows requiring this discipline. This discipline extends to the amendment below.
- No message editing, deletion, attachments, reactions, read receipts, typing indicators, or real-time delivery exist in this iteration — a thread is a plain, append-only, text history visible on page load.
- *(Amendment)* Chats and My listings show no unread counts, badges, or notifications — reachability only, consistent with this feature's existing no-real-time stance (FR-014).
- *(Amendment)* No new shared layout is introduced (see Clarifications, 2026-07-17 amendment session) — `AppShell` already renders on every authenticated screen; this amendment only adds two links to its existing sidebar.
- *(Amendment)* Chats and My listings are each a single query, entirely scoped, ordered, and counted by the database (a `communityId IN (current memberships)` filter, `ORDER BY lastMessageAt DESC`, and a `COUNT` aggregate respectively) — grouping that already-scoped, already-ordered result by community for the Chats page's rendering is a presentational transform only, not a re-implementation of scoping, ordering, or counting in application code.
