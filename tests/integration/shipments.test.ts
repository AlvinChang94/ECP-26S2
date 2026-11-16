// What: integration tests for story 5: shipping documents join a shipment, quantities are compared, required documents are checked against the due date.
// Who calls it: `npm test`.
// To extend: PO-9101 to PO-9111 in data/golden/navision are the vendor POs of the golden shipment cases; their PDFs are in data/golden/files.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/domain/audit";
import { UserError } from "@/services/errors";
import { getFulfilment } from "@/services/fulfilment";
import { confirmDocumentType, ingestDocument, parseDocumentType, type RouteResult } from "@/services/intake";
import { runDueJobs } from "@/services/jobs";
import { listOutbox } from "@/services/outbox";
import {
  assignShipment,
  editShipmentDocument,
  getShipment,
  linkDocumentToShipment,
  listShipments,
  listShipmentTimeline,
  listUnmatchedDocuments,
  recordResolution,
  reopenFinding,
  requestDocument,
  summarizeShipments,
  trackShipment,
} from "@/services/shipments";
import { renderInvoice, renderPackingList, renderTransportDocument } from "../../scripts/sample-data/pdfs";
import { exportedOrder } from "../helpers/flows";
import { createWorkspace, FARAH, PETER, readDataFile, SAM, type TestWorkspace } from "../helpers/workspace";

let workspace: TestWorkspace;
beforeEach(() => {
  workspace = createWorkspace();
});
afterEach(async () => {
  await workspace.cleanup();
});

/** Takes in PDF bytes and, unless told otherwise, confirms the type the reader detected (as a person would in the Inbox). */
async function takeInBytes(bytes: Uint8Array, fileName: string, options: { actor?: Actor; confirm?: boolean } = {}): Promise<{ documentId: string; route: RouteResult | null }> {
  const actor = options.actor ?? PETER;
  const { documentId } = await ingestDocument(workspace.deps, actor, { bytes, fileName, channel: "email", sender: null });
  if (options.confirm === false) return { documentId, route: null };
  const document = await workspace.deps.db.document.findUniqueOrThrow({ where: { id: documentId } });
  return { documentId, route: await confirmDocumentType(workspace.deps, actor, documentId, parseDocumentType(document.detectedType)) };
}

function takeIn(goldenFile: string, options: { actor?: Actor; confirm?: boolean } = {}) {
  return takeInBytes(readDataFile(`golden/files/${goldenFile}`), goldenFile, options);
}

async function takeInAll(caseId: string, parts: string[]): Promise<void> {
  for (const part of parts) await takeIn(`${caseId}-${part}.pdf`);
}

async function airWaybillFor(reference: string): Promise<Uint8Array> {
  const rendered = await renderTransportDocument({
    mode: "air",
    documentNumber: "618-00001111",
    shipperName: "Alpha Supply",
    consigneeName: "Spectra Innovations Pte Ltd",
    origin: "Sample Origin Airport",
    destination: "Singapore Changi Airport",
    pieces: "25",
    reference,
  });
  return rendered.bytes;
}

const flagCodes = async (shipmentNo: string) => (await getShipment(workspace.deps, shipmentNo)).flags.map((flag) => flag.code);

describe("a shipping document joins a shipment", () => {
  it("does nothing until a person confirms the type; then the reference decides the shipment", async () => {
    const { documentId } = await takeIn("ship-receipt-short-invoice.pdf", { confirm: false });
    expect(await workspace.deps.db.shipment.count()).toBe(0);

    const route = await confirmDocumentType(workspace.deps, PETER, documentId, "vendor_invoice");
    expect(route).toEqual({ kind: "shipment", routedId: "SHP-0001", path: "/shipments/SHP-0001" });
    const shipment = await workspace.deps.db.shipment.findUniqueOrThrow({ where: { shipmentNo: "SHP-0001" } });
    expect(shipment).toMatchObject({ direction: "inbound", reference: "PO-9101", partyName: "Pacific Components", orderNo: null });
    expect(shipment.dueDate?.toISOString()).toBe("2026-12-15T08:00:00.000Z");
  });

  it("puts documents of the same vendor PO on one shipment and another PO on its own", async () => {
    await takeInAll("ship-receipt-short", ["invoice", "packing-list", "awb", "permit"]);
    await takeIn("ship-all-matching-invoice.pdf");
    const shipments = await workspace.deps.db.shipment.findMany({ orderBy: { shipmentNo: "asc" } });
    expect(shipments.map((shipment) => [shipment.shipmentNo, shipment.reference])).toEqual([
      ["SHP-0001", "PO-9101"],
      ["SHP-0002", "PO-9102"],
    ]);
    expect(await workspace.deps.db.shipmentDocument.count({ where: { shipmentNo: "SHP-0001" } })).toBe(4);
  });

  it("takes the document off the shipment when a person changes its type", async () => {
    const { documentId } = await takeIn("ship-receipt-short-invoice.pdf");
    await confirmDocumentType(workspace.deps, PETER, documentId, "proforma_invoice");
    expect(await workspace.deps.db.shipmentDocument.count()).toBe(0);
    const view = await getShipment(workspace.deps, "SHP-0001");
    expect(view.checklist.find((item) => item.key === "invoice")?.status).toBe("missing");
  });
});

