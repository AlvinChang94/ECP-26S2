// What: unit tests for the order dashboard rule: status, owner, delay reason, next action, ship-date risk, tasks, customer update, tiles.
// Who calls it: `npm test`.
// To extend: add a row to the status table for every new status, and say which facts lead to it.
import { describe, expect, it } from "vitest";
import { customerUpdate, deriveOrderStatus, type OrderFlag, type OrderState, summarizeOrders } from "./status";

const NOW = new Date("2026-11-16T01:00:00.000Z"); // Monday 16 Nov 2026, 09:00 Singapore time

/** An exported, paid order with nothing holding it up, promised to ship on 27 Nov. Each test changes only what it is about. */
function order(changes: Partial<OrderState> = {}): OrderState {
  return {
    orderNo: "ORD-1042",
    poNumber: "BD-PO-5521",
    customerName: "Beacon Devices",
    cancelled: false,
    exported: true,
    pendingChange: null,
    promisedShipDate: "2026-11-27",
    paymentTerms: "advance",
    piNumber: "PI-1042",
    payment: "paid",
    daysWaitingForPayment: null,
    paymentLate: false,
    fulfilment: { state: "none", totalOrdered: 100, totalDelivered: 0 },
    sprs: [],
    shipments: [],
    people: { sales: "Sam Tan", finance: "Farah Lim", purchase: "Peter Goh" },
    ...changes,
  };
}

const shortReceipt: OrderFlag = {
  code: "QTY_VARIANCE",
  severity: "blocking",
  field: "PC-4402",
  reason: "PC-4402: invoiced 100, packing list 100, received 95: 5 units short.",
  data: { partNo: "PC-4402", difference: "-5" },
  source: "shipment",
  sourceRef: "SHP-0004",
  decided: false,
};
const awbDue: OrderFlag = {
  code: "DOCUMENT_DUE_SOON",
  severity: "blocking",
  field: "awb_bl",
  reason: "AWB or BL is still missing and is due on 16 Nov 2026, 16:00 (in 7 hours).",
  source: "shipment",
  sourceRef: "SHP-0004",
  decided: false,
};
const priceFinding: OrderFlag = { code: "PRICE_MISMATCH", severity: "blocking", field: "lines[0].unitPrice", reason: "Line 1: the PO unit price 11.90 differs from the Navision price 12.40.", source: "po", sourceRef: "ORD-1042", decided: false };
const partFinding: OrderFlag = { code: "PART_NOT_FOUND", severity: "blocking", field: "lines[1].partNo", reason: "Line 2: part number ZZ-1 is not in Navision.", source: "po", sourceRef: "ORD-1042", decided: false };

const blockedShipment = { shipmentNo: "SHP-0004", reference: "PO-8341", direction: "inbound" as const, status: "needs_review" as const, assigneeName: "Peter Goh", goodsReceived: true };

