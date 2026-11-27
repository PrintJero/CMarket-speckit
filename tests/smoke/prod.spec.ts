import { expect, test } from "@playwright/test";

/**
 * Production smoke test: the automatable, credential-free part of the release
 * checklist (README, "Production deployment (Dokploy)", step 8.6). The steps
 * that need real accounts, real email, Google or a second community are manual
 * and listed there.
 *
 *   PLAYWRIGHT_BASE_URL=https://<domain> npm run test:smoke
 */

test("health check reports the database reachable", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: "ok" });
});

test("is served over HTTPS (required for secure cookies and the PWA)", async ({ baseURL }) => {
  expect(new URL(baseURL ?? "").protocol).toBe("https:");
});

for (const path of ["/", "/sign-in", "/sign-up"]) {
  test(`${path} loads without console errors`, async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    const response = await page.goto(path);
    expect(response?.ok(), `${path} status`).toBe(true);
    await page.waitForLoadState("networkidle");
    expect(errors).toEqual([]);
  });
}

test("listing photos refuse an unauthenticated request (Principle II, 017)", async ({
  request,
}) => {
  const response = await request.get("/api/communities/smoke-community/listing-photos/smoke-photo");
  expect(response.status()).toBe(401);
});

test("media cleanup refuses a request without the token", async ({ request }) => {
  const response = await request.post("/api/listing-media/cleanup");
  expect(response.status()).toBe(401);
});

test("every test-only switch is off", async ({ request }) => {
  // OPERATOR_PANEL_ENABLED
  expect((await request.get("/operator")).status()).toBe(404);
  expect((await request.post("/api/operator/create-community", { data: {} })).status()).toBe(404);
  // EMAIL_TEST_CAPTURE
  expect((await request.get("/api/test/last-email?to=smoke@example.com")).status()).toBe(404);
});

test("the PWA is installable: manifest, worker and Chrome's installability check (018)", async ({
  page,
  request,
}) => {
  expect((await request.get("/manifest.webmanifest")).status()).toBe(200);
  const sw = await request.get("/sw.js");
  expect(sw.status()).toBe(200);
  expect(sw.headers()["cache-control"]).toContain("no-cache");

  await page.goto("/sign-in");
  const active = await page.evaluate(async () => {
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 15_000));
    const registration = await Promise.race([navigator.serviceWorker.ready, timeout]);
    return Boolean(registration?.active);
  });
  expect(active).toBe(true);
  const cdp = await page.context().newCDPSession(page);
  const { installabilityErrors } = await cdp.send("Page.getInstallabilityErrors");
  expect(installabilityErrors).toEqual([]);
});