describe("quantity reconciliation", () => {
  it("flags the deck's example: invoiced 100, packing list 100, received 95 in Navision", async () => {
    await takeInAll("ship-receipt-short", ["invoice", "packing-list", "awb", "permit"]);
    const view = await getShipment(workspace.deps, "SHP-0001");
    expect(view.rows).toEqual([{ partNo: "PC-4402", ordered: 100, invoiced: 100, packed: 100, received: 95, status: "variance", note: "5 units short" }]);
    expect(view.flags.map((flag) => [flag.code, flag.field, flag.severity])).toEqual([["QTY_VARIANCE", "PC-4402", "blocking"]]);
    expect(view.flags[0].reason).toBe("PC-4402: invoiced 100, packing list 100, received 95: 5 units short.");
    expect(view.goodsReceipt?.grNo).toBe("GR-9101");
    expect(view.status).toBe("needs_review");

    // What was found is written to the audit trail when each document was checked.
    const timeline = await listShipmentTimeline(workspace.deps, view);
    expect(timeline.filter((entry) => entry.action === "shipment_checked").at(-1)?.summary).toContain("5 units short");
    expect(new Set(timeline.map((entry) => entry.action))).toEqual(new Set(["document_received", "type_confirmed", "shipment_created", "shipment_document_added", "shipment_checked"]));
  });

  it("finds nothing when invoice, packing list and receipt agree and every document is present", async () => {
    await takeInAll("ship-all-matching", ["invoice", "packing-list", "awb", "permit"]);
    const view = await getShipment(workspace.deps, "SHP-0001");
    expect(view.flags).toEqual([]);
    expect(view.status).toBe("verified");
  });

  it("notes that the goods receipt is missing in Navision instead of guessing a quantity", async () => {
    await takeInAll("ship-no-receipt-yet", ["invoice", "packing-list", "awb", "permit"]);
    const view = await getShipment(workspace.deps, "SHP-0001");
    expect(view.rows[0]).toMatchObject({ invoiced: 150, packed: 150, received: null, status: "waiting" });
    expect(view.flags.map((flag) => [flag.code, flag.severity])).toEqual([["GOODS_RECEIPT_PENDING", "info"]]);
    expect(view.status).toBe("waiting");
  });

  it("lets a person correct a misread quantity: the change is audited and the shipment is checked again", async () => {
    await takeInAll("ship-all-matching", ["invoice", "packing-list", "awb", "permit"]);
    const before = await getShipment(workspace.deps, "SHP-0001");
    const invoice = before.documents.find((entry) => entry.type === "vendor_invoice");
    const changed = await editShipmentDocument(workspace.deps, PETER, {
      shipmentNo: "SHP-0001",
      documentId: invoice?.document.id as string,
      changes: [{ field: "lines[0].quantity", value: "250" }],
    });
    expect(changed).toBe(1);
    const after = await getShipment(workspace.deps, "SHP-0001");
    expect(after.flags.map((flag) => flag.code)).toEqual(["QTY_VARIANCE"]);
    // The extracted value is untouched; the edit is an audit event with old and new value.
    expect(after.documents.find((entry) => entry.type === "vendor_invoice")?.fields.find((field) => field.key === "lines[0].quantity")?.value).toBe("240");
    const edit = await workspace.deps.db.auditEvent.findFirstOrThrow({ where: { action: "field_edit" } });
    expect(edit).toMatchObject({ actorName: "Peter Goh", oldValue: "240", newValue: "250", field: "lines[0].quantity" });
  });
});

