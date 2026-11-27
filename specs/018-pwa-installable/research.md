# Research: Installable PWA (018)

All Technical Context unknowns are resolved below. Each entry records the decision, why, and the
alternatives that were rejected.

## 1. Manifest delivery

- **Decision**: `app/manifest.ts` (Next.js App Router metadata route) returning
  `MetadataRoute.Manifest`, served by Next at `/manifest.webmanifest` and linked automatically from
  every page's `<head>`.
- **Rationale**: native to the framework already in use (Constitution stack), typed, and needs
  neither a hand-maintained `<link rel="manifest">` nor a static file.
- **Alternatives considered**: a static `public/manifest.json`, which needs a manual `<link>` and is
  untyped. Rejected as more surface for the same output.

## 2. Icon generation without new dependencies

- **Decision**: commit one source SVG (`public/icons/icon.svg`, an original "CM" wordmark on the
  brand color) and the PNGs derived from it (`icon-192.png`, `icon-512.png`, `icon-maskable-512.png`,
  `apple-touch-icon.png` 180×180). The PNGs are produced once by `scripts/generate-pwa-icons.ts`,
  which renders the SVG with the **already-installed** Playwright Chromium (devDependency) and
  screenshots it at each size. The PNGs are committed, so neither build nor runtime generates
  anything.
- **Rationale**: FR-004 asks for an original icon, and SC-006 forbids new dependencies.
  `sharp` exists only as Next's transitive dependency, and relying on it from our own script would
  break silently on a Next upgrade. Playwright is a declared devDependency.
- **Maskable safe zone**: the maskable variant keeps the wordmark inside the central 80% circle
  (W3C maskable safe zone) on a full-bleed background. The standard variants use rounded corners.
- **Alternatives considered**: `next/og` `ImageResponse` icon routes (`app/icon.tsx`). These
  generate at request time and live outside `public/icons/`, which the spec names. Rejected. Adding
  `sharp`/`pwa-asset-generator` violates SC-006.

## 3. iOS metadata and theme color

- **Decision**: in `app/layout.tsx`, `metadata.appleWebApp = { capable: true, title: "CMarket",
  statusBarStyle: "default" }`, `metadata.icons.apple = "/icons/apple-touch-icon.png"`, and a separate
  `export const viewport: Viewport = { themeColor: "#7c1ff2" }`. In Next 15+ `themeColor` belongs in
  `viewport`, not `metadata`.
- **Colors**: theme `#7c1ff2` (`--color-brand`), background `#f7f7f9` (`--color-bg`), from
  `app/globals.css`. No new palette.

## 4. Service worker: hand-written, scoped strictly

- **Decision**: `public/sw.js`, plain JavaScript and dependency-free, with these rules:
  1. Every request whose method is not `GET`, or whose origin differs from `self.location.origin`,
     is not intercepted (no `respondWith`), so it goes to the network untouched (FR-013).
  2. Paths under `/api/` are **never** intercepted (FR-007). This check runs first, before any
     cache logic, so a later rule cannot accidentally widen it.
  3. Navigations (`request.mode === "navigate"`) are **network-first** with
     `fetch(request)` and are never written to a cache. On a network error (a rejected promise, not
     an HTTP error status), the worker answers with the cached `/offline` (FR-010).
  4. Allowlisted static assets (`/_next/static/`, `/icons/`, `/manifest.webmanifest`) are
     **cache-first**. On a miss, the network response is stored only if it is `ok`, same-origin
     (`type === "basic"`), and its `Cache-Control` contains neither `private` nor `no-store`
     (FR-006, FR-009).
  5. Everything else (RSC payloads `?_rsc=`, prefetches, fonts outside `/_next/static`) is not
     intercepted.
- **Install**: precaches exactly `/offline`, `/manifest.webmanifest` and the icon PNGs, using
  `new Request(url, { credentials: "omit" })`. The offline page is therefore fetched **without the
  session cookie**, and the copy stored on the device cannot contain account data even if the page
  ever became dynamic (defence in depth for FR-014). Then `skipWaiting()`.
- **Activate**: deletes every cache whose name starts with `cmarket-` and is not the current
  `cmarket-static-v1` (FR-011), then `clients.claim()`.
- **Why `/_next/static/` is safe to cache-first**: Next fingerprints those files with a content
  hash and serves them `immutable`. They are identical for every user and contain no data.
- **Alternatives considered**: `next-pwa`/`serwist` (rejected: new dependencies, SC-006, and broad
  default runtime-caching recipes that would contradict FR-007/FR-008); stale-while-revalidate for
  navigations (rejected: it serves stored HTML, which violates FR-008 and Principle II).

## 5. Registration only in production

