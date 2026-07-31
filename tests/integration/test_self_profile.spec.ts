import { expect, test } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/passwordHash";
import { uniqueEmail, signIn } from "./helpers";

async function createVerifiedAccount(email: string, password: string, displayName: string) {
  return prisma.account.create({
    data: { email, passwordHash: await hashPassword(password), emailVerifiedAt: new Date(), displayName },
  });
}

async function createCommunityWithAdmin(
  request: import("@playwright/test").APIRequestContext,
  name: string,
  adminEmail: string,
  password: string,
  adminDisplayName: string,
) {
  await createVerifiedAccount(adminEmail, password, adminDisplayName);
  const response = await request.post("/api/operator/create-community", {
    data: { name, founderEmail: adminEmail, invokedBy: "playwright-test" },
  });
  const body = await response.json();
  if (!body.ok) throw new Error(`expected community creation to succeed, got ${JSON.stringify(body)}`);
  return body.community as { id: string; name: string };
}

async function addMember(communityId: string, email: string, password: string, displayName: string) {
  const account = await createVerifiedAccount(email, password, displayName);
  await prisma.membership.create({ data: { accountId: account.id, communityId, role: "MEMBER" } });
  return account;
}

// T004 (US1): the self-profile page, reached from "Account," shows identity, reputation, and
// every current community with its own active listings, both clickable.
test("Account shows the signed-in member's own profile, communities, and listings, with working navigation", async ({
  page,
}) => {
  const password = "correct-horse-battery-staple";
  const ownerEmail = uniqueEmail("self-profile-owner");
  const communityC = await createCommunityWithAdmin(
    page.request,
    `Self Profile Community C ${Date.now()}`,
    ownerEmail,
    password,
    "Self Profile Owner",
  );
  const owner = await prisma.account.findUniqueOrThrow({ where: { email: ownerEmail } });

  const communityD = await createCommunityWithAdmin(
    page.request,
    `Self Profile Community D ${Date.now()}`,
    uniqueEmail("self-profile-owner-d"),
    password,
    "Self Profile Owner D Admin",
  );
  await prisma.membership.create({ data: { accountId: owner.id, communityId: communityD.id, role: "MEMBER" } });

  const forSaleListing = await prisma.listing.create({
    data: {
      communityId: communityC.id,
      ownerId: owner.id,
      title: "Self Profile Bicycle",
      description: "Nice bike",
      priceCents: 15000,
      kind: "FOR_SALE",
      stockQuantity: 4,
    },
  });
  await prisma.listing.create({
    data: {
      communityId: communityD.id,
      ownerId: owner.id,
      title: "Self Profile Wanted Desk",
      description: "Looking for a desk",
      kind: "WANTED",
    },
  });

  await signIn(page, ownerEmail, password);
  await page.getByRole("link", { name: "Account", exact: true }).click();
  await page.waitForURL("/account");

  await expect(page.getByRole("main").getByText("Self Profile Owner")).toBeVisible();
  await expect(page.getByText(ownerEmail)).toBeVisible();
  await expect(page.getByText("No ratings yet")).toBeVisible();

  const communitiesSection = page.getByTestId("self-profile-communities");
  await expect(communitiesSection.getByText(communityC.name)).toBeVisible();
  await expect(communitiesSection.getByText(communityD.name)).toBeVisible();
  await expect(communitiesSection.getByText("Self Profile Bicycle")).toBeVisible();
  await expect(communitiesSection.getByText("Self Profile Wanted Desk")).toBeVisible();

  // Community name navigates to that community's main view.
  await communitiesSection.getByRole("link", { name: communityC.name }).click();
  await page.waitForURL(`**/communities/${communityC.id}`);

  // Listing card navigates to its detail page.
  await page.goto("/account");
  await page.getByRole("link", { name: "Self Profile Bicycle" }).click();
  await page.waitForURL(`**/communities/${communityC.id}/listings/${forSaleListing.id}`);
});

// T004 (Edge Case): a brand-new account with no memberships gets a defined empty state, not an error.
test("Account renders a defined empty state for a member who belongs to no community yet", async ({ page }) => {
  const password = "correct-horse-battery-staple";
  const email = uniqueEmail("self-profile-empty");
  await createVerifiedAccount(email, password, "Self Profile Empty");

  await signIn(page, email, password);
  await page.goto("/account");

  await expect(page.getByRole("main").getByText("Self Profile Empty")).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByText(/no communities|haven.t joined/i)).toBeVisible();
});
