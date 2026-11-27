# CMarket

A single Next.js (App Router) web application, installable as a PWA (Constitution Principle V).

## Getting started

```sh
npm install
docker compose up -d       # local dev + test PostgreSQL (see docker-compose.yml)
cp .env.example .env       # then fill in the values below
npx prisma migrate deploy
npm run dev
```

Running the test suites (`npm run test:unit`, `npm run test:e2e`) needs `.env.test` pointed at the `postgres-test` container instead of the dev database — copy `.env.example` to `.env.test` and set `DATABASE_URL` to the test container's port (`5433` in `docker-compose.yml`) plus `EMAIL_TEST_CAPTURE=true`. Both configs load `.env.test` automatically via `dotenv`.

## Environment variables

| Variable                                       | Required                | Purpose                                                                                                                                                                                                                    |
| ---------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                 | yes                     | PostgreSQL connection string (Prisma)                                                                                                                                                                                      |
| `NEXTAUTH_URL`                                 | yes                     | Base URL used for Auth.js callbacks and verification links                                                                                                                                                                 |
| `NEXTAUTH_SECRET`                              | yes                     | Long random string used by Auth.js to sign cookies                                                                                                                                                                         |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`    | yes, for Google sign-in | OAuth credentials from the Google Cloud Console                                                                                                                                                                            |
| `EMAIL_FROM`                                   | no                      | From-address used on outbound verification emails                                                                                                                                                                          |
| `EMAIL_WEBHOOK_URL` / `EMAIL_WEBHOOK_TOKEN`    | no                      | Provider-agnostic HTTP webhook for sending verification emails (see `src/lib/email/sendEmail.ts`). Leave unset in development — emails are logged to the console instead                                                   |
| `EMAIL_TEST_CAPTURE`                           | no                      | Set to `true` only for automated tests: captures sent emails in memory and exposes the last one per recipient at `GET /api/test/last-email?to=...`. **Never set this in a real deployment**                                |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` | yes                     | Cloudinary account identifiers for listing media. The cloud name and key reach the browser only inside a short-lived signed upload authorization, which the direct-upload protocol requires                                |
| `CLOUDINARY_API_SECRET`                        | yes                     | Server-only. **Never** give this a `NEXT_PUBLIC_` prefix, commit it, bake it into a Docker image, or log it                                                                                                                |
| `CLOUDINARY_ENV_FOLDER`                        | yes                     | `development` \| `test` \| `production`. The first path segment of every generated asset id. This prefix is what makes it impossible for a staging deployment to address or delete production assets                       |
| `LISTING_IMAGE_CACHE_MODE`                     | no                      | `no-cache` (default) or `no-store`. A mode, not a TTL — a `max-age` is deliberately not offered, because permitting cached reuse without revalidation is what would let a departed member keep seeing a community's images |
| `CLEANUP_TOKEN`                                | yes                     | Shared secret for `POST /api/listing-media/cleanup`, which drains the retryable Cloudinary deletion queue. Generate with `openssl rand -hex 32`                                                                            |
| `CLOUDINARY_TEST_STUB`                         | no                      | Set to `true` only for automated tests: replaces the Cloudinary Admin API verification call while still enforcing the public-ID prefix and provenance checks. **Never set this in a real deployment**                      |

There is deliberately **no** `NEXT_PUBLIC_CLOUDINARY_*` variable. The browser never builds a Cloudinary URL: images are delivered through an authenticated CMarket route, and the upload endpoint is returned at runtime by the authorize endpoint.

## Scripts

- `npm run dev` / `npm run build` / `npm run start` — Next.js app
- `npm run lint` / `npm run typecheck`
- `npm run test:unit` — Vitest (unit + contract tests)
- `npm run test:e2e` — Playwright (integration tests; starts its own dev server)
- `npm run prisma:generate` / `npm run prisma:migrate`
- `npm run create-community` — operator-only community bootstrap tool; see below

## Operations: Creating a community

Communities are never created by end users — there is no in-app "create a community" action anywhere in the product. Creating one is the sole, deliberate exception to admin-issued membership (Constitution Principle I), reserved for onboarding a real institution (a university, a residential complex).

**Who may run this**: only an operator who already has direct access to the application's server/database environment (e.g., production database access through the team's existing infrastructure access controls). There is no separate in-app role or account for this — the tooling is intentionally unreachable from the network (it is never imported by anything under `app/`, and running it requires the same access an operator would need to run a database migration).