- **Decision**: `app/_components/ServiceWorkerRegistrar.tsx`, a client component rendered once in
  the root layout. In an effect, it returns early unless
  `process.env.NODE_ENV === "production"` (inlined at build time) and `"serviceWorker" in navigator`,
  and then calls `navigator.serviceWorker.register("/sw.js", { scope: "/" })`. The effect and
  render produce no visible output.
- **Rationale**: FR-012 and the edge case "local development never debugs against stale assets".
  `next start` (which the e2e suite now uses) is a production build, so the tests exercise real
  registration.

## 6. Response headers for `/sw.js`

- **Decision**: `next.config.ts` `headers()` adds, for source `/sw.js`:
  `Cache-Control: no-cache, no-store, must-revalidate` and
  `Content-Type: application/javascript; charset=utf-8`.
- **`Service-Worker-Allowed`**: **not needed**. The worker lives at the root (`/sw.js`), so its
  default scope is already `/` (the spec says to add it only if necessary).
- **Rationale**: browsers cap worker-script HTTP caching at 24 hours, but an explicit `no-cache`
  makes a fixed worker reach users on their next load (FR-012).

## 7. Offline page

- **Decision**: `app/offline/page.tsx`, a Server Component with `export const dynamic =
  "force-static"`, rendered without `AppShell` (the root layout is bare, and `AppShell` is only used
  per page). Content: the CMarket wordmark, "You're offline", "CMarket needs a connection to show
  your communities", and a **"Try again"** control implemented as a plain `<a href="">`, which
  reloads the current URL and works without JavaScript or cached chunks.
- **Rationale**: the worker serves the offline HTML as the response to the original navigation, so
  the address bar keeps the requested URL and "Try again" retries exactly that page (US2-AS2).
  Using no JavaScript means the page renders even when route-specific chunks were never cached.
  Styling comes from the shared CSS chunk if it is cached, and otherwise degrades to readable
  unstyled HTML.

## 8. Docker image must ship `public/`

- **Finding**: the runner stage copies `.next/standalone` and `.next/static` but **not `public/`**.
  Next's standalone output does not include `public/` by design. Without a fix, `/sw.js` and
  `/icons/*` would return 404 in production and the app would not be installable.
- **Decision**: add `COPY --from=builder --chown=node:node /app/public ./public` to the runner
  stage. `.dockerignore` does not exclude `public/`.

## 9. Verifying installability without Lighthouse

- **Finding**: Lighthouse 12 removed the standalone PWA category, so `--only-categories=pwa` is
  no longer available.
- **Decision**: verify installability in an automated Playwright test through Chrome's own
  installability engine. Open a CDP session (`page.context().newCDPSession(page)`), call
  `Page.getInstallabilityErrors` after the worker is active, and assert an empty list. This is the
  same check behind Chrome's install prompt and DevTools > Application > Manifest. Also call
  `Page.getAppManifest` and assert there are no manifest parse errors.
- **Rationale**: it is stronger than a manual checklist (runs in CI on every PR) and needs no new
  tool. The manual iOS "Add to Home Screen" check stays in the production smoke test (8.6), since
  no automated iOS Safari is available.

## 10. Testing the "nothing private is stored" guarantee

- **Decision**: after signing in, browsing the feed, a listing **with a photo** (Cloudinary stubbed,
  as in 017's tests), a chat and a transaction, the test evaluates in the page:
  `caches.keys()` → for each cache, `cache.keys()` → request URLs. It then asserts:
  - only `cmarket-static-v1` exists;
  - no URL path starts with `/api/`;
  - no URL path starts with `/communities`, `/chats`, `/transactions`, `/account`, `/my-listings`,
    `/master` or `/invitations`;
  - every URL path is in the allowlist (`/_next/static/`, `/icons/`, `/manifest.webmanifest`,
    `/offline`).
  The allowlist assertion is the real guard: any new cached path fails the test even if nobody
  remembered to add it to a denylist.
- **Offline test**: `context.setOffline(true)` → `page.goto(<community feed URL>)` → the offline
  heading is visible and the URL is unchanged. Then go back online, use "Try again" and confirm the
  live page renders.

## 11. Mobile check (FR-015)

- **Decision**: one Playwright spec that iterates
  `devices["iPhone 13"]` (390×844) and `devices["Pixel 7"]` (412×915) over the feed, a listing
  detail, a chat thread, the transactions list and the self profile. It asserts
  `document.documentElement.scrollWidth <= window.innerWidth + 1` (the same 1px tolerance as 017's
  SC-014 test) and that each screen's primary action is visible.
- **Note**: the existing project runs Desktop Chrome only. The spec uses
  `browser.newContext({ ...devices[...] })` per device instead of adding Playwright projects, so the
  rest of the suite is unaffected. WebKit is not installed in CI; the iPhone 13 descriptor runs in
  Chromium with iPhone viewport, DPR, touch and UA, which is enough for layout overflow checks.
