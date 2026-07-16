import { randomBytes, createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours (research.md #3)
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes (research.md #11)
export const RATE_LIMIT_MAX_TOKENS = 5;

function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

/** FR-021: shared per-account rate limit on token issuance (signUp repeats + resend). */
export async function isIssuanceRateLimited(accountId: string): Promise<boolean> {
  const count = await prisma.verificationToken.count({
    where: { accountId, createdAt: { gte: new Date(Date.now() - RATE_LIMIT_WINDOW_MS) } },
  });
  return count >= RATE_LIMIT_MAX_TOKENS;
}

/**
 * FR-019 (security amendment #3): each sign-up attempt against an unverified
 * account gets its own independent token. This does NOT invalidate any other
 * pending token — multiple may coexist, each with its own candidate
 * credential (contrast `reissueVerificationToken`, used by resend only).
 */
export async function issueVerificationToken(
  accountId: string,
  candidatePasswordHash: string | null,
): Promise<string> {
  const rawToken = randomBytes(32).toString("base64url");
  await prisma.verificationToken.create({
    data: {
      accountId,
      tokenHash: hashToken(rawToken),
      candidatePasswordHash,
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    },
  });
  return rawToken;
}

/**
 * FR-014: resend MAY invalidate prior pending token(s), since it re-issues
 * the same candidate credential rather than a competing one.
 */
export async function reissueVerificationToken(
  accountId: string,
  candidatePasswordHash: string | null,
): Promise<string> {
  const rawToken = randomBytes(32).toString("base64url");
  await prisma.$transaction([
    prisma.verificationToken.updateMany({
      where: { accountId, consumedAt: null },
      data: { consumedAt: new Date() },
    }),
    prisma.verificationToken.create({
      data: {
        accountId,
        tokenHash: hashToken(rawToken),
        candidatePasswordHash,
        expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
      },
    }),
  ]);
  return rawToken;
}

export type ConsumeVerificationTokenResult =
  | { ok: true; accountId: string }
  | { ok: false; reason: "invalid" | "expired" | "consumed" | "no_credential" };

/**
 * FR-020: applying `candidatePasswordHash` + `emailVerifiedAt` is guarded
 * atomically by `emailVerifiedAt: null`; when the candidate is null,
 * additionally guarded by `passwordHash: { not: null }` (FR-022) so a
 * credential-less token can never verify a credential-less account. The
 * moment this consumption is what verifies the account, every other
 * still-pending token for it is invalidated in the same transaction —
 * that's what makes a losing sibling token concretely "dead" (security
 * amendment #3) rather than merely inert.
 */
export async function consumeVerificationToken(
  rawToken: string,
): Promise<ConsumeVerificationTokenResult> {
  const tokenHash = hashToken(rawToken);
  const token = await prisma.verificationToken.findUnique({ where: { tokenHash } });

  if (!token) return { ok: false, reason: "invalid" };
  if (token.consumedAt) return { ok: false, reason: "consumed" };
  if (token.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };

  return prisma.$transaction(async (tx) => {
    await tx.verificationToken.update({
      where: { tokenHash },
      data: { consumedAt: new Date() },
    });

    const verifyResult = await tx.account.updateMany({
      where: {
        id: token.accountId,
        emailVerifiedAt: null,
        ...(token.candidatePasswordHash === null ? { passwordHash: { not: null } } : {}),
      },
      data: { emailVerifiedAt: new Date(), passwordHash: token.candidatePasswordHash },
    });

    if (verifyResult.count > 0) {
      await tx.verificationToken.updateMany({
        where: { accountId: token.accountId, id: { not: token.id }, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      return { ok: true, accountId: token.accountId };
    }

    if (token.candidatePasswordHash === null) {
      const account = await tx.account.findUnique({ where: { id: token.accountId } });
      if (!account?.emailVerifiedAt) {
        return { ok: false, reason: "no_credential" };
      }
    }

    return { ok: true, accountId: token.accountId };
  });
}

/** Used by resendVerification (FR-014) to carry forward the same candidate credential. */
export async function getLatestCandidatePasswordHash(accountId: string): Promise<string | null> {
  const latest = await prisma.verificationToken.findFirst({
    where: { accountId },
    orderBy: { createdAt: "desc" },
  });
  return latest?.candidatePasswordHash ?? null;
}
