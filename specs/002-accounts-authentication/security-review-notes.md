# Security Review Notes: Accounts and Authentication

Covers FR-011, FR-012, SC-007 ("zero code paths store or compare a password in plaintext, and zero authentication path bypasses password validation"), plus the dependency and non-enumeration findings surfaced while building this feature.

## Password storage and comparison

- Passwords are hashed with Argon2id (`@node-rs/argon2`, native Rust bindings) at OWASP-recommended cost parameters (m=19456 KiB, t=2, p=1) — `src/lib/auth/passwordHash.ts`.
- The only place a plaintext password is read is inside `hashPassword`/`verifyPassword`; neither function, nor anything upstream of them (`accountService.signUp`, `accountService.signInWithPassword`), ever writes the plaintext password to the database, logs, or the email transport.
- `Account.passwordHash` is nullable, and — since security amendment #2 (2026-07-16, FR-019) — is **null for every unverified account**, not only Google-only ones: the candidate credential from an email/password sign-up lives on the `VerificationToken` until consumption applies it. `signInWithPassword` treats a null hash as an automatic non-match (FR-012: no bypass), not a special case that skips verification, so an unverified account simply cannot be signed into with a password yet.
- No code path accepts a password without calling `verifyPassword` against the stored hash. There is no admin override, debug endpoint, or alternate credential check anywhere in `app/api/auth/*` or `src/server/services/*`.

## Identity binding on Google auto-link (FR-015/FR-018) — pre-hijacking fix (2026-07-16)

**Finding**: The original FR-015 auto-linked a Google identity to any pre-existing email/password account matching its email, "verified or not," preserving that account's password credential unconditionally. This allowed pre-hijacking: an attacker registers `victim@x.com` with a password and never verifies it; later, when the real owner signs in with Google, the account gets linked and marked verified, but the attacker's original password credential kept working — the attacker retained silent access to the victim's now-verified, membership-bearing account. This directly undermined Constitution Principle I's identity-binding guarantee (an unverified email must not be trustable as proof of ownership).

