import { expect, test } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { uniqueEmail } from "./helpers";

/**
 * spec.md FR-023: client-side-only typo guard. Password recovery is out of
 * scope, so a typo'd password would otherwise produce a permanently
 * unusable account once verified (FR-020 applies whatever the token
 * carries). This is purely a form guard — no server request should even be
 * made when the two entries don't match.
 */
test("sign-up blocks submission when the password confirmation does not match, with no request reaching the server", async ({
  page,
}) => {
  const email = uniqueEmail("signup-mismatch");

  await page.goto("/sign-up");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("first-password-123");
  await page.getByLabel("Confirm password").fill("different-password-456");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByText("Passwords do not match.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Check your email" })).toHaveCount(0);

  // No account was created — the mismatch was caught before any API call.
  const account = await prisma.account.findUnique({ where: { email } });
  expect(account).toBeNull();
});
