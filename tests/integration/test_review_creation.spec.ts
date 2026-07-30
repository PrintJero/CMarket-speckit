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

async function createConfirmedTransaction(
  communityId: string,
  ownerId: string,
  buyerId: string,
  listingTitle: string,
) {
  const listing = await prisma.listing.create({
    data: { communityId, ownerId, title: listingTitle, description: "Description", priceCents: 5000 },
  });
  const thread = await prisma.messageThread.create({ data: { listingId: listing.id, buyerId } });
  await prisma.message.create({ data: { threadId: thread.id, senderId: buyerId, body: "Interested!" } });
  const recorded = await prisma.transaction.create({
    data: {
      communityId,
      recorderId: ownerId,
      counterpartId: buyerId,
      listingId: listing.id,
      listingTitle: listing.title,
      confirmationState: "CONFIRMED",
      confirmedAt: new Date(),
    },
  });
  return recorded;
}

async function createUnconfirmedTransaction(
  communityId: string,
  ownerId: string,
  buyerId: string,
  listingTitle: string,
) {
  const listing = await prisma.listing.create({
    data: { communityId, ownerId, title: listingTitle, description: "Description", priceCents: 5000 },
  });
  const thread = await prisma.messageThread.create({ data: { listingId: listing.id, buyerId } });
  await prisma.message.create({ data: { threadId: thread.id, senderId: buyerId, body: "Interested!" } });
  return prisma.transaction.create({
    data: {
      communityId,
      recorderId: ownerId,
      counterpartId: buyerId,
      listingId: listing.id,
      listingTitle: listing.title,
    },
  });
}

// Post-confirmation rating prompt — confirming immediately shows a rating modal (optional, dismissible).
test("confirming a transaction immediately shows a rating modal; submitting a star rating through it creates the review", async ({
  page,
}) => {
  const password = "correct-horse-battery-staple";
  const ownerEmail = uniqueEmail("review-modal-owner");
  const buyerEmail = uniqueEmail("review-modal-buyer");
  const community = await createCommunityWithAdmin(
    page.request,
    `Review Modal Community ${Date.now()}`,
    ownerEmail,
    password,
    "Modal Owner",
  );
  const buyer = await addMember(community.id, buyerEmail, password, "Modal Buyer");
  const owner = await prisma.account.findUniqueOrThrow({ where: { email: ownerEmail } });
  const transaction = await createUnconfirmedTransaction(community.id, owner.id, buyer.id, "Review Modal Item");

  await signIn(page, buyerEmail, password);
  await page.goto(`/communities/${community.id}/transactions/${transaction.id}`);
  await page.getByRole("button", { name: "Confirm transaction" }).click();

  const modal = page.getByRole("dialog", { name: "Rate this transaction" });
  await expect(modal).toBeVisible();
  await modal.getByRole("radio", { name: "4 stars" }).click();
  await modal.getByRole("button", { name: "Submit" }).click();

  await expect(modal).toHaveCount(0);
  await expect(page.getByTestId("my-review")).toContainText("4 out of 5");
});

test("dismissing the rating modal with Maybe later leaves the transaction ratable later", async ({ page }) => {
  const password = "correct-horse-battery-staple";
  const ownerEmail = uniqueEmail("review-modal-later-owner");
  const buyerEmail = uniqueEmail("review-modal-later-buyer");
  const community = await createCommunityWithAdmin(
    page.request,
    `Review Modal Later Community ${Date.now()}`,
    ownerEmail,
    password,
    "Modal Later Owner",
  );
  const buyer = await addMember(community.id, buyerEmail, password, "Modal Later Buyer");
  const owner = await prisma.account.findUniqueOrThrow({ where: { email: ownerEmail } });
  const transaction = await createUnconfirmedTransaction(community.id, owner.id, buyer.id, "Review Modal Later Item");

  await signIn(page, buyerEmail, password);
  await page.goto(`/communities/${community.id}/transactions/${transaction.id}`);
  await page.getByRole("button", { name: "Confirm transaction" }).click();

  const modal = page.getByRole("dialog", { name: "Rate this transaction" });
  await expect(modal).toBeVisible();
  await modal.getByRole("button", { name: "Maybe later" }).click();
  await expect(modal).toHaveCount(0);

  // No review was created, and the confirmed transaction is still ratable from the same page.
  expect(await prisma.review.count({ where: { transactionId: transaction.id } })).toBe(0);
  await expect(page.getByTestId("review-form")).toBeVisible();
  await page.getByTestId("review-form").getByRole("button", { name: "5", exact: true }).click();
  await expect(page.getByTestId("my-review")).toContainText("5 out of 5");
});

