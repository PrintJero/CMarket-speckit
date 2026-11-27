# Contract: Web App Manifest and Icons

## `GET /manifest.webmanifest`

- **Auth**: none (public). Must be reachable signed out.
- **Status**: `200`
- **Content-Type**: `application/manifest+json`
- **Body** (exact required fields; additional standard fields allowed):

```json
{
  "name": "CMarket",
  "short_name": "CMarket",
  "description": "Community marketplaces",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "background_color": "#f7f7f9",
  "theme_color": "#7c1ff2",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

- **Linked from every page** as `<link rel="manifest" href="/manifest.webmanifest">`.

## Icons

| Request | Status | Content-Type | Notes |
|---|---|---|---|
| `GET /icons/icon-192.png` | 200 | `image/png` | decoded size exactly 192×192 |
| `GET /icons/icon-512.png` | 200 | `image/png` | 512×512 |
| `GET /icons/icon-maskable-512.png` | 200 | `image/png` | 512×512, wordmark within the 80% safe zone |
| `GET /icons/apple-touch-icon.png` | 200 | `image/png` | 180×180, linked as `<link rel="apple-touch-icon">` |

## Page `<head>` (iOS / theme)

- `<meta name="theme-color" content="#7c1ff2">`
- `<meta name="mobile-web-app-capable" content="yes">` (emitted by Next for `appleWebApp.capable`)
- `<meta name="apple-mobile-web-app-title" content="CMarket">`
- `<meta name="apple-mobile-web-app-status-bar-style" content="default">`
- `<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">`

## Installability (Chrome engine)

With the production build served and the worker active, CDP `Page.getInstallabilityErrors` returns
`{ installabilityErrors: [] }` and `Page.getAppManifest` reports no manifest `errors`.
