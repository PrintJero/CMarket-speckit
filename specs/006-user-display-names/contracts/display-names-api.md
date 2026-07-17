# Contract: User Display Names

New and changed surfaces this feature introduces. All routes require an authenticated session (existing `Session` cookie, unified per 002's 2026-07-17 bug-fix amendment) — an absent/invalid session returns `401 Unauthorized` with no further processing, exactly as every other authenticated route in this codebase.

## PATCH /api/account/display-name

Set or change the caller's own display name (FR-002, FR-012, FR-013). The target account is always the caller's own — derived exclusively from the session cookie via `getCurrentAccount()`, never from a request field — so this endpoint has no way to act on any account other than the caller's own.

**Request**: `{ "displayName": "string" }`

**Responses**:
- `200 OK` — Body: `{ "ok": true, "account": { "id", "displayName" } }`.
- `400 Bad Request` — `displayName` is blank after trimming, or exceeds 50 characters. Body: `{ "ok": false, "reason": "invalid_display_name" }`.

This is the *only* write path for `Account.displayName` — reused by both the account-settings page (User Story 4) and the listing-creation flow below (User Story 2), so FR-012's validation exists in exactly one place.

## POST /api/communities/{communityId}/listings *(existing endpoint, 005 — one new response added)*

Unchanged request/response shapes, with one addition: `createListing()` now also rejects an attempt for a caller whose account has no `displayName` yet (FR-008), independent of anything else in the request.

**Responses (new)**:
- `409 Conflict` — the caller's account has no `displayName` yet. Body: `{ "ok": false, "reason": "display_name_required" }`. This applies identically whether the request came from the listing-creation page or a direct request — there is no separate, more permissive path (research.md #3).

## GET /api/communities/{communityId}/listings and GET /api/communities/{communityId}/listings/{listingId} *(existing endpoints, 005 — response shape extended)*

Each returned listing gains one field: `"ownerDisplayName": string | null` (FR-009). `null` means the owner has no display name yet — callers rendering this to a fellow member MUST substitute the defined placeholder (FR-011) themselves; the API never resolves it server-side (data-model.md's "Derived data" section) and never substitutes the owner's email address in its place (FR-010).

## Test-only: mocked Google OAuth boundary *(revised, third round — a standalone script, not part of this application's JSON contract at all)*

Exists solely to let User Story 3 / SC-002 drive the real `/api/auth/[...nextauth]` callback route end-to-end without depending on Google's live consent screen (research.md #2). This is **not** a route this application exposes — `scripts/mock-google-oauth-server.ts` is a standalone Node HTTP server, started only by Playwright's test configuration (a second `webServer` entry), never by `npm run build`/`next build`/`next start`. It is documented here only because `authConfig.ts` (real, shipped code) points at it when `GOOGLE_OAUTH_MOCK_ENABLED === "true"`:

- `GET /authorize` — redirects to the request's own `redirect_uri` query parameter with `code=<fixed-or-per-test value>` and the same `state` value it was given — no consent screen, no user interaction.
- `POST /token` — returns a fixed `{ "access_token": "...", "token_type": "Bearer", "id_token": "..." }` for any well-formed request; does not validate PKCE (this boundary is not what this feature is testing).
- `GET /userinfo` — returns a Google-profile-shaped JSON body (`sub`, `email`, `email_verified`, `name`, `picture`) sourced from a small, test-only, in-memory fixture keyed by the access token presented — so a single Playwright test run can drive multiple distinct mocked profiles (e.g., one with `name` present, one without, per the Edge Cases entry on a nameless provider profile) without any real network call.

An earlier round of this feature's own design hosted equivalent endpoints as actual Next.js routes under `app/api/test/mock-google-oauth/`, gated at runtime and (in a second revision) excluded from a production build via a `next.config.ts` check. That design is **retracted** (plan.md Complexity Tracking): the build-exclusion condition it relied on — `NODE_ENV === "production"` AND the route directory existing on disk — could never be false for a real deploy, since nothing removed that directory from the checked-in repository before a build, so every production build would have found it and failed permanently. Hosting the mock boundary as a standalone script outside `app/` removes the problem structurally: there is nothing under this application's route tree for a production build to find, in any state, so no build-time guard is needed at all.

The one piece of this boundary that remains real, shipped application code is `authConfig.ts`'s provider selection:

- It checks `process.env.GOOGLE_OAUTH_MOCK_ENABLED === "true"` before ever constructing a config pointing at `GOOGLE_OAUTH_MOCK_URL`; otherwise it registers the real `GoogleProvider(...)`, unchanged from before this feature. Default unset/false, so production always gets the real provider.
- `GOOGLE_OAUTH_MOCK_ENABLED=""` and `GOOGLE_OAUTH_MOCK_URL=""` are documented in `.env.example` with an explicit "never enable outside tests" warning.
- A static guard test asserts, by parsing `authConfig.ts`'s source, that every reference to `GOOGLE_OAUTH_MOCK_URL`/the mock provider construction is nested inside a branch conditioned on `GOOGLE_OAUTH_MOCK_ENABLED`.
- A behavioral test forces a real module re-evaluation of `authConfig.ts` under both env states (`vi.resetModules()` + dynamic `import()`) and inspects the *actual* resulting `authOptions.providers[0]`: real Google config (`wellKnown` present, no mock URL anywhere) when unset; mock config (`wellKnown` absent, endpoints under `GOOGLE_OAUTH_MOCK_URL`) when enabled — a present-but-wrong gate would pass the static test above while still failing this one.

See research.md #2 for the full revision history and plan.md's Complexity Tracking for the retracted design's audit trail.

## Pages (browser-facing, not a JSON contract but part of this feature's reachable surface)

- `GET /account` *(new)* — signed-in-only page showing the caller's own current display name (or its absence) and a form to change it (User Story 4). Reachable from a new link in the home page's sidebar (`app/page.tsx`).
- `GET /communities/{communityId}/listings/new` *(existing, 005 — form extended)* — when the signed-in account has no `displayName` yet, the creation form additionally shows a required "Display name" field; submitting first calls `PATCH /api/account/display-name`, then proceeds to create the listing only on that call's success (User Story 2). An account that already has a `displayName` sees no such field.
- `GET /communities/{communityId}/listings` and `GET /communities/{communityId}/listings/{listingId}` *(existing, 005 — rendering extended)* — each listing's card/detail view now shows the resolved owner display name (or the defined placeholder) instead of nothing (User Story 1); the owner's email is not present in the rendered page or in any data sent to the browser for it, exactly as before this feature (it was never rendered) and exactly as FR-010 requires going forward.