describe("required documents", () => {
  it("shows Missing, then Pending check when an unconfirmed document arrives, then Present once it is confirmed", async () => {
    await takeInAll("ship-awb-missing", ["invoice", "packing-list", "permit"]);
    let view = await getShipment(workspace.deps, "SHP-0001");
    expect(view.checklist.map((item) => [item.label, item.status])).toEqual([
      ["Invoice", "present"],
      ["Packing list", "present"],
      ["AWB or BL", "missing"],
      ["Import permit", "present"],
    ]);
    expect(view.flags.map((flag) => [flag.code, flag.field, flag.severity])).toEqual([["DOCUMENT_MISSING", "awb_bl", "warning"]]);
    expect(view.status).toBe("waiting");

    const { documentId } = await takeInBytes(await airWaybillFor("PO-9106"), "awb-po-9106.pdf", { confirm: false });
    view = await getShipment(workspace.deps, "SHP-0001");
    expect(view.checklist.find((item) => item.key === "awb_bl")?.status).toBe("pending_check");
    expect(view.pending.map((document) => document.fileName)).toEqual(["awb-po-9106.pdf"]);
    expect(view.flags.map((flag) => flag.code)).toEqual(["DOCUMENT_PENDING_CHECK"]);

    await confirmDocumentType(workspace.deps, PETER, documentId, "awb_bl");
    view = await getShipment(workspace.deps, "SHP-0001");
    expect(view.checklist.find((item) => item.key === "awb_bl")?.status).toBe("present");
    expect(view.status).toBe("verified");
  });

  it("flags a missing import permit", async () => {
    await takeInAll("ship-permit-missing", ["invoice", "packing-list", "awb"]);
    expect(await flagCodes("SHP-0001")).toEqual(["DOCUMENT_MISSING"]);
    expect((await getShipment(workspace.deps, "SHP-0001")).flags[0].field).toBe("import_permit");
  });

  it("a reference that matches nothing is not guessed at: the document waits for a person to link it", async () => {
    const { documentId, route } = await takeInBytes(await airWaybillFor("PO-0000"), "awb-unknown.pdf");
    expect(route).toEqual({ kind: "shipment", routedId: null, path: "/shipments" });
    expect(await workspace.deps.db.shipment.count()).toBe(0);
    const unmatched = await listUnmatchedDocuments(workspace.deps);
    expect(unmatched.map((entry) => [entry.document.fileName, entry.flag.code, entry.flag.canOverride])).toEqual([["awb-unknown.pdf", "REFERENCE_NOT_FOUND", false]]);
    expect(unmatched[0].flag.reason).toContain('"PO-0000"');

    await expect(linkDocumentToShipment(workspace.deps, FARAH, { documentId, reference: "PO-9106" })).rejects.toThrow(/purchase team or a sales team member/);
    await expect(linkDocumentToShipment(workspace.deps, PETER, { documentId, reference: "PO-0001" })).rejects.toThrow(/matches no vendor PO/);
    const shipmentNo = await linkDocumentToShipment(workspace.deps, PETER, { documentId, reference: "PO-9106" });
    expect(await listUnmatchedDocuments(workspace.deps)).toEqual([]);
    expect((await workspace.deps.db.document.findUniqueOrThrow({ where: { id: documentId } })).routedId).toBe(shipmentNo);
    const added = await workspace.deps.db.auditEvent.findFirstOrThrow({ where: { action: "shipment_document_added" } });
    expect(added.summary).toContain("by hand by Peter Goh");
    expect((await getShipment(workspace.deps, shipmentNo)).checklist.find((item) => item.key === "awb_bl")?.status).toBe("present");
  });

  it("can be tracked by hand before any document arrives", async () => {
    await expect(trackShipment(workspace.deps, FARAH, "PO-9102")).rejects.toThrow(UserError);
    await expect(trackShipment(workspace.deps, PETER, "PO-0000")).rejects.toThrow(/matches no vendor PO/);
    expect(await trackShipment(workspace.deps, PETER, "po 9102")).toEqual({ shipmentNo: "SHP-0001", created: true });
    expect(await trackShipment(workspace.deps, PETER, "PO-9102")).toEqual({ shipmentNo: "SHP-0001", created: false });
    const view = await getShipment(workspace.deps, "SHP-0001");
    expect(view.checklist.map((item) => item.status)).toEqual(["missing", "missing", "missing", "missing"]);
    expect(view.status).toBe("waiting");
  });
});

