/*
 * CMarket service worker (018-pwa-installable).
 * Contract: specs/018-pwa-installable/contracts/service-worker.md
 *
 * PRIVACY INVARIANT. This worker stores ONLY the public, non-personalised
 * static shell: versioned build assets (/_next/static/), icons (/icons/), the
 * manifest, and the offline page. It NEVER stores:
 *   - any API response (/api/...), in particular listing photos, which would let
 *     community content outlive membership (Constitution Principle II) and
 *     defeat 017's access revocation;
 *   - any page HTML except /offline (FR-008);
 *   - any response marked Cache-Control: private or no-store (FR-009).
 * Navigations are network-first and never stored; the cached /offline page is
 * served only when the network request itself fails (FR-010).
 *
 * Changing these rules or the PRECACHE list REQUIRES bumping CACHE, so that
 * activation deletes the previous version's storage (FR-011).
 */

const CACHE = "cmarket-static-v1";
const CACHE_PREFIX = "cmarket-";
const OFFLINE_URL = "/offline";

const PRECACHE = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // credentials: "omit" fetches the precache WITHOUT the session cookie, so
      // the stored offline page can never contain account data (FR-014).
      .then((cache) =>
        cache.addAll(PRECACHE.map((url) => new Request(url, { credentials: "omit" }))),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          // FR-011: remove every previous CMarket cache version.
          names
            .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE)
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/** FR-006: the only paths that may ever be stored. */
function isStaticAsset(pathname) {
  return (
    pathname.startsWith("/_next/static/") ||
    pathname.startsWith("/icons/") ||
    pathname === "/manifest.webmanifest"
  );
}

/** FR-009: never store a response its server marked private or no-store. */
function isCacheable(response) {
  if (!response.ok || response.type !== "basic") return false;
  const cacheControl = response.headers.get("Cache-Control") || "";
  return !/private/i.test(cacheControl) && !/no-store/i.test(cacheControl);
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // 1. FR-013: only same-origin GETs are ever considered; everything else goes
  //    to the network untouched (no respondWith).
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  // 2. FR-007: API responses are NEVER intercepted, and so never stored. This
  //    check comes before any caching logic so no later rule can widen it.
  if (url.pathname.startsWith("/api/")) return;

  // 3. FR-008/FR-010: navigations are network-first and never stored; the
  //    offline page is served only when the network request itself fails.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(OFFLINE_URL).then((offline) => offline || Response.error()),
      ),
    );
    return;
  }

  // 4. FR-006/FR-009: allowlisted public static assets, cache-first.
  if (isStaticAsset(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (isCacheable(response)) {
            const copy = response.clone();
            event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, copy)));
          }
          return response;
        });
      }),
    );
  }

  // 5. Everything else (RSC payloads, prefetches, ...) is not intercepted.
});
