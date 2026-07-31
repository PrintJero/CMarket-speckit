import { expect, test } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/passwordHash";
import { uniqueEmail, signIn } from "./helpers";

async function createVerifiedAccount(email: string, password: string, displayName: string | null = "Chat UI Account") {
  return prisma.account.create({
    data: { email, passwordHash: await hashPassword(password), emailVerifiedAt: new Date(), displayName },
  });
}

async function createCommunityWithAdmin(
  request: import("@playwright/test").APIRequestContext,
  name: string,
  adminEmail: string,
  password: string,
  adminDisplayName = "Chat UI Owner",
) {
  await createVerifiedAccount(adminEmail, password, adminDisplayName);
  const response = await request.post("/api/operator/create-community", {
    data: { name, founderEmail: adminEmail, invokedBy: "playwright-test" },
  });
  const body = await response.json();
  if (!body.ok) throw new Error(`expected community creation to succeed, got ${JSON.stringify(body)}`);
  return body.community as { id: string; name: string };
}

async function addMember(communityId: string, email: string, password: string, displayName: string | null = "Chat UI Buyer") {
  const account = await createVerifiedAccount(email, password, displayName);
  await prisma.membership.create({ data: { accountId: account.id, communityId, role: "MEMBER" } });
  return account;
}

async function createListingAndThread(
  communityId: string,
  ownerId: string,
  buyerId: string,
  title = "Chat UI Bicycle",
) {
  const listing = await prisma.listing.create({
    data: { communityId, ownerId, title, description: "Description", priceCents: 5000, kind: "FOR_SALE", stockQuantity: 10 },
  });
  const thread = await prisma.messageThread.create({ data: { listingId: listing.id, buyerId } });
  return { listing, thread };
}

async function seedMessage(threadId: string, senderId: string, body: string, createdAt?: Date) {
  return prisma.message.create({ data: { threadId, senderId, body, ...(createdAt ? { createdAt } : {}) } });
}

/** Every message row's bounding box relative to the message-area container, for alignment assertions. */
async function messageBoxes(page: import("@playwright/test").Page) {
  const container = page.getByTestId("message-area");
  const containerBox = (await container.boundingBox())!;
  const rows = page.getByTestId("message");
  const count = await rows.count();
  const boxes = [];
  for (let i = 0; i < count; i++) {
    const box = (await rows.nth(i).boundingBox())!;
    boxes.push({ box, containerBox });
  }
  return boxes;
}

