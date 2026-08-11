import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/passwordHash";
import { uniqueEmail, signIn } from "./helpers";

/**
 * T023, T035, T040-T042, T053, T054, T076, T086
 * (017-cloudinary-listing-media).
 *
 * The browser-level half of this feature's coverage. Everything here needs a
 * real request with a session cookie, which is why it lives in Playwright rather
 * than in a vitest contract test (this codebase's established split — see the
 * note in tests/contract/test_current_account_active_community.ts).
 *
 * NO TEST CONTACTS CLOUDINARY. The direct browser-to-Cloudinary upload is
 * intercepted with page.route(), which is also how forced failures and
 * out-of-order completion are produced deterministically. The delivery proxy's
 * upstream fetch is server-side, so those tests assert on the gate and headers
 * rather than on bytes.
 */

const PASSWORD = "correct-horse-battery-staple";

/** A minimal valid JPEG the uploader will accept by MIME type and size. */
const TINY_JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]);

function jpegFile(name: string) {
  return { name, mimeType: "image/jpeg", buffer: TINY_JPEG };
}

async function createVerifiedAccount(email: string, password: string) {
  return prisma.account.create({
    data: { email, passwordHash: await hashPassword(password), emailVerifiedAt: new Date(), displayName: "Media Tester" },
  });
}

async function createCommunityWithAdmin(request: APIRequestContext, name: string, adminEmail: string) {
  await createVerifiedAccount(adminEmail, PASSWORD);
  const response = await request.post("/api/operator/create-community", {
    data: { name, founderEmail: adminEmail, invokedBy: "playwright-test" },
  });
  const body = await response.json();
  if (!body.ok) throw new Error(`expected community creation to succeed, got ${JSON.stringify(body)}`);
  return body.community as { id: string; name: string };
}

/**
 * Intercept the direct upload so no test ever reaches Cloudinary.
 *
 * `failFor` names 1-based upload ordinals that should fail, which is how the
 * per-file recovery tests force exactly one file to break. `delayMs` lets a test
 * make completion order differ from display order.
 */
async function stubCloudinaryUpload(
  page: Page,
  options: { failFor?: number[]; delayMs?: number; onUpload?: () => void } = {},
) {
  let ordinal = 0;
  const inFlight = { current: 0, peak: 0 };

  await page.route("https://api.cloudinary.com/**", async (route) => {
    ordinal += 1;
    const mine = ordinal;
    inFlight.current += 1;
    inFlight.peak = Math.max(inFlight.peak, inFlight.current);
    options.onUpload?.();

    if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));

    inFlight.current -= 1;

    if (options.failFor?.includes(mine)) {
      await route.fulfill({ status: 500, body: "stubbed failure" });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ asset_id: `stub-asset-${mine}`, public_id: `stub-${mine}` }),
    });
  });

  return { inFlight, uploadCount: () => ordinal };
}

async function gotoNewListing(page: Page, communityId: string) {
  await page.goto(`/communities/${communityId}/listings/new`);
  await expect(page.getByLabel(/Photos/)).toBeVisible();
}

// ---------------------------------------------------------------- T023 ----
test("selects multiple images in one action and previews each, with no Cloudinary widget", async ({ page }) => {
  const adminEmail = uniqueEmail("media-flow-admin");
  const community = await createCommunityWithAdmin(page.request, `Media Flow ${Date.now()}`, adminEmail);
  await signIn(page, adminEmail, PASSWORD);

  const widgetRequests: string[] = [];
  page.on("request", (request) => {
    if (/widget|upload-widget/i.test(request.url())) widgetRequests.push(request.url());
  });
  await stubCloudinaryUpload(page);

  await gotoNewListing(page, community.id);
  await page.getByLabel(/Photos/).setInputFiles([
    jpegFile("a.jpg"),
    jpegFile("b.jpg"),
    jpegFile("c.jpg"),
    jpegFile("d.jpg"),
    jpegFile("e.jpg"),
  ]);

  // FR-003, FR-007: one tile per selected file, each with its own state.
  await expect(page.getByTestId("media-tile")).toHaveCount(5);
  // FR-002, SC-002: no Cloudinary Upload Widget is ever loaded.
  expect(widgetRequests).toEqual([]);
});

