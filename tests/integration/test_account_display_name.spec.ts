import { expect, test } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/passwordHash";
import { signIn, uniqueEmail } from "./helpers";

async function createVerifiedAccount(email: string, password: string) {
  return prisma.account.create({
    data: { email, passwordHash: await hashPassword(password), emailVerifiedAt: new Date() },
  });
}

async function saveDisplayName(page: import("@playwright/test").Page, name: string): Promise<void> {
  await page.getByLabel("Display name").fill(name);
  await Promise.all([
    page.waitForResponse(
      (res) => res.url().includes("/api/account/display-name") && res.request().method() === "PATCH",
    ),
    page.getByRole("button", { name: "Save" }).click(),
  ]);
}

// T030 (US4): anyone can see and change their own display name from a
// durable, reachable place — and only their own.
test("an account holder views and edits their own display name at /account, and no other account can change it (US4)", async ({
  page,
  browser,
}) => {
  const password = "correct-horse-battery-staple";
  const emailA = uniqueEmail("account-settings-a");
  const emailB = uniqueEmail("account-settings-b");
  await createVerifiedAccount(emailA, password);
  await createVerifiedAccount(emailB, password);

  await signIn(page, emailA, password);
  await page.goto("/account");
  await expect(page.getByText("not set yet", { exact: false })).toBeVisible();

  await saveDisplayName(page, "Ada Lovelace");
  await expect(page.getByLabel("Display name")).toHaveValue("Ada Lovelace");

  const accountA = await prisma.account.findUniqueOrThrow({ where: { email: emailA } });
  expect(accountA.displayName).toBe("Ada Lovelace");

  // A different, unrelated account edits its own display name — there is no
  // account-id field anywhere in this flow for it to target account A with.
  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  await signIn(pageB, emailB, password);
  await pageB.goto("/account");
  await saveDisplayName(pageB, "Someone Else");
  await expect(pageB.getByLabel("Display name")).toHaveValue("Someone Else");
  await contextB.close();

  const accountAAfter = await prisma.account.findUniqueOrThrow({ where: { email: emailA } });
  expect(accountAAfter.displayName).toBe("Ada Lovelace");
  const accountB = await prisma.account.findUniqueOrThrow({ where: { email: emailB } });
  expect(accountB.displayName).toBe("Someone Else");
});
