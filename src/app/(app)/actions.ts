// What: server actions for the demo tools in the top bar (move the simulated clock, run due jobs).
// Who calls it: the small forms in src/app/(app)/layout.tsx.
// To extend: these are demo tools. In AWS, time is real and EventBridge Scheduler triggers runDueJobs.
"use server";

import { refresh } from "next/cache";
import { formNumber, runAction } from "@/app/_lib/forms";
import { actorOf, requirePersona } from "@/app/_lib/session";
import { advanceDemoClock } from "@/services/clockControl";
import { getDeps } from "@/services/deps";
import { runDueJobs } from "@/services/jobs";

/** Moves the simulated time forward, then runs whatever became due. Stays on the current page. */
export async function advanceClockAction(formData: FormData): Promise<void> {
  const persona = await requirePersona();
  const hours = formNumber(formData, "hours") ?? 1;
  await advanceDemoClock(await getDeps(), actorOf(persona), hours);
  // getDeps() again: it builds a clock with the new offset.
  await runDueJobs(await getDeps());
  refresh();
}

/** Runs due jobs now and shows the result on the Outbox page. */
export async function runJobsAction(): Promise<void> {
  await requirePersona();
  await runAction("/outbox", async () => {
    const summary = await runDueJobs(await getDeps());
    return {
      notice:
        summary.lines.length === 0
          ? "Due jobs ran: nothing was due."
          : `Due jobs ran: ${summary.lines.length} action${summary.lines.length === 1 ? "" : "s"}. ${summary.lines.join(" ")}`,
    };
  });
}
