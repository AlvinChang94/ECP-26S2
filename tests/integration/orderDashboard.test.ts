// What: integration tests for story 6: the order dashboard on the seeded demo scenario (ORD-1042 blocked), search, filter, timeline, ship-date alerts.
// Who calls it: `npm test`.
// To extend: the first block loads the whole demo history once (the same steps `npm run seed` runs) and only reads from it until its last test.
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listOrderTimeline } from "@/services/audit";
import { recordDelivery } from "@/services/fulfilment";
import { confirmDocumentType, ingestDocument } from "@/services/intake";
import { runDueJobs } from "@/services/jobs";
import { getOrderDashboard, getOrderOverview } from "@/services/orderDashboard";
import { listOutbox } from "@/services/outbox";
import { confirmPaid } from "@/services/payments";
import { getShipment, recordResolution } from "@/services/shipments";
import { seedDemoScenario } from "../../scripts/seed-scenario";
import { exportedOrder } from "../helpers/flows";
import { createWorkspace, DATA_DIR, FARAH, PETER, readDataFile, SAM, type TestWorkspace } from "../helpers/workspace";

describe("the seeded demo scenario on the order dashboard", () => {
  let workspace: TestWorkspace;
  beforeAll(async () => {
    workspace = createWorkspace({ navision: "demo" });
    await seedDemoScenario(workspace.deps, workspace.clock, path.join(DATA_DIR, "seed"));
  }, 120_000);
  afterAll(async () => {
    await workspace.cleanup();
  });

  it("shows ORD-1042 as blocked, with its owner, the delay reason and the next action", async () => {
    const overview = await getOrderOverview(workspace.deps, "ORD-1042");
    expect(overview.result).toMatchObject({
      status: "blocked",
      label: "Blocked",
      owner: "Peter Goh",
      nextAction: "Resolve 2 findings on shipment SHP-0004 (PO-8341)",
      shipRisk: "at_risk",
    });
    expect(overview.result.blockerReason).toBe(
      "PC-4402: invoiced 100, packing list 100, received 95: 5 units short. AWB or BL is still missing and is due on 16 Nov 2026, 16:00 (in 7 hours).",
    );
    expect(overview.customerUpdate).toBe("Shipment at risk: 5 units short; AWB or BL pending. Promised ship date: 18 Nov 2026.");
    expect(overview.result.tasks).toEqual([{ title: "Resolve 2 findings on shipment SHP-0004 (PO-8341)", assignee: "Peter Goh", href: "/shipments/SHP-0004" }]);
    expect(overview.order.promisedShipDate).toBe("2026-11-18");
  });

  it("gives every order a status, an owner and a promised ship date, derived from what the other stories recorded", async () => {
    const dashboard = await getOrderDashboard(workspace.deps);
    const byOrder = Object.fromEntries(dashboard.rows.map((row) => [row.order.orderNo, [row.result.status, row.result.owner, row.result.shipRisk]]));
    expect(byOrder).toEqual({
      "ORD-1031": ["shipped", null, "none"],
      "ORD-1032": ["ready_to_ship", "Sam Tan", "on_track"],
      "ORD-1033": ["awaiting_payment", "Farah Lim", "on_track"],
      "ORD-1034": ["awaiting_payment", "Farah Lim", "on_track"],
      "ORD-1035": ["awaiting_payment", "Farah Lim", "on_track"],
      "ORD-1036": ["awaiting_payment", "Farah Lim", "at_risk"],
      "ORD-1037": ["partly_shipped", "Sam Tan", "on_track"],
      "ORD-1038": ["ready_to_ship", "Sam Tan", "on_track"],
      "ORD-1039": ["in_review", "Sam Tan", "none"],
      "ORD-1040": ["waiting_stock", "Janet", "on_track"],
      "ORD-1041": ["cancelled", null, "none"],
      "ORD-1042": ["blocked", "Peter Goh", "at_risk"],
    });
    // The most urgent order is on top; closed orders are at the bottom.
    expect(dashboard.rows[0].order.orderNo).toBe("ORD-1042");
    expect(dashboard.rows.slice(-2).map((row) => row.result.status)).toEqual(["shipped", "cancelled"]);
  });

  it("computes the tiles and the tasks per person from the same data", async () => {
    const dashboard = await getOrderDashboard(workspace.deps);
    expect(dashboard.totalOrders).toBe(12);
    expect(dashboard.tiles).toEqual({ open: 10, blocked: 1, shipDateAtRisk: 2, shipDateLate: 0, awaitingPayment: 4, readyToShip: 3 });
    expect(dashboard.tasksByPerson).toEqual([
      { assignee: "Sam Tan", tasks: 5, orders: 4 },
      { assignee: "Farah Lim", tasks: 4, orders: 4 },
      { assignee: "Janet", tasks: 1, orders: 1 },
      { assignee: "Peter Goh", tasks: 1, orders: 1 },
    ]);
    // Tiles always count every order, whatever the filter.
    expect((await getOrderDashboard(workspace.deps, { status: "blocked" })).tiles).toEqual(dashboard.tiles);
  });

  it.each([
    ["by customer name, any case", { search: "beacon" }, ["ORD-1042"]],
    ["by order number", { search: "ORD-1036" }, ["ORD-1036"]],
    ["by the customer's PO number", { search: "lt-po" }, ["ORD-1040", "ORD-1031"]],
    ["by PI number", { search: "PI-1034" }, ["ORD-1034"]],
    ["by status", { status: "awaiting_payment" }, ["ORD-1036", "ORD-1033", "ORD-1034", "ORD-1035"]],
    ["ship date at risk or passed", { status: "risk" }, ["ORD-1042", "ORD-1036"]],
    ["search and status together", { search: "lanka", status: "open" }, ["ORD-1040"]],
    ["nothing matches", { search: "no such customer" }, []],
  ])("search and filter: %s", async (_name, filter, expected) => {
    const dashboard = await getOrderDashboard(workspace.deps, filter);
    expect(dashboard.rows.map((row) => row.order.orderNo)).toEqual(expected);
  });

  it("builds the order's timeline from the audit events of every story", async () => {
    const actions = new Set((await listOrderTimeline(workspace.deps, "ORD-1042")).map((entry) => entry.action));
    for (const action of ["document_received", "type_confirmed", "order_created", "export_approved", "spr_created", "spr_approved", "proof_matched", "payment_confirmed", "shipment_created", "shipment_checked", "shipment_assigned", "due_date_alert", "ship_date_alert"]) {
      expect(actions, action).toContain(action);
    }
  });

  it("has no data entry of its own: looking at the dashboard writes nothing", async () => {
    const counts = async () => [
      await workspace.deps.db.auditEvent.count(),
      await workspace.deps.db.outboxMessage.count(),
      await workspace.deps.db.flagDecision.count(),
      await workspace.deps.db.shipment.count(),
      JSON.stringify(await workspace.deps.db.order.findMany({ orderBy: { orderNo: "asc" } })),
    ];
    const before = await counts();
    await getOrderDashboard(workspace.deps, { search: "a", status: "open" });
    await getOrderOverview(workspace.deps, "ORD-1042");
    expect(await counts()).toEqual(before);
  });

  it("raised a ship-date alert for the blocked order before its promised ship date", async () => {
    const alerts = await listOutbox(workspace.deps, { type: "ship_date_alert", orderNo: "ORD-1042" });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ toName: "Peter Goh", subject: "ORD-1042 may miss its promised ship date (18 Nov 2026)" });
    expect(alerts[0].createdAt.getTime()).toBeLessThan(new Date("2026-11-18T00:00:00.000Z").getTime());
  });

  // This test changes the workspace, so it stays last in this block.
  it("moves ORD-1042 on once people deal with the findings: the status follows, nobody sets it", async () => {
    const shipment = await getShipment(workspace.deps, "SHP-0004");
    const variance = shipment.flags.find((flag) => flag.code === "QTY_VARIANCE");
    await recordResolution(workspace.deps, PETER, { shipmentNo: "SHP-0004", fingerprint: variance?.fingerprint as string, reason: "Vendor ships the 5 missing units next week" });
    let overview = await getOrderOverview(workspace.deps, "ORD-1042");
    expect(overview.result).toMatchObject({ status: "blocked", nextAction: "Resolve 1 finding on shipment SHP-0004 (PO-8341)" });
    expect(overview.customerUpdate).toBe("Shipment at risk: AWB or BL pending. Promised ship date: 18 Nov 2026.");

    // The AWB arrives (it is waiting in the demo Inbox) and Peter confirms its type.
    const fileName = "awb-pacific-components-po-8341.pdf";
    const { documentId } = await ingestDocument(workspace.deps, PETER, { bytes: readDataFile(`inbox/${fileName}`), fileName, channel: "email", sender: null });
    await confirmDocumentType(workspace.deps, PETER, documentId, "awb_bl");
    overview = await getOrderOverview(workspace.deps, "ORD-1042");
    expect(overview.result).toMatchObject({ status: "ready_to_ship", owner: "Sam Tan", blockerReason: null, shipRisk: "on_track" });
    expect(overview.customerUpdate).toBe("Payment received. Your order is being prepared for shipment. Promised ship date: 18 Nov 2026.");

    await recordDelivery(workspace.deps, SAM, { orderNo: "ORD-1042", partNo: "PC-4402", quantity: 100, note: null });
    expect((await getOrderOverview(workspace.deps, "ORD-1042")).result).toMatchObject({ status: "shipped", owner: null, tasks: [] });
  });
});

