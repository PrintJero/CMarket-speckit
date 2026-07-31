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

// 010-registration-form: display name is now collected up front, as a
// required field on the registration form itself, so a freshly registered
// account already has one by the time it reaches its first listing — there
// is no longer a separate "name yourself" step after sign-up/sign-in.
test("a freshly registered account supplies its display name at sign-up and is never prompted again, including at first listing creation", async ({
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

  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("First Timer");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();

  const link = await getVerificationLink(request, email);
  await page.goto(link);

  const account = await prisma.account.findUniqueOrThrow({ where: { email } });
  expect(account.displayName).toBe("First Timer"); // set at registration itself
  await prisma.membership.create({
    data: { accountId: account.id, communityId: community.id, role: "MEMBER" },
  });

  await signIn(page, email, password);

  // First listing ever created by this account: no "Display name" field —
  // the account already has one from registration.
  await page.goto(`/communities/${community.id}/listings/new`);
  await expect(page.getByLabel("Display name")).toHaveCount(0);
  await page.getByLabel("Title").fill("My First Listing");
  await page.getByLabel("Description").fill("Something to sell");
  await page.getByLabel("Price (MXN)").fill("100.00");
  await page.getByRole("button", { name: "Create listing" }).click();
  await page.waitForURL(`**/communities/${community.id}`);

  const unchangedAccount = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
  expect(unchangedAccount.displayName).toBe("First Timer"); // untouched by listing creation
  const firstListing = await prisma.listing.findFirstOrThrow({
    where: { communityId: community.id, title: "My First Listing" },
  });
  expect(firstListing.ownerId).toBe(account.id);
});

// The create-listing display-name gate (006-user-display-names FR-008)
// remains as a defensive backstop for an account that can still legitimately
// have no display name from a path other than this registration form — e.g.
// an account that predates this change, or a Google sign-in whose profile
// carried no name at all. That gate is untouched by, and independent of, the
// registration form covered above.
test("an account with no display name from outside the registration form is still prompted at first listing creation, and a direct API bypass is still blocked", async ({
  page,
}) => {
  const password = "correct-horse-battery-staple";
  const adminEmail = uniqueEmail("listing-display-prompt-admin-legacy");
  const community = await createCommunityWithAdmin(
    page.request,
    `Listing Display Prompt Community Legacy ${Date.now()}`,
    adminEmail,
    password,
  );

  const namelessEmail = uniqueEmail("listing-display-prompt-nameless");
  const namelessAccount = await createVerifiedAccount(namelessEmail, password);
  await prisma.membership.create({
    data: { accountId: namelessAccount.id, communityId: community.id, role: "MEMBER" },
  });

  await signIn(page, namelessEmail, password);

  await page.goto(`/communities/${community.id}/listings/new`);
  const displayNameField = page.getByLabel("Display name");
  await expect(displayNameField).toBeVisible();
  await displayNameField.fill("Now Named");
  await page.getByLabel("Title").fill("My First Listing");
  await page.getByLabel("Description").fill("Something to sell");
  await page.getByLabel("Price (MXN)").fill("100.00");
  await page.getByRole("button", { name: "Create listing" }).click();
  await page.waitForURL(`**/communities/${community.id}`);

  const updatedAccount = await prisma.account.findUniqueOrThrow({ where: { id: namelessAccount.id } });
  expect(updatedAccount.displayName).toBe("Now Named");

  // A second listing by the now-named account: no display-name field this time.
  await page.goto(`/communities/${community.id}/listings/new`);
  await expect(page.getByLabel("Display name")).toHaveCount(0);

  // A direct API request, bypassing the form entirely, for a different nameless account.
  const bypassEmail = uniqueEmail("listing-display-prompt-bypass");
  const bypassAccount = await createVerifiedAccount(bypassEmail, password);
  await prisma.membership.create({
    data: { accountId: bypassAccount.id, communityId: community.id, role: "MEMBER" },
  });
  const bypassContext = await page.context().browser()!.newContext();
  const bypassPage = await bypassContext.newPage();
  await signIn(bypassPage, bypassEmail, password);
  const bypassResponse = await bypassPage.request.fetch(`/api/communities/${community.id}/listings`, {
    method: "POST",
    data: { title: "Bypass attempt", description: "Should be blocked", priceCents: 100 },
    headers: { "Content-Type": "application/json" },
  });
  expect(bypassResponse.status()).toBe(409);
  expect(await bypassResponse.json()).toEqual({ ok: false, reason: "display_name_required" });
  expect(await prisma.listing.count({ where: { communityId: community.id, title: "Bypass attempt" } })).toBe(0);
  await bypassContext.close();
});
