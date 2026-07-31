# Feature Specification: Chat Conversation UI Redesign

**Feature Branch**: `016-chat-conversation-redesign`

**Created**: 2026-07-31

**Status**: Finished

**Input**: User description: "Chat Conversation UI Redesign: CMarket already has working listing-based messaging and chat threads. This feature does NOT change messaging business rules, thread creation rules, participant permissions, community isolation, or message storage. The goal is only to redesign the existing chat/thread experience so it looks and behaves visually like a modern messaging conversation. The current chat UI feels like ordinary page content. Replace that presentation with a centered conversation window in the main content area. CHAT LAYOUT: When a user opens a chat thread, show a dedicated conversation panel centered in the main content area. The conversation panel should contain: 1. A chat header 2. A scrollable messages area 3. A message composer at the bottom. The overall experience should resemble a normal messaging application rather than a list of text entries. CHAT HEADER: Show the other participant's display name, the related listing title when available. The counterpart's display name should remain clickable and open their existing public profile. Do not show email, phone number, physical address, authentication information. MESSAGE ALIGNMENT: Messages sent by the currently signed-in account MUST appear aligned to the RIGHT. Messages sent by the other participant MUST appear aligned to the LEFT. Each message should appear inside a visually distinct message bubble. Sent and received messages should have clearly distinguishable styles while remaining consistent with the existing CMarket visual language. MESSAGE DISPLAY: Messages must remain in chronological order. Each message bubble should have a reasonable maximum width, wrap long text correctly, have comfortable padding, preserve existing message content exactly, show a subtle timestamp. Do not display unnecessary internal identifiers. SCROLLING: The messages area should be independently scrollable when the conversation becomes long. When opening an existing conversation, the UI should naturally position the user near the newest messages. When a new message is successfully sent, it should appear in the conversation and the view should remain focused near the newest messages. MESSAGE COMPOSER: At the bottom of the conversation panel, provide a messaging composer containing a text input or textarea and a Send button. The composer should remain visually attached to the bottom of the conversation panel. Sending a message must continue using the existing messaging service/API and validation rules. Do not introduce a second message-send path. EMPTY STATE: If a valid thread exists but contains no messages yet, show a simple empty state such as 'Start the conversation' while keeping the composer available. RESPONSIVE DESIGN: Desktop: conversation panel centered in the main content area, comfortable maximum width, enough vertical height to feel like a messaging window. Mobile: conversation panel uses the available screen width, sent messages remain right-aligned, received messages remain left-aligned, composer remains easy to use, avoid horizontal overflow. EXISTING NAVIGATION: Do not change the existing Chats hub or thread navigation behavior unless a minimal presentation adjustment is required. Opening a thread from Chats should still lead to that existing conversation. PROFILE INTEGRATION: The counterpart's display name in the chat header should remain clickable and open the existing public member profile. Do not introduce a separate profile mechanism. PRIVACY: The redesigned chat must preserve all existing privacy rules. Never expose email, phone, address, authentication information. OUT OF SCOPE: image attachments, file attachments, voice notes, read receipts, typing indicators, reactions, message editing, message deletion, notifications, online/offline presence, calling, group chats. This feature is specifically a visual and interaction redesign of the existing one-to-one message conversation. Do not change the underlying MessageThread or Message data model unless absolutely required for rendering existing information. Do not create duplicate messaging services or APIs. Success criteria: a user can immediately distinguish their own messages from the other participant's messages; current-user messages always render on the right; counterpart messages always render on the left; the conversation appears inside a centered, dedicated chat panel; long conversations scroll correctly; sending a message updates the conversation without breaking the layout; the UI works correctly on desktop and mobile; existing messaging permissions and community isolation remain unchanged."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Instantly tell who sent what (Priority: P1) 🎯 MVP

A member opens a chat thread and, without reading a single sender label, can immediately tell which messages are their own and which belong to the other participant — their own messages sit on the right, the other participant's sit on the left, and each message appears inside its own visually distinct bubble.

