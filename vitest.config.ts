import { defineConfig } from "vitest/config";
import path from "node:path";
import { config } from "dotenv";

config({ path: path.resolve(__dirname, ".env.test") });

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.ts", "tests/contract/**/*.ts"],
    // 009-platform-administration: MasterIdentity and AdministrativeAuditEntry
    // are genuinely global tables (not scoped by a unique field per test, the
    // way Account/Community fixtures are) — multiple contract-test files
    // assert on table-wide invariants (e.g. "exactly one MASTER exists").
    // Running test files in parallel worker processes races on those tables;
    // sequential file execution keeps each file's beforeEach cleanup honest.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
