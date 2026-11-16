// What: Vitest settings for unit, integration, invariant and golden tests.
// Who calls it: `npm test` (vitest run).
// To extend: add new test folders to `include`. End-to-end tests live in e2e/ and use Playwright instead.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    // Each test file runs in its own process: the SQLite driver is a native module.
    pool: "forks",
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
