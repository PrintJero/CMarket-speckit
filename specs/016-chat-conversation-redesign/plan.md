# Implementation Plan: Chat Conversation UI Redesign

**Branch**: `016-chat-conversation-redesign` | **Date**: 2026-07-31 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/016-chat-conversation-redesign/spec.md`

## Summary

Redesign the existing one-to-one message thread page so it reads as a real chat conversation — a centered panel with a header, an independently-scrollable message area, and a bottom-attached composer — with the signed-in account's own messages right-aligned in one bubble style and the other participant's left-aligned in a visually distinct style. This is almost entirely a rendering-layer change: `messageService.ts`'s `getThread()` already returns everything needed to derive per-message alignment (`senderId`, `senderDisplayName`, `body`, `createdAt`) and the related listing's title. The one small exception (research.md #6) is the chat header's own identity: reliably showing *the other participant's* name requires `getThread()` to also return `counterpartId`/`counterpartDisplayName` at the thread level — data it already fetches internally but doesn't yet return, computed the exact same way its sibling functions `listThreads()`/`listMyThreads()` already compute it in the same file. No schema change, no new service, and no new API route are introduced. Sending continues to POST to the exact same existing endpoint the current reply form already uses.

## Technical Context

**Language/Version**: TypeScript, Next.js (App Router) — unchanged from 002-015, no new language/runtime.

**Primary Dependencies**: None new. Reuses `sendThreadMessage()`/`sendMessageToListingOwner()` (008-listing-messaging, `src/server/services/messageService.ts`) fully unchanged; `getThread()` in the same file gains two additional fields on its existing `thread` result (research.md #6) but no new function, no new parameter, no changed authorization gate. Reuses `resolveDisplayName()` (006-user-display-names), the existing public-profile route (`/communities/{communityId}/members/{accountId}`, 012/014), and the shared `AppShell`/`Card`/`Button`/`FormField` components.

**Storage**: PostgreSQL via Prisma, same dev/test containers already used by 002-015. **No new table, no new column, no migration.** `Message` already carries `senderId`, `body`, `createdAt`; `MessageThread` already carries `listingId`/`listingTitle` (via its related `Listing`, surfaced by `getThread()`). This feature reads that same data differently — it writes nothing new.

**Testing**: Playwright (`tests/integration/test_thread_conversation_ui.spec.ts`, new) covering: right/left alignment for own vs. counterpart messages, bubble sizing/spacing/timestamp presentation, chronological order, the empty state, scroll-to-latest on open and after send, the header's display name/listing-title/profile-link/no-contact-data guarantees (including when the caller has sent every message so far, research.md #6), and a mobile-viewport pass for overflow and composer usability. Not on Constitution Principle VIII's named critical-flow list (a UI redesign, not a new business flow) — but spec.md's own Success Criteria (SC-001 through SC-008) commit to automated verification, so tasks.md carries these as required, mirroring 012/014's identical precedent. A small Vitest addition to the existing `tests/contract/test_messaging.ts` covers `getThread()`'s two new fields directly (correct counterpart identity from either side, including the sent-everything-myself case) — its authorization gates (`not_a_member`/`not_found`/`not_a_participant`) are unchanged and already covered by that file's existing tests. The one new piece of page-level "logic" (comparing `message.senderId` to the caller's own account id) is a one-line, self-evidently-correct comparison exercised end-to-end by the Playwright suite, not a candidate for its own isolated unit test (mirrors this codebase's existing precedent of not unit-testing trivial inline comparisons/validators separately from their consuming test, e.g. `isValidPriceCents()`).

**Target Platform**: The existing single Next.js web app (App Router), installable PWA, Docker/Dokploy — no new deployable unit, no new route. The conversation still lives at the exact existing URL `/communities/{communityId}/threads/{threadId}`; every existing link into it (the Chats hub, a listing's own thread inbox) needs zero changes.

**Project Type**: Extension of the existing single Next.js/Prisma project (no new top-level project).

**Performance Goals**: None beyond standard interactive web-app latency. No pagination is introduced — `getThread()` already loads a thread's full message history unpaginated today, and this feature does not change that (out of scope per spec.md; consistent with this codebase's existing per-thread, per-listing unpaginated read patterns).

**Constraints**: Message ownership (right vs. left) is derived purely by comparing each message's existing `senderId` to the caller's own account id already available on the page — no new field needed for this part. The chat header's counterpart identity is the one exception (research.md #6): `getThread()` gains `counterpartId`/`counterpartDisplayName` on its existing `thread` result, computed with the exact derivation its sibling functions in the same file already use — no new field is invented, an existing computation is simply exposed one function further. The bottom-attached composer inside a fixed-height, internally-scrolling panel is a new layout shape for this codebase (research.md #3 — no identical existing pattern to copy verbatim); it is built from the existing visual vocabulary (`rounded-card`, `shadow-card`, pill-shaped controls, the existing `brand`/`ink`/`ink-muted`/`bg`/`surface`/`border` color tokens) rather than introducing new design primitives. Scrolling to the latest message is a client-only concern (the message list itself stays server-rendered); it is isolated to one small client component so the rest of the page remains a Server Component, consistent with this codebase's strong preference for Server Components except where genuinely necessary (mirrors `AppShell.tsx`'s own isolated client-side effect for its unrelated deep-link sync).

**Scale/Scope**: One thread's conversation at a time; no new index is required — `Message`'s existing `[threadId, createdAt]` index already supports this feature's read pattern unchanged.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Admin-Controlled Membership Origin (NON-NEGOTIABLE) | N/A | No membership path is touched. |
| II. Community Isolation (NON-NEGOTIABLE) | **PASS** | `getThread()`'s existing access gate (`not_a_member`/`not_found`/`not_a_participant`) is completely unchanged — this feature only changes how the exact same already-authorized data is rendered. No new query, no new join, no new way to reach a thread's data. |
| III. Administrator as Community Gatekeeper | N/A | No administrator action is added or changed; mirrors 008's own "no administrator access path" precedent for one-to-one threads. |
| IV. Non-Custodial Payments — Transaction Logging as Source of Truth (NON-NEGOTIABLE) | N/A | No money or payment path is touched. |
| V. Single Web Application, Installable as PWA | **PASS** | Explicitly required and tested (User Story 5, FR-025–FR-027) — the redesigned conversation must work at common mobile and desktop widths, extending the existing responsive `AppShell` shell rather than introducing a new one. |
| VI. Contact & Data Privacy Gating | **PASS** | The header and every message continue to show only display name and message content — never email, phone, address, or authentication data (FR-006, FR-017), an unchanged continuation of the existing thread page's own guarantee (it never showed contact data either), now with an explicit test (User Story 4). |
| VII. Simplicity & MVP-First | **PASS** | Zero new entities, zero migrations, zero new service functions, zero new API routes — the one service change is two additional fields on an existing function's response, computed with a derivation that already exists twice in the same file. The only new file is one small client component isolating the auto-scroll effect; the existing reply-form component is restyled, not replaced or duplicated. |
| VIII. Test Discipline for Critical Flows (NON-NEGOTIABLE) | **N/A by constitution; mandatory by this feature's own spec** | Not a named critical flow (it changes no business rule). spec.md's Success Criteria (SC-001–SC-008) nonetheless commit to automated verification — tasks.md MUST carry these as required tests, mirroring 012/014's identical treatment. |
| IX. Platform Administration Authority (NON-NEGOTIABLE) | N/A | No MASTER-surface change; nothing here references `masterAdministrationService` or any `/master` route. |

**Additional Constraints check**: Tenancy — no new data store; the existing `communityId`-scoped access gate is untouched. Stack — no deviation, no new dependency. Migrations & backups — **none needed**; zero `prisma/schema.prisma` changes.

No Core Principle violations identified; Complexity Tracking table is not needed.

*Re-check after Phase 1 design: data-model.md and contracts/thread-conversation-api.md describe zero changes to any existing contract or entity — the single existing send endpoint's request/response shape, status codes, and validation are confirmed unchanged. No new PII field is introduced. No administrator- or MASTER-only route or field was introduced.*

## Project Structure

### Documentation (this feature)

```text
specs/016-chat-conversation-redesign/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── thread-conversation-api.md
└── tasks.md             # Phase 2 output (/speckit-tasks command — not created by /speckit-plan)
```

### Source Code (repository root)

Extends the existing single Next.js/Prisma project established by 002-015 — no new top-level project, no schema/migration changes.

```text
src/
└── server/
    └── services/
        └── messageService.ts   # extended: getThread()'s thread result gains counterpartId/
                                 #   counterpartDisplayName (research.md #6) — same derivation
                                 #   listThreads()/listMyThreads() already use in this file;
                                 #   no other function, gate, or route in this file changes