test("rejects an unsupported type and an oversized file, naming each file (FR-005, FR-006, FR-013)", async ({ page }) => {
  const adminEmail = uniqueEmail("media-reject-admin");
  const community = await createCommunityWithAdmin(page.request, `Media Reject ${Date.now()}`, adminEmail);
  await signIn(page, adminEmail, PASSWORD);
  await stubCloudinaryUpload(page);
  await gotoNewListing(page, community.id);

  await page.getByLabel(/Photos/).setInputFiles([
    { name: "animation.gif", mimeType: "image/gif", buffer: Buffer.from([0x47, 0x49, 0x46]) },
    { name: "huge.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(11 * 1024 * 1024) },
    jpegFile("fine.jpg"),
  ]);

  const rejected = page.getByTestId("media-tile-rejected");
  await expect(rejected).toHaveCount(2);
  await expect(rejected.filter({ hasText: "animation.gif" })).toContainText(/unsupported file type/i);
  await expect(rejected.filter({ hasText: "huge.jpg" })).toContainText(/10 MB/i);
  // The valid file is unaffected — a rejected file never takes a good one down.
  await expect(page.getByTestId("media-tile")).toHaveCount(1);
});

test("rejects the ninth file with a maximum-photo message (FR-004)", async ({ page }) => {
  const adminEmail = uniqueEmail("media-cap-admin");
  const community = await createCommunityWithAdmin(page.request, `Media Cap ${Date.now()}`, adminEmail);
  await signIn(page, adminEmail, PASSWORD);
  await stubCloudinaryUpload(page);
  await gotoNewListing(page, community.id);

  await page
    .getByLabel(/Photos/)
    .setInputFiles(Array.from({ length: 9 }, (_, i) => jpegFile(`p${i}.jpg`)));

  await expect(page.getByTestId("media-tile")).toHaveCount(8);
  await expect(page.getByTestId("media-tile-rejected")).toContainText(/at most 8 photos/i);
});

// ---------------------------------------------------------------- T040 ----
test("never exceeds three concurrent uploads (FR-011, SC-020)", async ({ page }) => {
  const adminEmail = uniqueEmail("media-conc-admin");
  const community = await createCommunityWithAdmin(page.request, `Media Conc ${Date.now()}`, adminEmail);
  await signIn(page, adminEmail, PASSWORD);
  // A delay is what makes concurrency observable at all.
  const stub = await stubCloudinaryUpload(page, { delayMs: 250 });
  await gotoNewListing(page, community.id);

  await page
    .getByLabel(/Photos/)
    .setInputFiles(Array.from({ length: 8 }, (_, i) => jpegFile(`c${i}.jpg`)));

  await expect(page.getByTestId("media-tile")).toHaveCount(8);
  await expect(page.getByTestId("media-tile").filter({ hasText: "Ready" })).toHaveCount(8, {
    timeout: 30_000,
  });

  // Counted from concurrently-open intercepted requests, not inferred from timing.
  expect(stub.inFlight.peak).toBeLessThanOrEqual(3);
  expect(stub.uploadCount()).toBe(8);
});

// ---------------------------------------------------------------- T041 ----
test("retries only the failed file and leaves successes untouched (FR-009, SC-005)", async ({ page }) => {
  const adminEmail = uniqueEmail("media-retry-admin");
  const community = await createCommunityWithAdmin(page.request, `Media Retry ${Date.now()}`, adminEmail);
  await signIn(page, adminEmail, PASSWORD);
  // Fail the 3rd upload only.
  const stub = await stubCloudinaryUpload(page, { failFor: [3] });
  await gotoNewListing(page, community.id);

  await page
    .getByLabel(/Photos/)
    .setInputFiles([jpegFile("r1.jpg"), jpegFile("r2.jpg"), jpegFile("r3.jpg"), jpegFile("r4.jpg")]);

  const tiles = page.getByTestId("media-tile");
  await expect(tiles).toHaveCount(4);
  await expect(tiles.filter({ hasText: "Failed" })).toHaveCount(1, { timeout: 30_000 });
  await expect(tiles.filter({ hasText: "Ready" })).toHaveCount(3, { timeout: 30_000 });

  const uploadsBeforeRetry = stub.uploadCount();
  await page.getByTestId("media-retry").click();
  await expect(tiles.filter({ hasText: "Ready" })).toHaveCount(4, { timeout: 30_000 });

  // Exactly ONE more upload: the three successes are never re-sent.
  expect(stub.uploadCount()).toBe(uploadsBeforeRetry + 1);
});

test("blocks submission while uploads are in flight or failed (FR-012, FR-076)", async ({ page }) => {
  const adminEmail = uniqueEmail("media-block-admin");
  const community = await createCommunityWithAdmin(page.request, `Media Block ${Date.now()}`, adminEmail);
  await signIn(page, adminEmail, PASSWORD);
  await stubCloudinaryUpload(page, { failFor: [1] });
  await gotoNewListing(page, community.id);

  await page.getByLabel("Title").fill("Blocked listing");
  await page.getByLabel("Description").fill("x");
  await page.getByLabel(/Price/).fill("10");
  await page.getByLabel(/Photos/).setInputFiles([jpegFile("b1.jpg")]);

  await expect(page.getByTestId("media-tile").filter({ hasText: "Failed" })).toHaveCount(1, {
    timeout: 30_000,
  });
  // The two states get distinct treatment because they need different actions.
  await expect(page.getByRole("button", { name: "Create listing" })).toBeDisabled();

  await page.getByTestId("media-remove").click();
  await expect(page.getByRole("button", { name: "Create listing" })).toBeEnabled();
});

// ---------------------------------------------------------------- T035 ----
test("saves the member's chosen order and cover, not the upload-completion order (SC-003, SC-004)", async ({
  page,
}) => {
  const adminEmail = uniqueEmail("media-order-admin");
  const community = await createCommunityWithAdmin(page.request, `Media Order ${Date.now()}`, adminEmail);
  await signIn(page, adminEmail, PASSWORD);
  await stubCloudinaryUpload(page, { delayMs: 150 });
  await gotoNewListing(page, community.id);

  await page.getByLabel("Title").fill("Ordered listing");
  await page.getByLabel("Description").fill("x");
  await page.getByLabel(/Price/).fill("42");
  await page
    .getByLabel(/Photos/)
    .setInputFiles([jpegFile("o1.jpg"), jpegFile("o2.jpg"), jpegFile("o3.jpg")]);

  const tiles = page.getByTestId("media-tile");
  await expect(tiles.filter({ hasText: "Ready" })).toHaveCount(3, { timeout: 30_000 });

  // FR-010 / Principle V: reordering must be achievable by CLICKS ALONE. A
  // drag-only implementation would be desktop-only, which Principle V forbids.
  await tiles.nth(2).getByTestId("media-move-left").click();
  await tiles.nth(1).getByTestId("media-move-left").click();
  // Third tile chosen as cover.
  await tiles.nth(2).getByTestId("media-set-cover").click();
  await expect(tiles.nth(2)).toContainText("Cover");

  await page.getByRole("button", { name: "Create listing" }).click();

  // Wait for navigation AWAY from the form. `/communities/{id}**` would match
  // the form's own URL (.../listings/new) and resolve instantly, silently
  // passing before the listing was ever created.
  await page.waitForURL((url) => !url.pathname.endsWith("/listings/new"), { timeout: 30_000 });

  const listing = await prisma.listing.findFirstOrThrow({
    where: { communityId: community.id, title: "Ordered listing" },
    include: { photos: { orderBy: { displayOrder: "asc" } } },
  });
  expect(listing.photos).toHaveLength(3);
  // FR-020: contiguous from 0.
  expect(listing.photos.map((p) => p.displayOrder)).toEqual([0, 1, 2]);
  // The chosen cover, not the first-completed upload.
  expect(listing.coverPhotoId).toBe(listing.photos[2].id);
});

// ---------------------------------------------------------------- T042 ----
test("re-authorizing a file reuses its issued public id and creates no second pending row", async ({
  page,
}) => {
  const adminEmail = uniqueEmail("media-reauth-admin");
  const community = await createCommunityWithAdmin(page.request, `Media Reauth ${Date.now()}`, adminEmail);
  await signIn(page, adminEmail, PASSWORD);
  await stubCloudinaryUpload(page, { failFor: [1] });
  await gotoNewListing(page, community.id);

  await page.getByLabel(/Photos/).setInputFiles([jpegFile("ra.jpg")]);
  await expect(page.getByTestId("media-tile").filter({ hasText: "Failed" })).toHaveCount(1, {
    timeout: 30_000,
  });

  const account = await prisma.account.findUniqueOrThrow({ where: { email: adminEmail } });
  const afterFirst = await prisma.pendingListingMedia.findMany({ where: { accountId: account.id } });
  expect(afterFirst).toHaveLength(1);

  await page.getByTestId("media-retry").click();
  await expect(page.getByTestId("media-tile").filter({ hasText: "Ready" })).toHaveCount(1, {
    timeout: 30_000,
  });

  const afterRetry = await prisma.pendingListingMedia.findMany({ where: { accountId: account.id } });
  // Retry mode: same asset identity, no second row, so the eight-photo cap is
  // not double-counted (research.md #7).
  expect(afterRetry).toHaveLength(1);
  expect(afterRetry[0].cloudinaryPublicId).toBe(afterFirst[0].cloudinaryPublicId);
});

// ------------------------------------------------------------ T053/T054 ----
test.describe("delivery through the authenticated proxy", () => {
  async function seedListingWithPhoto(request: APIRequestContext, label: string) {
    const adminEmail = uniqueEmail(`media-deliver-${label}`);
    const community = await createCommunityWithAdmin(request, `Media Deliver ${label} ${Date.now()}`, adminEmail);
    const owner = await prisma.account.findUniqueOrThrow({ where: { email: adminEmail } });
    const listing = await prisma.listing.create({
      data: {
        communityId: community.id,
        ownerId: owner.id,
        title: `Delivered ${label}`,
        description: "x",
        priceCents: 1000,
      },
    });
    const photo = await prisma.listingPhoto.create({
      data: {
        listingId: listing.id,
        cloudinaryAssetId: `deliver-asset-${label}-${Date.now()}`,
        cloudinaryPublicId: `cmarket/test/listings/deliver-${label}/${Date.now()}`,
        width: 1600,
        height: 1200,
        format: "jpg",
        bytes: 50_000,
        displayOrder: 0,
      },
    });
    await prisma.listing.update({ where: { id: listing.id }, data: { coverPhotoId: photo.id } });
    return { adminEmail, community, listing, photo };
  }

  test("renders every image through the proxy and leaks no Cloudinary delivery data (FR-056, SC-007)", async ({
    page,
  }) => {
    const { adminEmail, community, listing } = await seedListingWithPhoto(page.request, "render");
    await signIn(page, adminEmail, PASSWORD);

    await page.goto(`/communities/${community.id}/listings/${listing.id}`);
    const gallery = page.getByTestId("listing-gallery").locator("img");
    await expect(gallery).toHaveCount(1);

    const src = await gallery.first().getAttribute("src");
    expect(src).toMatch(
      new RegExp(`^/api/communities/${community.id}/listing-photos/[^?]+\\?v=thumbnail$`),
    );

    // FR-068: stored dimensions are present so the browser reserves the ratio.
    expect(await gallery.first().getAttribute("width")).toBe("1600");
    expect(await gallery.first().getAttribute("height")).toBe("1200");
    // FR-066: alt derived from listing context, never a filename or an id.
    expect(await gallery.first().getAttribute("alt")).toContain("Delivered render");

    // FR-056: nothing Cloudinary in the rendered markup.
    expect(await page.content()).not.toContain("res.cloudinary.com");
  });

  test("lazy-loads non-cover gallery images (FR-067)", async ({ page }) => {
    const { adminEmail, community, listing } = await seedListingWithPhoto(page.request, "lazy");
    for (let i = 1; i <= 2; i += 1) {
      await prisma.listingPhoto.create({
        data: {
          listingId: listing.id,
          cloudinaryAssetId: `lazy-asset-${i}-${Date.now()}`,
          cloudinaryPublicId: `cmarket/test/listings/lazy/${i}-${Date.now()}`,
          width: 800,
          height: 600,
          format: "jpg",
          bytes: 1000,
          displayOrder: i,
        },
      });
    }
    await signIn(page, adminEmail, PASSWORD);
    await page.goto(`/communities/${community.id}/listings/${listing.id}`);

    const images = page.getByTestId("listing-gallery").locator("img");
    await expect(images).toHaveCount(3);
    expect(await images.nth(0).getAttribute("loading")).toBe("eager");
    expect(await images.nth(1).getAttribute("loading")).toBe("lazy");
    expect(await images.nth(2).getAttribute("loading")).toBe("lazy");
  });

  test("refuses an image request without a session, and streams rather than redirecting (FR-107)", async ({
    page,
    request,
  }) => {
    const { community, photo } = await seedListingWithPhoto(page.request, "auth");
    const url = `/api/communities/${community.id}/listing-photos/${photo.id}?v=card`;

    // A fresh context carries no session cookie.
    const anonymous = await request.get(url, { maxRedirects: 0 });
    expect(anonymous.status()).toBe(401);
    // FR-107: never a redirect to a signed Cloudinary URL.
    expect(anonymous.headers()["location"]).toBeUndefined();
  });

  test("refuses a photo whose listing belongs to another community, indistinguishably (FR-054)", async ({
    page,
  }) => {
    const first = await seedListingWithPhoto(page.request, "iso-a");
    const second = await seedListingWithPhoto(page.request, "iso-b");
    await signIn(page, second.adminEmail, PASSWORD);

    const wrongCommunity = await page.request.get(
      `/api/communities/${second.community.id}/listing-photos/${first.photo.id}?v=card`,
      { maxRedirects: 0 },
    );
    const nonexistent = await page.request.get(
      `/api/communities/${second.community.id}/listing-photos/clnonexistentphoto?v=card`,
      { maxRedirects: 0 },
    );

    expect(wrongCommunity.status()).toBe(404);
    expect(nonexistent.status()).toBe(404);
    expect(await wrongCommunity.body()).toEqual(await nonexistent.body());
  });

  test("the authorize response carries upload metadata and no secret (FR-108)", async ({ page }) => {
    const adminEmail = uniqueEmail("media-authz");
    const community = await createCommunityWithAdmin(page.request, `Media Authz ${Date.now()}`, adminEmail);
    await signIn(page, adminEmail, PASSWORD);

    const response = await page.request.post("/api/listing-media/authorize", {
      data: { communityId: community.id, draftId: `pw-draft-${Date.now()}` },
    });
    expect(response.ok()).toBe(true);
    const body = await response.json();

    // PERMITTED, and structurally required by the signed upload protocol.
    expect(body.upload.url).toContain("api.cloudinary.com");
    expect(body.upload.apiKey).toBeTruthy();
    expect(body.upload.signature).toBeTruthy();
    expect(body.upload.publicId).toBeTruthy();
    // FORBIDDEN, without exception.
    expect(JSON.stringify(body)).not.toContain(process.env.CLOUDINARY_API_SECRET ?? "__unset__");
    // No legacy folder parameter (research.md #5).
    expect(body.upload.folder).toBeUndefined();
  });
});

// ---------------------------------------------------------------- T095 ----
test("uploader and media surfaces have no horizontal overflow at mobile, tablet, and desktop widths (Principle V, SC-014)", async ({
  page,
}) => {
  const adminEmail = uniqueEmail("media-viewport-admin");
  const community = await createCommunityWithAdmin(page.request, `Media Viewport ${Date.now()}`, adminEmail);
  const owner = await prisma.account.findUniqueOrThrow({ where: { email: adminEmail } });
  const listing = await prisma.listing.create({
    data: {
      communityId: community.id,
      ownerId: owner.id,
      title: "Wide load",
      description: "x",
      priceCents: 1234,
    },
  });
  // A deliberately extreme aspect ratio: the shape most likely to burst a
  // container if object-cover or the aspect box were wrong.
  const photo = await prisma.listingPhoto.create({
    data: {
      listingId: listing.id,
      cloudinaryAssetId: `vp-asset-${Date.now()}`,
      cloudinaryPublicId: `cmarket/test/listings/viewport/${Date.now()}`,
      width: 6000,
      height: 400,
      format: "jpg",
      bytes: 2000,
      displayOrder: 0,
    },
  });
  await prisma.listing.update({ where: { id: listing.id }, data: { coverPhotoId: photo.id } });

  await stubCloudinaryUpload(page);
  await signIn(page, adminEmail, PASSWORD);

  const widths = [375, 768, 1440];
  const surfaces = [
    `/communities/${community.id}`,
    `/communities/${community.id}/listings`,
    `/communities/${community.id}/listings/${listing.id}`,
    `/communities/${community.id}/listings/new`,
  ];

  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    for (const surface of surfaces) {
      await page.goto(surface);
      // FR-065: the page body must never scroll horizontally. Allow 1px for
      // sub-pixel rounding rather than demanding exact equality.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${surface} at ${width}px overflows by ${overflow}px`).toBeLessThanOrEqual(1);
    }
  }

  // The uploader itself must stay usable at the narrowest width, including its
  // touch-reachable reorder controls.
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto(`/communities/${community.id}/listings/${listing.id}`);
  await page.getByLabel(/Photos/).setInputFiles([jpegFile("v1.jpg"), jpegFile("v2.jpg")]);
  await expect(page.getByTestId("media-tile")).toHaveCount(3);
  await expect(page.getByTestId("media-move-right").first()).toBeVisible();

  const narrowOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(narrowOverflow).toBeLessThanOrEqual(1);
});