describe("due-date alerts", () => {
  /** What the due jobs did about shipments (other sweeps, such as vendor payment reminders, also run and are tested elsewhere). */
  const alertLines = async (): Promise<string[]> => (await runDueJobs(workspace.deps)).lines.filter((line) => line.startsWith("SHP-"));

  beforeEach(async () => {
    // PO-9106: the AWB is missing and the documents are due on 15 Dec 2026, 08:00 UTC.
    await takeInAll("ship-awb-missing", ["invoice", "packing-list", "permit"]);
  });

  it("alerts once inside the window before the due date, and once more when the due date has passed", async () => {
    expect((await alertLines())).toEqual([]); // four weeks before: nothing
    workspace.clock.set(new Date("2026-12-13T07:59:00.000Z"));
    expect((await alertLines())).toEqual([]); // one minute before the 48-hour window

    workspace.clock.set(new Date("2026-12-13T09:00:00.000Z"));
    expect(await flagCodes("SHP-0001")).toEqual(["DOCUMENT_DUE_SOON"]);
    expect((await alertLines())).toEqual(["SHP-0001: due-date alert sent to Peter Goh (AWB or BL due soon for PO-9106)."]);
    expect((await alertLines())).toEqual([]); // the same alert is never written twice

    workspace.clock.set(new Date("2026-12-15T09:00:00.000Z"));
    expect(await flagCodes("SHP-0001")).toEqual(["DOCUMENT_OVERDUE"]);
    expect((await alertLines())).toEqual(["SHP-0001: due-date alert sent to Peter Goh (AWB or BL overdue for PO-9106)."]);
    workspace.clock.advanceHours(72);
    expect((await alertLines())).toEqual([]);

    const alerts = await listOutbox(workspace.deps, { type: "document_due_alert" });
    expect(alerts.map((message) => message.subject).sort()).toEqual(["AWB or BL due soon for PO-9106 (Alpha Supply)", "AWB or BL overdue for PO-9106 (Alpha Supply)"]);
    expect(alerts[0].body).toContain("due on 15 Dec 2026, 16:00");
    expect(await workspace.deps.db.auditEvent.count({ where: { action: "due_date_alert", entityId: "SHP-0001" } })).toBe(2);
    // The shipments page shows the same thing as an open due-date alert.
    expect(summarizeShipments(await listShipments(workspace.deps), 0)).toMatchObject({ needsReview: 1, dueAlerts: 1 });
  });

  it("sends the alert to the person the shipment is assigned to", async () => {
    await assignShipment(workspace.deps, PETER, { shipmentNo: "SHP-0001", staffId: "sam" });
    workspace.clock.set(new Date("2026-12-14T00:00:00.000Z"));
    await runDueJobs(workspace.deps);
    const [alert] = await listOutbox(workspace.deps, { type: "document_due_alert" });
    expect(alert.toName).toBe("Sam Tan");
  });

  it("does not remind about a finding a person already recorded an outcome for, but overdue is a new finding", async () => {
    workspace.clock.set(new Date("2026-12-13T09:00:00.000Z"));
    const soon = (await getShipment(workspace.deps, "SHP-0001")).flags[0];
    await recordResolution(workspace.deps, PETER, { shipmentNo: "SHP-0001", fingerprint: soon.fingerprint, reason: "Vendor confirmed the AWB follows tomorrow morning" });
    expect((await alertLines())).toEqual([]);

    workspace.clock.set(new Date("2026-12-15T09:00:00.000Z"));
    const view = await getShipment(workspace.deps, "SHP-0001");
    expect(view.flags.map((flag) => [flag.code, flag.decision])).toEqual([["DOCUMENT_OVERDUE", null]]);
    expect(view.status).toBe("needs_review");
    expect((await alertLines())).toHaveLength(1);
  });

  it("stops alerting once the document arrives and is confirmed", async () => {
    await takeInBytes(await airWaybillFor("PO-9106"), "awb-po-9106.pdf");
    workspace.clock.set(new Date("2026-12-16T00:00:00.000Z"));
    expect((await alertLines())).toEqual([]);
    expect(await listOutbox(workspace.deps, { type: "document_due_alert" })).toEqual([]);
  });
});