**Fix**: `linkAccount` in `src/lib/auth/prismaAuthAdapter.ts` now branches on whether the pre-existing account was verified, using the same `updateMany` call that flips verification as the atomic check (its `count` tells us whether this call is what verified the account — see research.md #8 for why this avoids a separate read-then-branch race):
- **Was already verified**: link only; password credential and existing sessions are untouched (FR-015, unchanged).
- **Was unverified**: link, mark verified, **and**: clear `passwordHash` to `null`, delete every `Session` row for that account, and mark every unconsumed `VerificationToken` consumed (FR-018). The old password can no longer authenticate (`signInWithPassword` already treats a null hash as an automatic non-match — no change needed there).

Rejecting the link outright (instead of tearing down the credential) was considered and rejected: it would let the same attacker permanently lock the real owner out by squatting their email with an unverified account and never going away.

**Verified by**: `tests/integration/test_google_autolink.spec.ts` (unverified case — confirmed red against the pre-fix code, now green) and `tests/integration/test_google_autolink_verified.spec.ts` (verified case, new coverage — passed both before and after the fix, confirming no over-application).

## Identity binding on repeated email/password sign-up (FR-019/FR-020) — second pre-hijacking fix (2026-07-16)

**Finding**: The fix above only closed the Google-auto-link path. The identical root cause remained fully exploitable purely within the email/password flow: `signUp()` wrote the submitted password to `Account.passwordHash` immediately, including on a *repeat* sign-up against an already-existing unverified account — except in that branch the code path that issues a fresh verification token ran, while the newly submitted password was silently discarded (never written anywhere). Concretely: an attacker registers `victim@x.com` with their own password and never verifies it; the real owner later submits their own sign-up with their own password; the system correctly re-sends a verification email to the real owner's inbox, but the real owner's password is thrown away; when the real owner clicks their own link, the account becomes verified — with the **attacker's** original password still attached. The real owner's own click was the exploit step.

**Fix**: `Account.passwordHash` is never written directly by `signUp()` (`src/server/services/accountService.ts`) or `resendVerification()` anymore. The candidate password's Argon2id hash is stored on the issued `VerificationToken.candidatePasswordHash` (`prisma/schema.prisma`) instead. `consumeVerificationToken()` (`src/server/services/verificationService.ts`) applies it to the account in one atomic `updateMany` guarded by `emailVerifiedAt: null` — the same check-and-act pattern as the Google-link fix above — so a token that reaches consumption after the account is already verified by any other means cannot modify `passwordHash`. **Superseded by security amendment #3 below**: this fix originally relied on "issuing a new token invalidates the one that preceded it" to neutralize an earlier registrant's candidate credential — that mechanism was itself a defect (see below) and was replaced.

**Direct, intended consequence**: an account that has never been verified now has `passwordHash: null` unconditionally, so it cannot be signed into with a password at all — there is no credential yet to check against. This replaced the previous (now known-incorrect) assumption that an unverified account could sign in; FR-007 was revised accordingly.

**Verified by**: `tests/contract/test_sign_up.ts` (the FR-009 double-signup case, enhanced — confirmed red against the pre-fix code at two points: `passwordHash` was set immediately at signup, and the attacker's password already authenticated before verification) and a new case in `tests/contract/test_verify_email.ts` (a token consumed against an already-verified account leaves `passwordHash` untouched).

## Token coexistence, rate limiting, and the null-credential lockout guard (FR-019/FR-020/FR-021/FR-022) — third pre-hijacking fix (2026-07-16)

**Finding**: The fix above relied on "a new sign-up token invalidates whichever token preceded it for that account" to neutralize a stale registrant's candidate credential. That mechanism was itself exploitable: since `signUp()` requires no proof of inbox ownership to call, an attacker who knows (or guesses) a victim's email can call sign-up again — *after* the victim's own legitimate sign-up — purely to destroy the victim's live token and replace it with one carrying the attacker's own candidate password. Both verification emails land in the victim's own inbox; whichever link the victim clicks, if it isn't literally the very first one they ever received, is now the attacker's. No password guessing, no email interception, and no race against the victim's click time was required — just calling the endpoint again.

**Fix**:
- `issueVerificationToken()` (used by `signUp()`) no longer invalidates any prior token — it simply creates a new, independent row. Multiple tokens, each with their own `candidatePasswordHash`, may now coexist for one account. `reissueVerificationToken()` (a new, separate function used only by `resendVerification()`) keeps the old invalidate-then-create behavior, since a resend legitimately re-issues the *same* credential rather than introducing a competing one.
- `consumeVerificationToken()` is now a Prisma interactive transaction (`prisma.$transaction(async (tx) => ...)`, needed because the third step depends on the second step's result — array-style `$transaction` can't express that): it marks the target token consumed, attempts the guarded `account.updateMany` (`emailVerifiedAt: null`, now also `passwordHash: { not: null }` when the candidate is null — see the lockout guard below), and — only if that update is what verified the account — marks every *other* pending token for that account consumed too. This is what makes a losing sibling token concretely, observably "dead" (a `400`, same as any other invalid token) rather than merely inert.
- New per-account rate limit (`isIssuanceRateLimited`, `src/server/services/verificationService.ts`): counts `VerificationToken` rows created for that account in a trailing 15-minute window; at 5 or more, `signUp()` and `resendVerification()` silently skip issuing anything further, while still returning their normal, identical success response. This directly limits how cheaply an attacker can flood an account with competing pending tokens, and is backed by Postgres (already this feature's source of truth) rather than new infrastructure.
- **Null-credential lockout guard** (a related but distinct finding): `getLatestCandidatePasswordHash()` returns `null` when an account has no prior `VerificationToken` history (reachable today only via direct test/DB construction, but expected to become reachable once a future community-bootstrap spec creates `Account` rows directly). Consuming a token with a `null` candidate was still marking the account verified while leaving `passwordHash` `null` — a permanently unusable, verified-but-passwordless account, since no password-recovery flow exists. Fixed by folding an additional condition into the same guarded `updateMany`: when the candidate is `null`, the account must already have a `passwordHash` of its own for the update to apply; otherwise the consumption fails explicitly (a `400`, indistinguishable from any other invalid-token response) rather than silently succeeding.

**Acknowledged, not fixed by this amendment**: an attacker who consumes a token *before* the real owner does still wins that specific race. This is a phishing/timing risk inherent to any first-click-wins, email-delivered-link verification scheme — not a gap this feature's own design choices introduced or left open. What this fix removes is the *destructive* interference between competing sign-up attempts, not the underlying race to click first.

**Verified by**: `tests/contract/test_signup_token_coexistence.ts` (both orderings — the account holder's own token survives a competing sign-up and wins if consumed first; the residual race is documented honestly for the reverse ordering, which already passed pre-fix since it describes unchanged, inherent behavior), a new rate-limit case in `test_sign_up.ts` (confirmed red: 7 rapid sign-ups sent 7 emails pre-fix, capped at 5 post-fix, with identical `202` responses throughout), and a new case in `test_verify_email.ts` (confirmed red: a null-candidate token against a credential-less account incorrectly verified it pre-fix).

## Session tokens

- Session and verification tokens are high-entropy random values (`crypto.randomBytes(32)`), hashed at rest with SHA-256 (not Argon2id — Argon2 is deliberately slow to resist guessing a *low-entropy* secret like a password; a 256-bit random token needs only pre-image resistance against a DB leak, which SHA-256 provides at a fraction of the cost). Only the raw token is ever placed in a cookie or an emailed link; the database stores only the hash.

## Non-enumeration (FR-009, FR-010)

- `POST /api/auth/sign-up` and `POST /api/auth/resend-verification` return an identical response regardless of whether the email already has an account (verified, unverified, or absent) — verified directly in `tests/contract/test_sign_up.ts` and `tests/integration/test_signup_enumeration.spec.ts`.
- `POST /api/auth/sign-in` returns the same generic 401 body for "no such account" and "wrong password" — verified in `tests/integration/test_signin_invalid_credentials.spec.ts`.

## Known accepted dependency risks (npm audit)

Two moderate-severity transitive advisories remain after dependency selection, both with no viable fix at time of writing:

- `postcss <8.5.10` (via `next`) — XSS via unescaped `</style>` in CSS stringification. `npm audit fix --force`'s suggested fix is downgrading `next` to `9.3.3`, which is not a real option. Accepted risk: this app does not accept user-authored CSS.
- `uuid <11.1.1` (via `next-auth`'s internals) — missing buffer bounds check in v3/v5/v6 generation when a buffer is supplied. `next-auth` does not expose a code path that lets this app control the buffer argument. Accepted risk pending an upstream `next-auth` update.

One dependency was deliberately **not** added because of a vulnerability with no fix in the version range we'd be constrained to: `nodemailer` — `next-auth`'s peer range (`^7.0.7`) is entirely within the disclosed high-severity SMTP command-injection advisory range (`<=9.0.0`, fixed in `9.0.1`), and there is no patched `7.x` release. `src/lib/email/sendEmail.ts` instead uses a provider-agnostic HTTP webhook transport (native `fetch`, no vendor SDK) plus a console/capture transport for dev and tests. See research.md #5.

## Verification performed

Against a local Dockerized PostgreSQL 16 (`docker-compose.yml`, separate dev/test databases) and Playwright's Chromium:

- `npx tsc --noEmit` and `npx eslint .`: clean.
- `npm run build`: all 12 routes compile.
- `npx vitest run tests/unit tests/contract`: **35/35 passing**, stable across repeated runs.
- `npx playwright test`: **9/9 passing**, stable across repeated runs.

One real bug was found and fixed by testing against a live, shared database rather than mocks: three contract test files ran an **unscoped** `prisma.verificationToken.deleteMany()` in `beforeEach`, which raced with other test files running in parallel against the same database (one file's cleanup could delete another's in-flight token, mid-test). Fixed by relying on `VerificationToken`'s `onDelete: Cascade` from each file's already-scoped `account.deleteMany()` instead. See `tests/contract/test_sign_up.ts` for the comment.

## Outstanding before production

- [ ] Provide real `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` and manually walk the Google sign-up/sign-in/auto-link flow at least once against a real consent screen — the automated tests for this story exercise the Adapter directly (see `tests/integration/test_google_*.spec.ts` header comments), which is not the same as observing NextAuth's actual OAuth redirect/callback handling.
- [ ] Point `EMAIL_WEBHOOK_URL` at a real transactional-email forwarder before launch; without it, verification emails only log to the console.
- [ ] Apply the migration to the actual production database (`prisma migrate deploy`) — verified here only against local dev/test Postgres containers.
