# Feature Specification: Installable PWA

**Feature Branch**: `018-pwa-installable`

**Created**: 2026-11-27

**Status**: Draft

**Input**: User description: "Installable PWA for CMarket (Constitution Principle V — 'MUST be installable as a Progressive Web App'; today there is no public/, manifest, or service worker, so the app cannot be installed). Scope (Principle VII, minimum viable): a web app manifest (name 'CMarket', start URL and scope '/', standalone display, background and theme colors, 192px, 512px and maskable 512px icons); icons plus an Apple touch icon and iOS home-screen metadata; a provisional original 'CM' wordmark icon; a hand-written service worker with no new dependencies, registered only in production; a minimal static offline page shown when a navigation fails without network. Security constraints: the service worker caches only static build assets, icons, the manifest and the offline page; it never caches API responses (especially listing photos — Principle II and 017's access revocation), authenticated HTML, or anything marked private/no-store; navigations are network-first with the offline page only as a fallback; versioned cache name with old caches removed on activation; the worker script itself is served uncached. UX: document that iOS has no push unless installed; this feature implements no push. Tests: manifest and icons served; worker registers in the production build; after authenticated browsing no API URL or community page is in any cache; offline navigation shows the offline page; installability criteria verified; main screens checked at iPhone 13 and Pixel 7 viewports, fixing any desktop-only screen."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Install CMarket to the home screen (Priority: P1)

A community member who uses CMarket from their phone adds it to their home screen (or installs it from the browser on desktop). From then on CMarket opens from its own icon, full screen, without browser address bar or tabs, under the name "CMarket" — like any other app on the device. Installing changes nothing about what the member can see: the installed app shows exactly what the website shows, for exactly the same account and communities.

**Why this priority**: Installability is a constitutional obligation (Principle V) that v1.0.0 does not yet meet. It is also the visible value of the feature: members reach their community in one tap.

**Independent Test**: Load CMarket's production build in a supporting browser, confirm the browser reports the app as installable, install it, and confirm it launches standalone with the CMarket name and icon.

**Acceptance Scenarios**:

1. **Given** a visitor on CMarket in a browser that supports installation, **When** the page loads, **Then** the browser offers to install "CMarket" and every installability criterion it checks is satisfied.
2. **Given** CMarket is installed, **When** the member opens it from the home screen, **Then** it opens at the CMarket home page in a standalone window that shows the CMarket icon and name and no browser address bar.
3. **Given** an iPhone user, **When** they use "Add to Home Screen", **Then** the home-screen shortcut uses the CMarket icon and title and opens in standalone mode.
4. **Given** a member browsed communities, listings, chats and transactions in the installed app, **When** the device's stored application data is inspected, **Then** it contains no API response, no listing photo, and no community or account page, only the public static application shell.

---

### User Story 2 - A clear offline message instead of a browser error (Priority: P2)

A member opens CMarket or follows a link inside it while their phone has no connection. Instead of the browser's generic "no internet" error, they see a short CMarket page explaining that they are offline and that CMarket needs a connection, with a way to retry. As soon as the connection is back, retrying loads the real, current page from the server. Never an outdated copy of private content.

**Why this priority**: It makes the installed app behave like an app when connectivity drops, which is common on phones. It comes after installability, which is the constitutional gap.

**Independent Test**: With the production build loaded once, switch the browser offline, navigate to any page, and confirm the CMarket offline page appears. Switch back online, retry, and confirm the live page loads.

**Acceptance Scenarios**:

1. **Given** CMarket has been opened at least once on the device, **When** the member navigates to any CMarket page while offline, **Then** the CMarket offline page is shown.
2. **Given** the offline page is shown, **When** connectivity returns and the member retries, **Then** the requested page loads fresh from the server.
3. **Given** a member is online, **When** they navigate to any page, **Then** the page always comes from the server (never from a device copy), so membership changes, removed listings and revoked photo access take effect immediately.

---

### User Story 3 - Core screens fully usable on a phone (Priority: P3)

