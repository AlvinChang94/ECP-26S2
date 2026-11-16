// What: command-line entry that (re)creates all synthetic sample data under ./data.
// Who calls it: `npm run generate-data`, and `npm run seed` (through scripts/seed.ts).
// To extend: the data itself is defined in scripts/sample-data/. This file only runs the generator and prints a summary.
import path from "node:path";
import { generateSampleData } from "./sample-data/generate";

async function main(): Promise<void> {
  const dataDir = path.resolve(process.cwd(), "data");
  const summary = await generateSampleData(dataDir);
  console.log(
    `Sample data written to ${dataDir}: ${summary.files} files, ${summary.goldenCases} golden cases, ` +
      `${summary.replayOrders} replay orders, ${summary.replayReceipts} replay receipts. All of it is synthetic.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