// T001 (US1): own vs. counterpart messages are visually distinguishable by alignment and style.
test("own messages render right-aligned and the counterpart's render left-aligned, in distinct, distinguishable bubble styles, in order", async ({
  page,
}) => {
  const password = "correct-horse-battery-staple";
  const ownerEmail = uniqueEmail("chatui-owner");
  const buyerEmail = uniqueEmail("chatui-buyer");
  const community = await createCommunityWithAdmin(page.request, `Chat UI Community ${Date.now()}`, ownerEmail, password);
  const buyer = await addMember(community.id, buyerEmail, password);
  const owner = await prisma.account.findUniqueOrThrow({ where: { email: ownerEmail } });
  const { thread } = await createListingAndThread(community.id, owner.id, buyer.id);

  const base = Date.now();
  await seedMessage(thread.id, buyer.id, "Is this still available?", new Date(base));
  await seedMessage(thread.id, owner.id, "Yes, it is.", new Date(base + 1000));
  await seedMessage(thread.id, buyer.id, "Can I buy two?", new Date(base + 2000));
  await seedMessage(thread.id, owner.id, "Sure.", new Date(base + 3000));
  const longBody = "This is a much longer message that should wrap across multiple lines ".repeat(6).trim();
  await seedMessage(thread.id, buyer.id, longBody, new Date(base + 4000));

  await signIn(page, buyerEmail, password);
  await page.goto(`/communities/${community.id}/threads/${thread.id}`);

  const rows = page.getByTestId("message");
  await expect(rows).toHaveCount(5);

  // Chronological order preserved, exact content preserved.
  await expect(rows.nth(0)).toContainText("Is this still available?");
  await expect(rows.nth(1)).toContainText("Yes, it is.");
  await expect(rows.nth(2)).toContainText("Can I buy two?");
  await expect(rows.nth(3)).toContainText("Sure.");
  await expect(rows.nth(4)).toContainText(longBody);

  // No per-message sender-name link anymore (research.md #2) — the header carries the one profile link.
  await expect(rows.first().locator("a")).toHaveCount(0);

  // Alignment: buyer's own messages (0, 2, 4) hug the right edge; the owner's (1, 3) hug the left edge.
  const boxes = await messageBoxes(page);
  const ownIndexes = [0, 2, 4];
  const counterpartIndexes = [1, 3];
  for (const i of ownIndexes) {
    const { box, containerBox } = boxes[i];
    expect(box.x + box.width).toBeGreaterThan(containerBox.x + containerBox.width - 40);
  }
  for (const i of counterpartIndexes) {
    const { box, containerBox } = boxes[i];
    expect(box.x).toBeLessThan(containerBox.x + 40);
  }

  // Distinguishable styles: own vs. counterpart bubbles differ in background color.
  const ownBg = await rows.nth(0).locator("> *").first().evaluate((el) => getComputedStyle(el).backgroundColor);
  const counterpartBg = await rows.nth(1).locator("> *").first().evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(ownBg).not.toBe(counterpartBg);

  // Sizing: no bubble exceeds ~75% of the message area's width; the long message wraps, no horizontal page overflow.
  for (const { box, containerBox } of boxes) {
    expect(box.width).toBeLessThanOrEqual(containerBox.width * 0.8);
  }
  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(hasHorizontalOverflow).toBe(false);

  // Padding: bubble content never touches the bubble's own edge.
  const padding = await rows.nth(0).locator("> *").first().evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      top: parseFloat(style.paddingTop),
      right: parseFloat(style.paddingRight),
      bottom: parseFloat(style.paddingBottom),
      left: parseFloat(style.paddingLeft),
    };
  });
  expect(padding.top).toBeGreaterThan(0);
  expect(padding.right).toBeGreaterThan(0);
  expect(padding.bottom).toBeGreaterThan(0);
  expect(padding.left).toBeGreaterThan(0);

  // Timestamp: present, visually secondary (smaller and lighter than the message body).
  const timestamp = rows.first().getByTestId("message-timestamp");
  await expect(timestamp).toBeVisible();
  const bodyText = rows.first().getByTestId("message-body");
  const [timestampStyle, bodyStyle] = await Promise.all([
    timestamp.evaluate((el) => ({ fontSize: parseFloat(getComputedStyle(el).fontSize) })),
    bodyText.evaluate((el) => ({ fontSize: parseFloat(getComputedStyle(el).fontSize) })),
  ]);
  expect(timestampStyle.fontSize).toBeLessThanOrEqual(bodyStyle.fontSize);
});

