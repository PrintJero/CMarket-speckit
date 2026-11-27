# Implementation Plan: Installable PWA

**Branch**: `018-pwa-installable` | **Date**: 2026-11-27 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/018-pwa-installable/spec.md`

## Summary

Make CMarket installable as a PWA (Constitution Principle V) with the smallest dependency-free
surface:

- a typed Next.js manifest route;
- committed icons generated once from an original "CM" SVG;
- iOS metadata in the root layout;
- a hand-written `public/sw.js`, registered only in production, that stores **only** the public
  static shell and falls back to a static `/offline` page when a navigation fails;
- `/sw.js` served uncached;
- the Docker runner fixed to ship `public/`.

Privacy is the design driver. An allowlist in the worker plus an allowlist assertion in the tests
guarantee that no API response, listing photo or page HTML is ever stored on the device (Principles
II and VI, 017 revocation).

## Technical Context

**Language/Version**: TypeScript 6 (app), plain ES2020 JavaScript for `public/sw.js` (served as-is, not bundled); Node 24

**Primary Dependencies**: Next.js 16.4 (App Router, `output: "standalone"`), React 19.2. **No new dependencies** (SC-006).

**Storage**: none server-side (no Prisma change). Device-side Cache Storage `cmarket-static-v1` (public static shell only; see [data-model.md](data-model.md)).

**Testing**: Playwright 1.61 against the production build (`next start`), including a CDP installability check (`Page.getInstallabilityErrors`); existing Vitest suite unaffected.

**Target Platform**: evergreen Chromium (Android, desktop) for installation; iOS Safari via "Add to Home Screen"; deployed in Docker on Dokploy behind HTTPS.

**Project Type**: web application (single Next.js app).

**Performance Goals**: static shell assets served from device storage on repeat visits; no added server work (the worker never touches `/api/`).

**Constraints**: never store private or personalised responses; network-first navigations; worker registered in production only; zero new dependencies.

**Scale/Scope**: about 10 new or changed files; 2 new Playwright specs; 5 committed image assets.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle | Assessment | Status |
|---|---|---|
| I. Admin-controlled membership | No membership logic touched. | ✅ |
| II. Community isolation (NON-NEGOTIABLE) | The worker never intercepts `/api/` and never stores page HTML, so community content cannot outlive membership on a device. This is enforced by an allowlist (research #4) and tested with an allowlist invariant over every cache key (research #10). | ✅ |
| III. Admin as gatekeeper | Not touched. | ✅ |
| IV. Non-custodial payments | Not touched. | ✅ |
| V. Single web app, installable PWA | **This feature closes the gap.** It also re-verifies five core screens at two phone sizes (FR-015). The iOS push limitation is documented (FR-016, BACKLOG). | ✅ |
| VI. Contact & data privacy | No personal data on the device. The offline page is static and precached with `credentials: "omit"`. | ✅ |
| VII. Simplicity & MVP-first | Hand-written worker, native manifest route, no libraries, no custom install UI (clarification), no push or offline content. | ✅ |
| VIII. Test discipline | Not a named critical flow, but the spec explicitly requests tests, and they gate CI. | ✅ |
| IX. Platform administration | `/master` pages are covered by the same "never store HTML" rule. | ✅ |
| Stack (decided) | Next.js App Router, Docker/Dokploy, unchanged. | ✅ |
| Migrations & backups | No schema change. | ✅ |

**Result: PASS. No violations, so Complexity Tracking is empty.**

_Post-design re-check (after Phase 1):_ still PASS. The design adds one more safeguard
(`credentials: "omit"` for precache) and surfaces one deployment fix (`public/` in the Docker image),
neither of which adds complexity beyond the spec.

## Project Structure

### Documentation (this feature)

```text
specs/018-pwa-installable/
├── plan.md              # This file
├── research.md          # Phase 0: decisions and rationale
├── data-model.md        # Phase 1: device cache + manifest (no DB changes)
├── quickstart.md        # Phase 1: validation scenarios
├── contracts/
│   ├── manifest.md      # manifest, icons, <head> metadata, installability
│   └── service-worker.md# /sw.js headers, request-handling table, /offline
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
app/
├── manifest.ts                          # NEW: MetadataRoute.Manifest (FR-001, FR-002)
├── layout.tsx                           # CHANGED: appleWebApp, apple icon, viewport.themeColor, <ServiceWorkerRegistrar/> (FR-003, FR-012)
├── offline/page.tsx                     # NEW: static offline page (FR-014)
└── _components/ServiceWorkerRegistrar.tsx # NEW: production-only registration (FR-012)

public/
├── sw.js                                # NEW: service worker (FR-006 to FR-011, FR-013)
└── icons/
    ├── icon.svg                         # NEW: original provisional "CM" wordmark (FR-004)
    ├── icon-192.png  icon-512.png  icon-maskable-512.png  apple-touch-icon.png  # NEW (FR-002, FR-003)

scripts/
└── generate-pwa-icons.ts                # NEW: one-off SVG→PNG via installed Playwright Chromium (research #2)

next.config.ts                           # CHANGED: headers() for /sw.js (FR-012)
Dockerfile                               # CHANGED: runner copies public/ (research #8)
README.md                                # CHANGED: "PWA" section (provisional icon, iOS push note, regeneration)

tests/integration/
├── test_pwa_installable.spec.ts         # NEW: manifest, icons, registration, installability, cache allowlist, offline, old-cache cleanup
└── test_pwa_mobile_viewports.spec.ts    # NEW: FR-015 at iPhone 13 / Pixel 7
```

**Structure Decision**: single Next.js project, as in every previous feature. New files follow the
existing conventions (`app/_components/` for shared client components, `scripts/` for one-off
tooling, `tests/integration/` for Playwright).

## Complexity Tracking

_No Constitution Check violations; nothing to justify._
