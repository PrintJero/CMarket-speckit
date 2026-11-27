# CMarket Backlog

Work deliberately **not** shipped in v1.0.0, and known risks carried into it. Per Constitution
Principle VII (Simplicity & MVP-First), new ideas are captured here instead of being expanded into
the current scope. An item leaves this file only by becoming a feature spec under `specs/###-name/`
(through `/speckit-specify`), never by being built ad hoc.

_Last updated: 2026-11-27 (release v1.0.0; production deployment and manual smoke)._

---

## 1. In-app payment (Constitution Principle IV-b)

**Status:** out of scope for v1.0.0. Off-platform payment with manual transaction logging
(Principle IV-a, specs 010 and 013) is the only payment path.

**Why it is deferred:**

- It needs a licensed processor with a **connected-accounts (split payments)** model, such as
  Stripe Connect or Mercado Pago Marketplace, plus real merchant credentials and seller onboarding.
- It needs **signed, idempotent webhooks**. A webhook processed twice, a forged notification
  accepted, or a paid order without a log each silently violates Principle IV.
- Webhook handling, payment-state transitions and automatic log generation are **critical flows
  under Principle VIII**: tests written first, failing first (red), and blocking CI.

**Constitutional requirements the future spec MUST satisfy:**

1. **Triple opt-in.** The community administrator enables the module (default: disabled), the
   seller connects their own processor account, and the buyer explicitly chooses in-app payment.
2. **Non-custodial.** Funds flow buyer → seller through the processor. CMarket never holds user
   funds, never touches or stores card data (processor-hosted checkout only), and receives only its
   own service fee.
3. **Visible fee.** CMarket's service fee is disclosed before the buyer confirms.
4. **Automatic transaction log.** A confirmed in-app payment generates the corresponding
   transaction log entry automatically. It extends logging; it does not replace it.
5. **Off-platform alternative always visible** alongside the in-app option.
6. **No stored value** (Additional Constraints): no wallets, balances or transferable credits.
7. **Not an intermediary.** The UX states that refunds and disputes are between the parties and
   the processor.

---

## 2. Community access codes (Constitution Principle I)

**Status:** constitutionally permitted, but **a feature spec MUST NOT be created yet**.

The constitution (Additional Constraints) forbids creating this spec until a concrete adopting
community requires bulk onboarding. Until then, direct invitation
(`specs/004-invitations-membership`) is the only membership path, alongside Principle IX's bounded
MASTER managed-provisioning exception.

**Trigger to revisit:** a real community asks to onboard its members in bulk.

---

## 3. Push notifications

**Status:** out of scope for v1.0.0. Spec 018 (installable PWA) deliberately implements no push.

**Known platform constraint (Principle V):** on iOS, web push only works once the user has
installed the PWA to the Home Screen. Any future notification-dependent flow (messaging, purchase
proposals, payment confirmations) must keep working without push delivery and treat push as an
enhancement.

---

## 4. Prisma 7 upgrade (residual `npm audit` findings)

**Status:** deferred. After `fix/deps` (v1.0.0), `npm audit --omit=dev` reports **0 critical and
4 high**. All four are inside Prisma's own toolchain (`prisma` → `@prisma/config` → `effect`,
`deepmerge-ts`) and the only available fix is **Prisma 7**, a major version.

**Exposure assessment:**

- `effect` (ReDoS in `Schema.TemplateLiteral`) and `deepmerge-ts` (stack exhaustion on recursive
  object graphs) are reached through Prisma's configuration loading, not through request handling
  with user input.
- In the production image, the Prisma CLI runs only in `docker-entrypoint.sh` (`migrate deploy`).

**Work for the future spec:** upgrade `prisma` and `@prisma/client` together (the Dockerfile reads
the CLI version from `package.json`), regenerate, re-run the full battery, and review Prisma 7's
breaking changes (configuration file, driver adapters).

---

## 5. Known risks and minor follow-ups

- **Shared mock Google OAuth profile in e2e.** `scripts/mock-google-oauth-server.ts` holds a single
  mutable "current profile". Each Google spec file is `serial` internally, but different Google
  spec files can run in parallel workers and race on that profile. None of the 18 full-suite runs
  during the v1.0.0 closure produced a failure attributable to this race, but the design permits
  one. Fix: key mock
  profiles by a per-test nonce carried in the OAuth `state`/`login_hint`.
- **Duplicated lifecycle actions on a suspended community's Lifecycle tab** (MASTER area). While a
  community is SUSPENDED or ARCHIVED, `LifecycleActions` renders both in the page banner and in the
  `?tab=lifecycle` panel, so the same buttons appear twice on that tab. Cosmetic; no behavioural
  impact.
