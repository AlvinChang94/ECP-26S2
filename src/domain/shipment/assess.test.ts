// What: unit tests for the story 5 rules: quantity reconciliation, the required-document checklist, due-date flags and shipment status.
// Who calls it: `npm test`.
// To extend: add a row to the tables below for every new comparison or required document.
import { describe, expect, it } from "vitest";
import type { DocumentType } from "../documents";
import { attachDecisions, type FlagDecisionRecord } from "../flags";
import { assessShipment, buildChecklist, deriveShipmentStatus, type QtyLine, quantityLines, reconcileQuantities, REQUIRED_DOCUMENTS } from "./assess";

const part = (partNo: string, quantity: number): QtyLine[] => [{ partNo, quantity }];

describe("reconcileQuantities for a purchase (invoice, packing list, received)", () => {
  it.each([
    // name, invoiced, packed, received, expected status, expected note, expected flag codes
    ["everything agrees", 100, 100, 100, "match", "", []],
    ["the deck's example: received 5 fewer than invoiced", 100, 100, 95, "variance", "5 units short", ["QTY_VARIANCE"]],
    ["one unit short uses the singular", 100, 100, 99, "variance", "1 unit short", ["QTY_VARIANCE"]],
    ["more received than invoiced", 100, 100, 104, "variance", "4 units more than invoiced", ["QTY_VARIANCE"]],
    ["packing list and receipt both lower than the invoice", 120, 110, 110, "variance", "10 units short", ["QTY_VARIANCE"]],
    ["only the packing list differs", 100, 90, 100, "variance", "quantities differ", ["QTY_VARIANCE"]],
    ["no goods receipt yet: documents agree, still waiting", 100, 100, null, "waiting", "", ["GOODS_RECEIPT_PENDING"]],
    ["no goods receipt yet and the documents disagree", 100, 90, null, "variance", "10 units short", ["QTY_VARIANCE", "GOODS_RECEIPT_PENDING"]],
    ["no packing list: invoice against receipt", 100, null, 95, "variance", "5 units short", ["QTY_VARIANCE"]],
    ["only an invoice: nothing to compare yet", 100, null, null, "waiting", "not enough documents yet to compare", ["GOODS_RECEIPT_PENDING"]],
  ] as const)("%s", (_name, invoiced, packed, received, status, note, codes) => {
    const result = reconcileQuantities({
      direction: "inbound",
      reference: "PO-1",
      ordered: part("P-1", 100),
      invoiced: invoiced === null ? null : part("P-1", invoiced),
      packed: packed === null ? null : part("P-1", packed),
      received: received === null ? null : part("P-1", received),
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ partNo: "P-1", status, note });
    expect(result.flags.map((flag) => flag.code)).toEqual(codes);
  });

  it("writes a reason a person can act on and keeps the numbers as data", () => {
    const { flags } = reconcileQuantities({ direction: "inbound", reference: "PO-8341", ordered: part("PC-4402", 100), invoiced: part("PC-4402", 100), packed: part("PC-4402", 100), received: part("PC-4402", 95) });
    expect(flags[0]).toMatchObject({
      code: "QTY_VARIANCE",
      severity: "blocking",
      field: "PC-4402",
      reason: "PC-4402: invoiced 100, packing list 100, received 95: 5 units short.",
      data: { partNo: "PC-4402", difference: "-5" },
    });
  });

  it("a different received quantity is a different finding (a recorded resolution does not carry over)", () => {
    const check = (received: number) =>
      reconcileQuantities({ direction: "inbound", reference: "PO-1", ordered: part("P-1", 100), invoiced: part("P-1", 100), packed: null, received: part("P-1", received) }).flags[0];
    expect(check(95).fingerprint).not.toBe(check(97).fingerprint);
    expect(check(95).fingerprint).toBe(check(95).fingerprint);
  });

  it("adds up a part that appears on several lines before comparing", () => {
    const result = reconcileQuantities({
      direction: "inbound",
      reference: "PO-1",
      ordered: part("P-1", 100),
      invoiced: [
        { partNo: "P-1", quantity: 60 },
        { partNo: "P-1", quantity: 40 },
      ],
      packed: part("P-1", 100),
      received: part("P-1", 100),
    });
    expect(result.rows[0]).toMatchObject({ invoiced: 100, status: "match" });
    expect(result.flags).toEqual([]);
  });

  it("flags a part on the invoice that is not on the vendor PO, once, and does not compare its quantities", () => {
    const result = reconcileQuantities({
      direction: "inbound",
      reference: "PO-9103",
      ordered: part("RT-AX55", 60),
      invoiced: part("RT-AX56", 60),
      packed: part("RT-AX55", 60),
      received: part("RT-AX55", 60),
    });
    expect(result.flags.map((flag) => [flag.code, flag.field])).toEqual([["INVOICE_PART_MISMATCH", "RT-AX56"]]);
    expect(result.flags[0].reason).toBe("The invoice lists RT-AX56 (60), which is not on PO-9103. PO-9103 has RT-AX55, which is not on the invoice.");
    expect(result.rows.map((row) => [row.partNo, row.status])).toEqual([
      ["RT-AX55", "match"],
      ["RT-AX56", "variance"],
    ]);
  });

  it("checks each part of a multi-line shipment separately", () => {
    const result = reconcileQuantities({
      direction: "inbound",
      reference: "PO-1",
      ordered: [...part("A", 10), ...part("B", 20)],
      invoiced: [...part("A", 10), ...part("B", 20)],
      packed: [...part("A", 10), ...part("B", 20)],
      received: [...part("A", 10), ...part("B", 18)],
    });
    expect(result.flags.map((flag) => flag.field)).toEqual(["B"]);
  });
});

