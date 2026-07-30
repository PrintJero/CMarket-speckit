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
      displayName: "Wanted Posts Flow Account",
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

// T010 (US1) — MVP: a member posts what they're looking for, with no price, labeled and interleaved.
test("a member creates a wanted post with no price, labeled 'Wanted' and interleaved with a for-sale listing (US1)", async ({
  page,
}) => {
  const password = "correct-horse-battery-staple";
  const ownerEmail = uniqueEmail("wanted-owner");
  const community = await createCommunityWithAdmin(
    page.request,
    `Wanted Posts Flow Community ${Date.now()}`,
    ownerEmail,
    password,
  );
  const owner = await prisma.account.findUniqueOrThrow({ where: { email: ownerEmail } });

  // A for-sale listing, seeded directly, to confirm interleaving.
  await prisma.listing.create({
    data: {
      communityId: community.id,
      ownerId: owner.id,
      title: "For Sale Bicycle",
      description: "Description",
      priceCents: 25000,
    },
  });

  await signIn(page, ownerEmail, password);
  await page.goto(`/communities/${community.id}/listings/new`);
  await page.getByLabel("Looking for").check();
  await page.getByLabel("Title").fill("Looking for a used laptop");
  await page.getByLabel("Description").fill("Any condition, just needs to work");
  await page.getByRole("button", { name: "Create listing" }).click();

  await page.waitForURL(`**/communities/${community.id}/listings`);
  await expect(page.getByText("Looking for a used laptop")).toBeVisible();

  const wanted = await prisma.listing.findFirstOrThrow({
    where: { communityId: community.id, title: "Looking for a used laptop" },
  });
  expect(wanted.kind).toBe("WANTED");
  expect(wanted.priceCents).toBeNull();

  const badges = page.locator('[data-testid="listing-kind-badge"]');
  await expect(badges).toHaveCount(2);
  await expect(badges.filter({ hasText: "Wanted" })).toHaveCount(1);
  await expect(badges.filter({ hasText: "For sale" })).toHaveCount(1);
});

// T013 (US2) — a different member responds to the wanted post via messaging.
test("a different member responds to a wanted post via messaging, with no contact data shown (US2)", async ({
  page,
  browser,
}) => {
  const password = "correct-horse-battery-staple";
  const ownerEmail = uniqueEmail("wanted-respond-owner");
  const responderEmail = uniqueEmail("wanted-respond-member");
  const community = await createCommunityWithAdmin(
    page.request,
    `Wanted Respond Community ${Date.now()}`,
    ownerEmail,
    password,
  );
  await addMember(community.id, responderEmail, password);
  const owner = await prisma.account.findUniqueOrThrow({ where: { email: ownerEmail } });

  const wanted = await prisma.listing.create({
    data: {
      communityId: community.id,
      ownerId: owner.id,
      title: "Looking for a keyboard",
      description: "Description",
      kind: "WANTED",
    },
  });

  await signIn(page, responderEmail, password);
  await page.goto(`/communities/${community.id}/listings/${wanted.id}`);
  await page.getByLabel("Message").fill("I have one of these!");
  await page.getByRole("button", { name: "Send message" }).click();
  await page.waitForURL(`**/communities/${community.id}/threads/**`);
  await expect(page.getByText("I have one of these!")).toBeVisible();

  const thread = await prisma.messageThread.findFirstOrThrow({ where: { listingId: wanted.id } });

  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await signIn(ownerPage, ownerEmail, password);
  await ownerPage.goto(`/communities/${community.id}/threads/${thread.id}`);
  await expect(ownerPage.getByText("I have one of these!")).toBeVisible();
  // Only a display name is ever shown — never an email address.
  await expect(ownerPage.getByText(responderEmail)).toHaveCount(0);
  await ownerContext.close();
});

// T018 (US3) — the owner marks it fulfilled, reverses it, then deletes it.
test("the owner marks a wanted post fulfilled, reverses it, then deletes it (US3)", async ({ page }) => {
  const password = "correct-horse-battery-staple";
  const ownerEmail = uniqueEmail("wanted-lifecycle-owner");
  const community = await createCommunityWithAdmin(
    page.request,
    `Wanted Lifecycle Community ${Date.now()}`,
    ownerEmail,
    password,
  );
  const owner = await prisma.account.findUniqueOrThrow({ where: { email: ownerEmail } });

  const wanted = await prisma.listing.create({
    data: {
      communityId: community.id,
      ownerId: owner.id,
      title: "Looking for a rug",
      description: "Description",
      kind: "WANTED",
    },
  });

  await signIn(page, ownerEmail, password);
  await page.goto(`/communities/${community.id}/listings/${wanted.id}`);
  await page.getByRole("button", { name: "Mark as fulfilled" }).click();
  await expect(page.getByRole("button", { name: "Reverse to active" })).toBeVisible();

  // Disappears from the community feed while FULFILLED.
  await page.goto(`/communities/${community.id}/listings`);
  await expect(page.getByText("Looking for a rug")).toHaveCount(0);

  // But the owner can still see it on its own detail page.
  await page.goto(`/communities/${community.id}/listings/${wanted.id}`);
  await expect(page.getByRole("button", { name: "Reverse to active" })).toBeVisible();

  // Reverse it — reappears in the feed.
  await page.getByRole("button", { name: "Reverse to active" }).click();
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await page.goto(`/communities/${community.id}/listings`);
  await expect(page.getByText("Looking for a rug")).toBeVisible();

  // Delete it — gone entirely.
  await page.goto(`/communities/${community.id}/listings/${wanted.id}`);
  await page.getByRole("button", { name: "Delete" }).click();
  await page.waitForURL(`**/communities/${community.id}/listings`);
  expect(await prisma.listing.findUnique({ where: { id: wanted.id } })).toBeNull();
});
