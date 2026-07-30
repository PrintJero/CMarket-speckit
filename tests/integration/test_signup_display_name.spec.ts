import { expect, test } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { getVerificationLink, uniqueEmail } from "./helpers";

/**
 * 010-registration-form: the registration form collects displayName, email,
 * password, and confirmPassword up front. No separate "name yourself" step
 * exists anywhere afterward, and sign-in continues to need only email and
 * password.
 */
test("registration collects a display name up front, and the account can then sign in with only email and password", async ({
  page,
  request,
}) => {
  const password = "correct-horse-battery-staple";
  const email = uniqueEmail("signup-display-name");

  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Francisco García");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();

  const account = await prisma.account.findUniqueOrThrow({ where: { email } });
  expect(account.displayName).toBe("Francisco García"); // stored at registration itself
  expect(account.passwordHash).toBeNull(); // not yet verified

  const link = await getVerificationLink(request, email);
  await page.goto(link);

  // Sign in afterward using only email and password — no name field here.
  await page.goto("/sign-in");
  await expect(page.getByLabel("Name")).toHaveCount(0);
  await expect(page.getByLabel("Display name")).toHaveCount(0);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("/");
  await expect(page.getByText("Francisco García")).toBeVisible();
  await expect(page.getByText(email)).toHaveCount(0);

  const signedIn = await prisma.account.findUniqueOrThrow({ where: { email } });
  expect(signedIn.displayName).toBe("Francisco García"); // unchanged by sign-in
});
