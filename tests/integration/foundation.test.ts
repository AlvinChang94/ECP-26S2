// What: integration tests for the shared plumbing: Outbox, audit log, counters, file store, clock and due jobs.
// Who calls it: `npm test`.
// To extend: each adapter has one describe block; add cases next to the adapter you change.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeClock, OffsetClock } from "@/adapters/clock";
import { listAuditLog, listEntityTimeline, recordAudit } from "@/services/audit";
import { advanceDemoClock, pinDemoClock } from "@/services/clockControl";
import { nextReference, setLastUsedNumber } from "@/services/counters";
import { readClockOffsetMs } from "@/services/deps";
import { runDueJobs } from "@/services/jobs";
import { listOutbox } from "@/services/outbox";
import { createWorkspace, SAM, type TestWorkspace } from "../helpers/workspace";

let workspace: TestWorkspace;
beforeEach(() => {
  workspace = createWorkspace();
});
afterEach(async () => {
  await workspace.cleanup();
});

describe("Outbox notifier", () => {
  const message = {
    type: "vendor_payment_due" as const,
    channel: "email" as const,
    toName: "Farah Lim",
    toAddress: "farah.lim@spectra.example",
    subject: "Vendor payment due",
    body: "Payment is due.",
    dedupeKey: "vendor-payment:PO-1:3d",
  };

  it("writes a message with the clock's time", async () => {
    const result = await workspace.deps.notifier.send(message);
    expect(result.duplicate).toBe(false);
    const [row] = await listOutbox(workspace.deps);
    expect(row.createdAt.toISOString()).toBe(workspace.clock.now().toISOString());
    expect(row.status).toBe("sent");
  });

  it("never writes the same reminder twice", async () => {
    await workspace.deps.notifier.send(message);
    const second = await workspace.deps.notifier.send(message);
    expect(second.duplicate).toBe(true);
    expect(await listOutbox(workspace.deps)).toHaveLength(1);
  });

  it("keeps a draft as a draft until a person sends it", async () => {
    await workspace.deps.notifier.send({ ...message, dedupeKey: undefined, status: "draft" });
    const [row] = await listOutbox(workspace.deps);
    expect(row.status).toBe("draft");
    expect(row.sentAt).toBeNull();
  });
});

describe("audit log", () => {
  it("records who, when, what, old value, new value and reason", async () => {
    await recordAudit(workspace.deps, {
      actor: SAM,
      action: "field_edit",
      entityType: "document",
      entityId: "doc-1",
      orderNo: "ORD-1",
      field: "lines[0].partNo",
      oldValue: "AB-1234X",
      newValue: "AB1234X",
      reason: "Same part",
      summary: "Sam Tan changed Line 1: Part no.",
    });
    const [event] = await listAuditLog(workspace.deps);
    expect(event).toMatchObject({ actorName: "Sam Tan", actorRole: "sales", field: "lines[0].partNo", oldValue: "AB-1234X", newValue: "AB1234X", reason: "Same part" });
    expect(event.at.toISOString()).toBe(workspace.clock.now().toISOString());
    expect(await listEntityTimeline(workspace.deps, "document", "doc-1")).toHaveLength(1);
  });
});

describe("counters", () => {
  it("hands out running numbers and can be set by the seed", async () => {
    expect(await nextReference(workspace.deps, "order")).toBe("ORD-1001");
    expect(await nextReference(workspace.deps, "order")).toBe("ORD-1002");
    await setLastUsedNumber(workspace.deps, "order", 1041);
    expect(await nextReference(workspace.deps, "order")).toBe("ORD-1042");
    expect(await nextReference(workspace.deps, "spr")).toBe("SPR-0001");
  });
});

describe("file store", () => {
  it("saves and reads back bytes", async () => {
    await workspace.deps.files.put("documents/a.pdf", new Uint8Array([1, 2, 3]));
    expect(await workspace.deps.files.exists("documents/a.pdf")).toBe(true);
    expect([...(await workspace.deps.files.get("documents/a.pdf"))]).toEqual([1, 2, 3]);
    expect(await workspace.deps.files.exists("documents/b.pdf")).toBe(false);
  });

  it("refuses a key that would leave the storage folder", async () => {
    await expect(workspace.deps.files.put("../outside.pdf", new Uint8Array([1]))).rejects.toThrow(/escapes/);
  });
});

describe("clock", () => {
  it("FakeClock only moves when told to", () => {
    const clock = new FakeClock("2026-11-16T01:00:00.000Z");
    clock.advanceHours(24);
    expect(clock.now().toISOString()).toBe("2026-11-17T01:00:00.000Z");
  });

  it("OffsetClock is real time plus the stored offset", () => {
    const hour = 60 * 60 * 1000;
    const difference = new OffsetClock(hour).now().getTime() - Date.now();
    expect(Math.abs(difference - hour)).toBeLessThan(1000);
  });

  it("pins the demo clock and moves it forward, with an audit event", async () => {
    await pinDemoClock(workspace.deps, new Date("2026-11-16T01:00:00.000Z"), new Date("2026-11-16T00:00:00.000Z"));
    expect(await readClockOffsetMs(workspace.deps.db)).toBe(60 * 60 * 1000);
    await advanceDemoClock(workspace.deps, SAM, 24);
    expect(await readClockOffsetMs(workspace.deps.db)).toBe(25 * 60 * 60 * 1000);
    const [event] = await listAuditLog(workspace.deps);
    expect(event.action).toBe("clock_changed");
  });
});

describe("runDueJobs", () => {
  it("does nothing, and says so, when nothing is due", async () => {
    const summary = await runDueJobs(workspace.deps);
    expect(summary.lines).toEqual([]);
  });
});
