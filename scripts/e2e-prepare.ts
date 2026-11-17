// What: prepares a private copy of the sample data for the end-to-end tests in the .e2e folder, so they never touch your demo database.
// Who calls it: the "e2e:server" npm script, which Playwright starts before the tests (see playwright.config.ts).
// To extend: the folders must match the environment variables in playwright.config.ts. The seed script then fills the database there.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const workspace = path.join(root, ".e2e");
const dataDir = path.join(root, "data");

if (!existsSync(path.join(dataDir, "navision", "items.json"))) {
  console.error('The sample data is missing. Run "npm run seed" once before the end-to-end tests.');
  process.exit(1);
}

rmSync(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
mkdirSync(workspace, { recursive: true });
// The Navision JSON files without anything exported earlier, and the PDFs waiting in the Inbox.
cpSync(path.join(dataDir, "navision"), path.join(workspace, "navision"), { recursive: true, filter: (from) => !from.includes(`${path.sep}export${path.sep}`) });
mkdirSync(path.join(workspace, "navision", "export"), { recursive: true });
cpSync(path.join(dataDir, "inbox"), path.join(workspace, "inbox"), { recursive: true });
console.log("End-to-end workspace prepared in .e2e (a private copy of data/navision and data/inbox).");
