import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { config } from "dotenv";

config({ path: path.resolve(__dirname, ".env.test") });

export default defineConfig({
  testDir: "./tests/integration",
  fullyParallel: true,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // The suite runs against the PRODUCTION build by default (run
      // `npm run build` first; CI does). `next dev` compiles each route on its
      // first request, and under parallel workers on a cold start that compile
      // can exceed the 30s test timeout — flaky failures that say nothing about
      // the app. The production server also exercises what actually ships
      // (and is required for the PWA service worker, spec 018).
      // For quick local iteration against `next dev`, set E2E_DEV=1.
      command: process.env.E2E_DEV ? "npm run dev" : "npm run start",
      url: "http://localhost:3000",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      // 006-user-display-names, research.md #2: the standalone mock Google
      // OAuth boundary — never started by the production build/start path.
      command: "npx tsx scripts/mock-google-oauth-server.ts",
      url: process.env.GOOGLE_OAUTH_MOCK_URL ?? "http://localhost:4310",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
