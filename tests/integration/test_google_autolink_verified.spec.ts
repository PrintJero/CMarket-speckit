import { expect, test } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { buildPrismaAuthAdapter } from "@/lib/auth/prismaAuthAdapter";
import { hashPassword } from "@/lib/auth/passwordHash";
import { signInWithPassword } from "@/server/services/accountService";
import { createSession } from "@/server/services/sessionService";
import { uniqueEmail } from "./helpers";

/**
 * spec.md FR-015 (unchanged behavior) / Story 3 scenario 4. Previously had no
 * dedicated coverage — test_google_autolink.spec.ts exercised only the
 * unverified case. Proves the fix for the unverified case (see that file)
 * does not over-apply to an already-verified account: its password and
 * sessions must be left alone.
 */
test("Google sign-up auto-links to an existing VERIFIED password account and preserves its credential", async () => {
  const adapter = buildPrismaAuthAdapter();
  const email = uniqueEmail("google-autolink-verified");
  const providerAccountId = `google-${Math.floor(Math.random() * 1e9)}`;
  const originalPassword = "existing-password-123";

  const existing = await prisma.account.create({
    data: {
      email,
      passwordHash: await hashPassword(originalPassword),
      emailVerifiedAt: new Date(),
    },
  });
  const priorSession = await createSession(existing.id);

  await adapter.linkAccount!({
    provider: "google",
    providerAccountId,
    userId: existing.id,
    type: "oauth",
  } as never);

  const updated = await prisma.account.findUniqueOrThrow({ where: { id: existing.id } });
  expect(updated.emailVerifiedAt).not.toBeNull();
  expect(updated.passwordHash).toBe(existing.passwordHash); // FR-015: credential preserved

  const remainingSessions = await prisma.session.count({ where: { accountId: existing.id } });
  expect(remainingSessions).toBe(1); // FR-015: no teardown for an already-verified account

  const accountCount = await prisma.account.count({ where: { email } });
  expect(accountCount).toBe(1);

  // The old password MUST still authenticate — this was already verified,
  // so its credential was never untrusted.
  const signInAttempt = await signInWithPassword(email, originalPassword);
  expect(signInAttempt.ok).toBe(true);
  void priorSession;
});
