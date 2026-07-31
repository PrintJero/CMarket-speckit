import { expect, test } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/passwordHash";
import { signIn, uniqueEmail } from "./helpers";

/**
 * The authenticated sidebar's primary identity is always displayName, never
 * the account's email address; Account leads to the signed-in member's own
 * self-profile (014-account-public-profiles), which — unlike every other
 * marketplace surface — is exactly where that same email address IS expected
 * to appear, since it is the account owner viewing their own data (FR-002,
 * FR-008).
 */
test("the sidebar shows displayName (never email) as the primary identity, and Account leads to the self profile", async ({
  page,
}) => {
  const email = uniqueEmail("sidebar-identity");
  const password = "correct-horse-battery-staple";
  await prisma.account.create({
    data: {
      email,
      passwordHash: await hashPassword(password),
      emailVerifiedAt: new Date(),
      displayName: "Francisco García",
    },
  });

  await signIn(page, email, password);

  // Primary identity: displayName text and its first letter as the avatar — never email.
  await expect(page.getByText("Francisco García")).toBeVisible();
  await expect(page.getByText("F", { exact: true })).toBeVisible();
  await expect(page.getByText(email)).toHaveCount(0);
  await expect(page.getByText("Signed in as", { exact: false })).toHaveCount(0);

  // Existing navigation items are preserved.
  await expect(page.getByRole("link", { name: "Chats", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "My listings", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

  // Account leads to the self profile — the one place this account's own email IS shown
  // (014-account-public-profiles, FR-002, FR-008); still no editing capability.
  await page.getByRole("link", { name: "Account", exact: true }).click();
  await page.waitForURL("/account");
  await expect(page.getByRole("main").getByText("Francisco García")).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByLabel("Display name")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save" })).toHaveCount(0);
});

test("an account with no display name falls back to the neutral placeholder in the sidebar, never the email", async ({
  page,
}) => {
  const email = uniqueEmail("sidebar-nameless");
  const password = "correct-horse-battery-staple";
  await prisma.account.create({
    data: { email, passwordHash: await hashPassword(password), emailVerifiedAt: new Date() },
  });

  await signIn(page, email, password);

  await expect(page.getByText("A member")).toBeVisible();
  await expect(page.getByText(email)).toHaveCount(0);
});
