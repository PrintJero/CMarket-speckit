# Quickstart: Chat Conversation UI Redesign

Validates the feature end-to-end once implemented. See [data-model.md](./data-model.md) for the derived rendering shape and [contracts/thread-conversation-api.md](./contracts/thread-conversation-api.md) for the one (unchanged) route involved. No migration is required — this feature ships with zero schema changes.

## Prerequisites

- Two accounts, O (a listing owner) and B (a buyer), members of the same community.
- A listing owned by O, with an existing message thread between O and B containing several messages from both sides.
- A second thread with zero messages (freshly started, nothing sent yet).
- A third thread with enough messages to exceed a typical screen's visible height (e.g., 20+).

## Scenario 1 — Instantly tell who sent what (User Story 1)

1. Sign in as B and open the thread with several messages from both O and B.
   - Expect every message B sent to be right-aligned; every message from O to be left-aligned.
   - Expect sent and received bubbles to look visibly different from each other (not distinguished by position alone).
   - Expect messages to appear in the same chronological order they were sent.
2. Inspect a message with unusually long text.
   - Expect it to wrap inside its bubble with no horizontal page scrolling.
3. Inspect a very short message next to a very long one.
   - Expect each bubble to size to its own content (neither noticeably wider than roughly three-quarters of the panel) with visible padding around the text.
4. Inspect any message.
   - Expect a timestamp, visually smaller/lighter than the message text.

## Scenario 2 — A real conversation window (User Story 2)

1. Open any existing thread.
   - Expect one panel: a header at the top, a message area in the middle, a composer at the bottom.
   - Expect the panel to be visibly narrower than the full browser width on a desktop-sized window, with several messages visible without scrolling.
2. Open the thread with zero messages.
   - Expect a simple "Start the conversation" empty state in place of the message list, with the composer still present and usable.
3. From `/chats` and from a listing's own thread list, click into a thread.
   - Expect both to land on this same panel for that same thread — no new URL shape.

## Scenario 3 — Scrolling a long conversation (User Story 3)

1. Open the thread with 20+ messages.
   - Expect the newest message to already be visible with no manual scrolling.
2. Scroll up to read older messages.
   - Expect only the message area to scroll — the header and composer stay fixed in place.
3. Send a new message from the composer.
   - Expect it to appear in the conversation and be immediately visible with no manual scrolling needed.

## Scenario 4 — Who you're talking to, without anything private (User Story 4)

1. Open a thread as either participant.
   - Expect the header to show the other participant's display name and (when the listing still exists) its title.
2. Click the header's display name.
   - Expect the same public profile experience already reachable from a listing or a transaction to open — not a new or different page.
3. Inspect the whole page (header, every message, the composer) and its underlying data.
   - Expect no email address, phone number, physical address, or authentication data anywhere, and no raw message/thread/account ID shown as visible text.
4. Open a thread with a counterpart who has no display name set.
   - Expect the existing neutral placeholder, never the email address.
5. As B, open a thread where B has sent every message so far and O hasn't replied yet.
   - Expect the header to still correctly show O's display name (not blank, not B's own name) — this is the case that requires `getThread()`'s two new fields (research.md #6) rather than deriving identity from message senders alone.

## Scenario 5 — Desktop and mobile (User Story 5)

1. Open a thread at a common desktop width.
   - Expect the panel centered, visibly narrower than the full window, tall enough for several messages.
2. Open the same thread at a common mobile width.
   - Expect the panel to use the full available width with no horizontal scrolling anywhere on the page, alignment unchanged, and the composer easy to reach and use.

## Scenario 6 — Nothing about sending, permissions, or isolation changed

1. Attempt to send an empty message.
   - Expect the exact same rejection behavior as before this feature (visually presented within the new composer).
2. As an account with no membership in the thread's community, attempt to open or post to the thread directly.
   - Expect the exact same `403`/`404` outcomes as before this feature.
3. Run the full existing automated suite covering message-thread access, participant permissions, and community isolation.
   - Expect it to pass unchanged.

## Scenario 7 — Automated test suite

1. Run `npm run typecheck` and `npm run lint` — clean.
2. Run `npm run test:unit` — the full existing suite passes unchanged (no service-layer code is touched by this feature).
3. Run `npm run test:e2e` for the new `tests/integration/test_thread_conversation_ui.spec.ts` plus the full existing suite (in particular `test_messaging_flow.spec.ts` and `test_profile_view.spec.ts`, both of which touch this same thread page) — all pass, with no regression beyond the intentional removal of the per-message sender-name link (research.md #2), which `test_profile_view.spec.ts`'s own link lookup does not depend on the location of.