describe("actions on the exception review page", () => {
  it("requests a missing document from the vendor through the Outbox and records who asked", async () => {
    await takeInAll("ship-awb-missing", ["invoice", "packing-list", "permit"]);
    await expect(requestDocument(workspace.deps, FARAH, { shipmentNo: "SHP-0001", documentKey: "awb_bl" })).rejects.toThrow(UserError);
    await expect(requestDocument(workspace.deps, PETER, { shipmentNo: "SHP-0001", documentKey: "invoice" })).rejects.toThrow(/not missing/);

    await requestDocument(workspace.deps, PETER, { shipmentNo: "SHP-0001", documentKey: "awb_bl" });
    const [request] = await listOutbox(workspace.deps, { type: "document_request" });
    expect(request).toMatchObject({ toName: "Alpha Supply", toAddress: "sales@alphasupply.example", subject: "Request: AWB or BL for PO-9106", status: "sent" });
    const event = await workspace.deps.db.auditEvent.findFirstOrThrow({ where: { action: "document_requested" } });
    expect(event).toMatchObject({ actorName: "Peter Goh", entityId: "SHP-0001", field: "awb_bl" });
  });

  it("assigns the shipment to a team member, tells them, and records the change", async () => {
    await takeInAll("ship-receipt-short", ["invoice", "packing-list", "awb", "permit"]);
    await expect(assignShipment(workspace.deps, SAM, { shipmentNo: "SHP-0001", staffId: "farah" })).rejects.toThrow(/purchase or sales team/);
    await assignShipment(workspace.deps, SAM, { shipmentNo: "SHP-0001", staffId: "peter" });

    expect((await getShipment(workspace.deps, "SHP-0001")).shipment.assigneeName).toBe("Peter Goh");
    const [task] = await listOutbox(workspace.deps, { type: "task_assigned" });
    expect(task.toName).toBe("Peter Goh");
    expect(task.body).toContain("5 units short");
    const event = await workspace.deps.db.auditEvent.findFirstOrThrow({ where: { action: "shipment_assigned" } });
    expect(event).toMatchObject({ actorName: "Sam Tan", oldValue: null, newValue: "Peter Goh" });
  });

  it("records a resolution with reason, name and time; a changed quantity needs a new decision", async () => {
    await takeInAll("ship-receipt-short", ["invoice", "packing-list", "awb", "permit"]);
    const finding = (await getShipment(workspace.deps, "SHP-0001")).flags[0];

    await expect(recordResolution(workspace.deps, FARAH, { shipmentNo: "SHP-0001", fingerprint: finding.fingerprint, reason: "Accepted by Finance" })).rejects.toThrow(/purchase team or a sales team member/);
    await recordResolution(workspace.deps, PETER, { shipmentNo: "SHP-0001", fingerprint: finding.fingerprint, reason: "Vendor ships the 5 missing units next week" });

    let view = await getShipment(workspace.deps, "SHP-0001");
    expect(view.status).toBe("resolved");
    expect(view.flags[0].decision).toMatchObject({ kind: "resolution", byName: "Peter Goh", reason: "Vendor ships the 5 missing units next week" });
    expect(view.flags[0].decision?.at.toISOString()).toBe(workspace.clock.now().toISOString());
    const event = await workspace.deps.db.auditEvent.findFirstOrThrow({ where: { action: "flag_resolution" } });
    expect(event).toMatchObject({ actorName: "Peter Goh", actorRole: "purchase", reason: "Vendor ships the 5 missing units next week", oldValue: "open", newValue: "resolved" });
    await expect(recordResolution(workspace.deps, PETER, { shipmentNo: "SHP-0001", fingerprint: finding.fingerprint, reason: "Again, to be sure" })).rejects.toThrow(/already has a resolution/);

    // The invoice quantity is corrected to 98: the difference is now 3 units, a different finding.
    const invoice = view.documents.find((entry) => entry.type === "vendor_invoice");
    await editShipmentDocument(workspace.deps, PETER, { shipmentNo: "SHP-0001", documentId: invoice?.document.id as string, changes: [{ field: "lines[0].quantity", value: "98" }] });
    view = await getShipment(workspace.deps, "SHP-0001");
    expect(view.flags.map((flag) => [flag.code, flag.decision])).toEqual([["QTY_VARIANCE", null]]);
    expect(view.status).toBe("needs_review");
  });

  it("lets a person take a resolution back; the finding is open again and both steps are in the audit trail", async () => {
    await takeInAll("ship-receipt-short", ["invoice", "packing-list", "awb", "permit"]);
    const finding = (await getShipment(workspace.deps, "SHP-0001")).flags[0];
    await recordResolution(workspace.deps, PETER, { shipmentNo: "SHP-0001", fingerprint: finding.fingerprint, reason: "Recorded against the wrong shipment" });
    await reopenFinding(workspace.deps, SAM, { shipmentNo: "SHP-0001", fingerprint: finding.fingerprint });
    expect((await getShipment(workspace.deps, "SHP-0001")).status).toBe("needs_review");
    const events = await workspace.deps.db.auditEvent.findMany({ where: { action: "flag_resolution" }, orderBy: { id: "asc" } });
    expect(events.map((event) => [event.actorName, event.newValue])).toEqual([
      ["Peter Goh", "resolved"],
      ["Sam Tan", "open"],
    ]);
  });

  it("does not let a note be 'resolved': there is nothing to decide", async () => {
    await takeInAll("ship-no-receipt-yet", ["invoice", "packing-list", "awb", "permit"]);
    const note = (await getShipment(workspace.deps, "SHP-0001")).flags[0];
    await expect(recordResolution(workspace.deps, PETER, { shipmentNo: "SHP-0001", fingerprint: note.fingerprint, reason: "Receipt will follow" })).rejects.toThrow(/note, not an exception/);
  });
});

