// What: runDueJobs(now): does everything that is due at a given time (reminders, escalations, due-date alerts).
// Who calls it: the "Run due jobs" button, the demo clock buttons, the seed and the KPI replay. Nothing runs in the background.
// To extend: add a handler for a new ScheduledJob type to JOB_HANDLERS, or a new sweep to SWEEPS. In AWS, EventBridge Scheduler calls this.
import { SYSTEM_ACTOR } from "@/domain/audit";
import { recordAudit } from "./audit";
import type { Deps } from "./deps";
import { latePayerDraftSweep, vendorPaymentReminderSweep } from "./payments";
import { sprEscalationJob, sprReminderJob } from "./spr";

export type DueJob = { id: string; type: string; entityType: string; entityId: string; payloadJson: string; dueAt: Date };

/** Does the work of one scheduled job and returns a one-line description of what happened. */
export type JobHandler = (deps: Deps, job: DueJob, now: Date) => Promise<string>;

/** Looks for things that have become due (for example a document due date) and returns one line per action taken. */
export type Sweep = (deps: Deps, now: Date) => Promise<string[]>;

/** One handler per ScheduledJob.type. Story 3 schedules the SPR reminders at 24, 48 and 72 hours. */
const JOB_HANDLERS: Record<string, JobHandler> = {
  spr_reminder: sprReminderJob,
  spr_escalation: sprEscalationJob,
};

/** Checks that run on every call. Each must be safe to repeat: the Outbox dedupe key stops double sending. */
const SWEEPS: Sweep[] = [vendorPaymentReminderSweep, latePayerDraftSweep];

export type JobsSummary = { ranAt: Date; lines: string[] };

export async function runDueJobs(deps: Deps, now: Date = deps.clock.now()): Promise<JobsSummary> {
  const lines: string[] = [];

  const due = await deps.db.scheduledJob.findMany({
    where: { status: "pending", dueAt: { lte: now } },
    orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
  });
  for (const job of due) {
    // Read the job again: an earlier job in this same run may have cancelled it (for example after a decision).
    const current = await deps.db.scheduledJob.findUnique({ where: { id: job.id } });
    if (!current || current.status !== "pending") continue;
    const handler = JOB_HANDLERS[current.type];
    if (!handler) {
      lines.push(`Left job ${current.id} alone: no handler for type "${current.type}".`);
      continue;
    }
    lines.push(await handler(deps, current, now));
    await deps.db.scheduledJob.update({ where: { id: current.id }, data: { status: "done", ranAt: now } });
  }

  for (const sweep of SWEEPS) lines.push(...(await sweep(deps, now)));

  if (lines.length > 0) {
    await recordAudit(deps, {
      actor: SYSTEM_ACTOR,
      action: "jobs_run",
      entityType: "system",
      entityId: "jobs",
      summary: `Due jobs ran: ${lines.length} action${lines.length === 1 ? "" : "s"}.`,
      newValue: lines.join("\n"),
    });
  }
  return { ranAt: now, lines };
}
