// What: integration tests for story 3: SPR from a part number, approval by link, reminders at 24, 48 and 72 hours, stand-in.
// Who calls it: `npm test`.
// To extend: time only moves when the test moves the fake clock, then runDueJobs() does what is due, exactly as the demo clock does.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "@/adapters/config";
import { buildDeps } from "@/services/deps";
import { runDueJobs } from "@/services/jobs";
import { listOutbox } from "@/services/outbox";
import { createSpr, decideSpr, getSpr, latestApprovalTokenFromOutbox, listSprJobs, listSuggestedSprs, lookupPart, openApprovalLink, parseEvidence, resendApprovalLink, submitSpr } from "@/services/spr";
import { captureCustomerPo } from "../helpers/flows";
import { createWorkspace, PRIYA, PROJECT_ROOT, SAM, type TestWorkspace } from "../helpers/workspace";

let workspace: TestWorkspace;
beforeEach(() => {
  workspace = createWorkspace();
});
afterEach(async () => {
  await workspace.cleanup();
});

async function submitted(partNo = "AB1234X", quantity = 40): Promise<string> {
  const sprNo = await createSpr(workspace.deps, PRIYA, { partNo, quantity, reason: "Short on an open order" });
  await submitSpr(workspace.deps, PRIYA, sprNo);
  return sprNo;
}

async function messageTypes(sprNo: string): Promise<string[]> {
  return (await listOutbox(workspace.deps, { entityType: "spr", entityId: sprNo })).reverse().map((message) => `${message.type} -> ${message.toName}`);
}

/** Puts Janet on planned leave around the given dates by editing the staff file, as someone would in mock Navision. */
function setJanetLeave(from: string, to: string): void {
  const staffPath = path.join(workspace.navisionDir, "staff.json");
  const staff = JSON.parse(readFileSync(staffPath, "utf8"));
  staff.plannedLeave = [{ staffId: "janet", from, to }];
  writeFileSync(staffPath, JSON.stringify(staff));
}

describe("creating an SPR from a part number", () => {
  it("fills vendor and price from Navision and nothing else", async () => {
    const part = await lookupPart(workspace.deps, "AB1234X");
    expect(part).toMatchObject({ stockQty: 160, vendor: { name: "Alpha Supply" } });

    const sprNo = await createSpr(workspace.deps, PRIYA, { partNo: " AB1234X ", quantity: 40, reason: "Short by 40 on an open order" });
    const spr = await getSpr(workspace.deps, sprNo);
    expect(spr).toMatchObject({
      sprNo: "SPR-0001",
      status: "Draft",
      partNo: "AB1234X",
      vendorId: "V001",
      vendorName: "Alpha Supply",
      unitPrice: "10.10", // the purchase price, not the sales price of 12.40
      currency: "USD",
      quantity: 40,
      reason: "Short by 40 on an open order",
      requestedBy: "Priya Nair",
      sellPrice: null, // SHOW_MARGIN is off by default
    });
  });

  it("refuses a part that is not in Navision instead of guessing", async () => {
    expect(await lookupPart(workspace.deps, "AB-1234X")).toBeNull();
    await expect(createSpr(workspace.deps, PRIYA, { partNo: "AB-1234X", quantity: 40, reason: "Short on an order" })).rejects.toThrow(/not in Navision/);
    expect(await workspace.deps.db.spr.count()).toBe(0);
  });

  it("needs a quantity and a reason typed by the product manager", async () => {
    await expect(createSpr(workspace.deps, PRIYA, { partNo: "AB1234X", quantity: null, reason: "x" })).rejects.toThrow(/whole number above zero/);
    await expect(createSpr(workspace.deps, PRIYA, { partNo: "AB1234X", quantity: 5, reason: "" })).rejects.toThrow(/reason/);
  });

  it("can only be raised by a product manager", async () => {
    await expect(createSpr(workspace.deps, SAM, { partNo: "AB1234X", quantity: 5, reason: "Restock" })).rejects.toThrow(/Only a product manager/);
  });

  it("keeps sell price and margin only when SHOW_MARGIN is on", async () => {
    const config = loadConfig({ ...process.env, DATABASE_URL: workspace.deps.config.databaseUrl, NAVISION_DIR: workspace.navisionDir, SHOW_MARGIN: "true" }, PROJECT_ROOT);
    const withMargin = buildDeps(config, workspace.clock, { db: workspace.deps.db });
    const sprNo = await createSpr(withMargin, PRIYA, { partNo: "AB1234X", quantity: 40, reason: "Short on an order" });
    expect((await getSpr(workspace.deps, sprNo)).sellPrice).toBe("12.40");
  });
});

