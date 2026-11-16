// INVARIANT: reminders stop once Janet decides.
// What: an SPR is decided at different moments; afterwards time runs on for days and no further reminder or hand-over may appear.
// Who calls it: `npm test`.
// To extend: any new job that concerns an SPR must be cancelled by decideSpr() and gets a case here.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runDueJobs } from "@/services/jobs";
import { listOutbox } from "@/services/outbox";
import { createSpr, decideSpr, getSpr, latestApprovalTokenFromOutbox, listSprJobs, submitSpr } from "@/services/spr";
import { createWorkspace, PRIYA, type TestWorkspace } from "../helpers/workspace";

let workspace: TestWorkspace;
beforeEach(() => {
  workspace = createWorkspace();
});
afterEach(async () => {
  await workspace.cleanup();
});

async function submitted(): Promise<string> {
  const sprNo = await createSpr(workspace.deps, PRIYA, { partNo: "AB1234X", quantity: 40, reason: "Short on an open order" });
  await submitSpr(workspace.deps, PRIYA, sprNo);
  return sprNo;
}

async function reminderCount(sprNo: string): Promise<number> {
  const messages = await listOutbox(workspace.deps, { entityType: "spr", entityId: sprNo });
  return messages.filter((message) => message.type === "spr_reminder" || message.type === "spr_escalation").length;
}

/** Lets a full week pass, running the due jobs every six hours as a schedule would. */
async function letAWeekPass(): Promise<string[]> {
  const lines: string[] = [];
  for (let step = 0; step < 28; step++) {
    workspace.clock.advanceHours(6);
    lines.push(...(await runDueJobs(workspace.deps)).lines);
  }
  return lines;
}

describe("INVARIANT: reminders stop once the SPR is decided", () => {
  it.each([
    ["approved before any reminder", 2, "approve" as const, 0],
    ["rejected before any reminder", 2, "reject" as const, 0],
    ["approved after the 24-hour reminder", 30, "approve" as const, 1],
    ["approved after the 48-hour reminder", 50, "approve" as const, 2],
    ["approved by the stand-in after the 72-hour hand-over", 75, "approve" as const, 3],
  ])("%s", async (_name, decideAfterHours, decision, remindersBefore) => {
    const sprNo = await submitted();
    // Time passes, with due jobs running, until the moment of the decision.
    for (let hour = 6; hour <= decideAfterHours; hour += 6) {
      workspace.clock.advanceHours(6);
      await runDueJobs(workspace.deps);
    }
    workspace.clock.advanceHours(decideAfterHours % 6);
    await runDueJobs(workspace.deps);
    expect(await reminderCount(sprNo)).toBe(remindersBefore);

    const token = (await latestApprovalTokenFromOutbox(workspace.deps, sprNo)) as string;
    await decideSpr(workspace.deps, token, { decision, remarks: "Decided in the test" });

    // Every job that had not run is cancelled at the moment of the decision...
    const jobs = await listSprJobs(workspace.deps, sprNo);
    expect(jobs.filter((job) => job.status === "pending")).toEqual([]);
    expect(jobs.filter((job) => job.status === "cancelled")).toHaveLength(3 - remindersBefore);

    // ...and however long we wait, nothing more is sent.
    const lines = await letAWeekPass();
    expect(lines).toEqual([]);
    expect(await reminderCount(sprNo)).toBe(remindersBefore);
    expect((await getSpr(workspace.deps, sprNo)).status).toBe(decision === "approve" ? "Approved" : "Rejected");
  });

  it("keeps reminding an undecided SPR while a decided one stays silent", async () => {
    const decided = await submitted();
    const waiting = await submitted();
    const token = (await latestApprovalTokenFromOutbox(workspace.deps, decided)) as string;
    await decideSpr(workspace.deps, token, { decision: "approve", remarks: "" });

    const lines = await letAWeekPass();
    expect(lines.filter((line) => line.startsWith(decided))).toEqual([]);
    expect(lines.filter((line) => line.startsWith(waiting))).toHaveLength(3);
  });
});