describe("deriveOrderStatus: status, owner and next action", () => {
  it.each([
    // name, state, flags, expected status, owner, next action
    ["cancelled", order({ cancelled: true }), [], "cancelled", null, "None: the order was cancelled."],
    ["every unit delivered", order({ fulfilment: { state: "complete", totalOrdered: 100, totalDelivered: 100 } }), [], "shipped", null, "None: every unit has been delivered."],
    ["a new PO with nothing to fix and no ship date", order({ exported: false, promisedShipDate: null, payment: "not_invoiced", fulfilment: null }), [], "in_review", "Sam Tan", "Set the promised ship date and approve the export preview"],
    ["a new PO with nothing to fix and a ship date", order({ exported: false, payment: "not_invoiced", fulfilment: null }), [], "in_review", "Sam Tan", "Approve the export preview"],
    ["a new PO with two findings", order({ exported: false, payment: "not_invoiced", fulfilment: null }), [priceFinding, partFinding], "in_review", "Sam Tan", "Fix or override 2 findings on the customer PO"],
    ["an amendment waiting on an exported order", order({ pendingChange: "amendment" }), [], "blocked", "Sam Tan", "Review the customer's amended PO"],
    ["a cancellation waiting on an exported order", order({ pendingChange: "cancellation" }), [], "blocked", "Sam Tan", "Review the customer's cancellation"],
    ["a shipment with open findings", order({ shipments: [blockedShipment] }), [shortReceipt, awbDue], "blocked", "Peter Goh", "Resolve 2 findings on shipment SHP-0004 (PO-8341)"],
    ["payment not arrived", order({ payment: "awaiting", daysWaitingForPayment: 3 }), [], "awaiting_payment", "Farah Lim", "Wait for the customer's payment for PI-1042"],
    ["payment late", order({ payment: "awaiting", daysWaitingForPayment: 9, paymentLate: true }), [], "awaiting_payment", "Farah Lim", "Review and send the payment reminder for PI-1042"],
    ["proof received, not confirmed", order({ payment: "proof_received", daysWaitingForPayment: 2 }), [], "awaiting_payment", "Farah Lim", "Check the bank and confirm the payment for PI-1042"],
    ["an SPR waiting for Janet", order({ sprs: [{ sprNo: "SPR-0004", status: "Submitted", assignedTo: "Janet", partNo: "EF-9", quantity: 15 }] }), [], "waiting_stock", "Janet", "Approve or reject SPR-0004 (15 x EF-9)"],
    ["an SPR handed to the stand-in", order({ sprs: [{ sprNo: "SPR-0004", status: "Submitted", assignedTo: "Marcus Lee", partNo: "EF-9", quantity: 15 }] }), [], "waiting_stock", "Marcus Lee", "Approve or reject SPR-0004 (15 x EF-9)"],
    ["goods bought for the order not received yet", order({ shipments: [{ ...blockedShipment, status: "waiting", assigneeName: null, goodsReceived: false }] }), [], "waiting_stock", "Peter Goh", "Follow up the incoming shipment SHP-0004 (PO-8341)"],
    ["an approved or rejected SPR no longer holds the order", order({ sprs: [{ sprNo: "SPR-0001", status: "Approved", assignedTo: "Janet", partNo: "PC-4402", quantity: 100 }] }), [], "ready_to_ship", "Sam Tan", "Warehouse packs and ships; record the delivery on the order page"],
    ["partly delivered", order({ fulfilment: { state: "partial", totalOrdered: 420, totalDelivered: 395 } }), [], "partly_shipped", "Sam Tan", "Ship the remaining 25 units and record the delivery"],
    ["paid and nothing open", order(), [], "ready_to_ship", "Sam Tan", "Warehouse packs and ships; record the delivery on the order page"],
    ["credit terms need no payment before shipping", order({ paymentTerms: "credit", payment: "awaiting" }), [], "ready_to_ship", "Sam Tan", "Warehouse packs and ships; record the delivery on the order page"],
  ] as const)("%s", (_name, state, flags, status, owner, nextAction) => {
    const result = deriveOrderStatus(state, [...flags], NOW);
    expect(result.status).toBe(status);
    expect(result.owner).toBe(owner);
    expect(result.nextAction).toBe(nextAction);
  });

  it("ranks what holds an order up: blocked before payment, payment before stock", () => {
    const everything = order({
      payment: "awaiting",
      daysWaitingForPayment: 4,
      shipments: [blockedShipment],
      sprs: [{ sprNo: "SPR-0004", status: "Submitted", assignedTo: "Janet", partNo: "EF-9", quantity: 15 }],
    });
    const result = deriveOrderStatus(everything, [shortReceipt], NOW);
    expect(result.status).toBe("blocked");
    // Every open piece of work is still listed as a task with its assignee, the most urgent first.
    expect(result.tasks.map((task) => task.assignee)).toEqual(["Peter Goh", "Farah Lim", "Janet"]);
    expect(deriveOrderStatus({ ...everything, shipments: [] }, [], NOW).status).toBe("awaiting_payment");
    expect(deriveOrderStatus({ ...everything, shipments: [], payment: "paid" }, [], NOW).status).toBe("waiting_stock");
  });

  it("a shipment nobody is assigned to belongs to the purchase team (incoming) or to sales (outgoing)", () => {
    const incoming = deriveOrderStatus(order({ shipments: [{ ...blockedShipment, assigneeName: null }] }), [shortReceipt], NOW);
    expect(incoming.owner).toBe("Peter Goh");
    const outgoing = deriveOrderStatus(order({ shipments: [{ ...blockedShipment, assigneeName: null, direction: "outbound" }] }), [shortReceipt], NOW);
    expect(outgoing.owner).toBe("Sam Tan");
  });

  it("a finding a person has already decided does not block the order", () => {
    const state = order({ shipments: [{ ...blockedShipment, status: "resolved" }] });
    expect(deriveOrderStatus(state, [{ ...shortReceipt, decided: true }], NOW).status).toBe("ready_to_ship");
  });

  it("documents that are missing but not yet due become a task without changing the status", () => {
    const missingPermit: OrderFlag = { code: "DOCUMENT_MISSING", severity: "warning", field: "import_permit", reason: "Import permit is missing.", source: "shipment", sourceRef: "SHP-0005", decided: false };
    const state = order({ shipments: [{ shipmentNo: "SHP-0005", reference: "ORD-1042", direction: "outbound", status: "waiting", assigneeName: null, goodsReceived: true }] });
    const result = deriveOrderStatus(state, [missingPermit], NOW);
    expect(result.status).toBe("ready_to_ship");
    expect(result.tasks.map((task) => [task.assignee, task.title, task.href])).toEqual([
      ["Sam Tan", "Warehouse packs and ships; record the delivery on the order page", "/orders/ORD-1042"],
      ["Sam Tan", "Get the missing Import permit for shipment SHP-0005 (ORD-1042)", "/shipments/SHP-0005"],
    ]);
  });

  it("gives the same answer for the same input and never changes its input", () => {
    const state = order({ shipments: [blockedShipment] });
    const flags = [shortReceipt, awbDue];
    const before = JSON.stringify({ state, flags });
    expect(deriveOrderStatus(state, flags, NOW)).toEqual(deriveOrderStatus(state, flags, NOW));
    expect(JSON.stringify({ state, flags })).toBe(before);
  });
});

