import { expect, test } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import {
  coreScreens,
  ensureControlledByWorker,
  readCacheStorage,
  seedMarketplace,
} from "./pwaFixtures";

/**
 * 018-pwa-installable (US1, US2). Runs against the production build, the only
 * build that registers the service worker (FR-012). The rest of the suite
 * blocks service workers (playwright.config.ts); these tests opt back in.
 */
test.use({ serviceWorkers: "allow" });

/** The only paths the worker may ever store (FR-006). Anything else fails. */
const ALLOWED_CACHE_PATH = /^\/_next\/static\/|^\/icons\/|^\/manifest\.webmanifest$|^\/offline$/;

/** PNG width/height live in the IHDR chunk at bytes 16–23, so no image library is needed. */
function pngSize(bytes: Buffer): { width: number; height: number } {
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

// ---------------------------------------------------------------- T005 (US1)

test("serves a manifest with the required fields (FR-001, FR-002)", async ({ request }) => {
  const response = await request.get("/manifest.webmanifest");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/manifest+json");
  const manifest = await response.json();
  expect(manifest).toMatchObject({
    name: "CMarket",
    short_name: "CMarket",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f7f7f9",
    theme_color: "#7c1ff2",
  });
  expect(manifest.icons).toEqual([
    { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    {
      src: "/icons/icon-maskable-512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable",
    },
  ]);
});

test("serves every icon at its declared size (FR-002, FR-003)", async ({ request }) => {
  const icons: [string, number][] = [
    ["/icons/icon-192.png", 192],
    ["/icons/icon-512.png", 512],
    ["/icons/icon-maskable-512.png", 512],
    ["/icons/apple-touch-icon.png", 180],
  ];
  for (const [path, size] of icons) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expect(response.headers()["content-type"], path).toContain("image/png");
    expect(pngSize(await response.body()), path).toEqual({ width: size, height: size });
  }
});

test("every page declares the manifest, theme color and iOS home-screen metadata (FR-003)", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    "href",
    "/manifest.webmanifest",
  );
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#7c1ff2");
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    "href",
    "/icons/apple-touch-icon.png",
  );
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute(
    "content",
    "CMarket",
  );
});

test("serves the worker script uncached (FR-012)", async ({ request }) => {
  const response = await request.get("/sw.js");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/javascript");
  expect(response.headers()["cache-control"]).toContain("no-cache");
});

test("registers /sw.js with scope / in the production build (FR-012)", async ({
  page,
  baseURL,
}) => {
  await page.goto("/sign-in");
  await ensureControlledByWorker(page);
  const registration = await page.evaluate(async () => {
    const ready = await navigator.serviceWorker.ready;
    return { scriptURL: ready.active?.scriptURL ?? "", scope: ready.scope };
  });
  expect(new URL(registration.scriptURL).pathname).toBe("/sw.js");
  expect(registration.scope).toBe(new URL("/", baseURL).href);
});

test("Chrome reports CMarket as installable (FR-005, SC-001)", async ({ page }) => {
  await page.goto("/sign-in");
  await ensureControlledByWorker(page);
  const cdp = await page.context().newCDPSession(page);
  const manifest = await cdp.send("Page.getAppManifest");
  expect(manifest.errors).toEqual([]);
  const { installabilityErrors } = await cdp.send("Page.getInstallabilityErrors");
  expect(installabilityErrors).toEqual([]);
});

// ---------------------------------------------------------------- T006 (US1)

test("after authenticated browsing, nothing but the public static shell is stored (FR-006 to FR-009, SC-002)", async ({
  page,
}) => {
  const marketplace = await seedMarketplace(page, "cache");
  await page.goto(coreScreens(marketplace)[0].path);
  await ensureControlledByWorker(page);

  for (const screen of coreScreens(marketplace)) {
    const photo =
      screen.name === "listing"
        ? page.waitForResponse((r) => r.url().includes("/listing-photos/"))
        : null;
    await page.goto(screen.path);
    await photo;
    // A second, controlled load routes every subresource through the worker.
    await page.reload();
  }

  const { names, paths } = await readCacheStorage(page);
  expect(names).toEqual(["cmarket-static-v1"]);
  expect(paths.filter((path) => path.startsWith("/api/"))).toEqual([]);
  expect(paths.filter((path) => !ALLOWED_CACHE_PATH.test(path))).toEqual([]);
  // Proves the worker is actually caching the shell, not just caching nothing.
  expect(paths.some((path) => path.startsWith("/_next/static/"))).toBe(true);
});

test("activating the worker removes storage left by previous versions (FR-011, SC-004)", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await ensureControlledByWorker(page);
  await page.evaluate(async () => {
    const stale = await caches.open("cmarket-static-v0");
    await stale.put("/stale-entry", new Response("stale"));
    const registration = await navigator.serviceWorker.getRegistration();
    await registration?.unregister();
  });

  await page.reload();
  await ensureControlledByWorker(page);
  await expect
    .poll(async () => (await readCacheStorage(page)).names)
    .toEqual(["cmarket-static-v1"]);
});

// ---------------------------------------------------------------- T013 (US2)

test("a navigation without network shows the CMarket offline page, and Try again reloads the live page (FR-010, FR-014, SC-003)", async ({
  page,
  context,
}) => {
  const marketplace = await seedMarketplace(page, "offline");
  const [feed, listing] = coreScreens(marketplace);
  await page.goto(feed.path);
  await ensureControlledByWorker(page);
  // Drop the network only once nothing is in flight (prefetches, RSC payloads):
  // a client-side request failing mid-test can trigger its own navigation and
  // abort the navigation under test (seen once in CI as net::ERR_ABORTED).
  await page.waitForLoadState("networkidle");

  await context.setOffline(true);
  await page.goto(listing.path);
  await expect(page.getByRole("heading", { level: 1, name: "You're offline" })).toBeVisible();
  // The worker answers the ORIGINAL navigation, so the address bar keeps the requested URL.
  expect(new URL(page.url()).pathname).toBe(listing.path);

  await context.setOffline(false);
  await page.getByRole("link", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: marketplace.listingTitle })).toBeVisible();
});

test("online navigations always come from the server, never a stored copy (US2-AS3)", async ({
  page,
}) => {
  const marketplace = await seedMarketplace(page, "fresh");
  const listing = coreScreens(marketplace)[1];
  await page.goto(listing.path);
  await ensureControlledByWorker(page);
  await expect(page.getByRole("heading", { name: marketplace.listingTitle })).toBeVisible();

  const renamed = `${marketplace.listingTitle} (renamed)`;
  await prisma.listing.update({ where: { id: marketplace.listingId }, data: { title: renamed } });
  await page.reload();
  await expect(page.getByRole("heading", { name: renamed })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: marketplace.listingTitle, exact: true }),
  ).toHaveCount(0);
});

test("the stored offline page carries no personal data (FR-014)", async ({ page }) => {
  const marketplace = await seedMarketplace(page, "nopii");
  await page.goto(coreScreens(marketplace)[0].path);
  await ensureControlledByWorker(page);

  const offlineHtml = await page.evaluate(async () => {
    const response = await caches.match("/offline");
    return response ? response.text() : null;
  });
  expect(offlineHtml).not.toBeNull();
  expect(offlineHtml).toContain("You&#x27;re offline");
  expect(offlineHtml).not.toContain(marketplace.buyer.email);
  expect(offlineHtml).not.toContain(marketplace.buyer.displayName);
});
