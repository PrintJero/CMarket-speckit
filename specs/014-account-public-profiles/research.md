# Phase 0 Research: Account Profile and Shared-Community Member Profiles

No item in Technical Context was left as NEEDS CLARIFICATION — the source spec was detailed enough (and the existing 012/013 precedent close enough) that every design question below had a clear, low-risk answer. This document records those decisions and their rationale.

## 1. Keep the public profile's existing route, change only what it returns

**Decision**: The public profile stays at `/communities/[communityId]/members/[accountId]` (page and `GET` API route). The `communityId` path segment is no longer used to decide *access* or to *scope* the response — it is retained purely so every existing "click a display name" link in the app keeps working unchanged.

**Rationale**: 8 existing files already link to this exact URL shape (listings feed/detail, chat thread list/detail, transaction list/detail, the Transactions hub). Access is now decided by FR-017 alone — "when the viewer and the viewed account currently share no community" — which is a property of the *pair of accounts*, not of the one community a particular link happened to originate from. Reusing the route avoids an app-wide link-rewrite for zero behavioral gain, directly satisfying Principle VII (Simplicity & MVP-First) and spec.md's own Assumption that "the public profile's route/entry point may continue to originate from a specific community context... even though its content aggregates every currently shared community."

**Alternatives considered**:
- *New top-level route* (e.g., `/members/[accountId]`), mirroring how `/transactions`, `/chats`, and `/my-listings` were introduced as cross-community pages alongside their community-scoped predecessors. Rejected: those precedents introduced a *new* capability (a cross-community list a single community-scoped page structurally couldn't express). Here, the community-scoped URL can express the exact same content once its underlying query changes — no structural reason to also rename the route, and doing so would require touching 8 unrelated files for no functional benefit.
- *Keep the old single-community gate as a stricter pre-condition on top of the intersection* (target must specifically still belong to the URL's own `communityId`, in addition to sharing something with the viewer). Rejected: this would make a profile link go stale the moment the target leaves that one specific community, even while a different shared community still exists — directly contradicting FR-017's plain "share no community" wording, which is not qualified by "specifically this one."

## 2. Collapse "account does not exist" and "no shared community" into one `not_found` response

**Decision**: `getProfile()` returns the same `{ ok: false, reason: "not_found" }` whether the target `accountId` does not exist at all or it exists but shares no current community with the viewer. The prior `not_a_member` reason (403, from 012) is retired.

**Rationale**: FR-017 requires that "no profile data — not even the display name" is returned when nothing is shared. If a nonexistent-account lookup and a no-shared-community lookup produced *different* responses (404 vs. 403), a caller could distinguish "this account doesn't exist" from "this account exists but we share nothing" — a narrow but real account-existence enumeration channel against strangers. Collapsing both into the same 404/`not_found` closes it, and is a strictly *more* private outcome than 012's own prior behavior, not a regression.

**Alternatives considered**: Keep two distinct reasons/status codes (404 for missing account, 403 for no-shared-community), matching 012's exact prior shape. Rejected for the enumeration reason above, and because FR-017's own wording ("no profile data... is returned") reads as one outcome, not two.

## 3. Reuse the existing epoch-matching "current membership" pattern, once more, locally

**Decision**: `profileService.ts` gains its own small helper that fetches an account's `Membership` rows joined to `Community.operationalEpoch`, keeping only rows whose own `operationalEpoch` matches their community's current one — the exact same filter already independently written in `getCurrentAccount()` (`src/lib/auth/currentAccount.ts`), `listMyListings()`, and `listMyThreads()`.

**Rationale**: This three-line filter is already duplicated three times in this codebase, by deliberate precedent (each service owns its own read shape rather than sharing a cross-module "current membership" utility). Introducing a new shared abstraction for a fourth, near-identical use would be the kind of speculative generalization Principle VII asks feature authors to avoid, not a simplification.

**Alternatives considered**: Extract a shared `getCurrentMemberships(accountId)` utility used by all four call sites. Rejected for this feature: doing so would touch three unrelated, already-shipped services' files for a refactor this feature does not need, expanding its blast radius well beyond "add a profile experience."

## 4. Global reputation and completed-transaction count: no new logic

**Decision**: Both profile types call the existing `getReputationSummary()` (012, `reviewService.ts`) unchanged, and compute the completed-transaction count exactly as 012's own prior `getProfile()` already did — `prisma.transaction.count({ where: { state: "ACCEPTED", OR: [{buyerId: accountId}, {sellerId: accountId}] } })`, global, never filtered by community.

**Rationale**: FR-018–FR-021 explicitly require this to stay unchanged from 012/013; there is nothing to design here beyond reusing it identically for both the self and public profile.

## 5. No new migration; listing status is filtered on, never rendered

**Decision**: Listing sections on both profile types query `status: "ACTIVE"` (as before) but the returned shape does not include a `status` field at all, per the spec's amendment ("a listing's status is not shown, since only `ACTIVE` listings ever appear in this section").

**Rationale**: Directly stated in spec.md FR-007/FR-023/FR-024; no alternative to weigh.

## 6. Self profile needs no dedicated API route

**Decision**: `app/account/page.tsx` calls `getSelfProfile()` directly as a server component, the same pattern already used by `/transactions`, `/my-listings`, and `/chats` — no new `GET` API route is introduced for it.

**Rationale**: None of those three precedents (all cross-cutting, read-only, no client-side interactivity beyond navigation) have their own list-fetching API route either; they call their service function directly from the page. The self profile has the identical shape (read-only, no client mutation), so the same precedent applies. The public profile's existing `GET` route is kept only because it already exists and an existing Playwright test exercises it directly as an HTTP contract surface (`test_profile_view.spec.ts`) — not because this feature needs a new one for the self profile.
