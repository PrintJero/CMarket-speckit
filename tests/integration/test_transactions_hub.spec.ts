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

async function createForSaleListing(communityId: string, ownerId: string, title: string, stockQuantity: number) {
  return prisma.listing.create({
    data: { communityId, ownerId, title, description: "Description", priceCents: 12000, kind: "FOR_SALE", stockQuantity },
  });
}

async function proposePurchaseViaApi(
  request: import("@playwright/test").APIRequestContext,
  communityId: string,
  listingId: string,
  quantity: number,
  totalCents: number,
) {
  const response = await request.post(`/api/communities/${communityId}/listings/${listingId}/proposals`, {
    data: { quantity, totalCents },
  });
  const body = await response.json();
  if (!body.ok) throw new Error(`expected proposal to succeed, got ${JSON.stringify(body)}`);
  return body.transaction as { id: string };
}

// The top-level Transactions nav item and its Buying/Selling hub (this feature's own new surface).
test("the sidebar's Transactions link opens a Buying/Selling hub aggregating proposals across every community", async ({
  page,
}) => {
  const password = "correct-horse-battery-staple";
  const sellerEmail = uniqueEmail("txhub-seller");
  const buyerEmail = uniqueEmail("txhub-buyer");
  const communityOne = await createCommunityWithAdmin(
    page.request,
    `Tx Hub Community One ${Date.now()}`,
    sellerEmail,
    password,
    "Hub Seller",
  );
  const buyer = await addMember(communityOne.id, buyerEmail, password, "Hub Buyer");
  const seller = await prisma.account.findUniqueOrThrow({ where: { email: sellerEmail } });

  const sellerTwoEmail = uniqueEmail("txhub-seller-2");
  const communityTwo = await createCommunityWithAdmin(
    page.request,
    `Tx Hub Community Two ${Date.now()}`,
    sellerTwoEmail,
    password,
    "Hub Seller Two",
  );
  await prisma.membership.create({ data: { accountId: buyer.id, communityId: communityTwo.id, role: "MEMBER" } });
  const sellerTwo = await prisma.account.findUniqueOrThrow({ where: { email: sellerTwoEmail } });

  const listingOne = await createForSaleListing(communityOne.id, seller.id, "Hub Bicycle", 10);
  const listingTwo = await createForSaleListing(communityTwo.id, sellerTwo.id, "Hub Desk", 5);

  await signIn(page, buyerEmail, password);
  await proposePurchaseViaApi(page.request, communityOne.id, listingOne.id, 2, 24000);
  await proposePurchaseViaApi(page.request, communityTwo.id, listingTwo.id, 1, 5000);

  await page.getByRole("link", { name: "Transactions", exact: true }).click();
  await page.waitForURL("/transactions");

  // Buying tab (default) shows both proposals, across both communities, with quantity/total and a friendly state label.
  await expect(page.getByText("Hub Bicycle")).toBeVisible();
  await expect(page.getByText("Hub Desk")).toBeVisible();
  await expect(page.getByText(/2 units/)).toBeVisible();
  await expect(page.getByText(/1 unit\b/)).toBeVisible();
  await expect(page.getByText("Pending").first()).toBeVisible();

  // Selling tab shows none, since the buyer sold nothing.
  await page.getByRole("tab", { name: "Selling" }).click();
  await expect(page.getByText("You haven't sold anything yet.")).toBeVisible();

  // The buyer can cancel a still-pending proposal directly from the hub.
  await page.getByRole("tab", { name: "Buying" }).click();
  const bicycleRow = page.getByTestId("my-transaction-row").filter({ hasText: "Hub Bicycle" });
  await bicycleRow.getByRole("button", { name: "Cancel" }).click();
  await expect(bicycleRow.getByText("Cancelled")).toBeVisible();
});

