// What: builds a throwaway workspace for integration tests: a temporary SQLite file, a temporary Navision folder and a fake clock.
// Who calls it: tests in tests/integration and tests/invariants.
// To extend: pass `navision: "demo"` to start from the demo Navision files instead of the golden ones.
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Actor } from "@/domain/audit";
import { createTempWorkspace, PROJECT_ROOT, type TempWorkspace } from "../../scripts/temp-workspace";

export { PROJECT_ROOT };
export const DATA_DIR = path.join(PROJECT_ROOT, "data");

/** The demo's starting moment, used as the default "now" in tests. */
export const TEST_NOW = "2026-11-16T01:00:00.000Z";

export const SAM: Actor = { name: "Sam Tan", role: "sales" };
export const PRIYA: Actor = { name: "Priya Nair", role: "product_manager" };
export const FARAH: Actor = { name: "Farah Lim", role: "finance" };
export const PETER: Actor = { name: "Peter Goh", role: "purchase" };

export type TestWorkspace = TempWorkspace;

/** A workspace of its own for one test: its own database, Navision folder and fake clock (see scripts/temp-workspace.ts). */
export function createWorkspace(options: { navision?: "golden" | "demo" | "replay"; now?: string } = {}): TestWorkspace {
  const navisionSource =
    options.navision === "demo"
      ? path.join(DATA_DIR, "navision")
      : options.navision === "replay"
        ? path.join(DATA_DIR, "replay", "navision")
        : path.join(DATA_DIR, "golden", "navision");
  return createTempWorkspace({ navisionSource, now: options.now ?? TEST_NOW, env: { APPROVAL_LINK_SECRET: "test-secret-for-approval-links" } });
}

/** Reads a PDF from the data folder, for example readDataFile("golden/files/po-clean-a.pdf"). */
export function readDataFile(relativePath: string): Uint8Array {
  return new Uint8Array(readFileSync(path.join(DATA_DIR, relativePath)));
}