describe("submitting", () => {
  it("goes to Janet with a signed link in the Outbox and reminders planned at 24, 48 and 72 hours", async () => {
    const sprNo = await submitted();
    const spr = await getSpr(workspace.deps, sprNo);
    expect(spr).toMatchObject({ status: "Submitted", assignedTo: "Janet", routingNote: null });

    const [message] = await listOutbox(workspace.deps, { entityType: "spr", entityId: sprNo });
    expect(message).toMatchObject({ type: "spr_approval_request", toName: "Janet", toAddress: "janet@spectra.example" });
    expect(message.body).toMatch(/http:\/\/localhost:3000\/approve\/[A-Za-z0-9_\-.]+/);
    expect(message.body).toContain("Stock on hand: 160");

    const jobs = await listSprJobs(workspace.deps, sprNo);
    const start = workspace.clock.now().getTime();
    expect(jobs.map((job) => [job.type, (job.dueAt.getTime() - start) / 3_600_000, job.status])).toEqual([
      ["spr_reminder", 24, "pending"],
      ["spr_reminder", 48, "pending"],
      ["spr_escalation", 72, "pending"],
    ]);
  });

  it("captures the evidence the approver will see, including the customer PO behind the request", async () => {
    const { orderNo } = await captureCustomerPo(workspace.deps, "golden/files/po-qty-above-stock.pdf"); // 200 x AB1234X, 160 in stock
    const sprNo = await createSpr(workspace.deps, PRIYA, { partNo: "AB1234X", quantity: 40, reason: "Short by 40", sourceOrderNo: orderNo });
    await submitSpr(workspace.deps, PRIYA, sprNo);
    const evidence = parseEvidence(await getSpr(workspace.deps, sprNo));
    expect(evidence).toMatchObject({ stockQty: 160, lastPurchasePrice: "10.10", demandQty: 200 });
    expect(evidence?.openOrders).toEqual([{ orderRef: orderNo, customerName: "Alpine Manufacturing", quantity: 200 }]);
    expect(evidence?.sourceOrder?.lines).toEqual([{ partNo: "AB1234X", quantity: "200", unitPrice: "12.40" }]);
  });

  it("goes to the stand-in straight away when Janet is on planned leave", async () => {
    setJanetLeave("2026-11-10", "2026-11-20"); // covers the test's "now" (16 Nov)
    const sprNo = await submitted();
    const spr = await getSpr(workspace.deps, sprNo);
    expect(spr.assignedTo).toBe("Marcus Lee");
    expect(spr.routingNote).toContain("Janet is on planned leave");
    expect(await messageTypes(sprNo)).toEqual(["spr_approval_request -> Marcus Lee"]);
  });

  it("cannot be submitted twice", async () => {
    const sprNo = await submitted();
    await expect(submitSpr(workspace.deps, PRIYA, sprNo)).rejects.toThrow(/cannot be submitted/);
  });
});

describe("reminders and the stand-in", () => {
  it("reminds at 24 and 48 hours and hands over to the stand-in at 72 hours", async () => {
    const sprNo = await submitted();

    workspace.clock.advanceHours(23);
    expect((await runDueJobs(workspace.deps)).lines).toEqual([]);

    workspace.clock.advanceHours(1); // 24 hours
    expect((await runDueJobs(workspace.deps)).lines).toEqual([`${sprNo}: 24-hour reminder sent to Janet.`]);

    workspace.clock.advanceHours(24); // 48 hours
    expect((await runDueJobs(workspace.deps)).lines).toEqual([`${sprNo}: 48-hour reminder sent to Janet.`]);
    expect((await getSpr(workspace.deps, sprNo)).assignedTo).toBe("Janet");

    workspace.clock.advanceHours(24); // 72 hours
    expect((await runDueJobs(workspace.deps)).lines).toEqual([`${sprNo}: handed to the stand-in Marcus Lee after 72 hours.`]);
    const spr = await getSpr(workspace.deps, sprNo);
    expect(spr.assignedTo).toBe("Marcus Lee");
    expect(spr.escalatedAt?.toISOString()).toBe(workspace.clock.now().toISOString());
    expect(spr.routingNote).toContain("No decision from Janet after 72 hours");

    expect(await messageTypes(sprNo)).toEqual([
      "spr_approval_request -> Janet",
      "spr_reminder -> Janet",
      "spr_reminder -> Janet",
      "spr_escalation -> Marcus Lee",
    ]);
    // Running the jobs again sends nothing twice.
    expect((await runDueJobs(workspace.deps)).lines).toEqual([]);
  });

  it("catches up when jobs run late: everything that became due is done, in order", async () => {
    const sprNo = await submitted();
    workspace.clock.advanceHours(80);
    const lines = (await runDueJobs(workspace.deps)).lines;
    expect(lines).toEqual([
      `${sprNo}: 24-hour reminder sent to Janet.`,
      `${sprNo}: 48-hour reminder sent to Janet.`,
      `${sprNo}: handed to the stand-in Marcus Lee after 72 hours.`,
    ]);
  });

  it("moves a waiting SPR to the stand-in at the next reminder when Janet has gone on leave meanwhile", async () => {
    const sprNo = await submitted();
    setJanetLeave("2026-11-17", "2026-11-25");
    workspace.clock.advanceHours(24);
    await runDueJobs(workspace.deps);
    expect((await getSpr(workspace.deps, sprNo)).assignedTo).toBe("Marcus Lee");
    expect((await messageTypes(sprNo)).at(-1)).toBe("spr_reminder -> Marcus Lee");
  });

  it("lets the stand-in decide after the hand-over", async () => {
    const sprNo = await submitted();
    workspace.clock.advanceHours(72);
    await runDueJobs(workspace.deps);
    const token = await latestApprovalTokenFromOutbox(workspace.deps, sprNo);
    const spr = await decideSpr(workspace.deps, token as string, { decision: "approve", remarks: "Approved as stand-in" });
    expect(spr).toMatchObject({ status: "Approved", decidedBy: "Marcus Lee" });
  });
});