describe("ship-date alerts", () => {
  let workspace: TestWorkspace;
  beforeEach(() => {
    workspace = createWorkspace();
  });
  afterEach(async () => {
    await workspace.cleanup();
  });
  const alertLines = async (): Promise<string[]> => (await runDueJobs(workspace.deps)).lines.filter((line) => line.includes("ship-date alert"));

  it("alerts the person who has to act, once, when an order is still not ready two days before its promised ship date", async () => {
    const orderNo = await exportedOrder(workspace.deps); // promised ship date 23 Nov 2026, not paid
    expect(await alertLines()).toEqual([]); // a week before
    workspace.clock.set(new Date("2026-11-20T15:59:00.000Z")); // one minute before the window opens (21 Nov, 00:00 Singapore time)
    expect(await alertLines()).toEqual([]);
    workspace.clock.set(new Date("2026-11-20T16:00:00.000Z"));
    expect(await alertLines()).toEqual([`${orderNo}: ship-date alert sent to Farah Lim (Awaiting payment, promised 2026-11-23).`]);
    workspace.clock.advanceHours(24 * 5);
    expect(await alertLines()).toEqual([]); // never twice, not even after the date has passed

    const [alert] = await listOutbox(workspace.deps, { type: "ship_date_alert" });
    expect(alert).toMatchObject({ toName: "Farah Lim", orderNo, status: "sent" });
    expect(alert.body).toContain("Reason: Payment for PI-1001 has not arrived (4 days waiting).");
    expect(alert.body).toContain("Next action: Wait for the customer's payment for PI-1001");
    expect(await workspace.deps.db.auditEvent.count({ where: { action: "ship_date_alert", orderNo } })).toBe(1);
  });

  it("does not alert while the order is ready to ship, but does once the promised date has passed", async () => {
    const orderNo = await exportedOrder(workspace.deps);
    await confirmPaid(workspace.deps, FARAH, { orderNo, reason: "Seen on the bank statement of 16 Nov" });
    workspace.clock.set(new Date("2026-11-22T02:00:00.000Z")); // the day before, ready to ship
    expect(await alertLines()).toEqual([]);
    workspace.clock.set(new Date("2026-11-23T16:00:00.000Z")); // the promised day has just ended
    expect(await alertLines()).toEqual([`${orderNo}: ship-date alert sent to Sam Tan (Ready to ship, promised 2026-11-23).`]);
    expect((await getOrderOverview(workspace.deps, orderNo)).result.shipRisk).toBe("late");
  });

  it("never alerts for an order that shipped in full or was never given a ship date", async () => {
    const orderNo = await exportedOrder(workspace.deps);
    await confirmPaid(workspace.deps, FARAH, { orderNo, reason: "Seen on the bank statement of 16 Nov" });
    const overview = await getOrderOverview(workspace.deps, orderNo);
    expect(overview.state.fulfilment?.totalOrdered).toBeGreaterThan(0);
    const exported = await workspace.deps.db.poVersion.findFirstOrThrow({ where: { orderNo, status: "exported" } });
    for (const line of (JSON.parse(exported.exportJson as string) as { lines: { itemNo: string; quantity: number }[] }).lines) {
      await recordDelivery(workspace.deps, SAM, { orderNo, partNo: line.itemNo, quantity: line.quantity, note: null });
    }
    // A second PO is captured but left in review: it has no promised ship date yet.
    const { documentId } = await ingestDocument(workspace.deps, SAM, { bytes: readDataFile("golden/files/po-clean-b.pdf"), fileName: "po-clean-b.pdf", channel: "email", sender: null });
    await confirmDocumentType(workspace.deps, SAM, documentId, "customer_po");

    workspace.clock.advanceHours(24 * 30);
    expect(await alertLines()).toEqual([]);
    expect(await listOutbox(workspace.deps, { type: "ship_date_alert" })).toEqual([]);
  });
});