**How it's requested**: an operator receives a request to onboard a new institution (e.g., via an internal support/ops channel), confirms the intended founding administrator already has a CMarket account with a **verified** email, and then runs the tool themselves. The tooling does not create accounts or verify email on anyone's behalf — if the intended administrator doesn't have a verified account yet, they must sign up and verify normally first.

**Usage**:

```sh
npm run create-community -- --name "Riverside Residences" --email "founder@example.com" --operator "your-name-or-identifier"
```

- `--name` — the community's display name (required, cannot be blank).
- `--email` — the existing, verified CMarket account to make founding administrator (required).
- `--operator` — an identifier for whoever is running this, recorded on the community for audit purposes (required; not tied to the CMarket account/authentication system).

On success, prints the created community's ID, name, and creation timestamp. On failure (no such account, that account's email isn't verified yet, or a blank name), prints a specific reason and exits non-zero — nothing is written to the database on failure.

See `specs/003-community-creation/contracts/community-creation.md` for the full contract.

## Operations: Listing media (Cloudinary)

Listing images are stored in Cloudinary and delivered through an **authenticated CMarket proxy** at `/api/communities/{communityId}/listing-photos/{photoId}`. The two directions are deliberately asymmetric: uploads go browser-to-Cloudinary directly using short-lived signed parameters, while reads are proxied so session and current membership are re-checked on every single image request.

**Deploying this for the first time:**

1. **Take and verify a database backup.** The `20260806000000_replace_listing_photos_with_cloudinary` migration deletes every existing listing photo irreversibly — it is a hard cutover with no legacy import path. Affected listings become image-less and show the existing "No photo" placeholder.
2. Set the six Cloudinary variables above. `CLOUDINARY_ENV_FOLDER=production`. Keep `CLOUDINARY_API_SECRET` an environment secret; do not bake it into the image.
3. Confirm the application server has **outbound network access to Cloudinary**. This is now required at _read_ time, not only at write time — if it is blocked, listing images stop rendering.
4. Deploy. Migrations apply via `prisma migrate deploy`, never `prisma db push --accept-data-loss`.
5. Schedule `POST /api/listing-media/cleanup` with an `X-Cleanup-Token` header. Every 15 minutes is ample; the endpoint is idempotent and safe to over-call. Without it, removed assets accumulate in Cloudinary — check `SELECT count(*) FROM media_cleanup_tasks` if storage grows unexpectedly.
6. **Ensure no shared cache or CDN sits in front of `/api/communities/*/listing-photos/*`.** The route returns `private, no-cache`, but a reverse proxy that caches on URL alone would serve one member's authorized bytes to an unauthorized caller and defeat the entire access model. Verify from outside the network that a request with no session cookie returns `401`.
7. Tell members their existing listing photos are gone and to re-upload. See `specs/017-cloudinary-listing-media/release-notice.md`.

## Docker

The app builds into a self-contained image (`Dockerfile`): Debian slim, Next.js
standalone output, non-root, with a `/api/health` probe that checks the database
rather than just the port. On startup it applies `prisma migrate deploy` and
**refuses to start if that fails** — serving traffic against an unexpected schema
fails in far more confusing ways.

**Local, app + database together:**

```bash
docker compose --profile app up --build
```

The `app` service is behind a profile, so the everyday `docker compose up`
(databases only, for `npm run dev`) is unchanged.

