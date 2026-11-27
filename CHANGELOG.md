# Changelog

All notable changes to CMarket are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Every feature has a
full Spec Kit record under `specs/###-name/` (spec, plan, tasks, contracts).

## [1.0.0] - 2026-11-27

First production release: a closed, community-gated marketplace delivered as a
single installable web app (Constitution v4.1.1).

### Added

- **002 Accounts and authentication:** self-service sign-up with email and
  password or Google, with mandatory email verification. An account with no
  community sees nothing, and sign-up never reveals whether an email exists.
- **003 Community creation:** communities are created only by platform
  tooling, with a founding administrator designated in the same atomic act. No
  public "create community" action exists.
- **004 Invitations and membership:** administrators invite by email with
  single-use, community-scoped invitations, which are the only path into a
  community. Verified accounts accept and become members.
- **005 Product listings:** community-scoped listings (every query scoped by
  `communityId`) with an `ACTIVE`/`PAUSED` status lifecycle, owner edits and
  administrator moderation.
- **006 User display names:** a display name is shown wherever a member appears.
  Email addresses are never shown to fellow members.
- **007 Listing discovery:** community feed with search, basic filters and
  pagination, all performed in SQL (never in application memory).
- **008 Listing messaging:** one text thread per listing and interested buyer,
  between the buyer and the owner, inside the community.
- **009 Platform administration:** a separate MASTER authority with its own
  sign-in. It covers community creation, suspension, automatic archival and
  restoration, account administration, the last-MASTER and last-administrator
  guards, and an immutable audit log.
- **010 Transaction logging:** members record a traceable transaction between
  them against a listing, as the source of truth for off-platform payment
  (Principle IV-a).
- **011 Wanted posts:** "looking for" posts alongside for-sale listings, with
  messaging and owner-only fulfilment.
- **012 Profiles and reputation:** member profiles and transaction-backed star
  ratings after a completed transaction.
- **013 Purchase flow with stock:** listings carry stock, buyers send purchase
  proposals that sellers accept or reject, and both parties have a transaction
  history. The non-intermediary disclosure is shown before submitting.
- **014 Account and member profiles:** separate self profile (account
  settings) and public profiles visible only between members who share a
  community.
- **015 Navigation shell and community selector:** pick an active community
  first, then work entirely inside it. The sidebar shows display names, never
  emails.
- **016 Chat conversation redesign:** a real chat-style thread UI. Messaging
  rules are unchanged.
- **017 Cloudinary listing media:** listing images are stored in Cloudinary,
  uploaded directly with signed requests and delivered through the app with
  access checks. PostgreSQL keeps only references.
- **018 Installable PWA:** web app manifest, original provisional icon, iOS
  metadata, and a dependency-free service worker that stores only the public
  static shell (never API responses, listing photos or page HTML). Includes an
  offline page and mobile checks at iPhone 13 and Pixel 7 sizes.

### Fixed

- **Google sign-in renamed other accounts.** Every Google sign-up or
  auto-link set the Google user's name on every account without a display
  name, across all communities. The update is now scoped to the linked account,
  with a regression test (#25).
- **Lost rating prompt.** The post-accept rating prompt could close before the
  seller rated when an active-community refresh landed mid-flow (#25).
- **Docker entrypoint and CRLF.** The production image restart-looped when
  built from a Windows checkout with a CRLF `docker-entrypoint.sh`. LF is now
  enforced by `.gitattributes` and normalised in the Dockerfile (#26, #27).
- **Missing `public/` in production.** The image did not ship `public/`, so the
  PWA assets would have returned 404 (#31).
- **MASTER accessibility.** The typed-confirmation field in MASTER dialogs is
  now labelled for assistive technology (#25).

### Security

- `next` 16.4.6 and `next-auth` 4.24.15 patch critical advisories (middleware
  bypass, email-normaliser homoglyph bypass). The unused `@auth/prisma-adapter`
  was removed (#28).

### Changed

- **CI:**
  - gitflow triggers (`main`, `develop`, `release/**`, `hotfix/**`);
  - format, production-build and Docker-image gates;
  - the e2e suite runs against the production build;
  - PR template with the constitution checklist (#25, #26).
- **Deployment:** after green CI, the image is published to GHCR and Dokploy is
  redeployed through a webhook. The production compose runs the published image
  plus an idle `tools` container for operations, and a credential-free smoke
  suite is included (#32).

### Breaking / Operations

- **Destructive migration (017).** `20260806000000_replace_listing_photos_with_cloudinary`
  irreversibly deletes every pre-existing listing photo. **Take and verify a
  database backup before deploying** to a database that holds data, then ask
  members to re-upload (`specs/017-cloudinary-listing-media/release-notice.md`).
- The production stack now **pulls** `ghcr.io/printjero/cmarket-speckit` instead
  of building on the server. Turn off Dokploy's own Git auto-deploy, because the
  Deploy workflow triggers it. See README, "Production deployment (Dokploy)".
- New scheduled jobs:
  - media cleanup every 15 minutes;
  - daily archival of communities suspended for more than 30 days;
  - daily backups with a retention of 7 days or more.

### Known / Backlog

See [`specs/BACKLOG.md`](specs/BACKLOG.md):

- in-app payment (Principle IV-b);
- access codes;
- push notifications (iOS limitation);
- Prisma 7, which resolves the remaining 4 high-severity `npm audit` findings in
  Prisma's own toolchain.

[1.0.0]: https://github.com/PrintJero/CMarket-speckit/releases/tag/v1.0.0
