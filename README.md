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

## Feature specs

See `specs/002-accounts-authentication/` (spec, plan, tasks, data model, API contracts, quickstart validation guide) for the accounts and authentication feature.