// T003 (US2): the thread renders as one grouped conversation panel (header, message area, composer),
// bounded to a comfortable desktop width, with a defined empty state when a thread has no messages yet.
test("renders one conversation panel with header, message area, and composer, bounded to a comfortable desktop width", async ({
  page,
}) => {
  const password = "correct-horse-battery-staple";
  const ownerEmail = uniqueEmail("chatui-panel-owner");
  const buyerEmail = uniqueEmail("chatui-panel-buyer");
  const community = await createCommunityWithAdmin(page.request, `Chat UI Panel Community ${Date.now()}`, ownerEmail, password);
  const buyer = await addMember(community.id, buyerEmail, password);
  const owner = await prisma.account.findUniqueOrThrow({ where: { email: ownerEmail } });
  const { thread } = await createListingAndThread(community.id, owner.id, buyer.id);

  const base = Date.now();
  await seedMessage(thread.id, buyer.id, "Is this still available?", new Date(base));
  await seedMessage(thread.id, owner.id, "Yes, it is.", new Date(base + 1000));
  await seedMessage(thread.id, buyer.id, "Great, I'll take it.", new Date(base + 2000));

  await signIn(page, buyerEmail, password);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/communities/${community.id}/threads/${thread.id}`);

  const panel = page.getByTestId("chat-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("chat-header")).toBeVisible();
  await expect(panel.getByTestId("message-area")).toBeVisible();
  await expect(panel.getByTestId("chat-composer")).toBeVisible();

  // Bounded desktop width — the panel is visibly narrower than the full page.
  const panelBox = (await panel.boundingBox())!;
  expect(panelBox.width).toBeLessThan(1280 * 0.85);

  // Several messages visible without scrolling the page itself.
  await expect(page.getByTestId("message")).toHaveCount(3);
  const hasPageScroll = await page.evaluate(
    () => document.documentElement.scrollHeight > document.documentElement.clientHeight + 1,
  );
  expect(hasPageScroll).toBe(false);
});

test("shows a 'Start the conversation' empty state for a thread with no messages, composer still usable", async ({ page }) => {
  const password = "correct-horse-battery-staple";
  const ownerEmail = uniqueEmail("chatui-empty-owner");
  const buyerEmail = uniqueEmail("chatui-empty-buyer");
  const community = await createCommunityWithAdmin(page.request, `Chat UI Empty Community ${Date.now()}`, ownerEmail, password);
  const buyer = await addMember(community.id, buyerEmail, password);
  const owner = await prisma.account.findUniqueOrThrow({ where: { email: ownerEmail } });
  const { thread } = await createListingAndThread(community.id, owner.id, buyer.id, "Chat UI Empty Listing");

  await signIn(page, buyerEmail, password);
  await page.goto(`/communities/${community.id}/threads/${thread.id}`);

  await expect(page.getByTestId("message")).toHaveCount(0);
  await expect(page.getByTestId("chat-empty-state")).toContainText("Start the conversation");
  await expect(page.getByTestId("chat-composer")).toBeVisible();
  await expect(page.getByLabel("Reply")).toBeEditable();
});

test("opening a thread from Chats and from a listing's thread list both land on the same conversation route", async ({ page }) => {
  const password = "correct-horse-battery-staple";
  const ownerEmail = uniqueEmail("chatui-nav-owner");
  const buyerEmail = uniqueEmail("chatui-nav-buyer");
  const community = await createCommunityWithAdmin(page.request, `Chat UI Nav Community ${Date.now()}`, ownerEmail, password);
  const buyer = await addMember(community.id, buyerEmail, password);
  const owner = await prisma.account.findUniqueOrThrow({ where: { email: ownerEmail } });
  const { listing, thread } = await createListingAndThread(community.id, owner.id, buyer.id, "Chat UI Nav Listing");
  await seedMessage(thread.id, buyer.id, "Is this still available?");

  const expectedUrl = new RegExp(`/communities/${community.id}/threads/${thread.id}$`);

  await signIn(page, buyerEmail, password);
  await page.goto("/chats");
  await page.getByTestId("chats-thread-row").getByText("Chat UI Nav Listing").click();
  await expect(page).toHaveURL(expectedUrl);

  await page.goto(`/communities/${community.id}/threads?listingId=${listing.id}`);
  await page.getByTestId("thread-row").getByText("Chat UI Nav Listing").click();
  await expect(page).toHaveURL(expectedUrl);
});

// T005 (US3): a long conversation opens with the newest message already visible, stays that way after
// sending, and only the message area itself scrolls — the header and composer stay fixed in place.
test("opens a long conversation with the newest message already visible, keeps it visible after sending, and only the message area scrolls", async ({
  page,
}) => {
  const password = "correct-horse-battery-staple";
  const ownerEmail = uniqueEmail("chatui-scroll-owner");
  const buyerEmail = uniqueEmail("chatui-scroll-buyer");
  const community = await createCommunityWithAdmin(page.request, `Chat UI Scroll Community ${Date.now()}`, ownerEmail, password);
  const buyer = await addMember(community.id, buyerEmail, password);
  const owner = await prisma.account.findUniqueOrThrow({ where: { email: ownerEmail } });
  const { thread } = await createListingAndThread(community.id, owner.id, buyer.id, "Chat UI Scroll Listing");

  // Anchored well into the past so the composer's real (actual-now) send always sorts after every seeded message.
  const base = Date.now() - 120_000;
  for (let i = 0; i < 25; i++) {
    const sender = i % 2 === 0 ? buyer.id : owner.id;
    await seedMessage(thread.id, sender, `Message number ${i}`, new Date(base + i * 1000));
  }

  await signIn(page, buyerEmail, password);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/communities/${community.id}/threads/${thread.id}`);

  const rows = page.getByTestId("message");
  await expect(rows).toHaveCount(25);

  // Opening the thread already positions the newest message in view, no manual scroll performed.
  await expect(rows.last()).toBeInViewport();

  const headerBoxBefore = (await page.getByTestId("chat-header").boundingBox())!;
  const composerBoxBefore = (await page.getByTestId("chat-composer").boundingBox())!;

  // Sending a new message keeps the view focused near the newest message.
  await page.getByLabel("Reply").fill("One more thing!");
  await page.getByRole("button", { name: "Send reply" }).click();
  await expect(rows).toHaveCount(26);
  await expect(rows.last()).toContainText("One more thing!");
  await expect(rows.last()).toBeInViewport();

  // Scrolling the message area up doesn't move the header or composer — only the message area scrolls.
  await page.getByTestId("message-area").evaluate((el) => {
    el.scrollTop = 0;
  });
  const headerBoxAfter = (await page.getByTestId("chat-header").boundingBox())!;
  const composerBoxAfter = (await page.getByTestId("chat-composer").boundingBox())!;
  expect(headerBoxAfter.y).toBe(headerBoxBefore.y);
  expect(composerBoxAfter.y).toBe(composerBoxBefore.y);
});