- **Production data affected by the Google display-name bug (fixed in v1.0.0, PR #25).** Before
  the fix, every Google sign-up or auto-link set the Google user's name on every account that had
  no display name. If any pre-v1.0.0 deployment ever accepted Google sign-ins, audit
  `accounts.displayName` for names that do not belong to their owners before onboarding real
  communities.

---

## 6. Publish the Google OAuth app (production)

**Status:** the OAuth consent screen is in **Testing** mode. Google sign-in works only for the
test users listed in Google Cloud Console (up to 100), and Google may ask them to re-consent
periodically. Anyone else gets "Access blocked". Email and password sign-up is unaffected.

**Blocked by:**

- **An own domain.** Production currently runs on an `sslip.io` hostname. Google requires the
  app's home page, privacy policy and authorised domains to be on a domain the publisher
  controls, verified in Google Search Console. A wildcard-DNS name such as `sslip.io` cannot be
  verified.
- **A privacy policy page (`/privacy`)**, publicly reachable without sign-in, stating what Google
  data CMarket receives (name, email, the `sub` identifier), why, retention, and how to request
  deletion. A terms page is recommended. Both should be linked from the sign-in screen.

**Work, once the domain exists:**

1. Point the domain at Dokploy and set `NEXTAUTH_URL` and the GitHub `production` variable
   `APP_URL` to it.
2. Add `https://<domain>/api/auth/callback/google` as an authorised redirect URI.
3. Add `/privacy` (a static page, same pattern as `/offline`) and link it.
4. Complete the consent screen (logo, home page, privacy URL, authorised domain) and click
   **Publish app**. The scopes requested (`openid`, `email`, `profile`) are non-sensitive, so no
   security review should be needed.

---

## 7. Automated database backups (Constitution: Migrations & backups)

**Status:** **not configured.** The constitution requires automated backups **and** one actually
performed restore before the first production community onboards. This is the main blocker for
onboarding a real community.

**Blocked by:** an **S3-compatible destination** (AWS S3, Cloudflare R2, Backblaze B2 or MinIO)
with a bucket and access keys. Dokploy's database backups write only to an S3 destination.

**Work, once the destination exists:**

1. In Dokploy, add the S3 destination, then on `cmarket-speckit-db` set **Backups**: daily, with
   retention of 7 days or more, to that destination.
2. Run one backup manually and confirm the object lands in the bucket.
3. **Restore test:** restore that backup into a scratch Postgres service, point a temporary
   `cmarket-tools` at it, and run `npx prisma migrate status` plus a row-count sanity check. Record
   the date in the release report.
4. Keep the bucket's credentials only in Dokploy (never in the repo or GitHub).

---

## 8. Constitution reference fix (done in v1.0.0)

The constitution cited the direct-invitation path as "spec 001", a folder that never existed. It
now cites `specs/004-invitations-membership`. Bumped **4.1.0 → 4.1.1 (PATCH)**, with a Sync Impact
Report entry and a new "Last Amended" date.

---

## 9. Email deliverability to institutional domains

**Found:** production manual smoke, 2026-11-27. Email to `@anahuac.mx` **does arrive, but late**.
That domain is on Microsoft 365 (MX `anahuac-mx.mail.protection.outlook.com`). By contrast,
`cosmic-chimps.com`, which is on Google Workspace, receives the same email instantly. A delay on a
verification or invitation email feels like a broken sign-up, and the target communities
(universities, companies) are often on Microsoft 365.

**Sender already checked (2026-11-27):**

- DKIM: the Resend DKIM record is present.
- SPF: on `send.anahuarket.cosmic-chimps.com`, the return-path subdomain (`include:amazonses.com`).
- DMARC: inherited from `cosmic-chimps.com`, with `p=none`.

Authentication is therefore in place. The **probable cause** is reputation:

- the sender is new and external, with no sending history to Microsoft;
- the links in the email point to an IP-based `sslip.io` hostname, which filters treat as suspicious.

Microsoft 365 holds or slows down such messages.

**Work:**

1. **Own domain for the app** (shared with BACKLOG §6). Links in emails should point to a real
   domain, not `sslip.io`.
2. **DMARC:** once reports show SPF and DKIM aligned, raise the policy from `p=none` to
   `p=quarantine`, and add `rua` reporting to watch alignment.
3. **Warm-up:** keep the volume low and consistent at first. In Resend's per-message log, check
   delivery time to Microsoft recipients (accepted versus deferred).
4. **Per-community onboarding:** if delays persist, ask the institution's IT team to allowlist the
   sender domain in Microsoft 365 / Defender. Document what to allowlist in the README.

---

## 10. Show dates in the user's time zone

**Found:** production manual smoke, 2026-11-27. Dates and times are rendered in UTC (the server's
time zone), not in the user's, so a user outside UTC sees shifted times.

**Work:** format timestamps for display in the viewer's time zone. Either render them in a small
client component that uses the browser's `Intl.DateTimeFormat`, or store a time zone on the account
or community and format on the server with it. Watch for hydration mismatches if the server and
client render the same date. Stored values stay UTC; this changes only how they are displayed.
