// What: story 5. Attaches shipping documents to a shipment, compares quantities, checks the required documents, alerts before the due date.
// Who calls it: the shipments pages and actions, the intake router (a confirmed shipping document), runDueJobs, the order dashboard, the seed.
// To extend: the rules are in src/domain/shipment/assess.ts. This file only gathers documents and Navision data for them. We detect and alert, never prevent.
import type { DocumentRow, OrderRow, ShipmentDocumentRow, ShipmentRow } from "@/adapters/db";
import { type Actor, SYSTEM_ACTOR, type TimelineEntry } from "@/domain/audit";
import { DOCUMENT_SPECS, type DocumentType, documentTypeLabel, type ExtractedField, isDocumentType } from "@/domain/documents";
import type { FieldEdit, FieldValues } from "@/domain/fields";
import { attachDecisions, type Flag, flagTitle, type FlagWithDecision, makeFlag, sortFlags, validateDecisionInput } from "@/domain/flags";
import type { NavGoodsReceipt, NavPurchaseOrder, StaffMember } from "@/domain/navision";
import { buildDocumentDueAlert, buildDocumentRequest, buildTaskAssigned } from "@/domain/notifications";
import { normalizeReference } from "@/domain/payment/matching";
import {
  assessShipment,
  type ChecklistItem,
  deriveShipmentStatus,
  type Direction,
  type QtyLine,
  type ReconciliationRow,
  REQUIRED_DOCUMENTS,
  type RequiredDocumentKey,
  SHIPMENT_DOCUMENT_TYPES,
  type ShipmentStatus,
} from "@/domain/shipment/assess";
import { formatDateTime, startOfBusinessDay } from "@/domain/time";
import { listEntityTimeline, recordAudit } from "./audit";
import { nextReference } from "./counters";
import type { Deps } from "./deps";
import { editDocumentField } from "./documentEdit";
import { loadDocumentRow } from "./documents";
import { requireThat, UserError } from "./errors";
import { getFulfilment } from "./fulfilment";
import { listFlagDecisions } from "./poReview";

/** Story 5 is worked by the purchase team and by sales team members. Others may look. The system never decides. */
export function requireShipmentRole(actor: Actor): void {
  if (actor.role !== "purchase" && actor.role !== "sales") {
    throw new UserError("Only the purchase team or a sales team member can do this. Switch persona to continue.");
  }
}

// ------------------------------------------------------------------------------------- which shipment a reference means

export type ShipmentTarget = {
  direction: Direction;
  /** Vendor PO number (purchases) or our order number (sales). */
  reference: string;
  /** Vendor or customer. */
  partyName: string;
  /** The customer order this shipment serves, when known. */
  orderNo: string | null;
  /** When the required documents are due. */
  dueAt: Date | null;
};

async function inboundTarget(deps: Pick<Deps, "db">, purchaseOrder: NavPurchaseOrder): Promise<ShipmentTarget> {
  // Navision says which customer PO a vendor PO was raised for; that links the incoming goods to our order.
  const order = purchaseOrder.forCustomerPoNumber
    ? await deps.db.order.findFirst({ where: { poNumber: purchaseOrder.forCustomerPoNumber, status: "open" }, orderBy: { receivedAt: "asc" } })
    : null;
  return {
    direction: "inbound",
    reference: purchaseOrder.poNumber,
    partyName: purchaseOrder.vendorName,
    orderNo: order?.orderNo ?? null,
    dueAt: purchaseOrder.documentsDueAt ? new Date(purchaseOrder.documentsDueAt) : null,
  };
}

function outboundTarget(order: OrderRow): ShipmentTarget {
  return {
    direction: "outbound",
    reference: order.orderNo,
    partyName: order.customerName ?? "",
    orderNo: order.orderNo,
    // Assumption A8: outgoing documents are due at the start of the promised ship day.
    dueAt: order.promisedShipDate ? startOfBusinessDay(order.promisedShipDate) : null,
  };
}

/**
 * Works out which shipment a reference on a document means. A vendor PO number in Navision is a purchase (inbound);
 * one of our order numbers, a customer's PO number or a PI number is a sale (outbound). Null when it matches nothing.
 */
