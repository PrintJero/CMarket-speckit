import { expect, test } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/passwordHash";
import { uniqueEmail, signIn } from "./helpers";

async function createVerifiedAccount(email: string, password: string) {
  return prisma.account.create({
    data: { email, passwordHash: await hashPassword(password), emailVerifiedAt: new Date() },
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

// T013 (US1) — MVP: a member creates a listing with a photo, entirely through the create form.
test("a member creates a product listing with a photo, and sees it in the community's feed (US1)", async ({
  page,
  browser,
}) => {
  const password = "correct-horse-battery-staple";
  const adminEmail = uniqueEmail("listing-admin");
  const memberEmail = uniqueEmail("listing-member");
  const community = await createCommunityWithAdmin(page.request, `Listing Flow Community ${Date.now()}`, adminEmail, password);
  await addMember(community.id, memberEmail, password);

  await signIn(page, memberEmail, password);
  await page.goto(`/communities/${community.id}/listings`);
  await page.getByRole("link", { name: "New listing" }).click();
  await page.waitForURL(`**/communities/${community.id}/listings/new`);

  await page.getByLabel("Title").fill("Bicycle");
  await page.getByLabel("Description").fill("Barely used road bike");
  await page.getByLabel("Price (USD)").fill("250.00");
  await page.setInputFiles('input[type="file"]', {
    name: "bike.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]),
  });
  await page.getByRole("button", { name: "Create listing" }).click();

  await page.waitForURL(`**/communities/${community.id}/listings`);
  await expect(page.getByText("Bicycle")).toBeVisible();

  const listing = await prisma.listing.findFirstOrThrow({ where: { communityId: community.id, title: "Bicycle" } });
  expect(listing.status).toBe("ACTIVE");
  expect(await prisma.listingPhoto.count({ where: { listingId: listing.id } })).toBe(1);

  // A second account with no membership in this community cannot reach the create form.
  const outsiderContext = await browser.newContext();
  const outsiderPage = await outsiderContext.newPage();
  const outsiderEmail = uniqueEmail("listing-outsider");
  await createVerifiedAccount(outsiderEmail, password);
  await signIn(outsiderPage, outsiderEmail, password);
  const response = await outsiderPage.goto(`/communities/${community.id}/listings/new`);
  expect(response?.status()).toBe(404);
  await outsiderContext.close();
});

// T021 (US2) — the owner edits their listing via the detail page; a different member's API attempt is rejected.
test("the owner edits their listing via the detail page; a non-owner's edit attempt is rejected (US2)", async ({
  page,
  browser,
}) => {
  const password = "correct-horse-battery-staple";
  const ownerEmail = uniqueEmail("listing-owner");
  const otherMemberEmail = uniqueEmail("listing-other-member");
  const community = await createCommunityWithAdmin(page.request, `Listing Edit Community ${Date.now()}`, ownerEmail, password);
  await addMember(community.id, otherMemberEmail, password);
  const owner = await prisma.account.findUniqueOrThrow({ where: { email: ownerEmail } });

  const listing = await prisma.listing.create({
    data: {
      communityId: community.id,
      ownerId: owner.id,
      title: "Old title",
      description: "Old description",
      priceCents: 1000,
    },
  });

  await signIn(page, ownerEmail, password);
  await page.goto(`/communities/${community.id}/listings/${listing.id}`);
  await page.getByLabel("Title").fill("New title");
  await page.getByLabel("Description").fill("New description");
  await page.getByLabel("Price (USD)").fill("20.00");
  const [patchResponse] = await Promise.all([
    page.waitForResponse(
      (response) => response.url().endsWith(`/listings/${listing.id}`) && response.request().method() === "PATCH",
    ),
    page.getByRole("button", { name: "Save changes" }).click(),
  ]);
  expect(patchResponse.status()).toBe(200);
  await expect(page.getByText(/^Failed:/)).toHaveCount(0);

  const updated = await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } });
  expect(updated.title).toBe("New title");
  expect(updated.description).toBe("New description");
  expect(updated.priceCents).toBe(2000);

  // A different member (not the owner) cannot edit via the API, even signed in as themselves.
  const otherContext = await browser.newContext();
  const otherPage = await otherContext.newPage();
  await signIn(otherPage, otherMemberEmail, password);
  const rejectResponse = await otherPage.request.fetch(
    `/api/communities/${community.id}/listings/${listing.id}`,
    {
      method: "PATCH",
      data: { title: "Hacked" },
      headers: { "Content-Type": "application/json" },
    },
  );
  expect(rejectResponse.status()).toBe(403);
  const stillUnchanged = await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } });
  expect(stillUnchanged.title).toBe("New title");
  await otherContext.close();
});