// ---------------------------------------------------------------- T086 ----
test("a listing left image-less by the migration renders the placeholder without error (FR-089, SC-018)", async ({
  page,
}) => {
  const adminEmail = uniqueEmail("media-legacy-admin");
  const community = await createCommunityWithAdmin(page.request, `Media Legacy ${Date.now()}`, adminEmail);
  const owner = await prisma.account.findUniqueOrThrow({ where: { email: adminEmail } });
  // Exactly the post-migration shape: a listing whose photos were deleted.
  const listing = await prisma.listing.create({
    data: {
      communityId: community.id,
      ownerId: owner.id,
      title: "Legacy listing",
      description: "Had photos before the cutover",
      priceCents: 999,
    },
  });

  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  const failedImageRequests: string[] = [];
  page.on("response", (response) => {
    if (response.request().resourceType() === "image" && response.status() >= 400) {
      failedImageRequests.push(response.url());
    }
  });

  await signIn(page, adminEmail, PASSWORD);
  await page.goto(`/communities/${community.id}`);
  await expect(page.getByTestId("listing-cover-placeholder").first()).toBeVisible();

  await page.goto(`/communities/${community.id}/listings/${listing.id}`);
  await expect(page.getByTestId("listing-gallery")).toHaveCount(0);

  expect(failedImageRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

// ---------------------------------------------------------------- T076 ----
test("removing a photo drops it from every surface and queues its cleanup (FR-078, FR-079)", async ({
  page,
}) => {
  const adminEmail = uniqueEmail("media-edit-admin");
  const community = await createCommunityWithAdmin(page.request, `Media Edit ${Date.now()}`, adminEmail);
  const owner = await prisma.account.findUniqueOrThrow({ where: { email: adminEmail } });
  const listing = await prisma.listing.create({
    data: {
      communityId: community.id,
      ownerId: owner.id,
      title: "Editable listing",
      description: "x",
      priceCents: 5000,
    },
  });
  const photos = [];
  for (let i = 0; i < 2; i += 1) {
    photos.push(
      await prisma.listingPhoto.create({
        data: {
          listingId: listing.id,
          cloudinaryAssetId: `edit-asset-${i}-${Date.now()}`,
          cloudinaryPublicId: `cmarket/test/listings/edit/${i}-${Date.now()}`,
          width: 1000,
          height: 800,
          format: "jpg",
          bytes: 1000,
          displayOrder: i,
        },
      }),
    );
  }
  await prisma.listing.update({ where: { id: listing.id }, data: { coverPhotoId: photos[0].id } });

  await signIn(page, adminEmail, PASSWORD);
  const response = await page.request.delete(
    `/api/communities/${community.id}/listings/${listing.id}/photos/${photos[0].id}`,
  );
  expect(response.status()).toBe(204);

  // Gone from the detail surface.
  await page.goto(`/communities/${community.id}/listings/${listing.id}`);
  await expect(page.getByTestId("listing-gallery").locator("img")).toHaveCount(1);

  // Its proxy URL now 404s, so a browser revalidating a cached copy gets the
  // removal immediately rather than after a TTL.
  const stale = await page.request.get(
    `/api/communities/${community.id}/listing-photos/${photos[0].id}?v=card`,
    { maxRedirects: 0 },
  );
  expect(stale.status()).toBe(404);

  // FR-018: the cover was removed, so the survivor is promoted.
  const updated = await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } });
  expect(updated.coverPhotoId).toBe(photos[1].id);

  // FR-079: queued for Cloudinary deletion, not deleted inline.
  expect(
    await prisma.mediaCleanupTask.count({
      where: { cloudinaryPublicId: photos[0].cloudinaryPublicId },
    }),
  ).toBe(1);
});