describe("reconcileQuantities for a sale (ordered, invoice, packing list)", () => {
  it.each([
    ["everything agrees", 80, 80, 80, "match", []],
    ["packed fewer than ordered", 80, 80, 70, "variance", ["QTY_VARIANCE"]],
    ["invoiced more than ordered", 80, 85, 85, "variance", ["QTY_VARIANCE"]],
    ["only the order is known", 80, null, null, "waiting", []],
  ] as const)("%s", (_name, ordered, invoiced, packed, status, codes) => {
    const result = reconcileQuantities({
      direction: "outbound",
      reference: "ORD-1038",
      ordered: part("HS-700", ordered),
      invoiced: invoiced === null ? null : part("HS-700", invoiced),
      packed: packed === null ? null : part("HS-700", packed),
      received: null,
    });
    expect(result.rows[0].status).toBe(status);
    // A sale has no goods receipt, so its absence is never a finding.
    expect(result.flags.map((flag) => flag.code)).toEqual(codes);
  });
});

describe("buildChecklist", () => {
  const due = new Date("2026-11-20T08:00:00.000Z");
  const all: DocumentType[] = ["vendor_invoice", "packing_list", "awb_bl", "import_permit"];
  const check = (confirmedTypes: DocumentType[], pendingTypes: DocumentType[], now: string, dueAt: Date | null = due) =>
    buildChecklist({ confirmedTypes, pendingTypes, dueAt, now: new Date(now), alertWindowHours: 48 });

  it("requires an invoice, a packing list, an AWB or BL and an import permit", () => {
    expect(REQUIRED_DOCUMENTS.map((required) => required.label)).toEqual(["Invoice", "Packing list", "AWB or BL", "Import permit"]);
  });

  it("shows every document as Present when all are confirmed, with no flags", () => {
    const result = check(all, [], "2026-11-19T08:00:00.000Z");
    expect(result.items.map((item) => item.status)).toEqual(["present", "present", "present", "present"]);
    expect(result.flags).toEqual([]);
  });

  it.each([
    // name, now, expected code, expected severity
    ["well before the due date: missing, a warning", "2026-11-16T08:00:00.000Z", "DOCUMENT_MISSING", "warning"],
    ["one minute before the alert window opens", "2026-11-18T07:59:00.000Z", "DOCUMENT_MISSING", "warning"],
    ["exactly when the alert window opens (48 hours before)", "2026-11-18T08:00:00.000Z", "DOCUMENT_DUE_SOON", "blocking"],
    ["one minute before the due date", "2026-11-20T07:59:00.000Z", "DOCUMENT_DUE_SOON", "blocking"],
    ["exactly at the due date", "2026-11-20T08:00:00.000Z", "DOCUMENT_OVERDUE", "blocking"],
    ["days after the due date", "2026-11-25T08:00:00.000Z", "DOCUMENT_OVERDUE", "blocking"],
  ] as const)("AWB missing, %s", (_name, now, code, severity) => {
    const result = check(["vendor_invoice", "packing_list", "import_permit"], [], now);
    expect(result.items.find((item) => item.key === "awb_bl")?.status).toBe("missing");
    expect(result.flags.map((flag) => [flag.code, flag.field, flag.severity])).toEqual([[code, "awb_bl", severity]]);
  });

  it("says when the document is due and how far away that is", () => {
    const result = check(["vendor_invoice", "packing_list", "import_permit"], [], "2026-11-20T01:00:00.000Z");
    expect(result.flags[0].reason).toBe("AWB or BL is still missing and is due on 20 Nov 2026, 16:00 (in 7 hours).");
  });

  it("an unconfirmed document is Pending check: not Present, not Missing, and no due-date flag", () => {
    const result = check(["vendor_invoice", "packing_list", "awb_bl"], ["import_permit"], "2026-11-20T01:00:00.000Z");
    expect(result.items.find((item) => item.key === "import_permit")?.status).toBe("pending_check");
    expect(result.flags.map((flag) => [flag.code, flag.severity])).toEqual([["DOCUMENT_PENDING_CHECK", "info"]]);
  });

  it("a confirmed document wins over a second, unconfirmed copy", () => {
    const result = check(all, ["awb_bl"], "2026-11-20T01:00:00.000Z");
    expect(result.items.find((item) => item.key === "awb_bl")?.status).toBe("present");
    expect(result.flags).toEqual([]);
  });

  it("without a known due date a missing document is still flagged, as a warning", () => {
    const result = check(["vendor_invoice", "packing_list", "awb_bl"], [], "2026-11-25T08:00:00.000Z", null);
    expect(result.flags.map((flag) => [flag.code, flag.severity])).toEqual([["DOCUMENT_MISSING", "warning"]]);
    expect(result.flags[0].reason).toContain("No due date is known");
  });

  it("due soon and overdue are different findings, so each needs its own decision", () => {
    const soon = check(["vendor_invoice"], [], "2026-11-19T08:00:00.000Z").flags.find((flag) => flag.field === "awb_bl");
    const overdue = check(["vendor_invoice"], [], "2026-11-21T08:00:00.000Z").flags.find((flag) => flag.field === "awb_bl");
    expect(soon?.fingerprint).not.toBe(overdue?.fingerprint);
  });

  it("never uses the word cut-off", () => {
    const reasons = check([], [], "2026-11-19T08:00:00.000Z").flags.map((flag) => flag.reason).join(" ");
    expect(reasons.toLowerCase()).not.toMatch(/cut-?off/);
  });
});