**Why this priority**: This is the single most-requested change and the core complaint about the current experience ("feels like ordinary page content") — every message renders identically today regardless of who sent it. Fixing this delivers the headline value of the whole feature even before the rest of the panel redesign lands, since it can be applied to the conversation's existing rendering with no other structural change.

**Independent Test**: Open a thread containing messages from both participants and confirm every message the signed-in account sent is right-aligned and styled one way, every message from the other participant is left-aligned and styled distinguishably, the order is chronological, and this holds for a thread of any length or message content.

**Acceptance Scenarios**:

1. **Given** a thread with messages from both participants, **When** the signed-in member opens it, **Then** every message they themselves sent appears aligned to the right and every message the other participant sent appears aligned to the left — for example, "Is this still available?" (their counterpart) appears on the left, "Yes, it is." (their own reply) appears on the right, and this pattern holds through the rest of the conversation.
2. **Given** a mix of sent and received messages, **When** the conversation is rendered, **Then** sent and received bubbles are visually distinguishable from each other (not merely by position) while still looking like they belong to the same CMarket interface.
3. **Given** a message with unusually long text, **When** it renders, **Then** the text wraps inside its bubble and does not overflow the page horizontally.
4. **Given** the same conversation, **When** it is inspected, **Then** every message's original content is shown exactly as stored — never altered, truncated unexpectedly, or reordered.
5. **Given** a very short message and a very long message in the same conversation, **When** both are rendered, **Then** each bubble sizes itself to its own content (neither ever wider than roughly three-quarters of the conversation panel's width) and shows visible spacing between its text and its own edges, so text never touches a bubble's border.
6. **Given** any message in the conversation, **When** it is rendered, **Then** it shows the time it was sent, styled smaller and lighter than the message text itself so the time reads as secondary information rather than competing with the conversation.

---

### User Story 2 - Open a thread inside a real conversation window (Priority: P1)

A member opens a chat thread and lands in a dedicated conversation panel — a header, a scrollable message area, and a composer fixed to the bottom — centered in the main content area, rather than a plain page of stacked text.

**Why this priority**: Alongside message alignment (User Story 1), this is what makes the experience read as "a messaging app" instead of "a list of text entries." It is the structural container every other requirement in this feature sits inside.

**Independent Test**: Open any existing thread and confirm it renders as one panel containing exactly a header, a message area, and a composer, centered in the page, without needing any new thread, message, or account data beyond what already exists.

**Acceptance Scenarios**:

1. **Given** a member opens an existing chat thread, **When** the page renders, **Then** they see one conversation panel containing a header at the top, a message area in the middle, and a composer at the bottom.
2. **Given** the panel is open on a desktop-width screen, **When** the surrounding page is viewed, **Then** the panel is visibly narrower than the full browser width (centered with space visible on both sides) and tall enough that several messages are visible at once, rather than stretching edge-to-edge or being cropped to a sliver.
3. **Given** a thread that legitimately has no messages yet, **When** it is opened, **Then** the message area shows a simple empty state (e.g., "Start the conversation") and the composer is still present and usable.
4. **Given** the existing Chats hub or a listing's thread list, **When** a member clicks into a thread, **Then** they land on this same conversation panel for that same existing thread — no new navigation path is introduced.

---

### User Story 3 - Scroll a long conversation without losing your place (Priority: P2)

A member opens a conversation with many messages and the newest message is immediately visible without them needing to scroll; after they send a new message, that new message is likewise immediately visible without scrolling.

**Why this priority**: Without this, a long-running conversation about a listing would force the member to scroll down every time just to see (or send) the latest message — a materially worse experience than a real chat app, even once alignment and the panel exist.

**Independent Test**: Seed a thread with enough messages to exceed the visible message area, open it, and confirm the newest message is already visible with no scrolling needed; send a new message and confirm that new message is likewise immediately visible with no scrolling needed, with the header and composer unaffected.

**Acceptance Scenarios**:

1. **Given** a conversation long enough to exceed the visible message area, **When** it is opened, **Then** its newest message is already visible without the member needing to scroll.
2. **Given** that same long conversation, **When** the member scrolls up to read older messages, **Then** only the message area scrolls — the header and composer stay in place.
3. **Given** an open conversation, **When** the member successfully sends a new message, **Then** it appears in the conversation and is itself immediately visible without the member needing to scroll.

---

### User Story 4 - Know who you're talking to, without seeing anything private (Priority: P2)

A member sees the other participant's display name (and the related listing title, when one exists) in the chat header, can click that name to open the counterpart's existing public profile, and never sees any contact or authentication data anywhere in the conversation.

**Why this priority**: Participant context and safe navigation to a profile are valuable but secondary to the core reading/writing experience (User Stories 1–3); this story also carries the feature's privacy obligation.

**Independent Test**: Open a thread and confirm the header shows the counterpart's display name and (when available) the related listing title, that clicking the name opens the same public profile experience already reachable elsewhere in CMarket, and that no email, phone, address, or authentication data appears anywhere on the page or in its underlying data.

**Acceptance Scenarios**:

1. **Given** an open thread, **When** the header renders, **Then** it shows the other participant's display name and, when the thread has one, the related listing's title.
2. **Given** the header's display name, **When** the member clicks it, **Then** the counterpart's existing public profile opens — the same profile experience already reachable from listings, transactions, and elsewhere in CMarket, not a new or separate mechanism.
3. **Given** any part of the redesigned chat (header, messages, composer), **When** it is rendered or its underlying data is inspected, **Then** no email address, phone number, physical address, or authentication data appears anywhere, and no raw internal identifier (such as a message, thread, or account ID) is shown as visible text.
4. **Given** a participant with no display name set, **When** the header renders, **Then** the same neutral placeholder already used elsewhere in CMarket is shown — never the email address.

---

### User Story 5 - Use the conversation comfortably on any device (Priority: P2)

A member gets the same clear, functional conversation experience whether they're on a desktop browser or a phone: centered and sized to feel like a real messaging window on desktop, full-width and overflow-free on mobile, with alignment and the composer both remaining usable at every width.

**Why this priority**: Members already use CMarket heavily from their phones — some even install it to their home screen like an app — so a redesign that only works well on desktop would break a real, everyday part of how people already use the product.

**Independent Test**: Open the same thread at a common desktop width and a common mobile width and confirm the panel adapts appropriately at each, alignment and bubble styling remain correct, the composer stays usable, and nothing overflows horizontally at either size.

**Acceptance Scenarios**:

1. **Given** a desktop-width viewport, **When** a thread opens, **Then** the conversation panel is centered in the main content area, visibly narrower than the full browser width, and tall enough that several messages are visible at once — not a cramped strip.
2. **Given** a mobile-width viewport, **When** the same thread opens, **Then** the panel uses the available screen width without introducing horizontal scrolling anywhere on the page.
3. **Given** a mobile-width viewport, **When** messages from both participants are shown, **Then** the current user's messages remain right-aligned and the other participant's remain left-aligned, exactly as on desktop.
4. **Given** a mobile-width viewport, **When** the member uses the composer, **Then** the text input and Send action remain easy to reach and use.

---

### Edge Cases

- A thread that legitimately has zero messages (e.g., just created) shows the "Start the conversation" empty state, not a blank panel or an error — the composer stays available so the first message can still be sent.
- A message with an unusually long single word or URL (no natural wrap point) does not force the page to scroll horizontally.
- The other participant has no display name set — the existing neutral placeholder is shown, exactly as it already is on listings and elsewhere; the email address is never substituted in.
- The thread's related listing has since been removed or is no longer available — the conversation itself remains fully usable; the listing-title portion of the header is simply omitted rather than showing broken or missing-data text.
- A conversation with a very large number of messages — scrolling and the "newest message immediately visible on open" behavior continue to work; no message is dropped or reordered.
- Sending a message fails validation (e.g., empty or over-length body) — the existing error behavior is preserved, and the conversation layout does not break or lose the composer.
- Two messages sent within the same second by different participants still render in their correct chronological order with correct alignment.
- The counterpart's display name link necessarily points to a destination that includes their account identifier — that identifier appearing inside a link's destination is not the same as displaying it as visible text, and is not something this feature needs to prevent.

## Requirements _(mandatory)_

### Functional Requirements

**Chat layout**

- **FR-001**: The system MUST render an existing chat thread inside one dedicated conversation panel — a header, a messages area, and a message composer — in the main content area, rather than as an undifferentiated page of stacked text.
- **FR-002**: The conversation panel MUST appear centered within the main content area.

**Chat header**

- **FR-003**: The chat header MUST show the other participant's resolved display name.
- **FR-004**: The chat header MUST show the related listing's title when the thread currently has one available; when it is not available, the header MUST still render normally without it.
- **FR-005**: The other participant's display name MUST be clickable and MUST open that participant's existing public member profile — the same profile mechanism already used elsewhere in CMarket, not a new or separate one.
- **FR-006**: The chat header MUST NOT show the other participant's email address, phone number, physical address, or authentication information.

**Message alignment and bubbles**

- **FR-007**: Every message authored by the currently signed-in account MUST render aligned to the right.
- **FR-008**: Every message authored by the other participant MUST render aligned to the left.
- **FR-009**: Message ownership (right vs. left) MUST be determined from the sender identity the existing messaging capability already provides for each message — no new information needs to be captured or stored to support it.
- **FR-010**: Each message MUST render inside its own visually distinct message bubble.
- **FR-011**: Sent bubbles and received bubbles MUST be styled in a clearly distinguishable way from one another, while remaining visually consistent with the rest of CMarket's existing interface.

**Message display**

- **FR-012**: Messages MUST remain displayed in chronological order.
- **FR-013**: Each message bubble MUST size itself to its own content, up to a maximum width of roughly three-quarters of the conversation panel's width, and MUST wrap longer text within that width rather than letting it overflow the page.
- **FR-014**: Each message bubble MUST show visible spacing between its text and its own edges, so the text never touches the bubble's border.
- **FR-015**: Each message's content MUST be displayed exactly as stored — the redesign MUST NOT alter, truncate, or reformat the underlying message text.
- **FR-016**: Each message MUST show the time it was sent, styled smaller and visually lighter than the message text itself, so the time reads as secondary information rather than competing with the conversation.
- **FR-017**: The conversation MUST NOT display internal identifiers (e.g., raw message, thread, or account IDs) as visible text anywhere in the conversation.

**Scrolling**

- **FR-018**: The messages area MUST scroll independently of the header and composer once the conversation exceeds the visible height.
- **FR-019**: Opening an existing conversation MUST leave its newest message immediately visible, with no scrolling needed, when the conversation is longer than the visible area.
- **FR-020**: Successfully sending a message MUST leave that new message immediately visible, with no scrolling needed.

**Message composer**

- **FR-021**: The conversation panel MUST provide a message composer, containing a text input or textarea and a Send action, attached to the bottom of the panel.
- **FR-022**: Sending a message MUST continue to use the existing messaging capability and its existing validation rules; the redesign MUST NOT introduce a second, parallel way to send a message.
- **FR-023**: Existing send-failure and validation behavior (e.g., for an empty or invalid message) MUST remain unchanged in outcome, however it is presented visually.

**Empty state**

- **FR-024**: A valid thread that currently has no messages MUST show a simple, defined empty-state message (e.g., "Start the conversation") in place of the messages area, while keeping the composer available and usable.

**Responsive design**

- **FR-025**: At common desktop viewport widths, the conversation panel MUST appear centered, visibly narrower than the full available width, and tall enough that several messages are visible at once.
- **FR-026**: At common mobile viewport widths, the conversation panel MUST use the available screen width without introducing horizontal overflow anywhere on the page.
- **FR-027**: At every supported viewport width, right/left message alignment and composer usability MUST be preserved.

**Navigation and scope preservation**

- **FR-028**: Existing navigation into a thread (from the Chats hub, a listing's thread list, or any other current entry point) MUST continue to lead to this same conversation — no new or duplicate navigation path is introduced.
- **FR-029**: This feature MUST NOT change thread creation rules, participant permissions, community isolation, or message persistence rules.
- **FR-030**: This feature MUST NOT introduce a second messaging service, a second message-retrieval path, or a duplicate of the existing MessageThread/Message data model.

### Key Entities _(reuses existing data, introduces no new stored entity)_

- **MessageThread** _(existing)_: The one-to-one conversation being displayed — its participants, related listing, and access rules are unchanged by this feature.
- **Message** _(existing)_: An individual message within a thread — its sender, content, and creation time are unchanged; the sender identity already present on each message is what determines right/left alignment.
- **Account** _(existing)_: Source of the signed-in member's own identity (for the "is this my message?" comparison) and of the counterpart's display name and public profile link.
- **Conversation Panel** _(conceptual, derived)_: The redesigned visual presentation — header, message area, composer — of an existing MessageThread and its Messages; not a stored entity and not a new data model.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A member can correctly identify, at a glance and without reading any label, which messages in a conversation are their own and which are the other participant's, 100% of the time.
- **SC-002**: Across every tested conversation, the signed-in member's own messages render on the right and the other participant's messages render on the left, with no exceptions.
- **SC-003**: Every opened chat thread renders as a single centered conversation panel containing a header, message area, and composer — never as an undifferentiated page of stacked text.
- **SC-004**: A conversation long enough to exceed the visible area can be scrolled to read every message, and opening it leaves the newest message immediately visible with no manual scrolling needed.
- **SC-005**: Sending a valid message always results in that message appearing in the conversation, correctly right-aligned, immediately visible with no manual scrolling needed, and with the surrounding layout intact.
- **SC-006**: The conversation is fully usable — readable, scrollable, and sendable — at both common desktop and common mobile viewport widths, with no horizontal overflow at either.
- **SC-007**: 100% of tested conversation views (header, messages, composer, and their underlying data) contain no email address, phone number, physical address, or authentication information.
- **SC-008**: Every existing automated test covering message-thread access, participant permissions, community isolation, and message sending continues to pass unchanged after this feature ships.

## Assumptions

- This is a presentation- and interaction-layer redesign only; the existing message-sending service, its validation rules, and thread/participant authorization are reused exactly as they are today.
- The information needed to determine message ownership (comparing a message's sender to the signed-in account) and to show when each message was sent is already available from the existing conversation data — no new information needs to be captured or stored, consistent with the instruction to avoid changing the underlying data unless rendering existing information genuinely requires it.
- The counterpart's display name and its link to their public profile reuse the exact same public-profile experience already used elsewhere in CMarket (listings, transactions, etc.) — this feature does not add a second profile mechanism, and does not change which communities or details that profile shows.
- Where a specific visual detail is not dictated by the source request (e.g., exact bubble corner radius, exact color pairing for sent vs. received), the redesign follows CMarket's existing visual language (its established rounded, soft-shadowed card style; pill-shaped interactive controls; existing brand color for emphasis) rather than introducing a new, inconsistent visual style — this is a presentational judgment call, not a functional requirement.
- A bottom-attached composer within an in-page panel is a new layout pattern for this codebase (no identical existing pattern was found to reuse verbatim); it is expected to be assembled from CMarket's existing visual primitives rather than introducing an unrelated new design system.
- "Common desktop and mobile viewport widths" follow the same responsive breakpoint the rest of the CMarket application already uses to distinguish mobile from desktop presentation.
- Out of scope, per the source request: image/file attachments, voice notes, read receipts, typing indicators, reactions, message editing, message deletion, notifications, online/offline presence, calling, and group chats.
