import { expect, test } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { assertEmailVerified } from "@/server/services/accountService";
import { getVerificationLink, uniqueEmail } from "./helpers";

/**
 * quickstart.md Scenario 1. The invitations feature itself lives outside
 * this repo/spec, so instead of calling a (nonexistent here) invitation
 * endpoint, this test drives the real UI flow and asserts directly against
 * `assertEmailVerified()` — the exact gate the invitations feature is
 * contractually required to call before activating a membership (FR-005,
 * FR-007).
 */
test("signup → blocked before verification → verify → allowed after", async ({
  page,
  request,
}) => {
  const email = uniqueEmail("signup-verify");
  const password = "correct-horse-battery-staple";

  await page.goto("/sign-up");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();

  const account = await prisma.account.findUniqueOrThrow({ where: { email } });
  expect(await assertEmailVerified(account.id)).toBe(false);

  const link = await getVerificationLink(request, email);
  await page.goto(link);
  await expect(page.getByText("Your email is verified.")).toBeVisible();

  expect(await assertEmailVerified(account.id)).toBe(true);
});
