import { defineConfig, devices } from "@playwright/test";

/**
 * Production smoke test (release checklist 8.6). Runs ONLY against a deployed
 * URL and is never part of `npm run test:e2e` (whose testDir is
 * tests/integration). It starts no local server and touches no database.
 *
 *   PLAYWRIGHT_BASE_URL=https://<domain> npm run test:smoke
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL;
if (!baseURL) {
  throw new Error("Set PLAYWRIGHT_BASE_URL to the deployed URL, e.g. https://cmarket.example.");
}

export default defineConfig({
  testDir: "./tests/smoke",
  fullyParallel: true,
  retries: 0,
  reporter: "list",
  use: { baseURL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