A member on a typical phone (for example an iPhone 13 or a Pixel 7) can use every core screen (the community feed, a listing's detail page, a chat, their transactions and their profile) without horizontal scrolling, clipped controls, or a desktop-only layout.

**Why this priority**: Principle V says a core feature MUST NOT ship desktop-only. Earlier features each checked their own screens; this story re-verifies them together at the moment CMarket becomes installable on phones, and fixes any regression found.

**Independent Test**: Visit each core screen at iPhone 13 and Pixel 7 viewport sizes and confirm there is no horizontal page overflow and that the primary action on each screen is visible and usable.

**Acceptance Scenarios**:

1. **Given** a signed-in member on a phone-sized screen, **When** they open the feed, a listing, a chat, the transactions list and their profile, **Then** no page scrolls horizontally and each screen's primary action is reachable.

---

### Edge Cases

- **Membership removed after installing:** a member is removed from a community, or a listing photo's access is revoked (017). The installed app MUST NOT show that community's pages or that photo from any device copy, online or offline.
- **Shared device, sign-out:** after sign-out, the next person to open the installed app MUST NOT see the previous member's pages, because none were stored.
- **New release deployed:** the installed app picks up the new version. Static files from previous versions MUST be removed from the device instead of accumulating.
- **Browsers without service worker support** (or with it disabled): CMarket MUST keep working exactly as a normal website. Only the offline page and installability are lost.
- **Local development:** no service worker is registered, so developers never debug against stale assets.
- **Offline on first visit ever:** no offline page is available yet, and the browser's own offline error is acceptable.
- **iOS notifications:** iOS delivers web push only to installed apps. This feature sends no notifications, and the limitation is documented for future features (see `specs/BACKLOG.md`).

## Requirements _(mandatory)_

### Functional Requirements

**Installability**

- **FR-001**: CMarket MUST publish a web app manifest declaring the name "CMarket", a short name, start URL `/`, scope `/`, standalone display, a background color and a theme color.
- **FR-002**: The manifest MUST reference icons of 192×192 and 512×512 pixels, plus a 512×512 icon marked as maskable. Every referenced icon MUST be served successfully.
- **FR-003**: CMarket MUST provide a 180×180 Apple touch icon and iOS home-screen metadata (title and standalone-capable status bar), and MUST declare its theme color for the browser UI.
- **FR-004**: The icon MUST be an original "CM" wordmark designed for CMarket, documented as provisional until an official logo exists.
- **FR-005**: CMarket MUST satisfy the browser installability criteria (served over HTTPS in production, valid manifest, registered service worker that handles navigations) so that supporting browsers offer installation.

**Service worker: what it may and may not store (security-critical)**

- **FR-006**: The service worker MUST store on the device only these public, non-personalised resources: versioned static build assets (`/_next/static/…`), icons (`/icons/…`), the manifest, and the offline page.
- **FR-007**: The service worker MUST NEVER store any API response (`/api/…`), and in particular never a listing photo (`/api/communities/{id}/listing-photos/…`). Storing them would let content outlive membership (Principle II, community isolation) and defeat 017's photo access revocation.
- **FR-008**: The service worker MUST NEVER store HTML pages, whether of authenticated routes (communities, listings, chats, transactions, profiles, account, MASTER area) or of any other route except the offline page itself.
- **FR-009**: The service worker MUST NEVER store a response marked `Cache-Control: private` or `no-store`, even if it would otherwise qualify under FR-006.
- **FR-010**: Page navigations MUST be network-first: when the network answers, its response is used and never stored. Only when the network request fails is the stored offline page shown.
- **FR-011**: Device storage MUST use a versioned name (initially `cmarket-static-v1`). When a new version activates, every CMarket storage area with a different name MUST be deleted.
- **FR-012**: The service worker script MUST be served so that browsers re-check it on every load (no long-lived caching), and MUST be registered only in production builds.
- **FR-013**: Requests the service worker does not handle (any method other than GET, cross-origin requests, and everything excluded above) MUST pass through to the network unchanged.

**Offline experience**

- **FR-014**: CMarket MUST provide a static offline page that identifies CMarket, says the device is offline and that CMarket needs a connection, offers a retry action, and contains no personal or community data.

**Mobile usability (Principle V)**

- **FR-015**: The community feed, listing detail, chat, transactions and profile screens MUST render without horizontal page overflow at iPhone 13 (390×844) and Pixel 7 (412×915) viewport sizes, with each screen's primary action visible. Any screen found desktop-only MUST be fixed within this feature.

**Out of scope**

- **FR-016**: This feature MUST NOT implement push notifications, background sync, or offline access to any community content. The iOS push limitation MUST be documented.

### Key Entities

- **App manifest**: public description of the installable app (name, colors, start URL, icons). Contains no user data.
- **Static device cache**: versioned, device-local store holding only the public application shell listed in FR-006. Never holds API responses, HTML of any page except the offline page, or private responses.
- **Offline page**: static, public page shown only when a navigation fails for lack of network.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: In a supporting browser, 100% of the browser's installability checks pass for the production build, and installation can be completed in under 30 seconds from the first page load.
- **SC-002**: After a member browses the feed, a listing with photos, a chat and a transaction, **zero** API responses, **zero** listing photos and **zero** community, listing, chat, transaction, profile or account pages are found in device storage.
- **SC-003**: With the device offline, 100% of navigations to CMarket pages show the CMarket offline page instead of a browser error, once CMarket has been opened at least once.
- **SC-004**: After a new release, storage from previous versions is removed on the first launch of the new version (no more than one CMarket static cache remains).
- **SC-005**: All five core screens show zero horizontal page overflow at both reference phone sizes.
- **SC-006**: No new runtime or build dependency is added to the project.

## Assumptions

- Production is served over HTTPS (Dokploy with Let's Encrypt), which browsers require for service workers and installation. Local `next start` on `localhost` counts as a secure context for automated tests.
- No official logo exists, so the provisional "CM" wordmark icon uses CMarket's existing brand colors from the app's design tokens until a final logo is supplied.
- Theme and background colors are taken from the existing design tokens. No new palette is introduced.
- Offline support is limited to the offline page by design. Browsing community content offline would require storing private data on the device, which this feature forbids.
- Lighthouse removed its standalone PWA category in recent versions. If it is unavailable, installability is verified against the browser's own manifest/installability report and the criteria in FR-005, and the result is documented.
- Earlier features (005, 007, 015, 016, 017) already assert mobile overflow for their own surfaces. FR-015 is a consolidated re-check at the two named reference devices.