describe("quantityLines", () => {
  it("reads part number and quantity per line and skips lines it cannot read", () => {
    const lines = quantityLines({
      "lines[0].partNo": "PC-4402",
      "lines[0].quantity": "100",
      "lines[1].partNo": "KM-2210",
      "lines[1].quantity": "1,200",
      "lines[2].partNo": "XX-1",
      "lines[2].quantity": "many",
      "lines[3].partNo": null,
      "lines[3].quantity": "5",
    });
    expect(lines).toEqual([
      { partNo: "PC-4402", quantity: 100 },
      { partNo: "KM-2210", quantity: 1200 },
    ]);
  });
});

describe("assessShipment and deriveShipmentStatus", () => {
  const now = new Date("2026-11-16T01:00:00.000Z");
  const lines = (quantity: number) => ({ "lines[0].partNo": "PC-4402", "lines[0].quantity": String(quantity) });
  const demo = () =>
    assessShipment({
      direction: "inbound",
      reference: "PO-8341",
      ordered: part("PC-4402", 100),
      documents: [
        { type: "vendor_invoice", values: lines(100) },
        { type: "packing_list", values: lines(100) },
      ],
      pendingTypes: ["import_permit"],
      received: part("PC-4402", 95),
      dueAt: new Date("2026-11-16T08:00:00.000Z"),
      now,
      alertWindowHours: 48,
    });
  const decision = (fingerprint: string): FlagDecisionRecord => ({ fingerprint, kind: "resolution", reason: "Vendor ships the rest next week", byName: "Peter Goh", at: now });

  it("the demo case: 5 units short, AWB due soon, permit waiting for a check", () => {
    const result = demo();
    expect(result.flags.map((flag) => [flag.code, flag.field])).toEqual([
      ["QTY_VARIANCE", "PC-4402"],
      ["DOCUMENT_DUE_SOON", "awb_bl"],
      ["DOCUMENT_PENDING_CHECK", "import_permit"],
    ]);
    expect(result.checklist.map((item) => item.status)).toEqual(["present", "present", "missing", "pending_check"]);
    expect(deriveShipmentStatus(attachDecisions(result.flags, []))).toBe("needs_review");
  });

  it("stays needs_review until every blocking finding has a recorded resolution", () => {
    const { flags } = demo();
    expect(deriveShipmentStatus(attachDecisions(flags, [decision(flags[0].fingerprint)]))).toBe("needs_review");
    // Both blocking findings resolved: only the note about the unconfirmed permit is left, so the shipment waits.
    expect(deriveShipmentStatus(attachDecisions(flags, [decision(flags[0].fingerprint), decision(flags[1].fingerprint)]))).toBe("waiting");
  });

  it.each([
    ["no findings at all", [], [], "verified"],
    ["a warning nobody decided", ["DOCUMENT_MISSING"], [], "waiting"],
    ["only a note", ["GOODS_RECEIPT_PENDING"], [], "waiting"],
    ["every finding resolved by a person", ["QTY_VARIANCE"], ["QTY_VARIANCE"], "resolved"],
  ] as const)("status: %s", (_name, codes, resolved, status) => {
    const result = assessShipment({
      direction: "inbound",
      reference: "PO-1",
      ordered: part("P-1", 100),
      documents: [
        { type: "vendor_invoice", values: { "lines[0].partNo": "P-1", "lines[0].quantity": "100" } },
        { type: "packing_list", values: { "lines[0].partNo": "P-1", "lines[0].quantity": "100" } },
        { type: "awb_bl", values: {} },
        ...((codes as readonly string[]).includes("DOCUMENT_MISSING") ? [] : [{ type: "import_permit" as const, values: {} }]),
      ],
      pendingTypes: [],
      received: (codes as readonly string[]).includes("GOODS_RECEIPT_PENDING") ? null : part("P-1", (codes as readonly string[]).includes("QTY_VARIANCE") ? 95 : 100),
      dueAt: new Date("2026-12-15T08:00:00.000Z"),
      now,
      alertWindowHours: 48,
    });
    expect(result.flags.map((flag) => flag.code)).toEqual(codes);
    const decisions = result.flags.filter((flag) => (resolved as readonly string[]).includes(flag.code)).map((flag) => decision(flag.fingerprint));
    expect(deriveShipmentStatus(attachDecisions(result.flags, decisions))).toBe(status);
  });

  it("gives the same result for the same input", () => {
    expect(demo()).toEqual(demo());
  });
});
