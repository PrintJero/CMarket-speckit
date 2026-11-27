# Quickstart: validating the installable PWA (018)

## Prerequisites

- Node 24, `npm ci`, Docker running (`docker compose up -d` for the dev/test databases).
- `.env.test` configured as in the README (Cloudinary dummies and `CLOUDINARY_TEST_STUB=true`).
- **A production build.** The service worker only registers in production:

```sh
npm run build
```

## Scenario 1: manifest, icons and installability (US1, FR-001 to FR-005)

```sh
npx playwright test tests/integration/test_pwa_installable.spec.ts
```

Expected:

- `/manifest.webmanifest` is 200 with the fields in [contracts/manifest.md](contracts/manifest.md),
  and every icon is 200 at its declared size.
- The worker registers and activates.
- CDP `Page.getInstallabilityErrors` returns an empty list.

Manual cross-check (optional): `npm run start`, open `http://localhost:3000` in Chrome, then
DevTools > Application > Manifest (no errors; "Installability" shows no issues) and Service Workers
(`/sw.js` activated, scope `/`). The install icon appears in the address bar.

## Scenario 2: nothing private is stored (US1-AS4, FR-006 to FR-009, SC-002)

Covered by the same spec. Signed in, it browses the feed, a listing with a photo, a chat and a
transaction, then asserts that every CacheStorage key is in the allowlist (see the invariant in
[contracts/service-worker.md](contracts/service-worker.md)): no `/api/`, no community or account
page.

Manual cross-check: DevTools > Application > Cache Storage > `cmarket-static-v1`. Only
`/_next/static/…`, `/icons/…`, `/manifest.webmanifest` and `/offline` are listed.

## Scenario 3: offline fallback (US2, FR-010, FR-014, SC-003)

Covered by the same spec: `context.setOffline(true)`, navigate to a community feed, and **"You're
offline"** is shown with the URL unchanged. Back online, "Try again" loads the live page.

## Scenario 4: old caches removed (FR-011, SC-004)

Covered by the same spec: it seeds a stale `cmarket-static-v0` cache, reloads so the worker
activates, and asserts that only `cmarket-static-v1` remains.

## Scenario 5: mobile viewports (US3, FR-015, SC-005)

```sh
npx playwright test tests/integration/test_pwa_mobile_viewports.spec.ts
```

Expected: at iPhone 13 and Pixel 7 sizes, the feed, listing detail, chat, transactions and self
profile have no horizontal page overflow, and their primary action is visible.

## Scenario 6: production image serves `public/` (research #8)

```sh
docker compose --profile app up -d --build
curl -fsS -o /dev/null -w "%{http_code}\n" http://localhost:3000/sw.js            # 200
curl -fsS -o /dev/null -w "%{http_code}\n" http://localhost:3000/icons/icon-192.png # 200
curl -fsSI http://localhost:3000/sw.js | grep -i cache-control                      # no-cache, no-store, must-revalidate
```

## Scenario 7: iOS (manual, production smoke test 8.6)

On an iPhone with Safari, open the production URL, then Share > **Add to Home Screen**. The icon and
title "CMarket" appear, and launching it opens standalone (no Safari UI). No push notifications are
expected (FR-016).
