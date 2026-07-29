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
      displayName: "Transactions Flow Account",
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

/** Seeds a listing owned by `ownerId` with an existing thread started by `buyerId` (mirrors T035's direct-prisma seeding style). */
async function createListingWithThread(communityId: string, ownerId: string, buyerId: string, title: string) {
  const listing = await prisma.listing.create({
    data: { communityId, ownerId, title, description: "Description", priceCents: 12000 },
  });
  const thread = await prisma.messageThread.create({ data: { listingId: listing.id, buyerId } });
  await prisma.message.create({ data: { threadId: thread.id, senderId: buyerId, body: "Is this still available?" } });
  return { listing, thread };
}

// T007 (US1) — MVP: either participant records a transaction; it's visible to both, including via the standalone transactions page.
test("either thread participant can record a transaction, and it's visible to both parties (US1)", async ({
  page,
  browser,
}) => {
  const password = "correct-horse-battery-staple";
  const ownerEmail = uniqueEmail("txn-owner");
  const buyerEmail = uniqueEmail("txn-buyer");
  const community = await createCommunityWithAdmin(
    page.request,
    `Transactions Flow Community ${Date.now()}`,
    ownerEmail,
    password,
  );
  const buyer = await addMember(community.id, buyerEmail, password);
  const owner = await prisma.account.findUniqueOrThrow({ where: { email: ownerEmail } });
  const { thread } = await createListingWithThread(community.id, owner.id, buyer.id, "Transactions Flow Bicycle");

  // The buyer records the transaction from the thread page.
  await signIn(page, buyerEmail, password);
  await page.goto(`/communities/${community.id}/threads/${thread.id}`);
  await page.getByRole("button", { name: "Record transaction" }).click();
  await expect(page.locator('[data-testid="transaction-row"]')).toHaveCount(1);
  await expect(page.getByText("Unconfirmed transaction")).toBeVisible();

  // The owner sees the same log from the same thread page.
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await signIn(ownerPage, ownerEmail, password);
  await ownerPage.goto(`/communities/${community.id}/threads/${thread.id}`);
  await expect(ownerPage.locator('[data-testid="transaction-row"]')).toHaveCount(1);
  await expect(ownerPage.getByText("Unconfirmed transaction")).toBeVisible();
  await ownerContext.close();

  // Both parties can also find it via the standalone transactions list, independent of the thread.
  await page.goto(`/communities/${community.id}/transactions`);
  await expect(page.getByText("Transactions Flow Bicycle")).toBeVisible();
});

// T013 (US2) — the named counterpart confirms; the recorder sees no confirm action for their own log.
test("the named counterpart can confirm a transaction; the recorder sees no confirm action for it (US2)", async ({
  page,
  browser,
}) => {
  const password = "correct-horse-battery-staple";
  const ownerEmail = uniqueEmail("txn-confirm-owner");
  const buyerEmail = uniqueEmail("txn-confirm-buyer");
  const community = await createCommunityWithAdmin(
    page.request,
    `Transactions Confirm Community ${Date.now()}`,
    ownerEmail,
    password,
  );
  const buyer = await addMember(community.id, buyerEmail, password);
  const owner = await prisma.account.findUniqueOrThrow({ where: { email: ownerEmail } });
  const { thread } = await createListingWithThread(community.id, owner.id, buyer.id, "Transactions Confirm Desk");

  // The owner records the transaction, naming the buyer as counterpart.
  await signIn(page, ownerEmail, password);
  await page.goto(`/communities/${community.id}/threads/${thread.id}`);
  await page.getByRole("button", { name: "Record transaction" }).click();
  await expect(page.getByText("Unconfirmed transaction")).toBeVisible();
  // The recorder (owner) sees no confirm action for their own log.
  await expect(page.getByRole("button", { name: "Confirm transaction" })).toHaveCount(0);

  // The buyer (named counterpart) confirms it from the same thread page.
  const buyerContext = await browser.newContext();
  const buyerPage = await buyerContext.newPage();
  await signIn(buyerPage, buyerEmail, password);
  await buyerPage.goto(`/communities/${community.id}/threads/${thread.id}`);
  await buyerPage.getByRole("button", { name: "Confirm transaction" }).click();
  await expect(buyerPage.getByText("Confirmed transaction")).toBeVisible();
  await buyerContext.close();

  // Both parties see the confirmed state on reload.
  await page.reload();
  await expect(page.getByText("Confirmed transaction")).toBeVisible();
});

// T017 (US4) — the non-intermediary disclosure is shown before both recording and confirming.
test("the non-intermediary disclosure is visible before recording and before confirming (US4)", async ({
  page,
  browser,
}) => {
  const password = "correct-horse-battery-staple";
  const ownerEmail = uniqueEmail("txn-disclosure-owner");
  const buyerEmail = uniqueEmail("txn-disclosure-buyer");
  const community = await createCommunityWithAdmin(
    page.request,
    `Transactions Disclosure Community ${Date.now()}`,
    ownerEmail,
    password,
  );
  const buyer = await addMember(community.id, buyerEmail, password);
  const owner = await prisma.account.findUniqueOrThrow({ where: { email: ownerEmail } });
  const { thread } = await createListingWithThread(community.id, owner.id, buyer.id, "Transactions Disclosure Sofa");

  await signIn(page, ownerEmail, password);
  await page.goto(`/communities/${community.id}/threads/${thread.id}`);
  await expect(page.getByRole("note")).toContainText("not a financial intermediary");
  await page.getByRole("button", { name: "Record transaction" }).click();
  await expect(page.getByText("Unconfirmed transaction")).toBeVisible();

  const buyerContext = await browser.newContext();
  const buyerPage = await buyerContext.newPage();
  await signIn(buyerPage, buyerEmail, password);
  await buyerPage.goto(`/communities/${community.id}/threads/${thread.id}`);
  await expect(buyerPage.getByRole("note")).toContainText("not a financial intermediary");
  await buyerContext.close();
});