app/
└── communities/
    └── [communityId]/
        └── threads/
            └── [threadId]/
                ├── page.tsx              # rewritten: renders the chat header (counterpart name/link,
                │                         #   listing title), the message list as right/left-aligned
                │                         #   bubbles (derived from message.senderId === account.accountId,
                │                         #   no per-message sender-name link anymore — the header now
                │                         #   carries the one profile link, FR-003–FR-020), the empty
                │                         #   state, wrapped in the new ChatScrollArea below, and the
                │                         #   existing ThreadReplyForm as the attached composer
                ├── ChatScrollArea.tsx    # new: small client component — receives the server-rendered
                │                         #   message list as children plus the current message count;
                │                         #   scrolls a bottom sentinel into view on mount and whenever
                │                         #   the count changes (FR-018–FR-020). No other state, no
                │                         #   network calls, no business logic.
                └── ThreadReplyForm.tsx   # restyled only: same POST to the same existing endpoint, same
                                          #   validation and display-name-prompt behavior, new composer
                                          #   markup (attached to the bottom of the panel, FR-021–FR-023)
```

**Structure Decision**: The conversation keeps its exact existing route and every existing entry point into it (`app/chats/page.tsx`, `app/communities/[communityId]/threads/page.tsx`) — zero changes needed to either, since neither embeds any thread-page markup itself, only a link to it. The only rewritten file is the thread detail page itself, plus one new small client component whose sole job is scroll positioning, plus a purely visual restyle of the existing reply form. `messageService.ts` gains two fields on one existing function's response — no new function, no new file, no API route. No other page or service is touched.

## Complexity Tracking

*No Core Principle violations — table not needed. This feature is smaller in surface area than any prior one in this codebase's history: one rewritten page, one new ~20-line client component, a purely visual restyle of one existing form, and a two-field addition to one existing function's response (no new function, route, entity, or migration).*
