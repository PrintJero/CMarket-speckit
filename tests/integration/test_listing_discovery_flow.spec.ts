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

async function seedListings(
  communityId: string,
  ownerId: string,
  specs: { title: string; description: string; priceCents: number }[],
) {
  const listings = [];
  for (let i = 0; i < specs.length; i++) {
    const listing = await prisma.listing.create({
      data: { communityId, ownerId, ...specs[i] },
    });
    listings.push(listing);
    await prisma.listing.update({
      where: { id: listing.id },
      data: { createdAt: new Date(Date.now() + i * 1000) },
    });
  }
  return listings;
}

// T005 (US1) — browse a paginated feed, page by page.
test("a member browses their community's listing feed across pages, newest-first (US1)", async ({ page }) => {
  const password = "correct-horse-battery-staple";
  const adminEmail = uniqueEmail("discovery-page-admin");
  const community = await createCommunityWithAdmin(
    page.request,
    `Discovery Pagination Community ${Date.now()}`,
    adminEmail,
    password,
  );
  const admin = await prisma.account.findUniqueOrThrow({ where: { email: adminEmail } });
  await seedListings(
    community.id,
    admin.id,
    Array.from({ length: 25 }, (_, i) => ({
      title: `Item ${i}`,
      description: "generic",
      priceCents: 1000,
    })),
  );

  await signIn(page, adminEmail, password);
  await page.goto(`/communities/${community.id}/listings`);

  await expect(page.getByText("Item 24")).toBeVisible();
  await expect(page.getByText("Item 5")).toBeVisible();
  await expect(page.getByText("Item 4")).toHaveCount(0);

  await page.getByRole("link", { name: "Next" }).click();
  await page.waitForURL(/page=2/);
  await expect(page.getByText("Item 4")).toBeVisible();
  await expect(page.getByText("Item 24")).toHaveCount(0);
});

// T010 (US2) — keyword search narrows the feed.
test("a member searches their community's listings by keyword (US2)", async ({ page }) => {
  const password = "correct-horse-battery-staple";
  const adminEmail = uniqueEmail("discovery-search-admin");
  const community = await createCommunityWithAdmin(
    page.request,
    `Discovery Search Community ${Date.now()}`,
    adminEmail,
    password,
  );
  const admin = await prisma.account.findUniqueOrThrow({ where: { email: adminEmail } });
  await seedListings(community.id, admin.id, [
    { title: "Mountain bicycle", description: "generic", priceCents: 5000 },
    { title: "Standing desk", description: "made of leather jacket fabric", priceCents: 8000 },
  ]);

  await signIn(page, adminEmail, password);
  await page.goto(`/communities/${community.id}/listings`);
  await page.getByLabel("Search").fill("bicycle");
  await page.getByRole("button", { name: "Search" }).click();
  await page.waitForURL(/q=bicycle/);

  await expect(page.getByText("Mountain bicycle")).toBeVisible();
  await expect(page.getByText("Standing desk")).toHaveCount(0);

  await page.getByLabel("Search").fill("");
  await page.getByRole("button", { name: "Search" }).click();
  await page.waitForURL((url) => !url.search.includes("q=bicycle"));
  await expect(page.getByText("Standing desk")).toBeVisible();
});

// T015 (US3) — price range filter, including client-side rejection of an invalid range.
test("a member filters their community's listings by price range (US3)", async ({ page }) => {
  const password = "correct-horse-battery-staple";
  const adminEmail = uniqueEmail("discovery-price-admin");
  const community = await createCommunityWithAdmin(
    page.request,
    `Discovery Price Community ${Date.now()}`,
    adminEmail,
    password,
  );
  const admin = await prisma.account.findUniqueOrThrow({ where: { email: adminEmail } });
  await seedListings(community.id, admin.id, [
    { title: "Cheap item", description: "generic", priceCents: 1000 },
    { title: "Mid item", description: "generic", priceCents: 5000 },
    { title: "Expensive item", description: "generic", priceCents: 9000 },
  ]);

  await signIn(page, adminEmail, password);
  await page.goto(`/communities/${community.id}/listings`);
  await page.getByLabel("Minimum price").fill("2000");
  await page.getByLabel("Maximum price").fill("6000");
  await page.getByRole("button", { name: "Search" }).click();
  await page.waitForURL(/minPrice=2000/);

  await expect(page.getByText("Mid item")).toBeVisible();
  await expect(page.getByText("Cheap item")).toHaveCount(0);
  await expect(page.getByText("Expensive item")).toHaveCount(0);

  // An invalid range (min above max) is rejected client-side — no navigation happens.
  await page.getByLabel("Minimum price").fill("9000");
  await page.getByLabel("Maximum price").fill("1000");
  const urlBefore = page.url();
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText("Minimum price cannot be greater than maximum price.")).toBeVisible();
  expect(page.url()).toBe(urlBefore);
});

// T019 (US4) — search, price filter, and pagination combined, preserved across a page change.
test("search and price filters stay applied across a page change (US4)", async ({ page }) => {
  const password = "correct-horse-battery-staple";
  const adminEmail = uniqueEmail("discovery-combined-admin");
  const community = await createCommunityWithAdmin(
    page.request,
    `Discovery Combined Community ${Date.now()}`,
    adminEmail,
    password,
  );
  const admin = await prisma.account.findUniqueOrThrow({ where: { email: adminEmail } });
  await seedListings(
    community.id,
    admin.id,
    Array.from({ length: 22 }, (_, i) => ({
      title: `Matching bicycle ${i}`,
      description: "generic",
      priceCents: 5000,
    })),
  );
  // A non-matching listing that must never appear regardless of page.
  await seedListings(community.id, admin.id, [
    { title: "Unrelated desk", description: "generic", priceCents: 5000 },
  ]);

  await signIn(page, adminEmail, password);
  await page.goto(`/communities/${community.id}/listings`);
  await page.getByLabel("Search").fill("bicycle");
  await page.getByLabel("Minimum price").fill("1000");
  await page.getByLabel("Maximum price").fill("9000");
  await page.getByRole("button", { name: "Search" }).click();
  await page.waitForURL(/q=bicycle/);

  await expect(page.getByText("Unrelated desk")).toHaveCount(0);
  await expect(page.getByText("Matching bicycle 21")).toBeVisible();

  const nextUrl = await page.getByRole("link", { name: "Next" }).getAttribute("href");
  expect(nextUrl).toContain("q=bicycle");
  expect(nextUrl).toContain("minPrice=1000");
  expect(nextUrl).toContain("maxPrice=9000");

  await page.getByRole("link", { name: "Next" }).click();
  await page.waitForURL(/page=2/);
  await expect(page.getByText("Matching bicycle 0")).toBeVisible();
  await expect(page.getByText("Unrelated desk")).toHaveCount(0);
});
