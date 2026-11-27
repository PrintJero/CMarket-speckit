---

description: "Task list for 018-pwa-installable"
---

# Tasks: Installable PWA

**Input**: Design documents from `/specs/018-pwa-installable/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/manifest.md, contracts/service-worker.md, quickstart.md

**Tests**: The spec explicitly requests Playwright tests (manifest/icons, worker registration, the
cache allowlist, offline fallback, installability, mobile viewports). Per Principle VIII they are
written first and confirmed **red** before implementation. All e2e tests run against the
production build (`npm run build`, then `npm run test:e2e`, which serves `next start`), because the
worker registers only in production.

**Organization**: grouped by user story (US1 install, P1; US2 offline, P2; US3 mobile, P3).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1, US2, US3 (user story phases only)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: static assets and the deployment fix every story depends on.

- [ ] T001 [P] Create the original, provisional "CM" wordmark icon as `public/icons/icon.svg`: a 512×512 viewBox, a full-bleed `#7c1ff2` (brand) background, and a white bold "CM" centred inside the central 80% circle (maskable safe zone, research #2). Add an XML comment marking it provisional until an official logo exists.
- [ ] T002 Create `scripts/generate-pwa-icons.ts`. It launches the already-installed Playwright Chromium (`import { chromium } from "@playwright/test"`), renders `public/icons/icon.svg` and screenshots it to `public/icons/icon-192.png` (192×192, rounded corners), `public/icons/icon-512.png` (512×512, rounded corners), `public/icons/icon-maskable-512.png` (512×512, full-bleed) and `public/icons/apple-touch-icon.png` (180×180, full-bleed, since iOS applies its own mask). Run it once with `npx tsx scripts/generate-pwa-icons.ts` and commit the PNGs. No new dependency (SC-006).
- [ ] T003 [P] In `Dockerfile`, runner stage, add `COPY --from=builder --chown=node:node /app/public ./public` next to the `.next/static` copy, with a comment explaining that Next's standalone output excludes `public/`, and that without it `/sw.js` and `/icons/*` would 404 in production (research #8).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the worker's install step precaches `/offline`. If that page 404s, worker
installation fails, and with it every story.

- [ ] T004 Create `app/offline/page.tsx` per contracts/service-worker.md: `export const dynamic = "force-static"`, `metadata.title = "Offline · CMarket"`, no `AppShell`, no data access. Content: the CMarket wordmark, an `<h1>` "You're offline", the paragraph "CMarket needs a connection to show your communities.", and a "Try again" control as a plain `<a href="">` (reloads the current URL without JavaScript). Mobile-first layout using existing design tokens (`text-ink`, `bg-bg`, `text-brand`), with no horizontal overflow at 320px.

**Checkpoint**: `npm run build` lists `/offline` as a static (○) route.

---

## Phase 3: User Story 1 - Install CMarket to the home screen (Priority: P1) 🎯 MVP

**Goal**: supporting browsers offer installation; the installed app opens standalone with the
CMarket name and icon; nothing private is ever stored on the device.

**Independent Test**: production build → the manifest and icons are served → the worker activates
→ Chrome reports zero installability errors → after authenticated browsing, every cache key is in
the allowlist.

### Tests for User Story 1 (write first, confirm red) ⚠️