describe("deciding through the link", () => {
  it("shows the evidence without using the link up, then records an approval", async () => {
    const sprNo = await submitted();
    const token = (await latestApprovalTokenFromOutbox(workspace.deps, sprNo)) as string;

    const view = await openApprovalLink(workspace.deps, token);
    expect(view.state).toBe("open");
    if (view.state === "open") {
      expect(view.recipient).toBe("Janet");
      expect(view.evidence?.stockQty).toBe(160);
    }
    expect((await openApprovalLink(workspace.deps, token)).state).toBe("open"); // looking twice is fine

    workspace.clock.advanceHours(5);
    const spr = await decideSpr(workspace.deps, token, { decision: "approve", remarks: "Go ahead" });
    expect(spr).toMatchObject({ status: "Approved", decidedBy: "Janet", decisionRemarks: "Go ahead" });
    expect(spr.decidedAt?.toISOString()).toBe(workspace.clock.now().toISOString());

    // The product manager is told, and nothing was ordered automatically.
    const messages = await listOutbox(workspace.deps, { entityType: "spr", entityId: sprNo });
    expect(messages[0]).toMatchObject({ type: "spr_decision", toName: "Priya Nair" });
    expect(messages[0].body).toContain("Nothing has been sent to the vendor or to Navision automatically");
  });

  it("needs remarks to reject", async () => {
    const sprNo = await submitted();
    const token = (await latestApprovalTokenFromOutbox(workspace.deps, sprNo)) as string;
    await expect(decideSpr(workspace.deps, token, { decision: "reject", remarks: "" })).rejects.toThrow(/reason when rejecting/);
    const spr = await decideSpr(workspace.deps, token, { decision: "reject", remarks: "Too much stock already" });
    expect(spr).toMatchObject({ status: "Rejected", decisionRemarks: "Too much stock already" });
  });

  it("sends a fresh link on request while the SPR is waiting", async () => {
    const sprNo = await submitted();
    const first = await latestApprovalTokenFromOutbox(workspace.deps, sprNo);
    await resendApprovalLink(workspace.deps, PRIYA, sprNo);
    const second = await latestApprovalTokenFromOutbox(workspace.deps, sprNo);
    expect(second).not.toBe(first);
    expect((await openApprovalLink(workspace.deps, second as string)).state).toBe("open");
  });
});

describe("suggested SPRs", () => {
  it("lists a part once an open customer PO needs more than the stock, and shows what was already requested", async () => {
    expect(await listSuggestedSprs(workspace.deps)).toEqual([]);
    const { orderNo } = await captureCustomerPo(workspace.deps, "golden/files/po-qty-above-stock.pdf");

    let [suggestion] = await listSuggestedSprs(workspace.deps);
    expect(suggestion).toMatchObject({ partNo: "AB1234X", demandQty: 200, stockQty: 160, shortBy: 40, toRequest: 40 });
    expect(suggestion.orders).toEqual([{ orderRef: orderNo, customerName: "Alpine Manufacturing", quantity: 200 }]);

    await createSpr(workspace.deps, PRIYA, { partNo: "AB1234X", quantity: 40, reason: "Short by 40", sourceOrderNo: orderNo });
    [suggestion] = await listSuggestedSprs(workspace.deps);
    expect(suggestion).toMatchObject({ alreadyRequested: 40, toRequest: 0 });
  });
});
