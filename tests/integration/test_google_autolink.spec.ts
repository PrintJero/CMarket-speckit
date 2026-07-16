import { expect, test } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { buildPrismaAuthAdapter } from "@/lib/auth/prismaAuthAdapter";
import { hashPassword } from "@/lib/auth/passwordHash";
import { signInWithPassword } from "@/server/services/accountService";
import { createSession } from "@/server/services/sessionService";
import { issueVerificationToken } from "@/server/services/verificationService";
import { uniqueEmail } from "./helpers";

/**
 * Security amendment (2026-07-16), spec.md FR-018 / Edge Cases: an account
 * that was never verified may have been registered by an attacker squatting
 * the victim's email, never the victim. When the real owner later proves
 * ownership via Google, the pre-existing password credential is untrusted
 * and MUST NOT survive the link — otherwise the attacker keeps silent
 * password access to the victim's now-verified account (Constitution
 * Principle I). This is the same reasoning as test_google_signup_new.spec.ts
 * for exercising the Adapter directly rather than a real Google consent
 * screen.
 */
test("Google sign-up auto-links to an existing UNVERIFIED password account, discards the password, and revokes prior sessions", async () => {
  const adapter = buildPrismaAuthAdapter();
  const email = uniqueEmail("google-autolink-unverified");
  const mixedCaseEmail = email.replace("google-autolink-unverified", "Google-Autolink-Unverified");
  const providerAccountId = `google-${Math.floor(Math.random() * 1e9)}`;
  const originalPassword = "existing-password-123";

  const existing = await prisma.account.create({
    data: { email, passwordHash: await hashPassword(originalPassword), emailVerifiedAt: null },
  });
  // A session and a pending verification token established before ownership
  // was ever proven — both must not survive the link.
  const priorSession = await createSession(existing.id);
  await issueVerificationToken(existing.id, "attacker-pending-candidate-hash");

  const matched = await adapter.getUserByEmail!(mixedCaseEmail); // FR-017: case-insensitive
  expect(matched?.id).toBe(existing.id);

  await adapter.linkAccount!({
    provider: "google",
    providerAccountId,
    userId: existing.id,
    type: "oauth",
  } as never);

  const updated = await prisma.account.findUniqueOrThrow({ where: { id: existing.id } });
  expect(updated.emailVerifiedAt).not.toBeNull();
  expect(updated.passwordHash).toBeNull(); // FR-018: untrusted credential discarded

  const remainingSessions = await prisma.session.count({ where: { accountId: existing.id } });
  expect(remainingSessions).toBe(0); // FR-018: every prior session revoked
  void priorSession;

  const pendingTokens = await prisma.verificationToken.count({
    where: { accountId: existing.id, consumedAt: null },
  });
  expect(pendingTokens).toBe(0); // FR-018: pending verification tokens invalidated

  const accountCount = await prisma.account.count({ where: { email } });
  expect(accountCount).toBe(1); // no second account created

  // The old password MUST NOT authenticate after the link.
  const signInAttempt = await signInWithPassword(email, originalPassword);
  expect(signInAttempt.ok).toBe(false);
});
