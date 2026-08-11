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

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string (Prisma) |
| `NEXTAUTH_URL` | yes | Base URL used for Auth.js callbacks and verification links |
| `NEXTAUTH_SECRET` | yes | Long random string used by Auth.js to sign cookies |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | yes, for Google sign-in | OAuth credentials from the Google Cloud Console |
| `EMAIL_FROM` | no | From-address used on outbound verification emails |
| `EMAIL_WEBHOOK_URL` / `EMAIL_WEBHOOK_TOKEN` | no | Provider-agnostic HTTP webhook for sending verification emails (see `src/lib/email/sendEmail.ts`). Leave unset in development — emails are logged to the console instead |
| `EMAIL_TEST_CAPTURE` | no | Set to `true` only for automated tests: captures sent emails in memory and exposes the last one per recipient at `GET /api/test/last-email?to=...`. **Never set this in a real deployment** |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` | yes | Cloudinary account identifiers for listing media. The cloud name and key reach the browser only inside a short-lived signed upload authorization, which the direct-upload protocol requires |
| `CLOUDINARY_API_SECRET` | yes | Server-only. **Never** give this a `NEXT_PUBLIC_` prefix, commit it, bake it into a Docker image, or log it |
| `CLOUDINARY_ENV_FOLDER` | yes | `development` \| `test` \| `production`. The first path segment of every generated asset id. This prefix is what makes it impossible for a staging deployment to address or delete production assets |
| `LISTING_IMAGE_CACHE_MODE` | no | `no-cache` (default) or `no-store`. A mode, not a TTL — a `max-age` is deliberately not offered, because permitting cached reuse without revalidation is what would let a departed member keep seeing a community's images |
| `CLEANUP_TOKEN` | yes | Shared secret for `POST /api/listing-media/cleanup`, which drains the retryable Cloudinary deletion queue. Generate with `openssl rand -hex 32` |
| `CLOUDINARY_TEST_STUB` | no | Set to `true` only for automated tests: replaces the Cloudinary Admin API verification call while still enforcing the public-ID prefix and provenance checks. **Never set this in a real deployment** |

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
3. Confirm the application server has **outbound network access to Cloudinary**. This is now required at *read* time, not only at write time — if it is blocked, listing images stop rendering.
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
*with* the quote characters and Prisma rejects it:

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

## Feature specs

- `specs/002-accounts-authentication/` (spec, plan, tasks, data model, API contracts, quickstart validation guide) — accounts and authentication.
- `specs/003-community-creation/` (spec, plan, tasks, data model, tooling contract, quickstart validation guide) — community creation and founding administrator.
