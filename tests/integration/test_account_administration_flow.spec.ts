import { expect, test } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/passwordHash";
import { signIn, uniqueEmail } from "./helpers";

async function createMasterFixture(masterId: string, password: string) {
  return prisma.masterIdentity.create({
    data: { masterId, email: `${masterId}@example.com`, passwordHash: await hashPassword(password), mustChangePassword: false },
  });
}

async function signInAsMaster(page: import("@playwright/test").Page, masterId: string, password: string) {
  await page.goto("/master/sign-in");
  await page.getByLabel("Master ID").fill(masterId);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("/master");
}

test("a MASTER edits, suspends, reactivates, resets, and permanently deletes an ordinary account", async ({
  page,
  browser,
}) => {
  const masterId = `us7-${process.pid}-${Math.floor(Math.random() * 1e9)}`;
  await createMasterFixture(masterId, "master-password-1");

  const originalEmail = uniqueEmail("us7-account");
  const originalPassword = "original-password-1";
  const account = await prisma.account.create({
    data: {
      email: originalEmail,
      passwordHash: await hashPassword(originalPassword),
      emailVerifiedAt: new Date(),
      displayName: "US7 Original Name",
    },
  });

  await signInAsMaster(page, masterId, "master-password-1");
  await page.goto(`/master/accounts/${account.id}`);

  // Edit.
  const newEmail = uniqueEmail("us7-account-edited");
  await page.getByLabel("Email").fill(newEmail);
  await page.getByLabel("Display name").fill("US7 Edited Name");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  // Suspend — sign-in now denied.
  await page.getByRole("button", { name: "Suspend" }).click();
  await expect(page.getByText("Status: SUSPENDED")).toBeVisible();

  const suspendedContext = await browser.newContext();
  const suspendedPage = await suspendedContext.newPage();
  await suspendedPage.goto("/sign-in");
  await suspendedPage.getByLabel("Email").fill(newEmail);
  await suspendedPage.getByLabel("Password").fill(originalPassword);
  await suspendedPage.getByRole("button", { name: "Sign in" }).click();
  await expect(suspendedPage.getByText("Invalid email or password.")).toBeVisible();
  await suspendedContext.close();

  // Reactivate — sign-in works again.
  await page.getByRole("button", { name: "Reactivate" }).click();
  await expect(page.getByText("Status: ACTIVE")).toBeVisible();

  const reactivatedContext = await browser.newContext();
  const reactivatedPage = await reactivatedContext.newPage();
  await signIn(reactivatedPage, newEmail, originalPassword);
  await reactivatedContext.close();

  // Reset password: the old one stops working, and the account's Session rows are cleared.
  const passwordHashBefore = (await prisma.account.findUniqueOrThrow({ where: { id: account.id } })).passwordHash;
  await page.goto(`/master/accounts/${account.id}`);
  const resetAlertPromise = page.waitForEvent("dialog");
  await page.getByRole("button", { name: "Reset password" }).click();
  const resetAlert = await resetAlertPromise;
  expect(resetAlert.message()).toContain("New temporary password");
  await resetAlert.dismiss().catch(() => undefined);

  const accountAfterReset = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
  expect(accountAfterReset.passwordHash).not.toBe(passwordHashBefore);
  expect(await prisma.session.findFirst({ where: { accountId: account.id } })).toBeNull();

  // Permanently delete.
  await page.goto(`/master/accounts/${account.id}`);
  await page.getByRole("button", { name: "Delete permanently" }).click();
  await expect(page.getByText("This account has been permanently deleted.")).toBeVisible();

  const deletedAccount = await prisma.account.findUnique({ where: { id: account.id } });
  expect(deletedAccount?.email).not.toBe(newEmail);
  expect(deletedAccount?.deletedAt).not.toBeNull();

  // The (new) email is free for a fresh sign-up.
  const signUpContext = await browser.newContext();
  const signUpPage = await signUpContext.newPage();
  await signUpPage.goto("/sign-up");
  await signUpPage.getByLabel("Email").fill(newEmail);
  await signUpPage.getByLabel("Password", { exact: true }).fill("a-fresh-password-1");
  await signUpPage.getByLabel("Confirm password").fill("a-fresh-password-1");
  await signUpPage.getByRole("button", { name: "Create account" }).click();
  await expect(signUpPage.getByText("Check your email")).toBeVisible();
  await signUpContext.close();
});

test("suspending/deleting an account that alone administers multiple communities requires a replacement for each", async ({
  page,
}) => {
  const masterId = `us7-multi-${process.pid}-${Math.floor(Math.random() * 1e9)}`;
  await createMasterFixture(masterId, "master-password-1");

  const adminEmail = uniqueEmail("us7-multi-admin");
  const admin = await prisma.account.create({
    data: { email: adminEmail, passwordHash: await hashPassword("irrelevant"), emailVerifiedAt: new Date() },
  });
  const communityX = await prisma.community.create({ data: { name: `US7 Community X ${Date.now()}`, createdByOperator: "test" } });
  const communityY = await prisma.community.create({ data: { name: `US7 Community Y ${Date.now()}`, createdByOperator: "test" } });
  await prisma.membership.create({
    data: { accountId: admin.id, communityId: communityX.id, role: "ADMINISTRATOR", operationalEpoch: 1 },
  });
  await prisma.membership.create({
    data: { accountId: admin.id, communityId: communityY.id, role: "ADMINISTRATOR", operationalEpoch: 1 },
  });
  const replacementX = await prisma.account.create({
    data: { email: uniqueEmail("us7-multi-replacement-x"), passwordHash: "irrelevant", emailVerifiedAt: new Date(), displayName: "Replacement X" },
  });
  await prisma.membership.create({
    data: { accountId: replacementX.id, communityId: communityX.id, role: "MEMBER", operationalEpoch: 1 },
  });
  const replacementY = await prisma.account.create({
    data: { email: uniqueEmail("us7-multi-replacement-y"), passwordHash: "irrelevant", emailVerifiedAt: new Date(), displayName: "Replacement Y" },
  });
  await prisma.membership.create({
    data: { accountId: replacementY.id, communityId: communityY.id, role: "MEMBER", operationalEpoch: 1 },
  });

  await signInAsMaster(page, masterId, "master-password-1");
  await page.goto(`/master/accounts/${admin.id}`);
  await page.getByRole("button", { name: "Suspend" }).click();

  await expect(page.getByText(/last active administrator of 2 community/i)).toBeVisible();
  await page.getByLabel("US7 Community X", { exact: false }).selectOption({ label: "Replacement X" });
  await page.getByLabel("US7 Community Y", { exact: false }).selectOption({ label: "Replacement Y" });
  await page.getByRole("button", { name: "Confirm suspend" }).click();

  await expect(page.getByText("Status: SUSPENDED")).toBeVisible();
  const replacementXMembership = await prisma.membership.findFirstOrThrow({
    where: { accountId: replacementX.id, communityId: communityX.id },
  });
  expect(replacementXMembership.role).toBe("ADMINISTRATOR");
});
