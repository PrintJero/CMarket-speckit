import { expect, test } from "@playwright/test";
import { EMAIL_DELIVERY_FAILED_MESSAGE } from "@/lib/email/sendEmail";
import { getVerificationLink, uniqueEmail } from "./helpers";

/**
 * Hotfix v1.0.1 (UI half): when the server reports that the verification
 * email could not be sent (503), the sign-up form shows a clear message and
 * stays usable, and the member can simply submit again. The server half (no
 * token left behind, rate limit untouched) is covered by
 * tests/contract/test_sign_up_email_failure.ts; the real email provider
 * cannot fail on demand here, so its 503 is simulated with page.route.
 */
test("a failed verification email shows a clear message, and retrying the same form succeeds", async ({
  page,
  request,
}) => {
  const email = uniqueEmail("signup-email-failure");
  const password = "correct-horse-battery-staple";

  await page.route("**/api/auth/sign-up", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: EMAIL_DELIVERY_FAILED_MESSAGE }),
    }),
  );

  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Email Failure Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();

  // Filtered by text: Next's route announcer is also a role="alert" element.
  await expect(
    page.getByRole("alert").filter({ hasText: EMAIL_DELIVERY_FAILED_MESSAGE }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Create account" })).toBeEnabled();

  // Delivery recovers: the very same form, submitted again, reaches the real server.
  await page.unroute("**/api/auth/sign-up");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();

  const link = await getVerificationLink(request, email);
  await page.goto(link);
  await expect(page.getByText("Your email is verified.")).toBeVisible();
});