// Post-accept rating prompt, then the persistent "Rate {name}" row action and its read-only state.
test("the seller accepts from the Selling tab, is prompted to rate the buyer, and can rate later from the row", async ({
  page,
}) => {
  const password = "correct-horse-battery-staple";
  const sellerEmail = uniqueEmail("txhub-rate-seller");
  const buyerEmail = uniqueEmail("txhub-rate-buyer");
  const community = await createCommunityWithAdmin(
    page.request,
    `Tx Hub Rate Community ${Date.now()}`,
    sellerEmail,
    password,
    "Rate Hub Seller",
  );
  const buyer = await addMember(community.id, buyerEmail, password, "Rate Hub Buyer");
  const seller = await prisma.account.findUniqueOrThrow({ where: { email: sellerEmail } });
  const listing = await createForSaleListing(community.id, seller.id, "Rate Hub Lamp", 10);

  const buyerContext = await page.context().browser()!.newContext();
  const buyerPage = await buyerContext.newPage();
  await signIn(buyerPage, buyerEmail, password);
  await proposePurchaseViaApi(buyerPage.request, community.id, listing.id, 1, 9000);
  await buyerContext.close();

  await signIn(page, sellerEmail, password);
  await page.goto("/transactions?view=selling");

  const row = page.getByTestId("my-transaction-row").filter({ hasText: "Rate Hub Lamp" });
  await row.getByRole("button", { name: "Accept" }).click();

  const modal = page.getByRole("dialog", { name: "Rate this transaction" });
  await expect(modal).toBeVisible();
  await expect(modal.getByText(`How was your experience with ${buyer.displayName}?`)).toBeVisible();
  await modal.getByRole("radio", { name: "5 stars" }).click();
  await modal.getByRole("button", { name: "Submit rating" }).click();
  await expect(modal).toHaveCount(0);

  await expect(row.getByTestId("my-rating")).toContainText(`You rated ${buyer.displayName} 5/5`);
});

// The buyer's own rating prompt on an ACCEPTED purchase, from the Buying tab.
test("the buyer sees a Rate-seller action on an accepted purchase, and it becomes read-only after rating", async ({
  page,
}) => {
  const password = "correct-horse-battery-staple";
  const sellerEmail = uniqueEmail("txhub-buyer-rate-seller");
  const buyerEmail = uniqueEmail("txhub-buyer-rate-buyer");
  const community = await createCommunityWithAdmin(
    page.request,
    `Tx Hub Buyer Rate Community ${Date.now()}`,
    sellerEmail,
    password,
    "Buyer Rate Seller",
  );
  const buyer = await addMember(community.id, buyerEmail, password, "Buyer Rate Buyer");
  const seller = await prisma.account.findUniqueOrThrow({ where: { email: sellerEmail } });
  const listing = await createForSaleListing(community.id, seller.id, "Buyer Rate Rug", 10);

  await signIn(page, buyerEmail, password);
  const proposed = await proposePurchaseViaApi(page.request, community.id, listing.id, 1, 7000);

  // Only the seller may accept — do it from a separate, seller-authenticated session.
  const sellerContext = await page.context().browser()!.newContext();
  const sellerPage = await sellerContext.newPage();
  await signIn(sellerPage, sellerEmail, password);
  await sellerPage.request.post(`/api/communities/${community.id}/transactions/${proposed.id}/accept`);
  await sellerContext.close();

  await page.goto("/transactions");
  const row = page.getByTestId("my-transaction-row").filter({ hasText: "Buyer Rate Rug" });
  await expect(row.getByText("Completed")).toBeVisible();
  await row.getByRole("button", { name: `Rate ${seller.displayName}` }).click();

  const modal = page.getByRole("dialog", { name: "Rate this transaction" });
  await modal.getByRole("radio", { name: "4 stars" }).click();
  await modal.getByRole("button", { name: "Submit rating" }).click();
  await expect(modal).toHaveCount(0);

  await expect(row.getByTestId("my-rating")).toContainText(`You rated ${seller.displayName} 4/5`);

  // The counterpart's displayName is clickable and opens their public profile.
  await row.getByRole("link", { name: seller.displayName! }).click();
  await page.waitForURL(new RegExp(`/communities/${community.id}/members/${seller.id}`));
  await expect(page.getByTestId("profile-reputation")).toBeVisible();
});
