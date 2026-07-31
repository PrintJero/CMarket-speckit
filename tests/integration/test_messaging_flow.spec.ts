import { expect, test } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/passwordHash";
import { uniqueEmail, signIn } from "./helpers";

/**
 * Defaults to a display name (006-user-display-names, FR-008) since almost
 * every test in this file sends messages, which now requires one (FR-010);
 * the one test specifically about the nameless case (US3) nulls it back out
 * afterward, mirroring tests/contract/test_messaging.ts's own convention.
 */
async function createVerifiedAccount(email: string, password: string) {
  return prisma.account.create({
    data: {
      email,
      passwordHash: await hashPassword(password),
      emailVerifiedAt: new Date(),
      displayName: "Messaging Flow Account",
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

// T007 (US1) — MVP: a buyer messages a listing's owner; the owner replies; both see the ordered history.
test("a buyer messages a listing's owner from the listing; the owner replies and the buyer sees the reply in order (US1)", async ({
  page,
  browser,
}) => {
  const password = "correct-horse-battery-staple";
  const ownerEmail = uniqueEmail("messaging-owner");
  const buyerEmail = uniqueEmail("messaging-buyer");
  const community = await createCommunityWithAdmin(
    page.request,
    `Messaging Flow Community ${Date.now()}`,
    ownerEmail,
    password,
  );
  await addMember(community.id, buyerEmail, password);
  const owner = await prisma.account.findUniqueOrThrow({ where: { email: ownerEmail } });

  const listing = await prisma.listing.create({
    data: {
      communityId: community.id,
      ownerId: owner.id,
      title: "Messaging Test Bicycle",
      description: "Barely used road bike",
      priceCents: 25000,
    },
  });

  // Buyer sends the first message from the listing detail page.
  await signIn(page, buyerEmail, password);
  await page.goto(`/communities/${community.id}/listings/${listing.id}`);
  await page.getByLabel("Message").fill("Is this still available?");
  await page.getByRole("button", { name: "Send message" }).click();
  await page.waitForURL(`**/communities/${community.id}/threads/**`);
  await expect(page.getByText("Is this still available?")).toBeVisible();

  const thread = await prisma.messageThread.findFirstOrThrow({
    where: { listingId: listing.id, buyerId: (await prisma.account.findUniqueOrThrow({ where: { email: buyerEmail } })).id },
  });

  // Owner opens the same thread and replies.
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await signIn(ownerPage, ownerEmail, password);
  await ownerPage.goto(`/communities/${community.id}/threads/${thread.id}`);
  await expect(ownerPage.getByText("Is this still available?")).toBeVisible();
  await ownerPage.getByLabel("Reply").fill("Yes, still available.");
  const [replyResponse] = await Promise.all([
    ownerPage.waitForResponse(
      (response) => response.url().includes(`/threads/${thread.id}/messages`) && response.request().method() === "POST",
    ),
    ownerPage.getByRole("button", { name: "Send reply" }).click(),
  ]);
  expect(replyResponse.status()).toBe(201);
  await expect(ownerPage.locator('[data-testid="message"]')).toHaveCount(2);
  await ownerContext.close();

  // Buyer reloads and sees both messages, in order.
  await page.reload();
  const messages = page.locator('[data-testid="message"]');
  await expect(messages).toHaveCount(2);
  await expect(messages.nth(0)).toContainText("Is this still available?");
  await expect(messages.nth(1)).toContainText("Yes, still available.");
});

// T013 (US2) — the owner's inbox shows every thread on their listing; each buyer's inbox shows only their own.
test("the owner's threads inbox shows every buyer's thread; each buyer's inbox shows only their own (US2)", async ({
  page,
  browser,
}) => {
  const password = "correct-horse-battery-staple";
  const ownerEmail = uniqueEmail("messaging-inbox-owner");
  const buyerOneEmail = uniqueEmail("messaging-inbox-buyer-one");
  const buyerTwoEmail = uniqueEmail("messaging-inbox-buyer-two");
  const community = await createCommunityWithAdmin(
    page.request,
    `Messaging Inbox Community ${Date.now()}`,
    ownerEmail,
    password,
  );
  const buyerOne = await addMember(community.id, buyerOneEmail, password);
  await addMember(community.id, buyerTwoEmail, password);
  const owner = await prisma.account.findUniqueOrThrow({ where: { email: ownerEmail } });

  const listing = await prisma.listing.create({
    data: {
      communityId: community.id,
      ownerId: owner.id,
      title: "Messaging Inbox Skateboard",
      description: "Description",
      priceCents: 4000,
    },
  });

  // Buyer one messages the owner.
  await signIn(page, buyerOneEmail, password);
  await page.goto(`/communities/${community.id}/listings/${listing.id}`);
  await page.getByLabel("Message").fill("From buyer one");
  await page.getByRole("button", { name: "Send message" }).click();
  await page.waitForURL(`**/communities/${community.id}/threads/**`);

  // Buyer two messages the owner, from a separate browser context.
  const buyerTwoContext = await browser.newContext();
  const buyerTwoPage = await buyerTwoContext.newPage();
  await signIn(buyerTwoPage, buyerTwoEmail, password);
  await buyerTwoPage.goto(`/communities/${community.id}/listings/${listing.id}`);
  await buyerTwoPage.getByLabel("Message").fill("From buyer two");
  await buyerTwoPage.getByRole("button", { name: "Send message" }).click();
  await buyerTwoPage.waitForURL(`**/communities/${community.id}/threads/**`);

  // The owner's inbox shows both threads.
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await signIn(ownerPage, ownerEmail, password);
  await ownerPage.goto(`/communities/${community.id}/threads`);
  await expect(ownerPage.getByText("From buyer one")).toBeVisible();
  await expect(ownerPage.getByText("From buyer two")).toBeVisible();
  await ownerContext.close();

  // Buyer one's inbox shows only their own thread.
  await page.goto(`/communities/${community.id}/threads`);
  await expect(page.getByText("From buyer one")).toBeVisible();
  await expect(page.getByText("From buyer two")).toHaveCount(0);
  await buyerTwoContext.close();

  // A non-participant member cannot reach either thread directly.
  const threadOne = await prisma.messageThread.findFirstOrThrow({
    where: { listingId: listing.id, buyerId: buyerOne.id },
  });
  const outsiderEmail = uniqueEmail("messaging-inbox-outsider");
  await addMember(community.id, outsiderEmail, password);
  const outsiderContext = await browser.newContext();
  const outsiderPage = await outsiderContext.newPage();
  await signIn(outsiderPage, outsiderEmail, password);
  const response = await outsiderPage.goto(`/communities/${community.id}/threads/${threadOne.id}`);
  expect(response?.status()).toBe(404);
  await outsiderContext.close();
});

// T018 (US3) — a nameless account is prompted for a display name before its first message sends.
test("a nameless account is prompted for a display name before its first message sends, and not asked again (US3)", async ({
  page,
}) => {
  const password = "correct-horse-battery-staple";
  const ownerEmail = uniqueEmail("messaging-name-owner");
  const buyerEmail = uniqueEmail("messaging-name-buyer");
  const community = await createCommunityWithAdmin(
    page.request,
    `Messaging Name Community ${Date.now()}`,
    ownerEmail,
    password,
  );
  const buyer = await addMember(community.id, buyerEmail, password);
  // This test is specifically about the nameless case — null out the helper's default (FR-010).
  await prisma.account.update({ where: { id: buyer.id }, data: { displayName: null } });
  const owner = await prisma.account.findUniqueOrThrow({ where: { email: ownerEmail } });

  const listing = await prisma.listing.create({
    data: {
      communityId: community.id,
      ownerId: owner.id,
      title: "Messaging Name Desk",
      description: "Description",
      priceCents: 15000,
    },
  });

  await signIn(page, buyerEmail, password);
  await page.goto(`/communities/${community.id}/listings/${listing.id}`);
  await expect(page.getByLabel("Display name")).toBeVisible();
  await page.getByLabel("Display name").fill("Messaging Buyer");
  await page.getByLabel("Message").fill("Is this still available?");
  await page.getByRole("button", { name: "Send message" }).click();
  await page.waitForURL(`**/communities/${community.id}/threads/**`);
  await expect(page.getByText("Is this still available?")).toBeVisible();

  const namedBuyer = await prisma.account.findUniqueOrThrow({ where: { email: buyerEmail } });
  expect(namedBuyer.displayName).toBe("Messaging Buyer");

  // A follow-up message from the same (now-named) account is not prompted again.
  await page.goto(`/communities/${community.id}/listings/${listing.id}`);
  await expect(page.getByLabel("Display name")).toHaveCount(0);
  await page.getByLabel("Message").fill("One more question");
  await page.getByRole("button", { name: "Send message" }).click();
  await page.waitForURL(`**/communities/${community.id}/threads/**`);
  await expect(page.getByText("One more question")).toBeVisible();
});

// T035 (2026-07-17 amendment) — Chats: reachable from the nav, grouped by community, role-marked, ordered by activity.
test("Chats groups threads by community, marks owner vs. buyer, orders by recent activity, and is reachable from the nav (amendment)", async ({
  page,
}) => {
  const password = "correct-horse-battery-staple";
  const sharedEmail = uniqueEmail("chats-shared");
  const buyerInAEmail = uniqueEmail("chats-buyerina");
  const ownerBEmail = uniqueEmail("chats-ownerb");

  // `shared` founds (and so owns/administers) Community A.
  const communityA = await createCommunityWithAdmin(
    page.request,
    `Chats Community A ${Date.now()}`,
    sharedEmail,
    password,
  );
  const communityB = await createCommunityWithAdmin(
    page.request,
    `Chats Community B ${Date.now()}`,
    ownerBEmail,
    password,
  );
  const shared = await prisma.account.findUniqueOrThrow({ where: { email: sharedEmail } });
  const ownerB = await prisma.account.findUniqueOrThrow({ where: { email: ownerBEmail } });
  await prisma.membership.create({ data: { accountId: shared.id, communityId: communityB.id, role: "MEMBER" } });
  const buyerInA = await addMember(communityA.id, buyerInAEmail, password);

  // Thread where `shared` is the owner (Community A) — older activity.
  const listingInA = await prisma.listing.create({
    data: { communityId: communityA.id, ownerId: shared.id, title: "Chats A Item", description: "Description", priceCents: 1000 },
  });
  const older = new Date(Date.now() - 60_000);
  const threadInA = await prisma.messageThread.create({
    data: { listingId: listingInA.id, buyerId: buyerInA.id, createdAt: older, lastMessageAt: older },
  });
  await prisma.message.create({
    data: { threadId: threadInA.id, senderId: buyerInA.id, body: "Interested in A item", createdAt: older },
  });

  // Thread where `shared` is the buyer (Community B) — more recent activity.
  const listingInB = await prisma.listing.create({
    data: { communityId: communityB.id, ownerId: ownerB.id, title: "Chats B Item", description: "Description", priceCents: 2000 },
  });
  const threadInB = await prisma.messageThread.create({
    data: { listingId: listingInB.id, buyerId: shared.id },
  });
  await prisma.message.create({
    data: { threadId: threadInB.id, senderId: shared.id, body: "Interested in B item" },
  });

  await signIn(page, sharedEmail, password);
  // 015-navigation-shell-community-selector: Chats is a cross-community hub, but it's
  // only reachable once a community is active — `shared` belongs to two, so pick one first.
  await page.goto(`/communities/${communityA.id}`);
  const chatsLink = page.getByRole("link", { name: "Chats", exact: true });
  await expect(chatsLink).toBeVisible();
  await chatsLink.click();
  await page.waitForURL("**/chats");

  const rows = page.locator('[data-testid="chats-thread-row"]');
  await expect(rows).toHaveCount(2);
  // Most recent first: B (buyer) before A (owner).
  await expect(rows.nth(0)).toContainText("Chats B Item");
  await expect(rows.nth(0)).toContainText("You contacted the owner");
  await expect(rows.nth(1)).toContainText("Chats A Item");
  await expect(rows.nth(1)).toContainText("You own this listing");

  // Bump Community A's thread, then confirm it re-sorts to the top.
  await page.goto(`/communities/${communityA.id}/threads/${threadInA.id}`);
  await page.getByLabel("Reply").fill("Bumping this conversation");
  await page.getByRole("button", { name: "Send reply" }).click();
  await expect(page.locator('[data-testid="message"]')).toHaveCount(2);

  await page.goto("/chats");
  const reorderedRows = page.locator('[data-testid="chats-thread-row"]');
  await expect(reorderedRows).toHaveCount(2);
  await expect(reorderedRows.nth(0)).toContainText("Chats A Item");
  await expect(reorderedRows.nth(1)).toContainText("Chats B Item");

  // A different, thread-less account sees an empty Chats page, not an error.
  const loneEmail = uniqueEmail("chats-lone");
  await addMember(communityA.id, loneEmail, password);
  const loneContext = await page.context().browser()!.newContext();
  const lonePage = await loneContext.newPage();
  await signIn(lonePage, loneEmail, password);
  await lonePage.goto("/chats");
  await expect(lonePage.locator('[data-testid="chats-thread-row"]')).toHaveCount(0);
  await expect(lonePage.getByText("No conversations yet")).toBeVisible();
  await loneContext.close();
});

// T036 (2026-07-17 amendment) — My listings: any status, thread counts, reachable from the nav, links to threads.
test("My listings shows every owned listing regardless of status with correct thread counts, and is reachable from the nav (amendment)", async ({
  page,
}) => {
  const password = "correct-horse-battery-staple";
  const ownerEmail = uniqueEmail("my-listings-owner");
  const buyerOneEmail = uniqueEmail("my-listings-buyer-one");
  const buyerTwoEmail = uniqueEmail("my-listings-buyer-two");

  const community = await createCommunityWithAdmin(
    page.request,
    `My Listings Community ${Date.now()}`,
    ownerEmail,
    password,
  );
  const owner = await prisma.account.findUniqueOrThrow({ where: { email: ownerEmail } });
  const buyerOne = await addMember(community.id, buyerOneEmail, password);
  const buyerTwo = await addMember(community.id, buyerTwoEmail, password);

  const activeListing = await prisma.listing.create({
    data: { communityId: community.id, ownerId: owner.id, title: "My Active Listing", description: "Description", priceCents: 1000 },
  });
  const pausedListing = await prisma.listing.create({
    data: {
      communityId: community.id,
      ownerId: owner.id,
      title: "My Paused Listing",
      description: "Description",
      priceCents: 2000,
      status: "PAUSED",
    },
  });
  for (const buyer of [buyerOne, buyerTwo]) {
    const thread = await prisma.messageThread.create({
      data: { listingId: activeListing.id, buyerId: buyer.id },
    });
    await prisma.message.create({ data: { threadId: thread.id, senderId: buyer.id, body: "Interested" } });
  }

  await signIn(page, ownerEmail, password);
  await page.goto(`/communities/${community.id}/listings`); // not a listing detail page
  const myListingsLink = page.getByRole("link", { name: "My listings", exact: true });
  await expect(myListingsLink).toBeVisible();
  await myListingsLink.click();
  await page.waitForURL("**/my-listings");

  const activeRow = page.locator('[data-testid="my-listing-row"]', { hasText: "My Active Listing" });
  await expect(activeRow).toContainText("ACTIVE");
  await expect(activeRow).toContainText("2");

  const pausedRow = page.locator('[data-testid="my-listing-row"]', { hasText: "My Paused Listing" });
  await expect(pausedRow).toContainText("PAUSED");
  await expect(pausedRow).toContainText("0");

  await activeRow.getByRole("link", { name: "View threads" }).click();
  await page.waitForURL(`**/communities/${community.id}/threads?listingId=${activeListing.id}`);
  await expect(page.locator('[data-testid="thread-row"]')).toHaveCount(2);

  await page.goto("/my-listings");
  await pausedRow.getByRole("link", { name: "View threads" }).click();
  await page.waitForURL(`**/communities/${community.id}/threads?listingId=${pausedListing.id}`);
  await expect(page.getByText("No messages yet.")).toBeVisible();
});
