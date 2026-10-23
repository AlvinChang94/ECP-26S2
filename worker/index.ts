// Polls the jobs table and runs handlers. Start with `npm run worker`; stop with Ctrl+C.
import "dotenv/config";
import { getDb } from "../src/lib/db";
import { getEnv } from "../src/lib/env";
import { handlers } from "./handlers";

const IDLE_DELAY_MS = 2000;
const BASE_BACKOFF_MS = 5000;

let stopping = false;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Claims the oldest runnable job. Returns null if the queue is empty or another worker won. */
async function claimNextJob() {
  const db = getDb();
  const candidate = await db.job.findFirst({
    where: { status: "PENDING", runAfter: { lte: new Date() } },
    orderBy: [{ runAfter: "asc" }, { id: "asc" }],
  });
  if (!candidate) return null;

  // Optimistic claim: only succeeds if the job is still PENDING.
  const { count } = await db.job.updateMany({
    where: { id: candidate.id, status: "PENDING" },
    data: { status: "RUNNING", lockedAt: new Date(), attempts: { increment: 1 } },
  });
  if (count === 0) return null;
  return db.job.findUniqueOrThrow({ where: { id: candidate.id } });
}

async function runOnce(): Promise<boolean> {
  const db = getDb();
  const job = await claimNextJob();
  if (!job) return false;

  const handler = handlers[job.type];
  try {
    if (!handler) throw new Error(`No handler registered for job type "${job.type}"`);
    await handler(job.payload);
    await db.job.update({
      where: { id: job.id },
      data: { status: "SUCCEEDED", lockedAt: null, lastError: null },
    });
    console.log(`[worker] job ${job.id} (${job.type}) succeeded`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const giveUp = job.attempts >= job.maxAttempts;
    await db.job.update({
      where: { id: job.id },
      data: giveUp
        ? { status: "FAILED", lockedAt: null, lastError: message }
        : {
            status: "PENDING",
            lockedAt: null,
            lastError: message,
            runAfter: new Date(Date.now() + BASE_BACKOFF_MS * 2 ** (job.attempts - 1)),
          },
    });
    console.error(
      `[worker] job ${job.id} (${job.type}) ${giveUp ? "failed permanently" : "will retry"}: ${message}`,
    );
  }
  return true;
}

async function main() {
  getEnv(); // fail fast with a clear message if .env is incomplete
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      console.log(`[worker] ${signal} received, finishing current job...`);
      stopping = true;
    });
  }

  console.log("[worker] polling jobs table");
  while (!stopping) {
    try {
      const didWork = await runOnce();
      if (!didWork) await sleep(IDLE_DELAY_MS);
    } catch (err) {
      console.error("[worker] poll error:", err instanceof Error ? err.message : err);
      await sleep(IDLE_DELAY_MS);
    }
  }
  await getDb().$disconnect();
  console.log("[worker] stopped");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
