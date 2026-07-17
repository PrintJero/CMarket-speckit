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
      command: "npm run dev",
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