describe("outgoing shipments (sales)", () => {
  it("links documents that quote the customer's PO number to the order and compares them with what was ordered", async () => {
    const orderNo = await exportedOrder(workspace.deps); // Lanka Tech, PO LT-PO-2240, promised ship date 23 Nov 2026
    const ordered = (await getFulfilment(workspace.deps, orderNo))?.lines ?? [];
    expect(ordered.length).toBeGreaterThan(0);

    const invoice = await renderInvoice({
      title: "COMMERCIAL INVOICE",
      invoiceNumber: "SI-0001",
      invoiceDate: "2026-11-20",
      issuerName: "Spectra Innovations Pte Ltd",
      billTo: "Lanka Tech Pte Ltd",
      poNumber: "LT-PO-2240",
      currency: "USD",
      lines: ordered.map((line) => ({ partNo: line.itemNo, description: line.description, quantity: String(line.ordered), unitPrice: "1.00" })),
    });
    // The warehouse packed 5 fewer of the first part than the order says.
    const packingList = await renderPackingList({
      packingListNumber: "SPL-0001",
      packingDate: "2026-11-20",
      shipperName: "Spectra Innovations Pte Ltd",
      consigneeName: "Lanka Tech Pte Ltd",
      poNumber: "LT-PO-2240",
      lines: ordered.map((line, index) => ({ partNo: line.itemNo, description: line.description, quantity: String(index === 0 ? line.ordered - 5 : line.ordered), cartons: "2" })),
    });
    const first = await takeInBytes(invoice.bytes, "invoice-out.pdf", { actor: SAM });
    await takeInBytes(packingList.bytes, "packing-list-out.pdf", { actor: SAM });
    expect(first.route).toEqual({ kind: "shipment", routedId: "SHP-0001", path: "/shipments/SHP-0001" });

    const view = await getShipment(workspace.deps, "SHP-0001");
    expect(view).toMatchObject({ direction: "outbound", reference: orderNo, partyName: "Lanka Tech Pte Ltd", orderNo, goodsReceipt: null });
    // Outgoing documents are due at the start of the promised ship day (Singapore time).
    expect(view.dueAt?.toISOString()).toBe("2026-11-22T16:00:00.000Z");
    expect(view.flags.filter((flag) => flag.code === "QTY_VARIANCE").map((flag) => flag.field)).toEqual([ordered[0].itemNo]);
    expect(view.flags.map((flag) => flag.code)).not.toContain("GOODS_RECEIPT_PENDING");
    expect(view.checklist.map((item) => item.status)).toEqual(["present", "present", "missing", "missing"]);
    // Events of the shipment carry the order number, so they appear on the order's timeline.
    expect(await workspace.deps.db.auditEvent.count({ where: { entityType: "shipment", orderNo } })).toBeGreaterThan(0);
  });
});