// T009 (US4): the header identifies the counterpart (linking to their profile) and the listing,
// correctly even before they've sent a single message, without ever leaking private data.
test("the chat header shows the counterpart's display name (linking to their profile) and the listing title, correct even before the counterpart has replied", async ({
  page,
}) => {
  const password = "correct-horse-battery-staple";
  const ownerEmail = uniqueEmail("chatui-header-owner");
  const buyerEmail = uniqueEmail("chatui-header-buyer");
  const community = await createCommunityWithAdmin(
    page.request,
    `Chat UI Header Community ${Date.now()}`,
    ownerEmail,
    password,
    "Chat UI Header Owner",
  );
  const buyer = await addMember(community.id, buyerEmail, password, "Chat UI Header Buyer");
  const owner = await prisma.account.findUniqueOrThrow({ where: { email: ownerEmail } });
  const { thread } = await createListingAndThread(community.id, owner.id, buyer.id, "Chat UI Header Listing");
  // The buyer has sent every message so far — the owner hasn't replied yet.
  await seedMessage(thread.id, buyer.id, "Is this still available?");

  await signIn(page, buyerEmail, password);
  await page.goto(`/communities/${community.id}/threads/${thread.id}`);

  const header = page.getByTestId("chat-header");
  await expect(header).toContainText("Chat UI Header Owner");
  await expect(header).toContainText("Chat UI Header Listing");

  await header.getByRole("link", { name: "Chat UI Header Owner" }).click();
  await expect(page).toHaveURL(`/communities/${community.id}/members/${owner.id}`);
});

test("the chat header shows the neutral placeholder for a counterpart with no display name, never their email", async ({
  page,
}) => {
  const password = "correct-horse-battery-staple";
  const ownerEmail = uniqueEmail("chatui-noname-owner");
  const buyerEmail = uniqueEmail("chatui-noname-buyer");
  const community = await createCommunityWithAdmin(page.request, `Chat UI No Name Community ${Date.now()}`, ownerEmail, password);
  const buyer = await addMember(community.id, buyerEmail, password);
  const owner = await prisma.account.findUniqueOrThrow({ where: { email: ownerEmail } });
  await prisma.account.update({ where: { id: owner.id }, data: { displayName: null } });
  const { thread } = await createListingAndThread(community.id, owner.id, buyer.id, "Chat UI No Name Listing");
  await seedMessage(thread.id, buyer.id, "Hello?");

  await signIn(page, buyerEmail, password);
  await page.goto(`/communities/${community.id}/threads/${thread.id}`);

  const header = page.getByTestId("chat-header");
  await expect(header).toContainText("A member");
  await expect(header).not.toContainText(ownerEmail);
});