export async function resolveShipmentTarget(deps: Pick<Deps, "db" | "navision">, reference: string | null): Promise<ShipmentTarget | null> {
  const wanted = normalizeReference(reference ?? "");
  if (!wanted) return null;
  const purchaseOrder = (await deps.navision.listPurchaseOrders()).find((candidate) => normalizeReference(candidate.poNumber) === wanted);
  if (purchaseOrder) return inboundTarget(deps, purchaseOrder);
  const orders = await deps.db.order.findMany({ where: { status: "open" }, orderBy: { orderNo: "asc" } });
  const order = orders.find((candidate) =>
    [candidate.orderNo, candidate.poNumber, candidate.piNumber].some((number) => number !== null && normalizeReference(number) === wanted),
  );
  return order ? outboundTarget(order) : null;
}

/** The same facts for a shipment we already track, read fresh so a changed due date or a newly captured order shows at once. */
async function currentTarget(deps: Pick<Deps, "db" | "navision">, shipment: ShipmentRow): Promise<ShipmentTarget | null> {
  if (shipment.direction === "inbound") {
    const purchaseOrder = await deps.navision.getPurchaseOrder(shipment.reference);
    return purchaseOrder ? inboundTarget(deps, purchaseOrder) : null;
  }
  const order = await deps.db.order.findUnique({ where: { orderNo: shipment.reference } });
  return order ? outboundTarget(order) : null;
}

// ------------------------------------------------------------------------------------- what Navision knows about a purchase

export type InboundFacts = {
  purchaseOrder: NavPurchaseOrder | null;
  /** What was ordered on the vendor PO. */
  ordered: QtyLine[] | null;
  goodsReceipt: NavGoodsReceipt | null;
  /** Received quantities from Navision's goodsReceipts file (assumption A1). Null when no receipt is recorded yet. */
  received: QtyLine[] | null;
  dueAt: Date | null;
};

/** Reads the ordered and received quantities of a vendor PO from Navision. Shared by the app and the golden test. */
export async function readInboundFacts(navision: Deps["navision"], poNumber: string): Promise<InboundFacts> {
  const purchaseOrder = await navision.getPurchaseOrder(poNumber);
  const goodsReceipt = await navision.getGoodsReceipt(poNumber);
  return {
    purchaseOrder,
    ordered: purchaseOrder ? purchaseOrder.lines.map((line) => ({ partNo: line.itemNo, quantity: line.quantity })) : null,
    goodsReceipt,
    received: goodsReceipt ? goodsReceipt.lines.map((line) => ({ partNo: line.itemNo, quantity: line.receivedQty })) : null,
    dueAt: purchaseOrder?.documentsDueAt ? new Date(purchaseOrder.documentsDueAt) : null,
  };
}

// ------------------------------------------------------------------------------------- one shipment, checked

export type ShipmentDocumentView = {
  link: ShipmentDocumentRow;
  document: DocumentRow;
  type: DocumentType;
  fields: ExtractedField[];
  edits: FieldEdit[];
  values: FieldValues;
};

export type ShipmentView = {
  shipment: ShipmentRow;
  direction: Direction;
  reference: string;
  partyName: string;
  orderNo: string | null;
  dueAt: Date | null;
  /** Confirmed documents attached to this shipment. */
  documents: ShipmentDocumentView[];
  /** Documents that arrived for this shipment but whose type nobody has confirmed yet. */
  pending: DocumentRow[];
  goodsReceipt: NavGoodsReceipt | null;
  rows: ReconciliationRow[];
  checklist: ChecklistItem[];
  /** Every finding, each with the resolution a person recorded for it (if any). */
  flags: FlagWithDecision[];
  status: ShipmentStatus;
};

/** References that mean this shipment when they appear on a document. */
async function acceptedReferences(deps: Pick<Deps, "db">, shipment: ShipmentRow): Promise<string[]> {
  if (shipment.direction === "inbound") return [normalizeReference(shipment.reference)];
  const order = await deps.db.order.findUnique({ where: { orderNo: shipment.reference } });
  return [shipment.reference, order?.poNumber ?? "", order?.piNumber ?? ""].map(normalizeReference).filter((reference) => reference.length > 0);
}

