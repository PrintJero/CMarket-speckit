import { expect, test } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/passwordHash";
import { uniqueEmail, signIn } from "./helpers";

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

async function addMember(communityId: string, email: string, password: string) {
  const account = await createVerifiedAccount(email, password);
  await prisma.membership.create({ data: { accountId: account.id, communityId, role: "MEMBER" } });
  return account;
}

// T010 (US1) — a fellow member sees the owner's display name, or the defined
// placeholder when absent — never the owner's email, in either surface.
test("the feed and detail page show the listing owner's display name, or the defined placeholder, never the email (US1)", async ({
  page,
}) => {
  const password = "correct-horse-battery-staple";
  const ownerEmail = uniqueEmail("listing-display-owner");
  const memberEmail = uniqueEmail("listing-display-member");
  const namelessOwnerEmail = uniqueEmail("listing-display-nameless");
  const community = await createCommunityWithAdmin(
    page.request,
    `Listing Display Names Community ${Date.now()}`,
    ownerEmail,
    password,
  );
  await addMember(community.id, memberEmail, password);
  const owner = await prisma.account.findUniqueOrThrow({ where: { email: ownerEmail } });
  await prisma.account.update({ where: { id: owner.id }, data: { displayName: "Ada Lovelace" } });
  const namelessOwner = await addMember(community.id, namelessOwnerEmail, password);

  const listing = await prisma.listing.create({
    data: {
      communityId: community.id,
      ownerId: owner.id,
      title: "Named Owner's Bicycle",
      description: "Barely used road bike",
      priceCents: 25000,
    },
  });
  const namelessListing = await prisma.listing.create({
    data: {
      communityId: community.id,
      ownerId: namelessOwner.id,
      title: "Nameless Owner's Desk",
      description: "Standing desk",
      priceCents: 15000,
    },
  });

  await signIn(page, memberEmail, password);
  await page.goto(`/communities/${community.id}/listings`);
  await expect(page.getByText("Ada Lovelace")).toBeVisible();
  await expect(page.getByText("A member")).toBeVisible();
  await expect(page.getByText(ownerEmail)).toHaveCount(0);
  await expect(page.getByText(namelessOwnerEmail)).toHaveCount(0);

  await page.goto(`/communities/${community.id}/listings/${listing.id}`);
  await expect(page.getByText("Ada Lovelace")).toBeVisible();
  await expect(page.getByText(ownerEmail)).toHaveCount(0);

  await page.goto(`/communities/${community.id}/listings/${namelessListing.id}`);
  await expect(page.getByText("A member")).toBeVisible();
  await expect(page.getByText(namelessOwnerEmail)).toHaveCount(0);
});
