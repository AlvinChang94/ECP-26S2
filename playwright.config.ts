// What: settings for the end-to-end tests (Playwright): where the tests are, which browser, and how the app is started for them.
// Who calls it: `npm run test:e2e`.
// To extend: add a spec file to tests/e2e. The tests share one seeded database and run one after another, so keep each test to its own order or document.
import { defineConfig, devices } from "@playwright/test";

/** A port of its own, so the tests can run while `npm run dev` is open on port 3000. */
const PORT = 3217;

export default defineConfig({
  testDir: "tests/e2e",
  // One worker, in file order: every test works on the same seeded demo scenario.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    // Copies the sample data to .e2e, seeds a database there, builds the app and starts it. Takes about a minute.
    command: "npm run e2e:server",
    url: `http://localhost:${PORT}/sign-in`,
    reuseExistingServer: false,
    timeout: 300_000,
    stdout: "pipe",
    env: {
      DATABASE_URL: "file:./.e2e/orderflow.db",
      NAVISION_DIR: ".e2e/navision",
      INBOX_DIR: ".e2e/inbox",
      STORAGE_DIR: ".e2e/storage",
      APP_BASE_URL: `http://localhost:${PORT}`,
    },
  },
});
