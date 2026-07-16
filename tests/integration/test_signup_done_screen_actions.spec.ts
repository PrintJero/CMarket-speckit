import { expect, test } from "@playwright/test";
import { uniqueEmail } from "./helpers";

/**
 * spec.md FR-024: the post-sign-up "Check your email" screen must not be a
 * dead end. Presentation and wiring only — reuses the existing, unchanged
 * resend-verification endpoint (FR-014/FR-021).
 */
test("the post-sign-up screen offers a resend action and a link back to sign-in", async ({
  page,
}) => {
  const email = uniqueEmail("signup-done-actions");
  const password = "correct-horse-battery-staple";

  await page.goto("/sign-up");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();

  await page.getByRole("button", { name: "Resend verification email" }).click();
  // FR-009/FR-021: identical, generic acknowledgement regardless of the
  // email's real state (already sent, already verified, or rate-limited).
  await expect(
    page.getByText("If this email needs verifying, we've sent a new link."),
  ).toBeVisible();

  await page.getByRole("link", { name: "Back to sign in" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
});
