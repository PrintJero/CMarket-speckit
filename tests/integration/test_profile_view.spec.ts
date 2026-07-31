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

// T009 (US2) — MVP: a profile is reachable from a listing, a thread, and a transaction, and
// shows only the one community shared, without contact data.
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
    data: { communityId: community.id, ownerId: owner.id, title: "Profile View Bicycle", description: "Nice bike", priceCents: 15000, kind: "FOR_SALE", stockQuantity: 10 },
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

  // From the transaction detail page (counterpart name), after proposing a purchase (013-purchase-flow-stock).
  await page.goto(`/communities/${community.id}/listings/${listing.id}`);
  await page.getByRole("button", { name: "Send purchase proposal" }).click();
  await expect(page.getByText(/proposal sent/i)).toBeVisible();
  await page.goto(`/communities/${community.id}/transactions`);
  await page.getByText("Profile View Bicycle").click();
  await page.getByRole("link", { name: "Profile Owner" }).click();
  await page.waitForURL(`**/communities/${community.id}/members/${owner.id}`);
});

// T009 (US2, FR-014): sharing two communities shows both, each independently scoped, and a
// community only the viewer belongs to never appears.
test("a profile shows every community the viewer and the target currently share, never one only the viewer belongs to", async ({
  page,
}) => {
  const password = "correct-horse-battery-staple";
  const ownerEmail = uniqueEmail("profile-view-multi-owner");
  const viewerEmail = uniqueEmail("profile-view-multi-viewer");
  const communityC = await createCommunityWithAdmin(
    page.request,
    `Profile Multi Community C ${Date.now()}`,
    ownerEmail,
    password,
    "Multi Owner",
  );
  const viewer = await addMember(communityC.id, viewerEmail, password, "Multi Viewer");
  const owner = await prisma.account.findUniqueOrThrow({ where: { email: ownerEmail } });

  const communityD = await createCommunityWithAdmin(
    page.request,
    `Profile Multi Community D ${Date.now()}`,
    uniqueEmail("profile-view-multi-owner-d"),
    password,
    "Multi Owner D Admin",
  );
  await prisma.membership.create({ data: { accountId: owner.id, communityId: communityD.id, role: "MEMBER" } });
  await prisma.membership.create({ data: { accountId: viewer.id, communityId: communityD.id, role: "MEMBER" } });

  const communityViewerOnlyName = `Profile Multi Viewer Only ${Date.now()}`;
  const communityViewerOnly = await createCommunityWithAdmin(
    page.request,
    communityViewerOnlyName,
    uniqueEmail("profile-view-multi-viewer-only-admin"),
    password,
    "Viewer Only Admin",
  );
  await prisma.membership.create({ data: { accountId: viewer.id, communityId: communityViewerOnly.id, role: "MEMBER" } });

  const listingC = await prisma.listing.create({
    data: { communityId: communityC.id, ownerId: owner.id, title: "Multi Listing C", description: "Description", priceCents: 1000, kind: "FOR_SALE", stockQuantity: 5 },
  });

  await signIn(page, viewerEmail, password);
  await page.goto(`/communities/${communityC.id}/members/${owner.id}`);

  const communitiesSection = page.getByTestId("profile-communities");
  await expect(communitiesSection.getByText(communityC.name)).toBeVisible();
  await expect(communitiesSection.getByText(communityD.name)).toBeVisible();
  await expect(communitiesSection.getByText("Multi Listing C")).toBeVisible();
  // communityD has no listing from the owner — a defined empty state, not an error.
  await expect(communitiesSection.getByText("No active listings in this community.")).toBeVisible();

  // Scoped to the profile's own content (not the viewer's personal sidebar, which legitimately
  // shows the viewer's own communities regardless of whose profile is being viewed).
  const mainText = await page.getByRole("main").textContent();
  expect(mainText).not.toContain(communityViewerOnlyName);
  expect(mainText).not.toContain(communityViewerOnly.id);

  // Clicking the shared community's name navigates to its listings feed.
  await communitiesSection.getByRole("link", { name: communityC.name }).click();
  await page.waitForURL(`**/communities/${communityC.id}/listings`);

  // Clicking a listing card navigates to its detail page.
  await page.goto(`/communities/${communityC.id}/members/${owner.id}`);
  await page.getByRole("link", { name: "Multi Listing C" }).click();
  await page.waitForURL(`**/communities/${communityC.id}/listings/${listingC.id}`);
});

