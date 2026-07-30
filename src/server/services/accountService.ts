import { prisma } from "@/lib/prisma";
import { isValidEmail, normalizeEmail } from "@/lib/validation/email";
import { validatePassword } from "@/lib/validation/password";
import { isValidDisplayName, normalizeDisplayName } from "@/lib/validation/displayName";
import { hashPassword, verifyPassword } from "@/lib/auth/passwordHash";
import { sendEmail } from "@/lib/email/sendEmail";
import {
  getLatestCandidatePasswordHash,
  isIssuanceRateLimited,
  issueVerificationToken,
  reissueVerificationToken,
} from "@/server/services/verificationService";
import { createSession } from "@/server/services/sessionService";

function verificationLink(rawToken: string): string {
  const base = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  return `${base}/verify-email?token=${encodeURIComponent(rawToken)}`;
}

async function sendVerificationEmail(email: string, rawToken: string): Promise<void> {
  await sendEmail({
    to: email,
    subject: "Verify your CMarket email",
    text: `Confirm your email address: ${verificationLink(rawToken)}`,
  });
}

export type SignUpResult =
  | { ok: true }
  | { ok: false; reason: "invalid_email" }
  | { ok: false; reason: "invalid_display_name" }
  | { ok: false; reason: "invalid_password"; passwordReason: "too_short" | "breached" };

/**
 * FR-001, FR-009, FR-016, FR-017, FR-019: creates an unverified Account (with
 * no password credential attached) for a genuinely new email, or issues an
 * additional, independent verification token carrying this attempt's own
 * candidate credential for an existing unverified one — the caller always
 * sees the same successful outcome either way, so no enumeration is
 * possible. The submitted password is never written to Account.passwordHash
 * here; it only reaches the account if and when its verification token is
 * consumed (FR-020). Security amendment #3: a repeated sign-up does NOT
 * invalidate any other pending token for that account (FR-019) — subject to
 * the shared per-account rate limit (FR-021).
 *
 * displayName (010-registration-form) is required up front and, unlike the
 * password, is not credential-gated: it is written to the new Account
 * immediately, since it carries no sign-in authority and doesn't need to
 * wait for email verification the way passwordHash does.
 */
export async function signUp(
  email: string,
  password: string,
  displayName: string,
): Promise<SignUpResult> {
  if (!isValidEmail(email)) {
    return { ok: false, reason: "invalid_email" };
  }

  if (!isValidDisplayName(displayName)) {
    return { ok: false, reason: "invalid_display_name" };
  }

  const passwordCheck = await validatePassword(password);
  if (!passwordCheck.valid) {
    return { ok: false, reason: "invalid_password", passwordReason: passwordCheck.reason };
  }

  const normalized = normalizeEmail(email);
  const existing = await prisma.account.findUnique({ where: { email: normalized } });

  if (existing) {
    if (!existing.emailVerifiedAt && !(await isIssuanceRateLimited(existing.id))) {
      const candidatePasswordHash = await hashPassword(password);
      const rawToken = await issueVerificationToken(existing.id, candidatePasswordHash);
      await sendVerificationEmail(existing.email, rawToken);
    }
    return { ok: true };
  }

  const created = await prisma.account.create({
    data: {
      email: normalized,
      passwordHash: null,
      emailVerifiedAt: null,
      displayName: normalizeDisplayName(displayName),
    },
  });
  const candidatePasswordHash = await hashPassword(password);
  const rawToken = await issueVerificationToken(created.id, candidatePasswordHash);
  await sendVerificationEmail(created.email, rawToken);

  return { ok: true };
}

/**
 * FR-014: always returns the same generic acknowledgement (non-enumeration).
 * No new password is collected here, so the re-sent token carries forward
 * the same candidate credential as the token(s) it replaces (FR-019) —
 * unlike a competing sign-up, a resend MAY invalidate prior pending tokens,
 * since it re-issues the same credential rather than a competing one.
 * Subject to the same shared per-account rate limit as sign-up (FR-021).
 */
export async function resendVerification(email: string): Promise<void> {
  if (!isValidEmail(email)) return;
  const account = await prisma.account.findUnique({ where: { email: normalizeEmail(email) } });
  if (account && !account.emailVerifiedAt && !(await isIssuanceRateLimited(account.id))) {
    const candidatePasswordHash = await getLatestCandidatePasswordHash(account.id);
    const rawToken = await reissueVerificationToken(account.id, candidatePasswordHash);
    await sendVerificationEmail(account.email, rawToken);
  }
}

/** FR-005, FR-007: gate consumed by the (separate) invitations feature. */
export async function assertEmailVerified(accountId: string): Promise<boolean> {
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  return Boolean(account?.emailVerifiedAt);
}

export type SignInResult =
  | { ok: true; sessionToken: string; expiresAt: Date }
  | { ok: false };

/**
 * FR-010, FR-012: a single generic failure for both "no such account" and
 * "wrong password" — including accounts that have no password set at all
 * (Google-only accounts). 009-platform-administration, research.md #9: a
 * SUSPENDED or soft-deleted account is denied the same generic way — never
 * distinguishing "wrong password" from "this account is suspended."
 */
export async function signInWithPassword(email: string, password: string): Promise<SignInResult> {
  const account = await prisma.account.findUnique({ where: { email: normalizeEmail(email) } });

  if (!account?.passwordHash || account.status !== "ACTIVE" || account.deletedAt !== null) {
    return { ok: false };
  }

  const passwordMatches = await verifyPassword(account.passwordHash, password);
  if (!passwordMatches) {
    return { ok: false };
  }

  const session = await createSession(account.id);
  return { ok: true, sessionToken: session.sessionToken, expiresAt: session.expiresAt };
}

export type SetDisplayNameResult =
  | { ok: true; account: { id: string; displayName: string } }
  | { ok: false; reason: "invalid_display_name" };

/**
 * FR-002, FR-012: the sole write path for Account.displayName. The caller
 * always supplies its own accountId (derived from the session, never a
 * request field — see the route handler), so this holds FR-002's "only the
 * account itself" guarantee by construction, not by an authorization check.
 */
export async function setDisplayName(accountId: string, displayName: string): Promise<SetDisplayNameResult> {
  if (!isValidDisplayName(displayName)) {
    return { ok: false, reason: "invalid_display_name" };
  }

  const updated = await prisma.account.update({
    where: { id: accountId },
    data: { displayName: normalizeDisplayName(displayName) },
  });

  return { ok: true, account: { id: updated.id, displayName: updated.displayName! } };
}
