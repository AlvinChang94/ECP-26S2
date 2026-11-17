// What: builds a throwaway copy of the app's world: a temporary SQLite file, a temporary Navision folder and a clock you control.
// Who calls it: the KPI replay (scripts/replay-runner.ts) and the integration tests (tests/helpers/workspace.ts).
// To extend: add an option here when a script or test needs another folder or setting; nothing outside the temp folder is touched.
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FakeClock } from "../src/adapters/clock";
import { loadConfig } from "../src/adapters/config";
import { createTablesFromMigrations } from "../src/adapters/db";
import { buildDeps, type Deps } from "../src/services/deps";

export const PROJECT_ROOT = path.resolve(__dirname, "..");

export type TempWorkspace = {
  deps: Deps;
  clock: FakeClock;
  dir: string;
  /** Folder that plays the part of data/navision in this workspace. Approved exports are written to its export/ folder. */
  navisionDir: string;
  cleanup(): Promise<void>;
};

export function createTempWorkspace(options: { navisionSource: string; now: string | Date; env?: Record<string, string> }): TempWorkspace {
  const dir = mkdtempSync(path.join(os.tmpdir(), "orderflow-"));
  const navisionDir = path.join(dir, "navision");
  // Copy the JSON files only: whatever a developer exported locally must not leak into a test or a replay.
  cpSync(options.navisionSource, navisionDir, { recursive: true, filter: (from) => !from.includes(`${path.sep}export`) });
  mkdirSync(path.join(dir, "inbox"), { recursive: true });

  const databaseFile = path.join(dir, "orderflow.db");
  createTablesFromMigrations(databaseFile, path.join(PROJECT_ROOT, "prisma", "migrations"));

  const config = loadConfig(
    {
      DATABASE_URL: `file:${databaseFile}`,
      NAVISION_DIR: navisionDir,
      INBOX_DIR: path.join(dir, "inbox"),
      STORAGE_DIR: path.join(dir, "storage"),
      APP_BASE_URL: "http://localhost:3000",
      APPROVAL_LINK_SECRET: "temp-workspace-secret-for-approval-links",
      ...options.env,
    },
    PROJECT_ROOT,
  );
  const clock = new FakeClock(options.now);
  const deps = buildDeps(config, clock);

  return {
    deps,
    clock,
    dir,
    navisionDir,
    async cleanup() {
      await deps.db.$disconnect();
      // Windows can hold the database file for a moment after closing it.
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
}
