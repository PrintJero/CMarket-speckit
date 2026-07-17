# Quickstart: Listing Messaging

Validates the feature end-to-end once implemented. See [data-model.md](./data-model.md) for the schema and [contracts/messaging-api.md](./contracts/messaging-api.md) for the four routes.

## Prerequisites

- PostgreSQL running and migrated with this feature's Prisma schema change (`prisma migrate deploy`) — adds `message_threads` and `messages` tables, no existing table altered.
- A `Community` with at least two members: one who owns an `ACTIVE` listing (with a `displayName` set), and one other member (the buyer) who does not own it.
- The Next.js dev server running (`npm run dev`).

## Scenario 1 — A buyer messages the owner, and they go back and forth (Story 1)

1. Sign in as the buyer. Visit the owner's listing detail page and send a message ("Is this still available?").
   - Expect a new thread to open, containing that message.
2. Sign in as the owner. Visit the community's threads inbox.
   - Expect the new thread to appear, with the buyer's display name and message.
3. Reply as the owner ("Yes, still available.").
   - Expect the reply added to the same thread, in order.
4. Sign back in as the buyer and send a second message from the same listing.
   - Expect it added to the *same* thread — confirm via the API that only one thread exists for this (listing, buyer) pair.

## Scenario 2 — Everyone sees only what they should (Story 2)

1. Sign in as a second, different buyer and send a message to the same owner's same listing.
   - Expect a second, separate thread (owner now has two threads on this one listing).
2. As the owner, view the threads inbox.
   - Expect both threads listed.
3. As the first buyer, view the threads inbox.
   - Expect only their own thread — not the second buyer's.
4. As the first buyer, attempt `GET /api/communities/{C}/threads/{secondBuyerThreadId}` directly.
   - Expect `403 not_a_participant`.

## Scenario 3 — The display-name gate (Story 3)

1. Create a brand-new email/password account with no display name and no listings; add it as a community member.
2. Sign in as that account and attempt to send a message to any listing's owner.
   - Expect the attempt to require a display name before the message is accepted (mirrors the existing listing-creation prompt, spec 006 FR-008); confirm directly against the API that no `Message` row exists until a display name is set.
3. Set a display name, then resend the message.
   - Expect it to succeed and not prompt again on a following message.

## Scenario 4 — Membership loss revokes access (Story 4)

1. With an existing thread (buyer + owner both current members), remove the buyer's membership from the community.
2. As the (now former) buyer, attempt to view or send to that thread.
   - Expect access denied.
3. As the owner (still a current member), view the same thread.
   - Expect it — and its prior messages — to still be fully visible.

## Scenario 5 — PAUSED-listing behavior (Clarifications)

1. As the owner, pause the listing that already has an open thread on it.
2. As the existing thread's buyer, send another message in that same thread.
   - Expect it to succeed — an existing thread is unaffected by pausing.
3. As a third member with no prior thread on this listing, attempt to start a new thread against the now-PAUSED listing.
   - Expect `409 listing_paused`.
4. Reactivate the listing and repeat step 3.
   - Expect it to now succeed.

## Scenario 6 — No contact data, ever (FR-011, Principle VI)

1. As any participant, inspect every response from all four routes in this feature (thread list, thread detail, both message-send routes).
   - Expect no field anywhere containing an email address, phone number, or other contact data — only `displayName` values (or the existing placeholder for an unset one, though this shouldn't occur given the display-name gate above).

## Scenario 7 — Listing deletion cascades (Edge Cases)

1. As the owner, delete the listing that has one or more open threads.
2. As either former participant, attempt to fetch that thread by ID.
   - Expect `404` — the thread and its messages no longer exist.

## Scenario 8 — Automated test suite

1. Run `npm run test:unit` — Vitest contract tests covering `messageService.ts` (thread creation/reuse, self-message prevention, PAUSED gate on creation only, display-name gate, message length validation, owner/buyer/third-party access scoping, membership-revocation effect, no-administrator-access, cascade delete on listing deletion) must pass, alongside the full existing 002–007 contract suite unmodified. Per this feature's own Assumptions, these tests are written first and confirmed failing (red) before any implementation.
2. Run `npm run test:e2e` — Playwright specs driving the message composer on a listing page, the threads inbox, and a thread's reply composer through a real browser must pass, alongside the full existing 002–007 suite (no regressions).

## Scenario 9 — Chats: reachable, grouped, ordered, and side-marked (Story 5, 2026-07-17 amendment)

1. As one account, have an open thread as a buyer in Community A, and separately own a listing in Community B with an incoming thread from a different buyer.
2. Sign in as that account on a page other than either listing or thread (e.g., the signed-in home). Confirm a "Chats" link is visible in the navigation without typing a URL.
3. Follow it. Expect two community sections: Community A's thread marked as "buyer," Community B's thread marked as "owner."
4. Send a new message in Community A's thread, making it more recent than Community B's.
5. Reload Chats. Expect Community A's thread now ordered first.
6. As a third account with no threads at all, open Chats. Expect an empty state, not an error.
7. Remove the first account's membership from Community A, then reload Chats as that account.
   - Expect Community A's section to no longer appear at all — not the thread, not an empty section for it.

## Scenario 10 — My listings: any status, thread counts, reachable (Story 6, 2026-07-17 amendment)

1. As an owner, have one `ACTIVE` and one `PAUSED` listing, in the same or different communities, with 2 threads on the `ACTIVE` one and 0 on the `PAUSED` one.
2. Sign in and, from a page other than either listing, confirm a "My listings" link is visible in the navigation without typing a URL.
3. Follow it. Expect both listings to appear regardless of status, the `ACTIVE` one showing a count of 2, the `PAUSED` one showing a count of 0.
4. Follow the `ACTIVE` listing's threads link. Expect exactly its 2 threads, not threads from any other listing.
5. Follow the `PAUSED` listing's threads link (count of 0). Expect an empty inbox view, not an error.

## Scenario 11 — Automated test suite (amendment)

1. Run `npm run test:unit` — extended `tests/contract/test_messaging.ts` (`listMyThreads`, `lastMessageAt` ordering) and `tests/contract/test_listings.ts` (`listMyListings`) must pass, written and confirmed red first, alongside the full pre-amendment suite unmodified.
2. Run `npm run test:e2e` — extended `tests/integration/test_messaging_flow.spec.ts` covering Chats and My listings navigation/content must pass, alongside the full pre-amendment suite (no regressions).