// T026 (US3) — the owner pauses and reactivates their listing via the detail page.
test("the owner pauses and reactivates their listing via the detail page (US3)", async ({ page }) => {
  const password = "correct-horse-battery-staple";
  const ownerEmail = uniqueEmail("listing-pause-owner");
  const community = await createCommunityWithAdmin(page.request, `Listing Pause Community ${Date.now()}`, ownerEmail, password);
  const owner = await prisma.account.findUniqueOrThrow({ where: { email: ownerEmail } });

  const listing = await prisma.listing.create({
    data: {
      communityId: community.id,
      ownerId: owner.id,
      title: "Pausable item",
      description: "Description",
      priceCents: 500,
    },
  });

  await signIn(page, ownerEmail, password);
  await page.goto(`/communities/${community.id}/listings`);
  await expect(page.getByText("Pausable item")).toBeVisible();

  await page.goto(`/communities/${community.id}/listings/${listing.id}`);
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByRole("button", { name: "Reactivate" })).toBeVisible();

  await page.goto(`/communities/${community.id}/listings`);
  await expect(page.getByText("Pausable item")).toHaveCount(0);

  await page.goto(`/communities/${community.id}/listings/${listing.id}`);
  await page.getByRole("button", { name: "Reactivate" }).click();
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();

  await page.goto(`/communities/${community.id}/listings`);
  await expect(page.getByText("Pausable item")).toBeVisible();
});

// T031 (US4) — the owner deletes their listing via the detail page; the administrator cannot.
test("the owner deletes their listing (with a photo) via the detail page; the administrator cannot (US4)", async ({
  page,
  browser,
}) => {
  const password = "correct-horse-battery-staple";
  const ownerEmail = uniqueEmail("listing-delete-owner");
  const community = await createCommunityWithAdmin(page.request, `Listing Delete Community ${Date.now()}`, ownerEmail, password);
  const owner = await prisma.account.findUniqueOrThrow({ where: { email: ownerEmail } });

  const listing = await prisma.listing.create({
    data: {
      communityId: community.id,
      ownerId: owner.id,
      title: "Deletable item",
      description: "Description",
      priceCents: 500,
    },
  });
  await prisma.listingPhoto.create({
    data: {
      listingId: listing.id,
      data: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      mimeType: "image/jpeg",
      sizeBytes: 4,
      position: 0,
    },
  });

  // A second administrator of the same community (not the listing's owner) cannot delete it.
  const secondAdminEmail = uniqueEmail("listing-delete-admin2");
  const secondAdmin = await createVerifiedAccount(secondAdminEmail, password);
  await prisma.membership.create({
    data: { accountId: secondAdmin.id, communityId: community.id, role: "ADMINISTRATOR" },
  });
  const secondAdminContext = await browser.newContext();
  const secondAdminPage = await secondAdminContext.newPage();
  await signIn(secondAdminPage, secondAdminEmail, password);
  const rejectResponse = await secondAdminPage.request.fetch(
    `/api/communities/${community.id}/listings/${listing.id}`,
    { method: "DELETE" },
  );
  expect(rejectResponse.status()).toBe(403);
  await secondAdminContext.close();
  expect(await prisma.listing.findUnique({ where: { id: listing.id } })).not.toBeNull();

  // The owner deletes it via the detail page.
  await signIn(page, ownerEmail, password);
  await page.goto(`/communities/${community.id}/listings/${listing.id}`);
  await page.getByRole("button", { name: "Delete" }).click();
  await page.waitForURL(`**/communities/${community.id}/listings`);
  await expect(page.getByText("Deletable item")).toHaveCount(0);

  expect(await prisma.listing.findUnique({ where: { id: listing.id } })).toBeNull();
  expect(await prisma.listingPhoto.count({ where: { listingId: listing.id } })).toBe(0);
});

// T035 (US5) — the administrator moderates (pauses) another member's listing, with no Edit/Delete shown.
test("the community's administrator pauses another member's listing, without Edit/Delete controls (US5)", async ({
  page,
}) => {
  const password = "correct-horse-battery-staple";
  const adminEmail = uniqueEmail("listing-mod-admin");
  const memberEmail = uniqueEmail("listing-mod-member");
  const community = await createCommunityWithAdmin(page.request, `Listing Moderation Community ${Date.now()}`, adminEmail, password);
  const member = await addMember(community.id, memberEmail, password);

  const listing = await prisma.listing.create({
    data: {
      communityId: community.id,
      ownerId: member.id,
      title: "Member's item",
      description: "Description",
      priceCents: 500,
    },
  });

  await signIn(page, adminEmail, password);
  await page.goto(`/communities/${community.id}/listings/${listing.id}`);

  await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
  await expect(page.getByLabel("Title")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);

  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByRole("button", { name: "Reactivate" })).toBeVisible();

  const updated = await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } });
  expect(updated.status).toBe("PAUSED");
  expect(updated.ownerId).toBe(member.id);
});
