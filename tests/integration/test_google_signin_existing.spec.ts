import { expect, test } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { buildPrismaAuthAdapter } from "@/lib/auth/prismaAuthAdapter";
import { uniqueEmail } from "./helpers";

/** quickstart.md Scenario 4, step 3 (see test_google_signup_new.spec.ts for why this drives the Adapter directly). */
test("a repeat Google sign-in for the same identity reuses the same account", async () => {
  const adapter = buildPrismaAuthAdapter();
  const email = uniqueEmail("google-repeat");
  const providerAccountId = `google-${Math.floor(Math.random() * 1e9)}`;

  const account = await prisma.account.create({
    data: { email, emailVerifiedAt: new Date() },
  });
  await prisma.authIdentity.create({
    data: { accountId: account.id, provider: "google", providerAccountId },
  });

  const found = await adapter.getUserByAccount!({ provider: "google", providerAccountId });
  expect(found?.id).toBe(account.id);

  const accountCount = await prisma.account.count({ where: { email } });
  expect(accountCount).toBe(1);
});