describe("deriveOrderStatus: the delay reason", () => {
  it.each([
    ["shipment findings are quoted in full", order({ shipments: [blockedShipment] }), [shortReceipt, awbDue], "PC-4402: invoiced 100, packing list 100, received 95: 5 units short. AWB or BL is still missing and is due on 16 Nov 2026, 16:00 (in 7 hours)."],
    ["PO findings quote the first and count the rest", order({ exported: false, fulfilment: null }), [priceFinding, partFinding], "2 findings on the customer PO. Line 1: the PO unit price 11.90 differs from the Navision price 12.40. (and 1 more)"],
    ["payment", order({ payment: "awaiting", daysWaitingForPayment: 9 }), [], "Payment for PI-1042 has not arrived (9 days waiting)."],
    ["one day waiting uses the singular", order({ payment: "awaiting", daysWaitingForPayment: 1 }), [], "Payment for PI-1042 has not arrived (1 day waiting)."],
    ["proof received", order({ payment: "proof_received" }), [], "A proof of payment for PI-1042 has arrived, but Finance has not yet confirmed that the money is in the bank."],
    ["SPR", order({ sprs: [{ sprNo: "SPR-0004", status: "Submitted", assignedTo: "Janet", partNo: "EF-9", quantity: 15 }] }), [], "SPR-0004 (15 x EF-9) for this order is waiting for Janet's decision."],
    ["partly shipped", order({ fulfilment: { state: "partial", totalOrdered: 420, totalDelivered: 395 } }), [], "25 of 420 units have not shipped yet."],
    ["nothing holds a ready order up", order(), [], null],
  ] as const)("%s", (_name, state, flags, reason) => {
    expect(deriveOrderStatus(state, [...flags], NOW).blockerReason).toBe(reason);
  });
});

describe("deriveOrderStatus: ship-date risk", () => {
  const awaiting = { payment: "awaiting" as const, daysWaitingForPayment: 3 };
  it.each([
    // name, state, now, expected risk
    ["far from the promised date, not ready", order({ ...awaiting, promisedShipDate: "2026-11-27" }), NOW, "on_track"],
    ["one second before the 2-day window opens", order({ ...awaiting, promisedShipDate: "2026-11-27" }), new Date("2026-11-24T15:59:59.000Z"), "on_track"],
    ["exactly when the 2-day window opens (midnight Singapore time)", order({ ...awaiting, promisedShipDate: "2026-11-27" }), new Date("2026-11-24T16:00:00.000Z"), "at_risk"],
    ["inside the window but ready to ship", order({ promisedShipDate: "2026-11-17" }), NOW, "on_track"],
    ["inside the window and only partly shipped", order({ promisedShipDate: "2026-11-17", fulfilment: { state: "partial", totalOrdered: 10, totalDelivered: 4 } }), NOW, "at_risk"],
    ["blocked, however far away the date is", order({ shipments: [blockedShipment], promisedShipDate: "2026-12-20" }), NOW, "at_risk"],
    ["on the promised day itself", order({ ...awaiting, promisedShipDate: "2026-11-16" }), NOW, "at_risk"],
    ["the moment the promised day ends", order({ promisedShipDate: "2026-11-16" }), new Date("2026-11-16T16:00:00.000Z"), "late"],
    ["ready but past the promised date is still late", order({ promisedShipDate: "2026-11-10" }), NOW, "late"],
    ["shipped orders have no risk", order({ promisedShipDate: "2026-11-10", fulfilment: { state: "complete", totalOrdered: 1, totalDelivered: 1 } }), NOW, "none"],
    ["cancelled orders have no risk", order({ promisedShipDate: "2026-11-10", cancelled: true }), NOW, "none"],
    ["no promised date yet", order({ exported: false, promisedShipDate: null, fulfilment: null }), NOW, "none"],
  ] as const)("%s", (_name, state, now, risk) => {
    expect(deriveOrderStatus(state, [shortReceipt], now).shipRisk).toBe(risk);
  });

  it("the window is a setting", () => {
    const state = order({ ...awaiting, promisedShipDate: "2026-11-27" });
    expect(deriveOrderStatus(state, [], NOW, { shipDateAlertDays: 2 }).shipRisk).toBe("on_track");
    expect(deriveOrderStatus(state, [], NOW, { shipDateAlertDays: 14 }).shipRisk).toBe("at_risk");
  });

  it("explains the risk in a sentence", () => {
    expect(deriveOrderStatus(order({ promisedShipDate: "2026-11-10" }), [], NOW).shipRiskNote).toBe("The promised ship date 10 Nov 2026 has passed and the order has not fully shipped.");
    expect(deriveOrderStatus(order({ ...awaiting, promisedShipDate: "2026-11-17" }), [], NOW).shipRiskNote).toBe('Promised to ship on 17 Nov 2026 and still "Awaiting payment".');
  });
});

