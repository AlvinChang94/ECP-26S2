// What: moves the demo clock (real time plus a stored offset) and reports the simulated time.
// Who calls it: the demo buttons in the top bar, and scripts/seed.ts when it pins the scenario's start time.
// To extend: nothing in production uses this; in AWS the clock is real time and EventBridge triggers the jobs.
import type { Actor } from "@/domain/audit";
import { formatDateTime } from "@/domain/time";
import { recordAudit } from "./audit";
import { CLOCK_OFFSET_SETTING, type Deps, readClockOffsetMs } from "./deps";

const HOUR_MS = 60 * 60 * 1000;

/** Moves the simulated time forward by a number of hours and records who did it. */
export async function advanceDemoClock(deps: Pick<Deps, "db" | "clock">, actor: Actor, hours: number): Promise<Date> {
  const offset = (await readClockOffsetMs(deps.db)) + hours * HOUR_MS;
  await deps.db.appSetting.upsert({
    where: { key: CLOCK_OFFSET_SETTING },
    create: { key: CLOCK_OFFSET_SETTING, value: String(offset) },
    update: { value: String(offset) },
  });
  const newNow = new Date(deps.clock.now().getTime() + hours * HOUR_MS);
  await recordAudit(deps, {
    actor,
    action: "clock_changed",
    entityType: "system",
    entityId: "demo-clock",
    summary: `${actor.name} moved the demo clock forward ${hours} hour${hours === 1 ? "" : "s"} to ${formatDateTime(newNow)}.`,
  });
  return newNow;
}

/** Sets the simulated "now" to an exact moment (used once, at the end of the seed). */
export async function pinDemoClock(deps: Pick<Deps, "db">, simulatedNow: Date, realNow: Date = new Date()): Promise<void> {
  const offset = simulatedNow.getTime() - realNow.getTime();
  await deps.db.appSetting.upsert({
    where: { key: CLOCK_OFFSET_SETTING },
    create: { key: CLOCK_OFFSET_SETTING, value: String(offset) },
    update: { value: String(offset) },
  });
}