// T019 (US2) — MVP: either participant of a confirmed transaction can leave a rating.
test("either participant of a confirmed transaction can leave a rating, independently, and it shows on the reviewed profile", async ({
  page,
  browser,
}) => {
  const password = "correct-horse-battery-staple";
  const ownerEmail = uniqueEmail("review-create-owner");
  const buyerEmail = uniqueEmail("review-create-buyer");
  const community = await createCommunityWithAdmin(
    page.request,
    `Review Create Community ${Date.now()}`,
    ownerEmail,
    password,
    "Review Owner",
  );
  const buyer = await addMember(community.id, buyerEmail, password, "Review Buyer");
  const owner = await prisma.account.findUniqueOrThrow({ where: { email: ownerEmail } });
  const transaction = await createConfirmedTransaction(community.id, owner.id, buyer.id, "Review Create Item");

  // The buyer rates the owner.
  await signIn(page, buyerEmail, password);
  await page.goto(`/communities/${community.id}/transactions/${transaction.id}`);
  await page.getByTestId("review-form").getByRole("button", { name: "5", exact: true }).click();
  await expect(page.getByTestId("my-review")).toContainText("5 out of 5");

  // The owner's profile reflects the new rating.
  await page.goto(`/communities/${community.id}/members/${owner.id}`);
  await expect(page.getByTestId("profile-reputation")).toContainText("5.0");
  await expect(page.getByTestId("profile-reputation")).toContainText("1 review");

  // The owner independently rates the buyer, from the same transaction page.
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await signIn(ownerPage, ownerEmail, password);
  await ownerPage.goto(`/communities/${community.id}/transactions/${transaction.id}`);
  await ownerPage.getByTestId("review-form").getByRole("button", { name: "3", exact: true }).click();
  await expect(ownerPage.getByTestId("my-review")).toContainText("3 out of 5");
  await ownerContext.close();

  // Revisiting the transaction page for the buyer shows their own submitted rating, read-only, not the form again.
  await page.goto(`/communities/${community.id}/transactions/${transaction.id}`);
  await expect(page.getByTestId("my-review")).toContainText("5 out of 5");
  await expect(page.getByTestId("review-form")).toHaveCount(0);
});

// T023 (US3) — a non-participant has no rating control, and a direct API bypass is rejected.
test("a non-participant has no rating control on someone else's transaction, and a direct API attempt is rejected", async ({
  page,
}) => {
  const password = "correct-horse-battery-staple";
  const ownerEmail = uniqueEmail("review-create-bypass-owner");
  const buyerEmail = uniqueEmail("review-create-bypass-buyer");
  const outsiderEmail = uniqueEmail("review-create-bypass-outsider");
  const community = await createCommunityWithAdmin(
    page.request,
    `Review Create Bypass Community ${Date.now()}`,
    ownerEmail,
    password,
    "Bypass Owner",
  );
  const buyer = await addMember(community.id, buyerEmail, password, "Bypass Buyer");
  await addMember(community.id, outsiderEmail, password, "Bypass Outsider");
  const owner = await prisma.account.findUniqueOrThrow({ where: { email: ownerEmail } });
  const transaction = await createConfirmedTransaction(community.id, owner.id, buyer.id, "Review Bypass Item");

  await signIn(page, outsiderEmail, password);
  await page.goto(`/communities/${community.id}/transactions/${transaction.id}`);
  await expect(page.getByTestId("review-form")).toHaveCount(0);

  const bypassResponse = await page.request.post(
    `/api/communities/${community.id}/transactions/${transaction.id}/reviews`,
    { data: { rating: 5 } },
  );
  expect(bypassResponse.status()).toBe(403);
  expect(await prisma.review.count({ where: { transactionId: transaction.id } })).toBe(0);
});
