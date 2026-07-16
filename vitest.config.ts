import { defineConfig } from "vitest/config";
import path from "node:path";
import { config } from "dotenv";

config({ path: path.resolve(__dirname, ".env.test") });

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.ts", "tests/contract/**/*.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
