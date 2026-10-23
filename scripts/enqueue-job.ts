// Adds a job for the worker. Usage: npm run job:enqueue -- <type> [key=value ...]
// e.g. npm run job:enqueue -- export-payment-consolidation
import "dotenv/config";
import { getDb } from "../src/lib/db";
import { getEnv } from "../src/lib/env";
import { handlers } from "../worker/handlers";

async function main() {
  getEnv();
  const [type, ...pairs] = process.argv.slice(2);
  if (!type || !handlers[type]) {
    console.error(`Usage: npm run job:enqueue -- <type> [key=value ...]`);
    console.error(`Known types: ${Object.keys(handlers).join(", ")}`);
    process.exitCode = 1;
    return;
  }
  const payload = Object.fromEntries(
    pairs.map((p) => {
      const i = p.indexOf("=");
      if (i < 1) throw new Error(`Expected key=value, got "${p}"`);
      return [p.slice(0, i), p.slice(i + 1)];
    }),
  );
  const job = await getDb().job.create({ data: { type, payload } });
  console.log(`Enqueued job ${job.id} (${type}). Start the worker with: npm run worker`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => getDb().$disconnect());
