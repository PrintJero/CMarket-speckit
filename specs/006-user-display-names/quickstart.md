# Quickstart: User Display Names

Validates the feature end-to-end once implemented. See [data-model.md](./data-model.md) for schema and [contracts/display-names-api.md](./contracts/display-names-api.md) for the route/page contracts.

## Prerequisites

- PostgreSQL running and reachable, migrated with this feature's Prisma schema (`prisma migrate deploy`) — adds `Account.displayName`.
- `.env.test` has `GOOGLE_OAUTH_MOCK_ENABLED="true"` and `GOOGLE_OAUTH_MOCK_URL` (e.g. `"http://localhost:4310"`) set (in addition to the existing `OPERATOR_PANEL_ENABLED="true"` needed by 005's listing-feed tests), and `npm run test:e2e` starts the standalone mock server (`scripts/mock-google-oauth-server.ts`) as a second Playwright `webServer` entry alongside the Next.js dev server (research.md #2) — nothing under `app/` serves these endpoints.
- An existing `Community` with at least one member (e.g., via 004's invite/accept flow).
- The Next.js dev server running (`npm run dev`).

## Scenario 1 — A fellow member sees a display name, never an email (Story 1)

1. As member A (with a display name already set), create a listing in community C.
2. Sign in as member B of the same community C. Visit `/communities/{C.id}/listings`.
   - Expect A's display name on the listing card; expect A's email address nowhere in the rendered page or in the feed's JSON response.
3. Open the listing's detail page as B.
   - Expect the same display name shown there; expect A's email nowhere in the rendered page or in the listing's JSON response.
4. Create a second listing owned by member A2, who has no display name yet (e.g., seeded directly, bypassing the normal creation prompt). View it as B.
   - Expect the defined placeholder shown in place of a name; expect A2's email nowhere.

## Scenario 2 — An email/password account is prompted at first listing creation (Story 2)

1. Sign up a brand-new email/password account.
   - Expect no display-name field or prompt anywhere on the sign-up form.
2. Sign in as that account and visit `/communities/{C.id}/listings/new`.
   - Expect a required "Display name" field present on the form (the account has none yet).
3. Submit the form with a title/description/price and a display name.
   - Expect the listing to be created and the account's display name to now be set.
4. Attempt `POST /api/communities/{C.id}/listings` directly (bypassing the form) for a *different*, still-nameless account.
   - Expect `409 display_name_required`; no listing is created (FR-008, SC-003).
5. Create a second listing as the now-named account from step 3.
   - Expect no display-name field/prompt this time.

## Scenario 3 — A Google sign-in arrives already named, driven through the real callback (Story 3)

1. Configure the mocked Google userinfo fixture (research.md #2) for a fresh test email with `name: "Ada Lovelace"`.
2. Drive the real sign-in flow: visit `/sign-in`, initiate Google sign-in, let it redirect through `/api/auth/signin/google` → the mocked `/authorize` → the real `/api/auth/callback/google` → the mocked `/token` and `/userinfo`.
   - Expect a real session cookie to be set and the signed-in view to render.
3. Query the resulting `Account` row.
   - Expect `displayName: "Ada Lovelace"`, with no display-name prompt ever shown during the flow (SC-002).
4. Repeat with an existing, unverified email/password account for the same email (spec 002 FR-018's auto-link path) instead of a brand-new account.
   - Expect the same outcome: `displayName` populated from the mocked profile, since an unverified account can never have set one itself beforehand (FR-005).
5. Repeat once more against an existing, *verified* account that already has its own, previously-chosen `displayName`.
   - Expect that existing `displayName` to remain unchanged after the Google link completes (FR-006, SC-005).
6. Configure the mocked userinfo fixture with no `name` field at all and repeat sign-up for a brand-new email.
   - Expect the resulting account to have `displayName: null` — not an error (Edge Cases).

## Scenario 4 — Viewing and editing your own display name (Story 4)

1. Sign in as any account. Visit `/account`.
   - Expect the current display name (or its absence) shown.
2. Submit a new display name via the page's form.
   - Expect it saved, and expect a fellow member's subsequent view of that account's listings to reflect the new value.
3. Sign in as a *different* account and attempt `PATCH /api/account/display-name` while impersonating the first account (there is no account-id field to supply — attempt confirms the endpoint only ever targets the caller's own session).
   - Expect only the caller's own account to ever be affected; the first account's display name is unchanged (FR-002, SC-004).

## Scenario 5 — Format and blank-name rejection (FR-012, Edge Cases)

1. Attempt to set a display name that is blank or whitespace-only, via `/account`.
   - Expect `400 invalid_display_name`; the account's display name is unchanged.
2. Attempt a display name over 50 characters.
   - Expect `400 invalid_display_name`.

## Scenario 6 — The administrator member list is untouched (Constraint, FR-015)

1. As a community administrator, visit that community's existing member list page.
   - Expect it to look and behave exactly as before this feature: member emails shown, no display-name column added or removed.

## Scenario 7 — Automated test suite

1. Run `npm run test:unit` — Vitest unit tests (`resolveDisplayName()`/placeholder) and contract tests (`setDisplayName()`, `createListing()`'s new precondition, `listListings()`/`getListing()`'s `ownerDisplayName`) must pass, red-then-green per Principle VIII (this feature touches the already-critical product-listing and user-registration flows).
2. Run `npm run test:e2e` — Playwright specs driving the listing feed/detail rendering, the listing-creation prompt (including the direct-API-bypass case), the account settings page, and the mocked-Google-OAuth end-to-end flow (Scenario 3) must pass, alongside the full existing 002/003/004/005 suite (no regressions).