**Production / Dokploy:**

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Supply every environment variable from the platform (Dokploy's Environment tab).
`docker-compose.prod.yml` contains no secrets — only `${VAR}` references — and
pins the dangerous test switches (`OPERATOR_PANEL_ENABLED`,
`GOOGLE_OAUTH_MOCK_ENABLED`, `EMAIL_TEST_CAPTURE`, `CLOUDINARY_TEST_STUB`) to
empty so a stray value cannot switch them on.

### Two traps worth knowing

**1. `docker run --env-file` does not strip quotes.** Unlike dotenv and Next.js,
Docker takes the value literally, so `DATABASE_URL="postgresql://…"` arrives
_with_ the quote characters and Prisma rejects it:

> the URL must start with the protocol `postgresql://` or `postgres://`

Keep `.env` values **unquoted**. They work in every consumer that way.

**2. The database hostname differs by where the app runs.** `.env` holds the
host-side form (`localhost:5432`) because `npm run dev`, the tests and the
scripts all read it. A container cannot resolve `localhost`, so the compose
services override `DATABASE_URL` with the compose-network form
(`cmarket-db:5432`). For a bare `docker run`, pass the override yourself:

```bash
docker run --name cmarket --network cmarket-speckit_default \
  --env-file .env \
  -e DATABASE_URL=postgresql://cmarket:localdev@cmarket-db:5432/cmarket_dev?schema=public \
  -p 3000:3000 cmarket:latest
```

### Before deploying a destructive migration

`017-cloudinary-listing-media`'s migration deletes every pre-existing listing
photo irreversibly. Take and verify a database backup first — the entrypoint
applies migrations automatically, so there is no manual gate.

## Production deployment (Dokploy)

### How a release reaches production

```text
merge to main ─► CI (verify + docker) green ─► Deploy workflow
                                               ├─ build + push ghcr.io/printjero/cmarket-speckit:main
                                               │                     (+ :latest, :sha-<short>, :main-tools)
                                               ├─ POST DOKPLOY_WEBHOOK_URL (GitHub Environment "production"),
                                               │    fails unless Dokploy answers 200
                                               │    └─ Dokploy pulls the image, entrypoint runs
                                               │       `prisma migrate deploy`, app starts
                                               └─ poll ${APP_URL}/api/health for up to 5 min, fail unless 200
```

`develop` works the same way, deploying to the GitHub Environment `develop` with
the `:develop` tags. The workflow can also be run manually (Actions > Deploy >
Run workflow, on `develop` or `main`).

**The Dokploy server never builds.** It has 3.8 GB of RAM, and a Next.js build
there runs out of memory during `npm ci`. Images are built on GitHub's runners,
and `docker-compose.prod.yml` has no `build:` section, so Dokploy only pulls
what runs: exactly the commit CI validated (`.github/workflows/deploy.yml`).

**Secrets and variables policy:**

- Application secrets live **only** in Dokploy's Environment tab.
- Each GitHub Environment (`develop`, `production`) holds **one secret**,
  `DOKPLOY_WEBHOOK_URL`, and **one variable** (not a secret), `APP_URL`, e.g.
  `https://cmarket.example`, used for the post-deploy health check.
- Without the webhook, the image is still published, and the deploy and health
  check are skipped with a notice.
- GHCR uses the workflow's built-in `GITHUB_TOKEN`. No Bella Baxter.

### 1. Pre-flight checklist (do not deploy until every box is ticked)

- [ ] **Backup.** If the production database already holds data, take a backup
      and verify it. The 017 migration irreversibly deletes all earlier listing
      photos. If the database is new and empty, record that and continue.
- [ ] **Restore tested.** Perform an actual restore at least once. The
      constitution requires this before the first real community onboards.
- [ ] **Domain and HTTPS** configured in Dokploy (Traefik with Let's Encrypt).
      Secure cookies and the PWA both require HTTPS.
- [ ] **Postgres:** either the `postgres` service in `docker-compose.prod.yml`
      (persistent volume) or a managed instance. For a managed instance, delete
      that service and the `depends_on` entries of `app` and `tools`.
- [ ] **Environment variables** set in Dokploy's Environment tab, **without
      quotes**:
  - `DATABASE_URL`: the compose hostname `postgres`, or the managed host.
  - `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`: only when using the
    compose Postgres.
  - `NEXTAUTH_URL=https://<domain>` and `NEXTAUTH_SECRET`
    (`openssl rand -base64 48`).
  - `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. In Google Cloud Console,
    authorise `https://<domain>/api/auth/callback/google` and publish the
    consent screen, or add test users.
  - `EMAIL_FROM`, `EMAIL_WEBHOOK_URL` and `EMAIL_WEBHOOK_TOKEN`. Without these,
    verification emails are only logged and nobody can verify an account. The
    transport POSTs `{from,to,subject,text,html}` with
    `Authorization: Bearer <token>`, which matches Resend's
    `POST https://api.resend.com/emails`. The `EMAIL_FROM` domain must be
    verified with the provider (SPF/DKIM).
  - `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`,
    `CLOUDINARY_ENV_FOLDER=production` and
    `LISTING_IMAGE_CACHE_MODE=no-cache`.
  - `CLEANUP_TOKEN` (`openssl rand -hex 32`).
  - `APP_PORT`, if not 3000.
  - For the **develop** application only: `CMARKET_IMAGE=ghcr.io/printjero/cmarket-speckit:develop`
    and `CMARKET_TOOLS_IMAGE=ghcr.io/printjero/cmarket-speckit:develop-tools`.
  - Do **not** define `OPERATOR_PANEL_ENABLED`, `GOOGLE_OAUTH_MOCK_*`,
    `EMAIL_TEST_CAPTURE` or `CLOUDINARY_TEST_STUB`. The compose file pins them
    empty anyway.
- [ ] **Outbound network** from the server to Cloudinary (at read time too:
      images are proxied through the app) and to the email provider.
- [ ] **No CDN or shared cache** in front of
      `/api/communities/*/listing-photos/*`.
- [ ] **GHCR access.** If the package `cmarket-speckit` is private, add a GHCR
      registry in Dokploy (a token with `read:packages`) so the host can pull.

### 2. One-time setup

1. **GitHub:** Settings > Environments, then create `develop` and `production`.
   In each, add the secret `DOKPLOY_WEBHOOK_URL` (that environment's Dokploy
   redeploy webhook) and the variable `APP_URL` (its public URL, no trailing
   slash). Optionally require Jero's approval on `production`.
2. **Dokploy:** create a **Docker Compose** application from this repository,
   branch `main`, compose file `docker-compose.prod.yml`. Set the domain and the
   Environment tab as above. **Turn Dokploy's own Git auto-deploy off.**
   Deploys are triggered by the webhook from the Deploy workflow, which runs only
   after CI passes and the new image is in GHCR. Dokploy's push trigger would
   redeploy before the image exists. Repeat with branch `develop` for a staging
   application if wanted.
3. Trigger the first deploy from Dokploy, or by merging to `main`.

### 3. Deploy and watch the logs

The `app` container must log
`[entrypoint] migrations up to date; starting server.`

If it logs `migration failed — refusing to start`, **do not retry blindly**.
Inspect the database first:

```sh
docker exec <tools-container> npx prisma migrate status
```

### 4. Bootstrap initial data (the app is empty and unusable without this)

Run these in the idle `tools` container, which has the code and `tsx` and no
open ports:

```sh
docker exec <tools-container> npx tsx scripts/bootstrap-master.ts --master-id <id> --email <ops-email>
# Jero signs up at https://<domain> with his own email and verifies it, then:
docker exec <tools-container> npm run create-community -- --name "<Pilot community>" --email <verified-email> --operator "jero"
```

**Alternative without the tools container:** run the same scripts from a
workstation. Open an SSH tunnel to Postgres (`ssh -L 5439:localhost:5432 …`) and
set a temporary `DATABASE_URL` in the shell (never in a file).

### 5. Scheduled tasks (Dokploy > Schedules, or host cron)

| Every  | Command                                                                                             | Why                                                                                 |
| ------ | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 15 min | `curl -fsS -X POST -H "X-Cleanup-Token: $CLEANUP_TOKEN" https://<domain>/api/listing-media/cleanup` | removes abandoned uploads (017)                                                     |
| day    | `docker exec <tools-container> npx tsx scripts/archive-suspended-communities.ts`                    | archives communities suspended for more than 30 days (009, research #7; idempotent) |
| day    | Dokploy Backups of Postgres to S3 or similar, **retention of 7 days or more**                       | constitution: automated backups                                                     |

### 6. Smoke test (with evidence)

**Automated** (credential-free):

```sh
PLAYWRIGHT_BASE_URL=https://<domain> npm run test:smoke
```

It checks health, HTTPS, pages without console errors, unauthenticated photo
access → 401, cleanup without token → 401, every test-only switch off, and
installability.

**Manual** (with evidence):

1. Sign up with a new email, receive the real email, verify, sign in.
2. Sign in with Google.
3. The pilot admin invites the test user, who accepts and sees the feed.
4. Create a listing with a photo. It uploads to `cmarket/production/…`, appears
   in the feed, and the image renders.
5. Message on a listing. The other account receives it.
6. Purchase proposal, then accept. It appears in both histories, with no
   contact data.
7. A member of another community cannot see the listing or its image
   (404/403).
8. Cleanup with the token returns 200:
   `curl -fsS -X POST -H "X-Cleanup-Token: …" https://<domain>/api/listing-media/cleanup`.
9. PWA: Chrome DevTools > Application shows a valid manifest and an active
   worker; "Install app" appears on Android/Chrome. On iOS, "Add to Home
   Screen" opens standalone.
10. Logs show no errors and no secrets printed.

### 7. Rollback and hotfix

- **Rollback:** in Dokploy, set
  `CMARKET_IMAGE=ghcr.io/printjero/cmarket-speckit:sha-<previous 7-char commit>` and
  redeploy, or use Dokploy's deployment history. Migrations are forward-only, so
  restore the backup if a migration must be undone.
- **Hotfix:** branch `hotfix/<desc>` from `main`, fix with a test, PR to `main`.
  CI and Deploy run, then tag `v1.0.x`, then PR `main` → `develop`. Repeat the
  smoke test.

## PWA

CMarket is installable as a Progressive Web App (Constitution Principle V,
`specs/018-pwa-installable/`).

- **How members install it:** through the browser's own UI only. In Chrome or
  Edge (Android and desktop), use the install prompt or the install icon in the
  address bar. On iPhone, use Safari > Share > **Add to Home Screen**. There is
  no custom in-app install button.
- **What ships:**
  - `app/manifest.ts`, served at `/manifest.webmanifest`;
  - the icons in `public/icons/`;
  - iOS metadata and `themeColor` in `app/layout.tsx`;
  - the service worker `public/sw.js`;
  - the static offline page `app/offline/page.tsx`.
- **The worker registers only in production builds** (`npm run build && npm run
start`, or the Docker image), never under `npm run dev`. `/sw.js` is served
  with `Cache-Control: no-cache`, so a fixed worker reaches members on their next
  visit.
- **Privacy invariant.** The worker stores **only** the public static shell:
  `/_next/static/…`, `/icons/…`, the manifest and `/offline`. It never stores
  API responses (in particular listing photos), page HTML other than `/offline`,
  or responses marked `private`/`no-store`. Navigations are network-first, and
  the offline page appears only when the network request fails.
  `tests/integration/test_pwa_installable.spec.ts` enforces this with an
  allowlist over every cached URL. **When you change the rules or the precache
  list in `public/sw.js`, bump `CACHE`** (`cmarket-static-v1` → `v2`) so old
  device caches are deleted on activation.
- **Icon:** `public/icons/icon.svg` is an original, **provisional** "CM" wordmark
  used until an official logo exists. After editing it, regenerate the PNGs
  (192, 512, maskable 512 and the 180×180 Apple touch icon) with
  `npx tsx scripts/generate-pwa-icons.ts`. The script uses the Playwright
  Chromium already installed for the tests, so no image dependency is added.
- **No push notifications.** iOS delivers web push only to apps installed on the
  Home Screen, and this release sends none. See `specs/BACKLOG.md` §3.
- **Tests:** the Playwright suite blocks service workers by default
  (`playwright.config.ts`). The two PWA specs opt back in with
  `test.use({ serviceWorkers: "allow" })`.

## Feature specs

- `specs/002-accounts-authentication/` (spec, plan, tasks, data model, API contracts, quickstart validation guide) — accounts and authentication.
- `specs/003-community-creation/` (spec, plan, tasks, data model, tooling contract, quickstart validation guide) — community creation and founding administrator.
- `specs/004-invitations-membership/` — single-use, community-scoped email invitations and membership.
- `specs/005-product-listings/` — community-scoped listings with an ACTIVE/PAUSED lifecycle.
- `specs/006-user-display-names/` — display names everywhere a member appears; never emails.
- `specs/007-listing-discovery/` — feed, search, filters and pagination in SQL.
- `specs/008-listing-messaging/` — one thread per listing and buyer.
- `specs/009-platform-administration/` — MASTER authority, community lifecycle, account administration, audit log.
- `specs/010-transaction-logging/` — traceable transaction records (off-platform payment).
- `specs/011-wanted-posts/` — "looking for" posts.
- `specs/012-profiles-reputation/` — member profiles and transaction-backed ratings.
- `specs/013-purchase-flow-stock/` — stock, purchase proposals, dual transaction history.
- `specs/014-account-public-profiles/` — self profile and shared-community member profiles.
- `specs/015-navigation-shell-community-selector/` — active-community navigation shell.
- `specs/016-chat-conversation-redesign/` — chat-style thread UI.
- `specs/017-cloudinary-listing-media/` — Cloudinary-backed listing images.
- `specs/018-pwa-installable/` — installable PWA with a privacy-bounded service worker.

Work deliberately not shipped in v1.0.0, and known risks, are tracked in `specs/BACKLOG.md`. Release history is in `CHANGELOG.md`.
