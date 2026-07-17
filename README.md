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

## Feature specs

- `specs/002-accounts-authentication/` (spec, plan, tasks, data model, API contracts, quickstart validation guide) — accounts and authentication.
- `specs/003-community-creation/` (spec, plan, tasks, data model, tooling contract, quickstart validation guide) — community creation and founding administrator.
