// What: puts the app into its demo starting state: sample data, an empty database, then the scripted history up to ORD-1042.
// Who calls it: `npm run seed` (also regenerates the sample data files) and `npm run reset-demo` (keeps the data files as they are).
// To extend: the history itself is in scripts/seed-scenario.ts. This file only prepares the ground and pins the demo clock.
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { FakeClock } from "../src/adapters/clock";
import { loadConfig } from "../src/adapters/config";
import { pinDemoClock } from "../src/services/clockControl";
import { buildDeps } from "../src/services/deps";
import { generateSampleData } from "./sample-data/generate";
import { DEMO_NOW } from "./sample-data/master";
import { seedDemoScenario } from "./seed-scenario";

async function main(): Promise<void> {
  try {
    process.loadEnvFile(); // optional .env file; the defaults work without it
  } catch {
    // no .env file: fine
  }
  const config = loadConfig();
  // config.ts only accepts file: (SQLite) or mysql:// (Amazon RDS). A DATABASE_URL set in the terminal wins over .env,
  // so a wrong one is usually left over from another project: say so plainly.
  const mysql = config.databaseUrl.startsWith("mysql://");
  console.log(`Database: ${mysql ? config.databaseUrl.replace(/\/\/[^@]*@/, "//***@") : config.databaseUrl} (${mysql ? "MySQL" : "SQLite"}).`);
  // The seed empties every table. On MySQL that must be asked for explicitly, so a DATABASE_URL left over from another
  // project (set in the terminal, which wins over .env) can never wipe that project's database.
  if (mysql && !process.argv.includes("--reset-mysql")) {
    console.error(
      "DATABASE_URL points at a MySQL database. The seed empties every table, so it only runs on MySQL with --reset-mysql\n" +
        "(the AWS server does this once on first start). On a laptop you normally want SQLite: clear DATABASE_URL in your terminal\n" +
        "(Command Prompt: set DATABASE_URL=   PowerShell: Remove-Item Env:DATABASE_URL) so .env is used.",
    );
    process.exit(1);
  }
  const dataDir = path.resolve(process.cwd(), "data");
  const regenerate = process.argv.includes("--regenerate-data") || !existsSync(path.join(config.navisionDir, "items.json"));

  if (regenerate) {
    const summary = await generateSampleData(dataDir);
    console.log(`1. Sample data written (${summary.files} files, all synthetic).`);
  } else {
    console.log("1. Sample data files kept as they are.");
  }

  // 2. Database: create the file and tables if needed (Prisma keeps the migration history), then empty every table.
  if (!mysql) mkdirSync(path.dirname(config.databaseUrl.slice("file:".length)), { recursive: true });
  // MySQL has its own migrations (prisma/mysql), generated from the same models.
  execSync(mysql ? "npx prisma migrate deploy --config prisma.mysql.config.ts" : "npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: config.databaseUrl },
  });

  const clock = new FakeClock(DEMO_NOW);
  const deps = buildDeps(config, clock);
  const db = deps.db;
  await db.auditEvent.deleteMany();
  await db.outboxMessage.deleteMany();
  await db.scheduledJob.deleteMany();
  await db.approvalToken.deleteMany();
  await db.spr.deleteMany();
  await db.paymentProof.deleteMany();
  await db.shipmentDocument.deleteMany();
  await db.shipment.deleteMany();
  await db.delivery.deleteMany();
  await db.flagDecision.deleteMany();
  await db.partAlias.deleteMany();
  await db.poVersion.deleteMany();
  await db.order.deleteMany();
  await db.document.deleteMany();
  await db.counter.deleteMany();
  await db.appSetting.deleteMany();
  console.log("2. Database emptied.");

  // 3. Uploaded files and everything the app wrote for Navision. (With S3 the old PDFs stay in the bucket: they are stored
  //    under their content hash, so the seed simply writes the same objects again.)
  rmSync(path.join(config.storageDir, "documents"), { recursive: true, force: true });
  const exportDir = path.join(config.navisionDir, "export");
  if (existsSync(exportDir)) {
    for (const name of readdirSync(exportDir)) {
      if (name !== ".gitkeep") rmSync(path.join(exportDir, name), { recursive: true, force: true });
    }
  }
  console.log("3. Uploaded files and the Navision export folder cleared.");

  // 4. Replay the scripted history through the real services, on a simulated clock.
  const report = await seedDemoScenario(deps, clock, path.join(dataDir, "seed"));
  console.log(`4. Demo history loaded: ${report}`);

  // 5. From now on the app's clock is real time shifted so that "now" is the demo's starting moment.
  await pinDemoClock(deps, DEMO_NOW);
  await db.$disconnect();
  console.log(`5. Demo clock set to ${DEMO_NOW.toISOString()} (Monday 16 November 2026, 09:00 Singapore time).`);
  console.log('Done. Start the app with "npm run dev" and open http://localhost:3000');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