- [ ] T005 [US1] Create `tests/integration/test_pwa_installable.spec.ts` with these tests (signed out unless stated):
  1. `GET /manifest.webmanifest` is 200 with `application/manifest+json` and exactly the required fields and three icons from contracts/manifest.md.
  2. Each of the four icon URLs is 200 `image/png`, and its decoded size matches. Read the PNG IHDR width/height from bytes 16–23 of the response body; no image library.
  3. The home page `<head>` contains `meta[name=theme-color][content="#7c1ff2"]`, `link[rel=manifest]`, `link[rel=apple-touch-icon][href="/icons/apple-touch-icon.png"]` and `meta[name=apple-mobile-web-app-title][content=CMarket]`.
  4. `GET /sw.js` is 200 with `application/javascript` and a `Cache-Control` containing `no-cache`.
  5. After `page.goto("/")`, `await page.evaluate(() => navigator.serviceWorker.ready.then(r => r.active?.scriptURL))` ends with `/sw.js`, and the registration scope is `/`.
  6. Via `page.context().newCDPSession(page)`: `Page.getInstallabilityErrors` returns an empty `installabilityErrors` array, and `Page.getAppManifest` returns no `errors` (research #9).

  Confirm all six FAIL (red): no manifest, icons, metadata or worker exist yet.
- [ ] T006 [US1] Extend `tests/integration/test_pwa_installable.spec.ts` with:
  1. **Cache allowlist (SC-002, FR-006 to FR-009)**: reuse the helpers pattern from `tests/integration/test_listing_media_flow.spec.ts` / `test_purchase_flow.spec.ts` to create a community with a seller and a buyer, a listing with one photo (Cloudinary stubbed via `stubCloudinaryUpload` from `tests/integration/helpers.ts`), a message thread and a pending transaction. Sign in as the buyer, wait for `navigator.serviceWorker.ready`, then visit the feed, the listing detail (wait for its image to load), the thread, `/transactions` and `/account`, and reload each once so a controlled page issues requests through the worker. Collect every key: `caches.keys()` → `cache.keys()` → `new URL(req.url).pathname`. Assert that the only cache name is `cmarket-static-v1`, that no path starts with `/api/`, and that every path matches `^/_next/static/|^/icons/|^/manifest\.webmanifest$|^/offline$`. Also assert at least one `/_next/static/` entry, which proves the worker is actually caching.
  2. **Old caches removed (FR-011, SC-004)**: in the page, `await caches.open("cmarket-static-v0")` and put one dummy entry. Then `navigator.serviceWorker.getRegistration()` → `registration.unregister()`, reload, wait for `ready` (a fresh install and activate run), and assert that `caches.keys()` equals `["cmarket-static-v1"]`.

  Confirm both FAIL (red).

### Implementation for User Story 1

- [ ] T007 [P] [US1] Create `app/manifest.ts` exporting `default function manifest(): MetadataRoute.Manifest` with exactly the fields of contracts/manifest.md (name/short_name "CMarket", description "Community marketplaces", start_url/scope "/", display "standalone", background `#f7f7f9`, theme `#7c1ff2`, the three icons with `purpose` "any"/"any"/"maskable").
- [ ] T008 [P] [US1] Create `app/_components/ServiceWorkerRegistrar.tsx` (`"use client"`). It returns `null`, and in a `useEffect` returns early unless `process.env.NODE_ENV === "production"` and `"serviceWorker" in navigator`. Otherwise it calls `navigator.serviceWorker.register("/sw.js", { scope: "/" })`. On rejection it logs a single `console.warn` (no rethrow), since the app must keep working as a plain website (spec edge case).
- [ ] T009 [P] [US1] Create `public/sw.js` implementing contracts/service-worker.md exactly, in plain ES2020 with no imports:
  - `CACHE = "cmarket-static-v1"`; `PRECACHE = ["/offline", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon-maskable-512.png", "/icons/apple-touch-icon.png"]`.
  - **install**: `cache.addAll(PRECACHE.map(u => new Request(u, { credentials: "omit" })))`, then `skipWaiting()`.
  - **activate**: delete every `cmarket-*` cache ≠ `CACHE`, then `clients.claim()`.
  - **fetch**, rules in this order, each with a comment naming its FR:
    1. return (no `respondWith`) for non-GET, cross-origin, and `/api/` requests;
    2. navigations: `respondWith(fetch(request).catch(() => caches.match("/offline")))`, never `put`;
    3. allowlisted static paths: cache-first, `put` only when `response.ok && response.type === "basic"` and `Cache-Control` matches neither `/private/i` nor `/no-store/i`;
    4. everything else: return.

  Add a header comment stating the privacy invariant, and that changing the rules or the precache list requires bumping `CACHE`. FR-009's private/no-store guard is defence in depth (allowlisted paths are never private today) and is verified by code review rather than an e2e test (analysis C1).
- [ ] T010 [P] [US1] In `next.config.ts`, add `async headers()` returning, for `source: "/sw.js"`, `Cache-Control: no-cache, no-store, must-revalidate` and `Content-Type: application/javascript; charset=utf-8`. Add a comment noting that `Service-Worker-Allowed` is intentionally absent, because a root-level worker already has scope `/` (research #6).
- [ ] T011 [US1] In `app/layout.tsx`, extend `metadata` with `appleWebApp: { capable: true, title: "CMarket", statusBarStyle: "default" }` and `icons: { apple: "/icons/apple-touch-icon.png" }`; add `export const viewport: Viewport = { themeColor: "#7c1ff2" }`; render `<ServiceWorkerRegistrar />` inside `<body>` after `{children}`.
- [ ] T012 [US1] In `playwright.config.ts`, set `use.serviceWorkers: "block"` as the suite default, with a comment: a worker that answers navigations hides those requests from `page.route` and makes `page.goto` responses `fromServiceWorker`, so the existing suite must not silently start depending on it. In both PWA specs (`test_pwa_installable.spec.ts`, and `test_pwa_mobile_viewports.spec.ts` from T015), add `test.use({ serviceWorkers: "allow" })` (analysis U1). Then `npm run build` and run `tests/integration/test_pwa_installable.spec.ts`: T005 and T006 must be green. Finally run the full `npm run test:e2e` to confirm nothing else changed.

**Checkpoint**: US1 is fully functional and testable on its own (MVP).

---

## Phase 4: User Story 2 - A clear offline message instead of a browser error (Priority: P2)

**Goal**: failed navigations show the CMarket offline page; online navigations are always live.

**Independent Test**: production build, visit once, go offline, navigate → "You're offline"; go
back online, "Try again" → the live page.

### Tests for User Story 2 (write first) ⚠️

- [ ] T013 [US2] Extend `tests/integration/test_pwa_installable.spec.ts` with:
  1. **Offline fallback (SC-003)**: sign in as a member, open the community feed, wait for `navigator.serviceWorker.ready` and for the page to be controlled (`navigator.serviceWorker.controller` non-null, reloading once if needed). Then `context.setOffline(true)`, `page.goto(<listing detail URL>)`. Assert the `h1` "You're offline" is visible and `page.url()` is still the listing URL. Then `context.setOffline(false)`, click "Try again", and assert the listing title is visible.
  2. **Network-first, never stale (US2-AS3)**: while online and controlled, open a listing detail, rename the listing directly through Prisma, reload, and assert the new title is shown and the old one is not.
  3. **Offline page carries no personal data (FR-014)**: with the signed-in member's display name and email known, read the cached offline response in the page (`caches.match("/offline")` → `.text()`) and assert it contains neither.

  Because the worker from T009 already implements the navigation branch, these are expected to pass immediately (the pattern of spec 011 T010/T013). If any is red, that reveals a defect to fix in T014.
- [ ] T014 [US2] Only if T013 is red: fix the navigation branch or the precache in `public/sw.js` (bumping `CACHE` if the caching rules change) until T013 is green. Record the outcome here.

**Checkpoint**: US1 and US2 both work independently.

---

## Phase 5: User Story 3 - Core screens fully usable on a phone (Priority: P3)

**Goal**: no desktop-only core screen at iPhone 13 / Pixel 7 sizes (Principle V).

**Independent Test**: each core screen at both device sizes shows no horizontal overflow, and its
primary action is visible.

### Tests for User Story 3 ⚠️

- [ ] T015 [US3] Create `tests/integration/test_pwa_mobile_viewports.spec.ts`. Set up one community with a seller, a buyer, a listing with a photo (stubbed), a thread with a message and a pending transaction. For each of `devices["iPhone 13"]` and `devices["Pixel 7"]` (via `browser.newContext({ ...devices[name] })`, research #11), sign in as the buyer and visit the five screens:
  - feed `/communities/{id}/listings` (primary action: the search/filter control);
  - listing detail (primary action: "Message" composer / propose purchase);
  - the thread (primary action: "Send reply");
  - `/transactions` (primary action: the transaction link);
  - `/account` (primary action: "Save").

  On each, assert `document.documentElement.scrollWidth <= window.innerWidth + 1` and that the primary action is visible.
- [ ] T016 [US3] For every screen T015 reports as overflowing or hiding its primary action, fix its layout in the owning component (e.g. `app/communities/[communityId]/listings/page.tsx`, `app/communities/[communityId]/listings/[listingId]/page.tsx`, `app/communities/[communityId]/threads/[threadId]/page.tsx`, `app/transactions/page.tsx`, `app/account/page.tsx`) until T015 is green. Record which screens, if any, needed changes.

**Checkpoint**: all three stories independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T017 [P] Add a "PWA" section to `README.md`: what is installable, and how (browser-native install UI only); that the icon is a provisional original "CM" wordmark, regenerated with `npx tsx scripts/generate-pwa-icons.ts`; the service-worker privacy invariant (static shell only; never `/api/`, page HTML or private responses) and the rule "bump `CACHE` when changing `public/sw.js` rules"; that the worker registers only in production builds; and that iOS delivers web push only to installed apps, which this feature does not use (FR-016, `specs/BACKLOG.md` §3).
- [ ] T018 Validate the production image (quickstart Scenario 6): `docker compose --profile app up -d --build`. `/sw.js`, `/manifest.webmanifest` and `/icons/icon-192.png` must return 200, `/sw.js` must have `Cache-Control: no-cache…`, and `/api/health` must return 200. Then stop the app container.
- [ ] T019 Full battery: `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build`, `npm run test:unit`, and `npm run test:e2e` three consecutive times, all green with 0 skipped. Also confirm SC-006: `git diff origin/develop -- package.json` shows no change to `dependencies`/`devDependencies` (analysis C4). Record the counts in the PR description.

---

## Dependencies & Execution Order

- **Setup (T001–T003)**: T002 depends on T001; T003 is independent.
- **Foundational (T004)**: blocks US1's worker install, so it must precede T009 and T012.
- **US1 (T005–T012)**: tests T005 and T006 before T007–T011; T007–T010 are [P] (different files); T011 depends on T008; T012 depends on all of them.
- **US2 (T013–T014)**: depends on US1's worker (T009) being active; T014 only if T013 is red.
- **US3 (T015–T016)**: independent of US1/US2 logic (pure layout), but runs against the same production build.
- **Polish (T017–T019)**: after all stories; T019 last.

## Parallel Example: User Story 1

```text
# After T005/T006 are written and red, these touch different files:
T007 app/manifest.ts
T008 app/_components/ServiceWorkerRegistrar.tsx
T009 public/sw.js
T010 next.config.ts
```

## Implementation Strategy

1. **MVP = Phase 1 + Phase 2 + US1.** CMarket becomes installable and provably stores nothing private. This alone closes the Principle V gap.
2. Add **US2** (offline page behaviour, freshness, and no-personal-data checks).
3. Add **US3** (mobile re-verification and any layout fixes).
4. Polish: README, Docker validation and the full battery, then a PR to `develop`.
