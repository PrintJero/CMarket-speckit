# Data Model: Installable PWA (018)

**No database changes.** This feature adds no Prisma model, column or migration. The only "data"
lives on the user's device, in the browser's Cache Storage, and it is public and non-personalised
by construction.

## Device-side: static cache

| Attribute | Value / rule |
|---|---|
| Name | `cmarket-static-v1` (the version suffix is bumped whenever `sw.js` changes its caching rules or precache list) |
| Owner | `public/sw.js` (the only writer) |
| Allowed keys (request URL paths) | `/_next/static/…`, `/icons/…`, `/manifest.webmanifest`, `/offline` (FR-006) |
| Forbidden keys | any `/api/…` (FR-007); any page HTML except `/offline` (FR-008); any response with `Cache-Control: private` or `no-store` (FR-009); any cross-origin URL; any non-GET request (FR-013) |
| Credentials | precache requests use `credentials: "omit"`; runtime-cached static assets are identical for every user |

### Lifecycle

```text
install   → open cmarket-static-v1 → add /offline, /manifest.webmanifest, icon PNGs (credentials: omit)
            → skipWaiting()
activate  → for each cache name starting with "cmarket-" and ≠ cmarket-static-v1 → delete   (FR-011)
            → clients.claim()
fetch     → non-GET or cross-origin            → not intercepted (network)
            /api/*                              → not intercepted (network), never stored
            navigation                          → network; on network error → cached /offline
            /_next/static/*, /icons/*, manifest → cache-first; store only ok + basic + cacheable
            anything else                       → not intercepted (network)
```

## Web app manifest (public)

| Field | Value |
|---|---|
| `name` | `CMarket` |
| `short_name` | `CMarket` |
| `description` | `Community marketplaces` |
| `start_url` | `/` |
| `scope` | `/` |
| `display` | `standalone` |
| `background_color` | `#f7f7f9` (`--color-bg`) |
| `theme_color` | `#7c1ff2` (`--color-brand`) |
| `icons` | `/icons/icon-192.png` 192×192 `any`; `/icons/icon-512.png` 512×512 `any`; `/icons/icon-maskable-512.png` 512×512 `maskable` |

Full contract: [contracts/manifest.md](contracts/manifest.md).

## Static assets (committed, public)

| File | Size | Purpose |
|---|---|---|
| `public/icons/icon.svg` | vector | source of truth, original provisional "CM" wordmark |
| `public/icons/icon-192.png` | 192×192 | manifest `any` |
| `public/icons/icon-512.png` | 512×512 | manifest `any` |
| `public/icons/icon-maskable-512.png` | 512×512 | manifest `maskable` (wordmark inside the 80% safe zone) |
| `public/icons/apple-touch-icon.png` | 180×180 | iOS home screen |
| `public/sw.js` | — | service worker ([contracts/service-worker.md](contracts/service-worker.md)) |
