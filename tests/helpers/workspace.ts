// What: builds a throwaway workspace for integration tests: a temporary SQLite file, a temporary Navision folder and a fake clock.
// Who calls it: tests in tests/integration and tests/invariants.
// To extend: pass `navision: "demo"` to start from the demo Navision files instead of the golden ones.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FakeClock } from "@/adapters/clock";
import { loadConfig } from "@/adapters/config";
import { createTablesFromMigrations } from "@/adapters/db";
import type { Actor } from "@/domain/audit";
import { buildDeps, type Deps } from "@/services/deps";

export const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
export const DATA_DIR = path.join(PROJECT_ROOT, "data");

/** The demo's starting moment, used as the default "now" in tests. */
export const TEST_NOW = "2026-11-16T01:00:00.000Z";

export const SAM: Actor = { name: "Sam Tan", role: "sales" };
export const PRIYA: Actor = { name: "Priya Nair", role: "product_manager" };
export const FARAH: Actor = { name: "Farah Lim", role: "finance" };
export const PETER: Actor = { name: "Peter Goh", role: "purchase" };

export type TestWorkspace = {
  deps: Deps;
  clock: FakeClock;
  dir: string;
  /** Folder that plays the part of data/navision in this workspace. */
  navisionDir: string;
  cleanup(): Promise<void>;
};

export function createWorkspace(options: { navision?: "golden" | "demo" | "replay"; now?: string } = {}): TestWorkspace {
  const dir = mkdtempSync(path.join(os.tmpdir(), "orderflow-test-"));
  const navisionDir = path.join(dir, "navision");
  const source =
    options.navision === "demo"
      ? path.join(DATA_DIR, "navision")
      : options.navision === "replay"
        ? path.join(DATA_DIR, "replay", "navision")
        : path.join(DATA_DIR, "golden", "navision");
  // Copy the JSON files only: whatever a developer exported locally must not leak into a test.
  cpSync(source, navisionDir, { recursive: true, filter: (from) => !from.includes(`${path.sep}export`) });
  mkdirSync(path.join(dir, "inbox"), { recursive: true });

  const databaseFile = path.join(dir, "test.db");
  createTablesFromMigrations(databaseFile, path.join(PROJECT_ROOT, "prisma", "migrations"));

  const config = loadConfig(
    {
      DATABASE_URL: `file:${databaseFile}`,
      NAVISION_DIR: navisionDir,
      INBOX_DIR: path.join(dir, "inbox"),
      STORAGE_DIR: path.join(dir, "storage"),
      APP_BASE_URL: "http://localhost:3000",
      APPROVAL_LINK_SECRET: "test-secret-for-approval-links",
    },
    PROJECT_ROOT,
  );
  const clock = new FakeClock(options.now ?? TEST_NOW);
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

/** Reads a PDF from the data folder, for example readDataFile("golden/files/po-clean-a.pdf"). */
export function readDataFile(relativePath: string): Uint8Array {
  return new Uint8Array(readFileSync(path.join(DATA_DIR, relativePath)));
}
