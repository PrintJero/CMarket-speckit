# Contract: Navigation Shell and Community Selector

One new route (setting the active community), one new page route (the active-community main view), and one rewritten page route (the top-level entry point). Every route requires an authenticated session (unauthenticated → existing sign-in redirect / 401, unchanged from today).

## POST /api/active-community

Sets the caller's active community for their current session. Used by the community-selection screen (FR-002) and the sidebar's community switcher (FR-014).

**Body**: `{ "communityId": string }`

**Responses**:

- `200 OK` — Body: `{ "ok": true, "communityId": string }`. Session's `activeCommunityId` is updated.
- `400 Bad Request` — `communityId` missing or not a string. Body: `{ "ok": false, "reason": "invalid_input" }`
- `403 Forbidden` — caller is not a current member of `communityId` (checked via the existing `requireCommunityMembership()` — no `allowSuspended`, since selecting a community to work in is a growth action, matching `createListing()`'s own convention). Body: `{ "ok": false, "reason": "not_a_member" }`. This is the same response whether the community doesn't exist, is `ARCHIVED`, or the caller was simply never a member — no information disclosure about communities the caller isn't part of.

## GET /communities/{communityId} *(new page route — Story 2 main view)*

Server-rendered page. Requires the caller to be a current member of `communityId` (same gate `listListings()` already applies internally); a non-member or nonexistent `communityId` renders `notFound()`, identical to the existing `/communities/{communityId}/listings` page's convention.

The page passes the account's currently-known `activeCommunityId` down to a client component (`MainViewControls.tsx`), which — in a post-hydration effect, never during server render — calls `POST /api/active-community` with this page's own `communityId` if it differs from the one passed down, then triggers a router refresh so the sidebar (which reads the same server-rendered `account` prop) reflects the change without a full page reload. This is what makes a genuine visit via a direct link, a sidebar switch, or a deep link (spec.md's deep-link Assumption) become the active community "for that visit." Deliberately NOT done as a side effect of the server render itself: Next.js `<Link>` prefetching (and any crawler or monitoring request hitting this route with a valid session cookie) fetches a page's RSC payload without the user ever intending to navigate there, and without ever running client-side JavaScript — a write during render would let mere prefetching silently reassign a member's active community. A post-hydration effect only ever runs on a real, completed navigation.

**Query params**: `q` (search term, optional), `kind` (`FOR_SALE` | `WANTED`, optional — omitted means `FOR_SALE`, the main view's default per FR-006).

**Renders**: search control; segmented For sale/Wanted toggle; a feed of `listListings(communityId, accountId, { search: q, kind })`'s results, each card showing title, price (via the existing `formatListingPrice()` — never raw cents), owner display name, a "verified member" badge (current-membership check, data-model.md), and reputation (`getReputationSummaries()` — rating/review count, blank/omitted when `reviewCount === 0` rather than showing a misleading "0 stars").

## GET / *(rewritten — top-level entry point)*

- No signed-in account → unchanged existing marketing/sign-in landing (`AuthShell`).
- Signed-in, zero memberships → unchanged existing empty state ("You don't belong to any community yet") — no directory/browse/join affordance (FR-004).
- Signed-in, `getCurrentAccount().activeCommunityId` is non-null (live-verified, data-model.md) → server-side redirect to `GET /communities/{activeCommunityId}` (FR-001a) — the selection screen is never shown.
- Signed-in, one or more memberships, no valid remembered active community → renders the community-selection screen (`CommunitySelector`), listing exactly `getCurrentAccount().memberships` (FR-001/FR-003/FR-005), each option posting to `POST /api/active-community` then redirecting to `GET /communities/{communityId}`.
