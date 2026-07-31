import { expect, test } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/passwordHash";
import { uniqueEmail, signIn } from "./helpers";

async function createVerifiedAccount(email: string, password: string) {
  return prisma.account.create({
    data: {
      email,
      passwordHash: await hashPassword(password),
      emailVerifiedAt: new Date(),
      displayName: "Purchase Flow Account",
    },
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

async function createForSaleListing(communityId: string, ownerId: string, title: string, stockQuantity: number) {
  return prisma.listing.create({
    data: { communityId, ownerId, title, description: "Description", priceCents: 12000, kind: "FOR_SALE", stockQuantity },
  });
}

// T012 (US1) — MVP: a co-member buyer proposes a purchase with no payment-method step.
test("a co-member buyer can propose a purchase; total recalculates with quantity; no payment-method step is shown (US1)", async ({
  page,
}) => {
  const password = "correct-horse-battery-staple";
  const sellerEmail = uniqueEmail("purchase-seller");
  const buyerEmail = uniqueEmail("purchase-buyer");
  const community = await createCommunityWithAdmin(
    page.request,
    `Purchase Flow Community ${Date.now()}`,
    sellerEmail,
    password,
  );
  await addMember(community.id, buyerEmail, password);
  const seller = await prisma.account.findUniqueOrThrow({ where: { email: sellerEmail } });
  const listing = await createForSaleListing(community.id, seller.id, "Purchase Flow Bicycle", 10);

  await signIn(page, buyerEmail, password);
  await page.goto(`/communities/${community.id}/listings/${listing.id}`);

  // FR-002: stock is shown as a seller-reported figure.
  await expect(page.getByText(/seller indicates 10 available/i)).toBeVisible();

  // FR-003: quantity defaults to 1, total pre-filled at listing price ($120.00).
  const quantityInput = page.getByLabel("Quantity");
  const totalInput = page.getByLabel("Total");
  await expect(quantityInput).toHaveValue("1");
  await expect(totalInput).toHaveValue("120.00");

  // FR-004: increasing quantity recalculates the total.
  await quantityInput.fill("3");
  await expect(totalInput).toHaveValue("360.00");

  // FR-005: no payment-method selection step anywhere on this screen.
  await expect(page.getByText(/payment method/i)).toHaveCount(0);
  await expect(page.locator('input[type="text"][name*="card" i]')).toHaveCount(0);

  await page.getByRole("button", { name: "Send purchase proposal" }).click();
  await expect(page.getByText(/proposal sent/i)).toBeVisible();

  await page.goto(`/communities/${community.id}/transactions`);
  await expect(page.getByText("Purchase Flow Bicycle")).toBeVisible();
  await expect(page.getByText(/pending/i)).toBeVisible();
});

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

// T017 (US2) — the seller accepts one pending proposal and rejects another; stock updates only for the accepted one.
test("the seller can accept a pending proposal (decrementing stock) and reject another (leaving stock unchanged) (US2)", async ({
  page,
  browser,
}) => {
  const password = "correct-horse-battery-staple";
  const sellerEmail = uniqueEmail("purchase-accept-seller");
  const buyerEmail = uniqueEmail("purchase-accept-buyer");
  const community = await createCommunityWithAdmin(
    page.request,
    `Purchase Accept Community ${Date.now()}`,
    sellerEmail,
    password,
  );
  await addMember(community.id, buyerEmail, password);
  const seller = await prisma.account.findUniqueOrThrow({ where: { email: sellerEmail } });
  const listing = await createForSaleListing(community.id, seller.id, "Purchase Accept Desk", 10);

  const buyerContext = await browser.newContext();
  const buyerPage = await buyerContext.newPage();
  await signIn(buyerPage, buyerEmail, password);
  const toAccept = await proposePurchaseViaApi(buyerPage.request, community.id, listing.id, 3, 30000);
  const toReject = await proposePurchaseViaApi(buyerPage.request, community.id, listing.id, 2, 20000);
  await buyerContext.close();

  await signIn(page, sellerEmail, password);
  await page.goto(`/communities/${community.id}/transactions/${toAccept.id}`);
  await page.getByRole("button", { name: "Accept" }).click();
  // Accepting immediately prompts the seller to rate the buyer (012's post-completion
  // rating prompt, carried over from "confirm" to "accept"); dismiss it to see the
  // underlying page reflect ACCEPTED.
  await page.getByRole("button", { name: "Maybe later" }).click();
  await expect(page.getByText(/accepted/i)).toBeVisible();

  await page.goto(`/communities/${community.id}/transactions/${toReject.id}`);
  await page.getByRole("button", { name: "Reject" }).click();
  await expect(page.getByText(/rejected/i)).toBeVisible();

  const stockAfter = await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } });
  expect(stockAfter.stockQuantity).toBe(7);
});

// T026 (US4) — the buyer sees every proposal's state and can cancel a still-PENDING one.
test("the buyer sees all their proposals' states and can cancel a still-pending one (US4)", async ({ page }) => {
  const password = "correct-horse-battery-staple";
  const sellerEmail = uniqueEmail("purchase-cancel-seller");
  const buyerEmail = uniqueEmail("purchase-cancel-buyer");
  const community = await createCommunityWithAdmin(
    page.request,
    `Purchase Cancel Community ${Date.now()}`,
    sellerEmail,
    password,
  );
  await addMember(community.id, buyerEmail, password);
  const seller = await prisma.account.findUniqueOrThrow({ where: { email: sellerEmail } });
  const listingOne = await createForSaleListing(community.id, seller.id, "Purchase Cancel Lamp", 10);
  const listingTwo = await createForSaleListing(community.id, seller.id, "Purchase Cancel Rug", 10);

  await signIn(page, buyerEmail, password);
  const toCancel = await proposePurchaseViaApi(page.request, community.id, listingOne.id, 1, 5000);
  await proposePurchaseViaApi(page.request, community.id, listingTwo.id, 1, 8000);

  await page.goto(`/communities/${community.id}/transactions`);
  await expect(page.getByText("Purchase Cancel Lamp")).toBeVisible();
  await expect(page.getByText("Purchase Cancel Rug")).toBeVisible();

  await page.goto(`/communities/${community.id}/transactions/${toCancel.id}`);
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText(/cancelled/i)).toBeVisible();

  const stillTen = await prisma.listing.findUniqueOrThrow({ where: { id: listingOne.id } });
  expect(stillTen.stockQuantity).toBe(10);
});

// T031 (US6) — the non-intermediary disclosure is shown before a proposal can be submitted.
test("the proposal screen shows the non-intermediary disclosure before submission (US6)", async ({ page }) => {
  const password = "correct-horse-battery-staple";
  const sellerEmail = uniqueEmail("purchase-disclosure-seller");
  const buyerEmail = uniqueEmail("purchase-disclosure-buyer");
  const community = await createCommunityWithAdmin(
    page.request,
    `Purchase Disclosure Community ${Date.now()}`,
    sellerEmail,
    password,
  );
  await addMember(community.id, buyerEmail, password);
  const seller = await prisma.account.findUniqueOrThrow({ where: { email: sellerEmail } });
  const listing = await createForSaleListing(community.id, seller.id, "Purchase Disclosure Chair", 10);

  await signIn(page, buyerEmail, password);
  await page.goto(`/communities/${community.id}/listings/${listing.id}`);
  await expect(page.getByRole("note")).toContainText("not a financial intermediary");
});
