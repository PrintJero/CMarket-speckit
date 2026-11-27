# Contract: Service Worker (`/sw.js`) and Offline Page

## `GET /sw.js`

- **Auth**: none (public).
- **Status**: `200`
- **Headers**: `Content-Type: application/javascript; charset=utf-8`,
  `Cache-Control: no-cache, no-store, must-revalidate` (FR-012). No `Service-Worker-Allowed`
  header: the worker lives at `/`, so its default scope is already `/`.
- **Registered** only by production builds, via `navigator.serviceWorker.register("/sw.js",
  { scope: "/" })`.

## Request-handling contract (normative, in evaluation order)

| # | Condition | Behaviour | Stored? | Requirement |
|---|---|---|---|---|
| 1 | `request.method !== "GET"` | not intercepted | never | FR-013 |
| 2 | URL origin ≠ worker origin | not intercepted | never | FR-013 |
| 3 | path starts with `/api/` | not intercepted | **never** | FR-007 |
| 4 | `request.mode === "navigate"` | network; on network **error** → cached `/offline` | **never** (the network response is not stored) | FR-008, FR-010 |
| 5 | path starts with `/_next/static/` or `/icons/`, or equals `/manifest.webmanifest` | cache-first; on miss fetch, then store only if `ok`, `type === "basic"`, and `Cache-Control` contains neither `private` nor `no-store` | conditionally | FR-006, FR-009 |
| 6 | anything else | not intercepted | never | FR-013 |

**Invariant (tested):** after any browsing session, every key in every CacheStorage cache belongs to
`cmarket-static-v1`, and its URL path matches one of: `^/_next/static/`, `^/icons/`,
`^/manifest\.webmanifest$`, `^/offline$`.

## Lifecycle

- **install**: `caches.open("cmarket-static-v1")`, then add `/offline`, `/manifest.webmanifest`,
  `/icons/icon-192.png`, `/icons/icon-512.png`, `/icons/icon-maskable-512.png` and
  `/icons/apple-touch-icon.png`, each as `new Request(url, { credentials: "omit" })`. Then
  `self.skipWaiting()`.
- **activate**: delete every cache whose name starts with `cmarket-` and is not
  `cmarket-static-v1` (FR-011), then `self.clients.claim()`.

## `GET /offline`

- **Auth**: none (public). Statically rendered (`force-static`), with no account or community data
  (FR-014).
- **Content**: the CMarket wordmark; heading **"You're offline"**; the explanation "CMarket needs a
  connection to show your communities."; a **"Try again"** link (`<a href="">`) that reloads the
  current URL and works without JavaScript.
- **Served by the worker** as the response to a failed navigation. The address bar keeps the
  originally requested URL.