// T027 (US4, FR-011): a profile's global reputation never names the community a viewer doesn't share.
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
      data: { communityId, ownerId: owner.id, title: "Global Item", description: "Description", priceCents: 1000, kind: "FOR_SALE", stockQuantity: 10 },
    });
    const transaction = await prisma.transaction.create({
      data: {
        communityId,
        buyerId,
        sellerId: owner.id,
        listingId: listing.id,
        listingTitle: listing.title,
        quantity: 1,
        totalCents: 1000,
        state: "ACCEPTED",
        resolvedAt: new Date(),
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

// T009 (US1, FR-006, Edge Case): an account with no active listings in a shared community
// shows a defined empty state.
test("a profile with no active listings in a shared community shows a defined empty state", async ({ page }) => {
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

// T009 (US2, FR-017): two accounts sharing no current community cannot reach each other's profile.
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
  expect(response.status()).toBe(404);
});

// T009 (Edge Case): viewing your own profile link behaves identically, without ever showing email.
test("opening your own public-profile link behaves like any other profile view, without showing your email", async ({
  page,
}) => {
  const password = "correct-horse-battery-staple";
  const ownerEmail = uniqueEmail("profile-view-self-owner");
  const community = await createCommunityWithAdmin(
    page.request,
    `Profile View Self Community ${Date.now()}`,
    ownerEmail,
    password,
    "Self View Owner",
  );
  const owner = await prisma.account.findUniqueOrThrow({ where: { email: ownerEmail } });

  await signIn(page, ownerEmail, password);
  await page.goto(`/communities/${community.id}/members/${owner.id}`);
  await expect(page.getByRole("heading", { name: "Self View Owner" })).toBeVisible();
  await expect(page.getByText(ownerEmail)).toHaveCount(0);
});

// T011 (US3): the two entry points not already exercised above — /chats and the global
// /transactions hub — also open the same shared-community profile.
test("clicking a counterpart's display name from /chats and the Transactions hub opens their profile", async ({
  page,
}) => {
  const password = "correct-horse-battery-staple";
  const ownerEmail = uniqueEmail("profile-view-nav-owner");
  const buyerEmail = uniqueEmail("profile-view-nav-buyer");
  const community = await createCommunityWithAdmin(
    page.request,
    `Profile Nav Community ${Date.now()}`,
    ownerEmail,
    password,
    "Nav Owner",
  );
  const buyer = await addMember(community.id, buyerEmail, password, "Nav Buyer");
  const owner = await prisma.account.findUniqueOrThrow({ where: { email: ownerEmail } });

  const listing = await prisma.listing.create({
    data: {
      communityId: community.id,
      ownerId: owner.id,
      title: "Profile Nav Bicycle",
      description: "Description",
      priceCents: 5000,
      kind: "FOR_SALE",
      stockQuantity: 10,
    },
  });
  const thread = await prisma.messageThread.create({ data: { listingId: listing.id, buyerId: buyer.id } });
  await prisma.message.create({ data: { threadId: thread.id, senderId: buyer.id, body: "Still available?" } });

  await signIn(page, buyerEmail, password);

  // From /chats.
  await page.goto("/chats");
  await page.getByRole("link", { name: "Nav Owner" }).first().click();
  await page.waitForURL(`**/communities/${community.id}/members/${owner.id}`);

  // From the global Transactions hub's Buying view.
  await page.request.post(`/api/communities/${community.id}/listings/${listing.id}/proposals`, {
    data: { quantity: 1, totalCents: 5000 },
  });
  await page.goto("/transactions");
  await page.getByRole("link", { name: "Nav Owner" }).click();
  await page.waitForURL(`**/communities/${community.id}/members/${owner.id}`);
});
