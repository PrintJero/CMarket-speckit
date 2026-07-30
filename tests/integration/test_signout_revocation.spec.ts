import { expect, test } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/passwordHash";
import { uniqueEmail } from "./helpers";

/** quickstart.md Scenario 3, step 4 / Story 2 scenario 3. */
test("sign-out deletes the underlying Session row", async ({ page }) => {
  const email = uniqueEmail("signout-revoke");
  const password = "correct-horse-battery-staple";
  const account = await prisma.account.create({
    data: {
      email,
      passwordHash: await hashPassword(password),
      emailVerifiedAt: new Date(),
      displayName: "Revoke Tester",
    },
  });

  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("/");
  await expect(page.getByText("Revoke Tester")).toBeVisible();

  expect(await prisma.session.count({ where: { accountId: account.id } })).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL("/");
  await expect(page.getByText("Revoke Tester")).toHaveCount(0);

  expect(await prisma.session.count({ where: { accountId: account.id } })).toBe(0);
});
