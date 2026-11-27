# CMarket Backlog

Work deliberately **not** shipped in v1.0.0, and known risks carried into it. Per Constitution
Principle VII (Simplicity & MVP-First), new ideas are captured here instead of being expanded into
the current scope. An item leaves this file only by becoming a feature spec under `specs/###-name/`
(through `/speckit-specify`), never by being built ad hoc.

_Last updated: 2026-11-27 (release v1.0.0)._

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

## 6. Constitution reference fix (done in v1.0.0)

The constitution cited the direct-invitation path as "spec 001", a folder that never existed. It
now cites `specs/004-invitations-membership`. Bumped **4.1.0 → 4.1.1 (PATCH)**, with a Sync Impact
Report entry and a new "Last Amended" date.
