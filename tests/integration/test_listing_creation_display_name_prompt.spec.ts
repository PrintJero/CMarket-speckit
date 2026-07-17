import { expect, test } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/passwordHash";
import { getVerificationLink, uniqueEmail, signIn } from "./helpers";

async function createVerifiedAccount(email: string, password: string) {
  return prisma.account.create({
    data: { email, passwordHash: await hashPassword(password), emailVerifiedAt: new Date() },
  });
}

async function createCommunityWithAdmin(
  request: import("@playwright/test").APIRequestContext,
  name: string,
  adminEmail: string,
  password: string,
) {
  await createVerifiedAccount(adminEmail, password);
  const response = await request.post("/api/operator/create-community", {
    data: { name, founderEmail: adminEmail, invokedBy: "playwright-test" },
  });
  const body = await response.json();
  if (!body.ok) throw new Error(`expected community creation to succeed, got ${JSON.stringify(body)}`);
  return body.community as { id: string; name: string };
}

// T015 (US2) — a brand-new email/password account is never prompted at sign-up;
// the first listing-creation requires a display name; the guarantee holds even
// against a direct API request that bypasses the form entirely (FR-008).
test("an email/password account is prompted for a display name only at first listing creation, never at sign-up, and the guarantee survives a direct API bypass (US2)", async ({
  page,
  request,
}) => {
  const password = "correct-horse-battery-staple";
  const email = uniqueEmail("listing-display-prompt");
  const adminEmail = uniqueEmail("listing-display-prompt-admin");
  const community = await createCommunityWithAdmin(
    page.request,
    `Listing Display Prompt Community ${Date.now()}`,
    adminEmail,
    password,
  );

  // Sign up: no display-name field or prompt anywhere on the form.
  await page.goto("/sign-up");
  await expect(page.getByLabel("Display name")).toHaveCount(0);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await expect(page.getByLabel("Display name")).toHaveCount(0);

  const link = await getVerificationLink(request, email);
  await page.goto(link);

  const account = await prisma.account.findUniqueOrThrow({ where: { email } });
  await prisma.membership.create({ data: { accountId: account.id, communityId: community.id, role: "MEMBER" } });

  await signIn(page, email, password);

  // Listing creation: a required "Display name" field appears (the account has none yet).
  await page.goto(`/communities/${community.id}/listings/new`);
  const displayNameField = page.getByLabel("Display name");
  await expect(displayNameField).toBeVisible();
  await displayNameField.fill("First Timer");
  await page.getByLabel("Title").fill("My First Listing");
  await page.getByLabel("Description").fill("Something to sell");
  await page.getByLabel("Price (MXN)").fill("100.00");
  await page.getByRole("button", { name: "Create listing" }).click();
  await page.waitForURL(`**/communities/${community.id}/listings`);

  const updatedAccount = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
  expect(updatedAccount.displayName).toBe("First Timer");
  const firstListing = await prisma.listing.findFirstOrThrow({
    where: { communityId: community.id, title: "My First Listing" },
  });
  expect(firstListing.ownerId).toBe(account.id);

  // A second listing by the now-named account: no display-name field this time.
  await page.goto(`/communities/${community.id}/listings/new`);
  await expect(page.getByLabel("Display name")).toHaveCount(0);
  await page.getByLabel("Title").fill("My Second Listing");
  await page.getByLabel("Description").fill("Another item");
  await page.getByLabel("Price (MXN)").fill("50.00");
  await page.getByRole("button", { name: "Create listing" }).click();
  await page.waitForURL(`**/communities/${community.id}/listings`);
  await expect(page.getByText("My Second Listing")).toBeVisible();

  // A direct API request, bypassing the form entirely, for a different nameless account.
  const namelessEmail = uniqueEmail("listing-display-prompt-nameless");
  const namelessAccount = await createVerifiedAccount(namelessEmail, password);
  await prisma.membership.create({
    data: { accountId: namelessAccount.id, communityId: community.id, role: "MEMBER" },
  });
  const namelessContext = await page.context().browser()!.newContext();
  const namelessPage = await namelessContext.newPage();
  await signIn(namelessPage, namelessEmail, password);
  const bypassResponse = await namelessPage.request.fetch(`/api/communities/${community.id}/listings`, {
    method: "POST",
    data: { title: "Bypass attempt", description: "Should be blocked", priceCents: 100 },
    headers: { "Content-Type": "application/json" },
  });
  expect(bypassResponse.status()).toBe(409);
  expect(await bypassResponse.json()).toEqual({ ok: false, reason: "display_name_required" });
  expect(await prisma.listing.count({ where: { communityId: community.id, title: "Bypass attempt" } })).toBe(0);
  await namelessContext.close();
});
