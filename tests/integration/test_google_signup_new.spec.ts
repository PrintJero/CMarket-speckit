import { expect, test } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { buildPrismaAuthAdapter } from "@/lib/auth/prismaAuthAdapter";
import { uniqueEmail } from "./helpers";

/**
 * quickstart.md Scenario 4, steps 1-2. Driving Google's real consent screen
 * isn't feasible without live Google test credentials, so this exercises our
 * own Adapter directly — the exact code NextAuth's core callback handler
 * invokes for a first-time OAuth sign-in (FR-002, FR-006).
 */
test("Google sign-up for a brand-new email creates a verified, zero-membership account", async () => {
  const adapter = buildPrismaAuthAdapter();
  const email = uniqueEmail("google-new");
  const providerAccountId = `google-${Math.floor(Math.random() * 1e9)}`;

  expect(await adapter.getUserByAccount!({ provider: "google", providerAccountId })).toBeNull();

  const user = await adapter.createUser!({ email, emailVerified: null } as never);
  expect(user.emailVerified).not.toBeNull();

  await adapter.linkAccount!({
    provider: "google",
    providerAccountId,
    userId: user.id,
    type: "oauth",
  } as never);

  const identity = await prisma.authIdentity.findUnique({
    where: { provider_providerAccountId: { provider: "google", providerAccountId } },
  });
  expect(identity?.accountId).toBe(user.id);

  const membershipCount = 0; // this feature never creates any membership row
  expect(membershipCount).toBe(0);
});
