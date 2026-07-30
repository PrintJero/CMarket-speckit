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

// T010 (US1) — MVP: a profile is reachable from a listing, a thread, and a transaction.
test("a member's profile is reachable from a listing, a thread, and a transaction, showing identity and listings without contact data", async ({
  page,
  browser,
}) => {
  const password = "correct-horse-battery-staple";
  const ownerEmail = uniqueEmail("profile-view-owner");
  const buyerEmail = uniqueEmail("profile-view-buyer");
  const community = await createCommunityWithAdmin(
    page.request,
    `Profile View Community ${Date.now()}`,
    ownerEmail,
    password,
    "Profile Owner",
  );
  const buyer = await addMember(community.id, buyerEmail, password, "Profile Buyer");
  const owner = await prisma.account.findUniqueOrThrow({ where: { email: ownerEmail } });

  const listing = await prisma.listing.create({
    data: { communityId: community.id, ownerId: owner.id, title: "Profile View Bicycle", description: "Nice bike", priceCents: 15000 },
  });
  const thread = await prisma.messageThread.create({ data: { listingId: listing.id, buyerId: buyer.id } });
  await prisma.message.create({ data: { threadId: thread.id, senderId: buyer.id, body: "Still available?" } });
  await prisma.message.create({ data: { threadId: thread.id, senderId: owner.id, body: "Yes, still have it!" } });

  // From the listing's feed and detail page.
  await signIn(page, buyerEmail, password);
  await page.goto(`/communities/${community.id}/listings`);
  await page.getByRole("link", { name: "Profile Owner" }).click();
  await page.waitForURL(`**/communities/${community.id}/members/${owner.id}`);
  await expect(page.getByRole("heading", { name: "Profile Owner" })).toBeVisible();
  await expect(page.getByText("Member since", { exact: false })).toBeVisible();
  await expect(page.getByText("Profile View Bicycle")).toBeVisible();
  await expect(page.getByText(ownerEmail)).toHaveCount(0);

  // From the thread page (counterpart name).
  await page.goto(`/communities/${community.id}/threads/${thread.id}`);
  await page.getByRole("link", { name: "Profile Owner" }).first().click();
  await page.waitForURL(`**/communities/${community.id}/members/${owner.id}`);

  // From the transaction detail page (counterpart name), after recording one.
  await page.goto(`/communities/${community.id}/threads/${thread.id}`);
  await page.getByRole("button", { name: "Record transaction" }).click();
  await expect(page.getByText("Unconfirmed transaction")).toBeVisible();
  await page.goto(`/communities/${community.id}/transactions`);
  await page.getByText("Profile View Bicycle").click();
  await page.getByRole("link", { name: "Profile Owner" }).click();
  await page.waitForURL(`**/communities/${community.id}/members/${owner.id}`);
});

// T010 (US1, Edge Cases): an account with no active listings shows a defined empty state.
test("a profile with no active listings in the community shows a defined empty state", async ({ page }) => {
  const password = "correct-horse-battery-staple";
  const ownerEmail = uniqueEmail("profile-view-empty-owner");
  const viewerEmail = uniqueEmail("profile-view-empty-viewer");
  const community = await createCommunityWithAdmin(
    page.request,
    `Profile View Empty Community ${Date.now()}`,
    ownerEmail,
    password,
    "Empty Listings Owner",
  );
  await addMember(community.id, viewerEmail, password, "Empty Listings Viewer");
  const owner = await prisma.account.findUniqueOrThrow({ where: { email: ownerEmail } });

  await signIn(page, viewerEmail, password);
  await page.goto(`/communities/${community.id}/members/${owner.id}`);
  await expect(page.getByText("No active listings in this community.")).toBeVisible();
  await expect(page.getByText("No ratings yet")).toBeVisible();
});

// T027 (US4, FR-011): a profile's global reputation never names the community a rating came from.
test("a profile's combined rating never reveals the community a viewer doesn't share", async ({ page }) => {
  const password = "correct-horse-battery-staple";
  const ownerEmail = uniqueEmail("profile-view-global-owner");
  const buyerCEmail = uniqueEmail("profile-view-global-buyer-c");
  const buyerDEmail = uniqueEmail("profile-view-global-buyer-d");
  const communityCName = `Profile View Global C ${Date.now()}`;
  const communityC = await createCommunityWithAdmin(page.request, communityCName, ownerEmail, password, "Global Owner");
  const communityDName = `Profile View Global D ${Date.now()}`;
  const communityD = await createCommunityWithAdmin(
    page.request,
    communityDName,
    uniqueEmail("profile-view-global-owner-d"),
    password,
    "Global Owner D Admin",
  );
  const owner = await prisma.account.findUniqueOrThrow({ where: { email: ownerEmail } });
  await prisma.membership.create({ data: { accountId: owner.id, communityId: communityD.id, role: "MEMBER" } });
  const buyerC = await addMember(communityC.id, buyerCEmail, password, "Global Buyer C");
  const buyerD = await addMember(communityD.id, buyerDEmail, password, "Global Buyer D");

  async function createRatedConfirmedTransaction(communityId: string, buyerId: string, rating: number) {
    const listing = await prisma.listing.create({
      data: { communityId, ownerId: owner.id, title: "Global Item", description: "Description", priceCents: 1000 },
    });
    const thread = await prisma.messageThread.create({ data: { listingId: listing.id, buyerId } });
    await prisma.message.create({ data: { threadId: thread.id, senderId: buyerId, body: "Hi" } });
    const transaction = await prisma.transaction.create({
      data: {
        communityId,
        recorderId: owner.id,
        counterpartId: buyerId,
        listingId: listing.id,
        listingTitle: listing.title,
        confirmationState: "CONFIRMED",
        confirmedAt: new Date(),
      },
    });
    await prisma.review.create({ data: { reviewerId: buyerId, reviewedId: owner.id, transactionId: transaction.id, rating } });
  }

  await createRatedConfirmedTransaction(communityC.id, buyerC.id, 5);
  await createRatedConfirmedTransaction(communityD.id, buyerD.id, 3);

  await signIn(page, buyerCEmail, password);
  await page.goto(`/communities/${communityC.id}/members/${owner.id}`);
  await expect(page.getByTestId("profile-reputation")).toContainText("4.0");
  await expect(page.getByTestId("profile-reputation")).toContainText("2 reviews");

  const pageText = await page.textContent("body");
  expect(pageText).not.toContain(communityDName);
  expect(pageText).not.toContain(communityD.id);
});

// T010 (US1, FR-006): two accounts sharing no community cannot reach each other's profile.
test("two accounts that do not share a community cannot open each other's profile", async ({ page }) => {
  const password = "correct-horse-battery-staple";
  const ownerEmail = uniqueEmail("profile-view-isolated-owner");
  const outsiderEmail = uniqueEmail("profile-view-isolated-outsider");
  const community = await createCommunityWithAdmin(
    page.request,
    `Profile View Isolated Community ${Date.now()}`,
    ownerEmail,
    password,
    "Isolated Owner",
  );
  await createVerifiedAccount(outsiderEmail, password, "Isolated Outsider");
  const owner = await prisma.account.findUniqueOrThrow({ where: { email: ownerEmail } });

  await signIn(page, outsiderEmail, password);
  const response = await page.request.get(`/api/communities/${community.id}/members/${owner.id}`);
  expect(response.status()).toBe(403);
});