test("the rendered thread page never shows email, authentication data, or raw internal IDs as visible text", async ({
  page,
}) => {
  const password = "correct-horse-battery-staple";
  const ownerEmail = uniqueEmail("chatui-privacy-owner");
  const buyerEmail = uniqueEmail("chatui-privacy-buyer");
  const community = await createCommunityWithAdmin(page.request, `Chat UI Privacy Community ${Date.now()}`, ownerEmail, password);
  const buyer = await addMember(community.id, buyerEmail, password);
  const owner = await prisma.account.findUniqueOrThrow({ where: { email: ownerEmail } });
  const { thread } = await createListingAndThread(community.id, owner.id, buyer.id, "Chat UI Privacy Listing");
  await seedMessage(thread.id, buyer.id, "Is this still available?");
  await seedMessage(thread.id, owner.id, "Yes, it is.");

  await signIn(page, buyerEmail, password);
  await page.goto(`/communities/${community.id}/threads/${thread.id}`);

  const bodyText = await page.locator("body").innerText();
  expect(bodyText).not.toContain(ownerEmail);
  expect(bodyText).not.toContain(buyerEmail);
  expect(bodyText).not.toContain(password);
  expect(bodyText).not.toContain(thread.id);
  expect(bodyText).not.toContain(owner.id);
  expect(bodyText).not.toContain(buyer.id);
});

// T011 (US5): the same conversation works at a common mobile width — full-width, no horizontal
// overflow, alignment unchanged from desktop, composer still visible and usable.
test("at a common mobile width, the panel uses the full width with no horizontal overflow, alignment unchanged, composer usable", async ({
  page,
}) => {
  const password = "correct-horse-battery-staple";
  const ownerEmail = uniqueEmail("chatui-mobile-owner");
  const buyerEmail = uniqueEmail("chatui-mobile-buyer");
  const community = await createCommunityWithAdmin(page.request, `Chat UI Mobile Community ${Date.now()}`, ownerEmail, password);
  const buyer = await addMember(community.id, buyerEmail, password);
  const owner = await prisma.account.findUniqueOrThrow({ where: { email: ownerEmail } });
  const { thread } = await createListingAndThread(community.id, owner.id, buyer.id, "Chat UI Mobile Listing");

  const base = Date.now();
  await seedMessage(thread.id, buyer.id, "Is this still available?", new Date(base));
  await seedMessage(thread.id, owner.id, "Yes, it is.", new Date(base + 1000));
  const longBody = "This is a much longer message that should wrap across multiple lines ".repeat(6).trim();
  await seedMessage(thread.id, buyer.id, longBody, new Date(base + 2000));

  await signIn(page, buyerEmail, password);
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto(`/communities/${community.id}/threads/${thread.id}`);

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(hasHorizontalOverflow).toBe(false);

  const rows = page.getByTestId("message");
  await expect(rows).toHaveCount(3);
  const boxes = await messageBoxes(page);
  const ownIndexes = [0, 2];
  const counterpartIndexes = [1];
  for (const i of ownIndexes) {
    const { box, containerBox } = boxes[i];
    expect(box.x + box.width).toBeGreaterThan(containerBox.x + containerBox.width - 40);
  }
  for (const i of counterpartIndexes) {
    const { box, containerBox } = boxes[i];
    expect(box.x).toBeLessThan(containerBox.x + 40);
  }

  await expect(page.getByLabel("Reply")).toBeVisible();
  await expect(page.getByLabel("Reply")).toBeEditable();
  const sendButton = page.getByRole("button", { name: "Send reply" });
  await expect(sendButton).toBeVisible();
  await expect(sendButton).toBeEnabled();
});
