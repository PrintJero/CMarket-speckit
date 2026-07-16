# Contract: Authentication API

Endpoints this feature exposes. The Google OAuth redirect is handled by Auth.js's standard route conventions. Sign-in and sign-out for email/password are our own routes, not an Auth.js `CredentialsProvider` (see research.md #2 addendum) — described here at the contract level (request intent / response shape).

## POST /api/auth/sign-up

Create an account with email and password (FR-001).

**Request**:
```json
{ "email": "string", "password": "string" }
```

**Responses**:
- `202 Accepted` — always returned for a syntactically valid email and a password meeting the policy (FR-016), **regardless of whether an account already existed** for that email (FR-009). Body: `{ "message": "If this email can be used, we've sent verification instructions." }`
- `400 Bad Request` — email is not a valid address, or password fails the policy check (too short / breached). Body identifies which field failed; MUST NOT mention whether the email is already registered.

**Side effects**: The submitted password is hashed and stored ONLY as the newly issued `VerificationToken.candidatePasswordHash` (FR-019) — it is never written to `Account.passwordHash` at this point. On a genuinely new email (per FR-017 matching), creates an unverified `Account` (with `passwordHash: null`) and sends a verification email carrying that candidate credential. On an email that already has an `Account`, sends nothing new to a *verified* account (the submitted password is simply discarded, since verification is already settled), but if that existing account is still unverified, issues an *additional*, independent token carrying the newly submitted candidate credential and re-sends the email — **security amendment #3**: this new token does NOT invalidate any other still-pending token for that account (contrast the old amendment #2 behavior, which did — that was itself a defect, since it let a competing sign-up destroy the legitimate holder's own pending token). The HTTP response is identical in every case, and this issuance is also subject to the per-email rate limit (FR-021, see below).

---

## GET /api/auth/verify-email?token=...

Consume a verification token (FR-005).

**Responses**:
- `200 OK` — token was valid, unconsumed, unexpired, and this consumption is what verified the account. Its `emailVerifiedAt` is set and the token's `candidatePasswordHash` is applied as `Account.passwordHash` (FR-020) — this is the only point at which an email/password account ever receives a working credential. **Security amendment #3**: every *other* still-pending token for this account (from any other sign-up attempt) is invalidated in the same operation (FR-020) — none of them can ever be consumed to apply a different credential afterward.
- `200 OK` — token was valid, unconsumed, unexpired, but the account was *already* verified by some other means (e.g., a sibling token consumed first, or a Google auto-link that happened in between). The account's credential is left untouched, but the response is the same `200 OK` (the email genuinely is verified, regardless of which consumption did it).
- `400 Bad Request` — token is missing, malformed, expired, or already consumed (including a token invalidated as someone else's sibling, per the first case above — indistinguishable from any other "no longer valid" token). Generic "this link is no longer valid" message.
- `400 Bad Request` *(new, FR-022)* — the token's candidate credential is null and the account has no credential of its own either; verifying it would create a permanently passwordless, verified-but-unusable account, so the system refuses. The token is still marked consumed. Uses the identical generic "this link is no longer valid" message as any other failure — no distinct signal is exposed.

---

## POST /api/auth/resend-verification

Request a new verification email for an unverified account (FR-014).

**Request**:
```json
{ "email": "string" }
```

**Responses**:
- `202 Accepted` — always, regardless of whether the email exists or is already verified (same non-enumeration rule as sign-up). Body: generic acknowledgement.

**Side effects**: If an unverified `Account` matches (FR-017), invalidates its prior verification token(s) and issues a new one carrying forward the same `candidatePasswordHash` (FR-014, FR-019) — no new password is collected on this endpoint. Unlike a competing sign-up (which no longer invalidates anything, per amendment #3), a resend MAY still invalidate, since it re-issues the same credential rather than introducing a competing one. Also subject to the per-email rate limit (FR-021, see below).

---

## POST /api/auth/sign-in

Email/password sign-in (FR-008, FR-010). Implemented directly (not via Auth.js) so it shares the same `Session` table and revocation path as Google sign-in.

**Request**:
```json
{ "email": "string", "password": "string" }
```

**Responses**:
- `200 OK` — credentials valid; a `Session` row is created (research.md #2) and its raw token set as an httpOnly cookie.
- `401 Unauthorized` — wrong password, no matching account, or an account that exists but has no credential yet because it isn't verified (`Account.passwordHash` is `null` — FR-019): all three return the identical generic invalid-credentials message (FR-007, FR-010). An unverified account cannot be signed into with a password at all, since none has been attached to it yet.

## POST /api/auth/sign-out

Deletes the current `Session` row (data-model.md) — not merely a client-side cookie clear — satisfying Story 2 scenario 3's "no longer grants access on that device."

## Sign-in (Google)

Handled by Auth.js's Google OAuth provider redirect flow, via our custom Adapter (`src/lib/auth/prismaAuthAdapter.ts`).

- On first sign-in for a Google identity with no matching `Account` (by `AuthIdentity.providerAccountId`, and no existing `Account.email` match either): creates a new, already-verified `Account` (FR-002, FR-006).
- On a Google identity whose email matches an existing, **already-verified** password `Account` (FR-015, via `allowDangerousEmailAccountLinking`): links the `AuthIdentity` to that existing `Account` instead of creating a new one; its password credential is left untouched.
- On a Google identity whose email matches an existing, **unverified** password `Account` (FR-018): links the `AuthIdentity` and sets `emailVerifiedAt`. Under the FR-019/FR-020 model, `Account.passwordHash` is already `null` at this point (an unverified account never has a credential attached — that's the whole point of security amendment #2), so there is normally nothing to clear; the operation still, defensively, ensures `passwordHash` stays `null`, deletes every `Session` row for that account, and marks every unconsumed `VerificationToken` for that account consumed — all in one transaction. Since security amendment #3, there may be *more than one* such pending token (one per independent sign-up attempt against that email); every one of them is invalidated here, since each is a place an un-applied candidate credential (from whoever registered the email — possibly not its real owner) could otherwise later be consumed and take effect.
- On a Google identity already linked to an `Account`: signs in to that `Account` (Story 3 scenario 2), creating a new `Session` row via the same adapter.

## Rate limiting (`POST /api/auth/sign-up`, `POST /api/auth/resend-verification`) — new, FR-021

Both endpoints share a single per-`Account` limit on `VerificationToken` issuance within a recent time window. Once that limit is reached:
- Neither endpoint issues a new token or sends an email.
- Both still return their normal success response (`202 Accepted`, identical body) — a rate-limited request is indistinguishable from a normal one, preserving FR-009's non-enumeration guarantee.
- The limit only throttles *repeated requests against one specific email* — it is not a global signup cap, and does not apply to a brand-new email's first request.

## Community-invitation acceptance gate (consumed by the existing invitations feature, not implemented here)

Any endpoint in the invitations feature that accepts a membership invitation MUST check `Account.emailVerifiedAt IS NOT NULL` for the signed-in account first, and reject with a clear "verify your email first" error otherwise (FR-005, FR-007).
