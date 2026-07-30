import { expect, test } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/passwordHash";
import { uniqueEmail } from "./helpers";

/** quickstart.md Scenario 3, steps 1-2 / FR-008. */
test("sign in persists across a simulated app restart", async ({ page, browser }) => {
  const email = uniqueEmail("signin-persist");
  const password = "correct-horse-battery-staple";
  await prisma.account.create({
    data: {
      email,
      passwordHash: await hashPassword(password),
      emailVerifiedAt: new Date(),
      displayName: "Persist Tester",
    },
  });

  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("/");
  await expect(page.getByText("Persist Tester")).toBeVisible();
  await expect(page.getByText(email)).toHaveCount(0);

  // Simulate an app restart: carry the persisted cookie into a fresh context.
  const storageState = await page.context().storageState();
  const restartedContext = await browser.newContext({ storageState });
  const restartedPage = await restartedContext.newPage();
  await restartedPage.goto("/");
  await expect(restartedPage.getByText("Persist Tester")).toBeVisible();
  await restartedContext.close();
});
