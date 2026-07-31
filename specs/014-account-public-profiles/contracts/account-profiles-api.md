# Contract: Account Profile and Shared-Community Member Profiles API

Every route requires an authenticated session (401 otherwise, matching every existing route in this app). This contract **supersedes** 012-profiles-reputation's `GET /api/communities/{communityId}/members/{accountId}` entry — the route's URL is unchanged, but its access rule and response shape are not.

## GET /api/communities/{communityId}/members/{accountId}

Fetch `accountId`'s public profile (FR-010–FR-017b). `communityId` is accepted for URL/back-link continuity only — it plays **no role** in the access decision or the response's content (research.md #1). Access is granted purely when the caller and `accountId` currently share at least one community.

**Responses**:

- `200 OK` — Body:
  ```json
  {
    "ok": true,
    "profile": {
      "accountId": "string",
      "displayName": "string | null",
      "averageRating": "number | null",
      "reviewCount": "number",
      "completedTransactionCount": "number",
      "communities": [
        {
          "communityId": "string",
          "communityName": "string",
          "memberSince": "string (ISO date)",
          "listings": [
            {
              "id": "string",
              "title": "string",
              "kind": "FOR_SALE | WANTED",
              "priceCents": "number | null",
              "stockQuantity": "number | null",
              "coverPhotoId": "string | null"
            }
          ]
        }
      ]
    }
  }
  ```
  `communities` contains exactly the current intersection of the caller's and `accountId`'s own memberships (FR-013, FR-014) — one entry when exactly one community is shared, all of them when several are, and the array is present but empty only in the impossible-in-practice case of an intersection check racing a departure between steps (not a normal response shape; ordinarily an empty intersection is rejected below). `averageRating`, `reviewCount`, and `completedTransactionCount` are global, identical in derivation to the self-profile response below (FR-011, FR-018) — never scoped to, or revealing, any one community (FR-019, FR-020).
- `404 Not Found` — `accountId` does not exist, **or** it exists but shares no current community with the caller. Identical response either way (FR-017, research.md #2), so a stranger cannot distinguish the two cases. Body: `{ "ok": false, "reason": "not_found" }`.

**Changed from 012's contract**: the `403 Forbidden` / `not_a_member` response is retired — an outsider sharing no community with `accountId` now gets `404`/`not_found`, not `403`. `memberSince` and `listings` move from single top-level fields to per-entry fields inside `communities` (FR-013). `status` is no longer present on a listing entry (FR-007).

## Pages (browser-facing, not a JSON contract)

- `GET /account` (rewritten): the self-profile page — the caller's own display name, email, account creation date, the three global reputation numbers, and one section per community the caller currently belongs to (community name → link to that community's listings feed; the caller's role; member-since date; their own active `FOR_SALE`/`WANTED` listings as clickable cards) (FR-001–FR-009b). Backed directly by `getSelfProfile()` — no separate API route (research.md #6).
- `GET /communities/{communityId}/members/{accountId}` (rewritten): the public profile page — display name, the three global reputation numbers, and one section per **shared** community (community name → link to that community's listings feed; the viewed account's member-since date there; their active listings there as clickable cards), backed by the route above (FR-010–FR-017b).
- Every existing page that already links a display name to this route is unchanged: `app/communities/[communityId]/listings/page.tsx` and `.../listings/[listingId]/page.tsx` (005/007), `.../threads/page.tsx` and `.../threads/[threadId]/page.tsx` (008), `.../transactions/page.tsx` and `.../transactions/[transactionId]/page.tsx` (013), `app/chats/page.tsx` (008), and `app/transactions/page.tsx` — all keep linking to `GET /communities/{communityId}/members/{accountId}` exactly as before; only what that route now renders has changed.

**Non-goals** (explicitly excluded, spec.md Out of Scope): no profile-editing endpoint beyond the existing Account behavior; no avatar/photo/bio/phone/address field on any route, request, or response; no followers/following endpoint; no notification, badge, or seller-tier field; no per-community reputation breakdown or "your rating in this community" field (unchanged from 012); no endpoint or field that names, counts, or otherwise makes inferable a community the caller does not currently belong to.