describe("customerUpdate: one line from a template", () => {
  const line = (state: OrderState, flags: OrderFlag[] = [], now = NOW): string => customerUpdate(state, deriveOrderStatus(state, flags, now), flags);

  it("the brief's example: units short and a document pending", () => {
    expect(line(order({ shipments: [blockedShipment], promisedShipDate: "2026-11-18" }), [shortReceipt, awbDue])).toBe(
      "Shipment at risk: 5 units short; AWB or BL pending. Promised ship date: 18 Nov 2026.",
    );
  });

  it.each([
    ["in review", order({ exported: false, promisedShipDate: null, fulfilment: null }), "We have received your PO BD-PO-5521 and are checking it."],
    ["awaiting payment", order({ payment: "awaiting" }), "Proforma invoice PI-1042 has been sent. Your order ships once payment is received. Promised ship date: 27 Nov 2026."],
    ["proof received", order({ payment: "proof_received" }), "We have received your proof of payment for PI-1042 and are confirming it with our bank. Promised ship date: 27 Nov 2026."],
    ["amendment in review", order({ pendingChange: "amendment" }), "We have received your amended PO and are reviewing it. Promised ship date: 27 Nov 2026."],
    ["waiting for stock", order({ sprs: [{ sprNo: "SPR-1", status: "Submitted", assignedTo: "Janet", partNo: "EF-9", quantity: 15 }] }), "Part of your order is being purchased from our supplier. We will confirm the ship date. Promised ship date: 27 Nov 2026."],
    ["partly shipped", order({ fulfilment: { state: "partial", totalOrdered: 420, totalDelivered: 395 } }), "395 of 420 units have shipped. The rest will follow. Promised ship date: 27 Nov 2026."],
    ["ready", order(), "Payment received. Your order is being prepared for shipment. Promised ship date: 27 Nov 2026."],
    ["past the promised date", order({ promisedShipDate: "2026-11-10" }), "Payment received. Your order is being prepared for shipment. We have passed the promised ship date of 10 Nov 2026 and will confirm a new date."],
    ["shipped", order({ fulfilment: { state: "complete", totalOrdered: 100, totalDelivered: 100 } }), "Order ORD-1042 (your PO BD-PO-5521) has shipped in full."],
    ["cancelled", order({ cancelled: true }), "Order ORD-1042 (your PO BD-PO-5521) has been cancelled."],
  ] as const)("%s", (_name, state, expected) => {
    expect(line(state)).toBe(expected);
  });

  it("never passes internal details to the customer: no staff names, no reason codes, no prices", () => {
    const text = line(order({ shipments: [blockedShipment] }), [shortReceipt, awbDue]);
    expect(text).not.toMatch(/Peter|Sam|Farah|Janet|QTY_VARIANCE|DOCUMENT_|SHP-|PO-8341/);
  });
});

describe("summarizeOrders", () => {
  it("counts the tiles from the derived statuses", () => {
    const tiles = summarizeOrders([
      { status: "blocked", shipRisk: "at_risk" },
      { status: "awaiting_payment", shipRisk: "at_risk" },
      { status: "awaiting_payment", shipRisk: "on_track" },
      { status: "ready_to_ship", shipRisk: "late" },
      { status: "partly_shipped", shipRisk: "on_track" },
      { status: "in_review", shipRisk: "none" },
      { status: "shipped", shipRisk: "none" },
      { status: "cancelled", shipRisk: "none" },
    ]);
    expect(tiles).toEqual({ open: 6, blocked: 1, shipDateAtRisk: 2, shipDateLate: 1, awaitingPayment: 2, readyToShip: 2 });
  });

  it("is all zeros for no orders", () => {
    expect(summarizeOrders([])).toEqual({ open: 0, blocked: 0, shipDateAtRisk: 0, shipDateLate: 0, awaitingPayment: 0, readyToShip: 0 });
  });
});