/**
 * Gathers a shipment's documents and Navision data and runs the story 5 rules on them. Always computed fresh:
 * a new goods receipt in Navision, a corrected value or a passing due date shows the next time anyone looks.
 */
export async function loadShipmentView(deps: Pick<Deps, "db" | "navision" | "config">, shipment: ShipmentRow, now: Date): Promise<ShipmentView> {
  const target = await currentTarget(deps, shipment);
  const direction = shipment.direction as Direction;

  const links = await deps.db.shipmentDocument.findMany({ where: { shipmentNo: shipment.shipmentNo }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const documents: ShipmentDocumentView[] = [];
  for (const link of links) {
    const row = await deps.db.document.findUnique({ where: { id: link.documentId } });
    if (!row) continue;
    const loaded = await loadDocumentRow(deps, row);
    if (loaded.type) documents.push({ link, document: row, type: loaded.type, fields: loaded.fields, edits: loaded.edits, values: loaded.values });
  }

  const accepted = await acceptedReferences(deps, shipment);
  const waiting = await deps.db.document.findMany({
    where: { typeStatus: "detected", detectedType: { in: SHIPMENT_DOCUMENT_TYPES }, reference: { not: null } },
    orderBy: { receivedAt: "asc" },
  });
  const pending = waiting.filter((document) => accepted.includes(normalizeReference(document.reference ?? "")));

  let ordered: QtyLine[] | null = null;
  let received: QtyLine[] | null = null;
  let goodsReceipt: NavGoodsReceipt | null = null;
  if (direction === "inbound") {
    const facts = await readInboundFacts(deps.navision, shipment.reference);
    ({ ordered, received, goodsReceipt } = facts);
  } else {
    const fulfilment = await getFulfilment(deps, shipment.reference);
    ordered = fulfilment ? fulfilment.lines.map((line) => ({ partNo: line.itemNo, quantity: line.ordered })) : null;
  }

  const dueAt = target ? target.dueAt : shipment.dueDate;
  const assessment = assessShipment({
    direction,
    reference: shipment.reference,
    ordered,
    documents: documents.map((entry) => ({ type: entry.type, values: entry.values })),
    pendingTypes: pending.map((document) => document.detectedType).filter(isDocumentType),
    received,
    dueAt,
    now,
    alertWindowHours: deps.config.documentAlertWindowHours,
  });
  const flags = sortFlags(attachDecisions(assessment.flags, await listFlagDecisions(deps, "shipment", shipment.shipmentNo)));
  return {
    shipment,
    direction,
    reference: shipment.reference,
    partyName: target?.partyName ?? shipment.partyName,
    orderNo: target ? target.orderNo : shipment.orderNo,
    dueAt,
    documents,
    pending,
    goodsReceipt,
    rows: assessment.rows,
    checklist: assessment.checklist,
    flags,
    status: deriveShipmentStatus(flags),
  };
}

export async function getShipment(deps: Pick<Deps, "db" | "navision" | "config" | "clock">, shipmentNo: string): Promise<ShipmentView> {
  const shipment = await deps.db.shipment.findUnique({ where: { shipmentNo } });
  if (!shipment) throw new UserError(`Shipment ${shipmentNo} does not exist.`);
  return loadShipmentView(deps, shipment, deps.clock.now());
}

/** The audit trail of a shipment: its own events and those of its documents (received, type confirmed, values corrected), oldest first. */
export async function listShipmentTimeline(deps: Pick<Deps, "db">, view: ShipmentView): Promise<TimelineEntry[]> {
  const entries = await listEntityTimeline(deps, "shipment", view.shipment.shipmentNo);
  for (const document of [...view.documents.map((entry) => entry.document), ...view.pending]) {
    entries.push(...(await listEntityTimeline(deps, "document", document.id)));
  }
  return entries.sort((a, b) => a.id - b.id);
}

const STATUS_ORDER: Record<ShipmentStatus, number> = { needs_review: 0, waiting: 1, resolved: 2, verified: 3 };

/** Every tracked shipment, checked. The ones that need a person come first, then the earliest due date. */
export async function listShipments(deps: Pick<Deps, "db" | "navision" | "config" | "clock">, now: Date = deps.clock.now()): Promise<ShipmentView[]> {
  const shipments = await deps.db.shipment.findMany({ orderBy: { shipmentNo: "asc" } });
  const views: ShipmentView[] = [];
  for (const shipment of shipments) views.push(await loadShipmentView(deps, shipment, now));
  const dueTime = (view: ShipmentView): number => view.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
  return views.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || dueTime(a) - dueTime(b));
}

export type UnmatchedDocument = { document: DocumentRow; type: DocumentType; reference: string | null; flag: Flag };

/** Confirmed shipping documents whose reference matched no vendor PO and no order. A person links them by hand. */
export async function listUnmatchedDocuments(deps: Pick<Deps, "db">): Promise<UnmatchedDocument[]> {
  const rows = await deps.db.document.findMany({ where: { typeStatus: "confirmed", routedKind: "shipment", routedId: null }, orderBy: { receivedAt: "asc" } });
  const unmatched: UnmatchedDocument[] = [];
  for (const row of rows) {
    const loaded = await loadDocumentRow(deps, row);
    if (!loaded.type) continue;
    const reference = referenceOn(loaded.type, loaded.values);
    unmatched.push({ document: row, type: loaded.type, reference, flag: referenceNotFound(row.fileName, reference) });
  }
  return unmatched;
}

function referenceOn(type: DocumentType, values: FieldValues): string | null {
  const key = DOCUMENT_SPECS[type].referenceField;
  return key ? (values[key] ?? null) : null;
}

function referenceNotFound(fileName: string, reference: string | null): Flag {
  return makeFlag({
    code: "REFERENCE_NOT_FOUND",
    field: "reference",
    reason: reference
      ? `The reference "${reference}" on ${fileName} matches no vendor PO in Navision and no open order. Link it to a shipment by hand.`
      : `No reference could be read from ${fileName}. Link it to a shipment by hand.`,
    values: [reference],
  });
}

export type ShipmentTiles = { total: number; needsReview: number; waiting: number; dueAlerts: number; unmatchedDocuments: number };

/** Counts for the tiles on the shipments page, computed from the same checked shipments the table shows. */
export function summarizeShipments(views: ShipmentView[], unmatchedDocuments: number): ShipmentTiles {
  const hasOpenDueFlag = (view: ShipmentView): boolean =>
    view.flags.some((flag) => (flag.code === "DOCUMENT_DUE_SOON" || flag.code === "DOCUMENT_OVERDUE") && flag.decision === null);
  return {
    total: views.length,
    needsReview: views.filter((view) => view.status === "needs_review").length,
    waiting: views.filter((view) => view.status === "waiting").length,
    dueAlerts: views.filter(hasOpenDueFlag).length,
    unmatchedDocuments,
  };
}

// ------------------------------------------------------------------------------------- starting and filling a shipment

async function findOrCreateShipment(deps: Pick<Deps, "db" | "clock">, actor: Actor, target: ShipmentTarget): Promise<{ shipment: ShipmentRow; created: boolean }> {
  const existing = await deps.db.shipment.findUnique({ where: { direction_reference: { direction: target.direction, reference: target.reference } } });
  if (existing) return { shipment: await refreshShipmentRow(deps, existing, target), created: false };

  const shipmentNo = await nextReference(deps, "shipment");
  const shipment = await deps.db.shipment.create({
    data: {
      shipmentNo,
      direction: target.direction,
      reference: target.reference,
      partyName: target.partyName,
      orderNo: target.orderNo,
      dueDate: target.dueAt,
      createdAt: deps.clock.now(),
    },
  });
  await recordAudit(deps, {
    actor,
    action: "shipment_created",
    entityType: "shipment",
    entityId: shipmentNo,
    orderNo: target.orderNo,
    summary:
      `${shipmentNo} now tracks the ${target.direction === "inbound" ? "incoming shipment for vendor PO" : "outgoing shipment for order"} ${target.reference} (${target.partyName})` +
      (target.dueAt ? `. Required documents are due on ${formatDateTime(target.dueAt)}.` : ". No due date is known for its documents."),
  });
  return { shipment, created: true };
}

/** Keeps the stored copy of party, order and due date in step with Navision and the order (used for lists and as a fallback). */
async function refreshShipmentRow(deps: Pick<Deps, "db">, shipment: ShipmentRow, target: ShipmentTarget): Promise<ShipmentRow> {
  const sameDue = (shipment.dueDate?.getTime() ?? null) === (target.dueAt?.getTime() ?? null);
  if (shipment.partyName === target.partyName && shipment.orderNo === target.orderNo && sameDue) return shipment;
  return deps.db.shipment.update({
    where: { shipmentNo: shipment.shipmentNo },
    data: { partyName: target.partyName, orderNo: target.orderNo, dueDate: target.dueAt },
  });
}

/** Writes what the rules found to the audit trail, so the timeline shows when a difference was first seen. */
async function recordCheck(deps: Pick<Deps, "db" | "navision" | "config" | "clock">, shipmentNo: string): Promise<ShipmentView> {
  const view = await getShipment(deps, shipmentNo);
  const open = view.flags.filter((flag) => flag.severity !== "info" && flag.decision === null);
  await recordAudit(deps, {
    actor: SYSTEM_ACTOR,
    action: "shipment_checked",
    entityType: "shipment",
    entityId: shipmentNo,
    orderNo: view.orderNo,
    summary:
      open.length === 0
        ? `${shipmentNo} (${view.reference}) was checked: nothing needs review.`
        : `${shipmentNo} (${view.reference}) was checked: ${open.length} finding${open.length === 1 ? "" : "s"} for a person to review. ${open.map((flag) => flag.reason).join(" ")}`,
  });
  return view;
}

async function addDocument(deps: Pick<Deps, "db" | "navision" | "config" | "clock">, actor: Actor, document: DocumentRow, type: DocumentType, target: ShipmentTarget, how: string): Promise<string> {
  const { shipment } = await findOrCreateShipment(deps, actor, target);
  await deps.db.shipmentDocument.create({ data: { shipmentNo: shipment.shipmentNo, documentId: document.id, docType: type, createdAt: deps.clock.now() } });
  await recordAudit(deps, {
    actor,
    action: "shipment_document_added",
    entityType: "shipment",
    entityId: shipment.shipmentNo,
    orderNo: target.orderNo,
    summary: `${documentTypeLabel(type)} ${document.fileName} was added to ${shipment.shipmentNo} (${target.reference}) ${how}.`,
  });
  await recordCheck(deps, shipment.shipmentNo);
  return shipment.shipmentNo;
}

/**
 * Routes a confirmed shipping document: its reference decides the shipment. A reference that matches nothing
 * is not guessed at: the document waits in "Documents that match no shipment" for a person to link it.
 */
export async function attachShipmentDocument(deps: Pick<Deps, "db" | "navision" | "config" | "clock">, actor: Actor, document: DocumentRow): Promise<{ shipmentNo: string | null }> {
  const loaded = await loadDocumentRow(deps, document);
  requireThat(loaded.type, "Confirm the document type first.");
  const reference = referenceOn(loaded.type, loaded.values);
  const target = await resolveShipmentTarget(deps, reference);
  if (!target) {
    await recordAudit(deps, {
      actor: SYSTEM_ACTOR,
      action: "shipment_checked",
      entityType: "document",
      entityId: document.id,
      summary: referenceNotFound(document.fileName, reference).reason,
    });
    return { shipmentNo: null };
  }
  return { shipmentNo: await addDocument(deps, actor, document, loaded.type, target, "by its reference") };
}

/** Undoes attachShipmentDocument when a person changes the document's type. The shipment itself stays. */
export async function detachShipmentDocument(deps: Pick<Deps, "db" | "clock">, actor: Actor, document: DocumentRow): Promise<void> {
  const link = await deps.db.shipmentDocument.findUnique({ where: { documentId: document.id } });
  if (!link) return;
  await deps.db.shipmentDocument.delete({ where: { id: link.id } });
  const shipment = await deps.db.shipment.findUnique({ where: { shipmentNo: link.shipmentNo } });
  await recordAudit(deps, {
    actor,
    action: "shipment_document_added",
    entityType: "shipment",
    entityId: link.shipmentNo,
    orderNo: shipment?.orderNo ?? null,
    summary: `${document.fileName} was taken off ${link.shipmentNo} because ${actor.name} changed its document type.`,
  });
}

/** A person links a document whose reference matched nothing to a shipment, by typing the vendor PO or order number. */
export async function linkDocumentToShipment(deps: Pick<Deps, "db" | "navision" | "config" | "clock">, actor: Actor, input: { documentId: string; reference: string }): Promise<string> {
  requireShipmentRole(actor);
  const document = await deps.db.document.findUnique({ where: { id: input.documentId } });
  requireThat(document && document.typeStatus === "confirmed" && document.routedKind === "shipment", "Only a confirmed shipping document can be linked to a shipment.");
  requireThat(!document.routedId, `This document already belongs to ${document.routedId}.`);
  const loaded = await loadDocumentRow(deps, document);
  requireThat(loaded.type, "Confirm the document type first.");
  const target = await resolveShipmentTarget(deps, input.reference);
  requireThat(target, `"${input.reference}" matches no vendor PO in Navision and no open order. Enter a vendor PO number or an order number.`);
  const shipmentNo = await addDocument(deps, actor, document, loaded.type, target, `by hand by ${actor.name}`);
  await deps.db.document.update({ where: { id: document.id }, data: { routedId: shipmentNo } });
  return shipmentNo;
}

/**
 * A person starts tracking a shipment before any of its documents has arrived, by entering a vendor PO or order number.
 * From then on its missing documents are flagged and alerted like any other shipment's.
 */
export async function trackShipment(deps: Pick<Deps, "db" | "navision" | "clock">, actor: Actor, reference: string): Promise<{ shipmentNo: string; created: boolean }> {
  requireShipmentRole(actor);
  requireThat(reference.trim().length > 0, "Enter a vendor PO number or an order number.");
  const target = await resolveShipmentTarget(deps, reference);
  requireThat(target, `"${reference}" matches no vendor PO in Navision and no open order.`);
  const { shipment, created } = await findOrCreateShipment(deps, actor, target);
  return { shipmentNo: shipment.shipmentNo, created };
}

/** A person corrects values the reader got wrong on a shipping document. Each change is an audit event; the check runs again. */
export async function editShipmentDocument(
  deps: Pick<Deps, "db" | "navision" | "config" | "clock">,
  actor: Actor,
  input: { shipmentNo: string; documentId: string; changes: { field: string; value: string | null }[] },
): Promise<number> {
  requireShipmentRole(actor);
  const view = await getShipment(deps, input.shipmentNo);
  requireThat(view.documents.some((entry) => entry.document.id === input.documentId), "That document does not belong to this shipment.");
  let changed = 0;
  for (const change of input.changes) {
    if ((await editDocumentField(deps, actor, { documentId: input.documentId, field: change.field, value: change.value, orderNo: view.orderNo })).changed) changed++;
  }
  if (changed > 0) await recordCheck(deps, input.shipmentNo);
  return changed;
}

// ------------------------------------------------------------------------------------- actions on the exception review page

function requiredDocument(key: string) {
  const required = REQUIRED_DOCUMENTS.find((candidate) => candidate.key === key);
  if (!required) throw new UserError("Choose one of the required documents.");
  return required;
}

/** Asks the other party for a missing document. The request is written to the Outbox and recorded on the shipment. */
export async function requestDocument(deps: Deps, actor: Actor, input: { shipmentNo: string; documentKey: string }): Promise<void> {
  requireShipmentRole(actor);
  const view = await getShipment(deps, input.shipmentNo);
  const required = requiredDocument(input.documentKey);
  const item = view.checklist.find((candidate) => candidate.key === (required.key as RequiredDocumentKey));
  requireThat(item?.status === "missing", `${required.label} is not missing for ${view.reference}.`);

  // Purchases: ask the vendor. Sales: ask the warehouse, which prepares the outgoing papers (assumption A25).
  let party: { name: string; email: string };
  if (view.direction === "inbound") {
    const purchaseOrder = await deps.navision.getPurchaseOrder(view.reference);
    const vendor = purchaseOrder ? await deps.navision.getVendor(purchaseOrder.vendorId) : null;
    party = { name: view.partyName, email: vendor?.email || "(no email address on the vendor card)" };
  } else {
    party = (await deps.navision.getStaffDirectory()).warehouseContact;
  }
  const result = await deps.notifier.send(
    buildDocumentRequest(party, { shipmentNo: view.shipment.shipmentNo, reference: view.reference, documentLabel: required.label, requestedBy: actor.name, orderNo: view.orderNo }),
  );
  await recordAudit(deps, {
    actor,
    action: "document_requested",
    entityType: "shipment",
    entityId: view.shipment.shipmentNo,
    orderNo: view.orderNo,
    field: required.key,
    newValue: `Outbox message ${result.id}`,
    summary: `${actor.name} requested the ${required.label} for ${view.reference} from ${party.name}.`,
  });
}

/** Staff who can be given a shipment to follow up: the purchase team and sales team members. */
export async function listAssignees(deps: Pick<Deps, "navision">): Promise<StaffMember[]> {
  return (await deps.navision.getStaffDirectory()).staff.filter((member) => member.role === "purchase" || member.role === "sales");
}

/** Gives the shipment to a team member to follow up. They are told through the Outbox. */
export async function assignShipment(deps: Deps, actor: Actor, input: { shipmentNo: string; staffId: string }): Promise<void> {
  requireShipmentRole(actor);
  const view = await getShipment(deps, input.shipmentNo);
  const assignee = (await listAssignees(deps)).find((member) => member.id === input.staffId);
  requireThat(assignee, "Choose a team member from the purchase or sales team.");
  requireThat(view.shipment.assigneeName !== assignee.name, `${view.shipment.shipmentNo} is already assigned to ${assignee.name}.`);

  await deps.db.shipment.update({ where: { shipmentNo: view.shipment.shipmentNo }, data: { assigneeName: assignee.name } });
  const open = view.flags.filter((flag) => flag.severity !== "info" && flag.decision === null);
  await deps.notifier.send(
    buildTaskAssigned(assignee, {
      shipmentNo: view.shipment.shipmentNo,
      reference: view.reference,
      assignedBy: actor.name,
      summary: open.length === 0 ? "Nothing needs review at the moment." : `To review:\n${open.map((flag) => `- ${flag.reason}`).join("\n")}`,
      orderNo: view.orderNo,
    }),
  );
  await recordAudit(deps, {
    actor,
    action: "shipment_assigned",
    entityType: "shipment",
    entityId: view.shipment.shipmentNo,
    orderNo: view.orderNo,
    field: "assignee",
    oldValue: view.shipment.assigneeName,
    newValue: assignee.name,
    summary: `${actor.name} assigned ${view.shipment.shipmentNo} (${view.reference}) to ${assignee.name}.`,
  });
}

/**
 * A person records the outcome of a finding (for example "vendor will ship the 5 missing units next week").
 * It needs a reason and the person's name, and it is tied to this exact finding: if the quantities change, or a missing
 * document becomes overdue, that is a new finding and needs a new decision. Nothing is ever closed automatically.
 * Invariant test: tests/invariants/override-needs-reason.test.ts
 */
export async function recordResolution(deps: Pick<Deps, "db" | "navision" | "config" | "clock">, actor: Actor, input: { shipmentNo: string; fingerprint: string; reason: string }): Promise<void> {
  requireShipmentRole(actor);
  const view = await getShipment(deps, input.shipmentNo);
  const flag = view.flags.find((candidate) => candidate.fingerprint === input.fingerprint);
  requireThat(flag, "That finding has changed since the page was loaded (a document or quantity is different now). Check the page again.");
  requireThat(flag.severity !== "info", "This is a note, not an exception. There is nothing to resolve.");
  requireThat(!flag.decision, `This finding already has a resolution recorded by ${flag.decision?.byName}.`);
  const problem = validateDecisionInput(flag, { reason: input.reason, byName: actor.name }, "resolution");
  if (problem) throw new UserError(problem);

  const reason = input.reason.trim();
  await deps.db.flagDecision.create({
    data: {
      entityType: "shipment",
      entityId: view.shipment.shipmentNo,
      kind: "resolution",
      flagCode: flag.code,
      field: flag.field,
      fingerprint: flag.fingerprint,
      reason,
      byName: actor.name,
      byRole: actor.role,
      at: deps.clock.now(),
    },
  });
  await recordAudit(deps, {
    actor,
    action: "flag_resolution",
    entityType: "shipment",
    entityId: view.shipment.shipmentNo,
    orderNo: view.orderNo,
    field: flag.field,
    oldValue: "open",
    newValue: "resolved",
    reason,
    summary: `${actor.name} recorded a resolution for "${flagTitle(flag.code)}" on ${view.shipment.shipmentNo}: ${flag.reason}`,
  });
}

/** Takes a recorded resolution back, for example when it was recorded against the wrong finding. The finding is open again. */
export async function reopenFinding(deps: Pick<Deps, "db" | "navision" | "config" | "clock">, actor: Actor, input: { shipmentNo: string; fingerprint: string }): Promise<void> {
  requireShipmentRole(actor);
  const view = await getShipment(deps, input.shipmentNo);
  const flag = view.flags.find((candidate) => candidate.fingerprint === input.fingerprint);
  requireThat(flag?.decision, "There is no recorded resolution to take back.");
  await deps.db.flagDecision.deleteMany({ where: { entityType: "shipment", entityId: view.shipment.shipmentNo, fingerprint: flag.fingerprint } });
  await recordAudit(deps, {
    actor,
    action: "flag_resolution",
    entityType: "shipment",
    entityId: view.shipment.shipmentNo,
    orderNo: view.orderNo,
    field: flag.field,
    oldValue: "resolved",
    newValue: "open",
    reason: flag.decision.reason,
    summary: `${actor.name} reopened "${flagTitle(flag.code)}" on ${view.shipment.shipmentNo}. The earlier resolution by ${flag.decision.byName} no longer counts.`,
  });
}

// ------------------------------------------------------------------------------------- due-date alerts

/** Who is told about a shipment: the person it is assigned to, otherwise the purchase team (purchases) or sales (sales). */
async function ownerOf(deps: Pick<Deps, "navision">, view: ShipmentView): Promise<StaffMember | null> {
  const staff = (await deps.navision.getStaffDirectory()).staff;
  const assigned = view.shipment.assigneeName ? staff.find((member) => member.name === view.shipment.assigneeName) : null;
  return assigned ?? staff.find((member) => member.role === (view.direction === "inbound" ? "purchase" : "sales")) ?? null;
}

/**
 * Run by runDueJobs: writes an alert to the Outbox when a required document is still missing inside the alert window
 * before its due date, and again once the due date has passed. Each alert is written once. An alert is a reminder to a person;
 * it does not stop or change anything.
 */
export async function documentDueAlertSweep(deps: Deps, now: Date): Promise<string[]> {
  const lines: string[] = [];
  for (const view of await listShipments(deps, now)) {
    if (!view.dueAt) continue;
    const target = await currentTarget(deps, view.shipment);
    if (target) await refreshShipmentRow(deps, view.shipment, target);

    for (const code of ["DOCUMENT_DUE_SOON", "DOCUMENT_OVERDUE"] as const) {
      // A finding a person already recorded an outcome for needs no further reminder.
      const open = view.flags.filter((flag) => flag.code === code && flag.decision === null);
      if (open.length === 0) continue;
      const owner = await ownerOf(deps, view);
      if (!owner) continue;
      const labels = open.map((flag) => REQUIRED_DOCUMENTS.find((required) => required.key === flag.field)?.label ?? flag.field);
      const overdue = code === "DOCUMENT_OVERDUE";
      const result = await deps.notifier.send(
        buildDocumentDueAlert(owner, {
          shipmentNo: view.shipment.shipmentNo,
          reference: view.reference,
          partyName: view.partyName,
          documentLabels: labels,
          dueAt: view.dueAt,
          overdue,
          orderNo: view.orderNo,
        }),
      );
      if (result.duplicate) continue;
      const line = `${view.shipment.shipmentNo}: due-date alert sent to ${owner.name} (${labels.join(", ")} ${overdue ? "overdue" : "due soon"} for ${view.reference}).`;
      lines.push(line);
      await recordAudit(deps, {
        actor: SYSTEM_ACTOR,
        action: "due_date_alert",
        entityType: "shipment",
        entityId: view.shipment.shipmentNo,
        orderNo: view.orderNo,
        summary: `Due-date alert sent to ${owner.name}: ${labels.join(", ")} ${overdue ? "overdue" : "due soon"} for ${view.reference} (due ${formatDateTime(view.dueAt)}).`,
      });
    }
  }
  return lines;
}
