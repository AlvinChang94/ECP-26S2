// What: story 5 rules. Compares quantities per part (invoice, packing list, received) and checks the required documents against the due date.
// Who calls it: the shipments service (with documents and Navision data) and the golden test.
// To extend: add a required document to REQUIRED_DOCUMENTS, or a comparison in reconcileQuantities. We detect and alert; we never prevent.
import type { DocumentType } from "../documents";
import { type FieldValues, lineIndexes, lineKey } from "../fields";
import { type Flag, type FlagWithDecision, makeFlag } from "../flags";
import { parseQuantity } from "../money";
import { addHours, describeTimeUntil, formatDateTime } from "../time";

export type Direction = "inbound" | "outbound";
export type QtyLine = { partNo: string; quantity: number };

// ------------------------------------------------------------------------------------- required documents

export type RequiredDocumentKey = "invoice" | "packing_list" | "awb_bl" | "import_permit";

export type RequiredDocument = {
  key: RequiredDocumentKey;
  label: string;
  /** Document types that satisfy this requirement. */
  types: DocumentType[];
};

/** The documents every tracked shipment needs (assumption A9: the same four for purchases and sales). */
export const REQUIRED_DOCUMENTS: RequiredDocument[] = [
  { key: "invoice", label: "Invoice", types: ["vendor_invoice"] },
  { key: "packing_list", label: "Packing list", types: ["packing_list"] },
  { key: "awb_bl", label: "AWB or BL", types: ["awb_bl"] },
  { key: "import_permit", label: "Import permit", types: ["import_permit"] },
];

/** Document types that belong to a shipment (required ones plus the goods receipt note, which is evidence only). */
export const SHIPMENT_DOCUMENT_TYPES: DocumentType[] = ["vendor_invoice", "packing_list", "awb_bl", "import_permit", "goods_receipt"];

export type ChecklistStatus = "present" | "missing" | "pending_check";
export type ChecklistItem = { key: RequiredDocumentKey; label: string; status: ChecklistStatus };

export const CHECKLIST_STATUS_LABELS: Record<ChecklistStatus, string> = {
  present: "Present",
  missing: "Missing",
  pending_check: "Pending check",
};

export type ChecklistInput = {
  /** Types of the documents a person has confirmed for this shipment. */
  confirmedTypes: DocumentType[];
  /** Types of documents that arrived for this shipment but whose type nobody has confirmed yet. */
  pendingTypes: DocumentType[];
  /** When the required documents are due. Null when no due date is known. */
  dueAt: Date | null;
  now: Date;
  /** A missing document raises an alert this many hours before the due date. */
  alertWindowHours: number;
};

/**
 * Present = a confirmed document of that kind is attached. Pending check = one arrived but nobody confirmed it yet.
 * Missing = neither. A missing document becomes "due soon" inside the alert window and "overdue" after the due date.
 */
export function buildChecklist(input: ChecklistInput): { items: ChecklistItem[]; flags: Flag[] } {
  const items: ChecklistItem[] = [];
  const flags: Flag[] = [];
  for (const required of REQUIRED_DOCUMENTS) {
    const present = required.types.some((type) => input.confirmedTypes.includes(type));
    const pending = required.types.some((type) => input.pendingTypes.includes(type));
    const status: ChecklistStatus = present ? "present" : pending ? "pending_check" : "missing";
    items.push({ key: required.key, label: required.label, status });

    if (status === "pending_check") {
      flags.push(
        makeFlag({
          code: "DOCUMENT_PENDING_CHECK",
          field: required.key,
          reason: `${required.label}: a document has arrived but nobody has confirmed its type yet. Confirm it in the Inbox; until then it does not count as present.`,
          values: [required.key],
        }),
      );
    }
    if (status !== "missing") continue;

    const due = input.dueAt;
    if (!due) {
      flags.push(makeFlag({ code: "DOCUMENT_MISSING", field: required.key, reason: `${required.label} is missing. No due date is known for it.`, values: [required.key] }));
    } else if (input.now.getTime() >= due.getTime()) {
      flags.push(
        makeFlag({
          code: "DOCUMENT_OVERDUE",
          field: required.key,
          reason: `${required.label} is still missing. It was due on ${formatDateTime(due)} (${describeTimeUntil(due, input.now)}).`,
          values: [required.key, due.toISOString()],
        }),
      );
    } else if (input.now.getTime() >= addHours(due, -input.alertWindowHours).getTime()) {
      flags.push(
        makeFlag({
          code: "DOCUMENT_DUE_SOON",
          field: required.key,
          reason: `${required.label} is still missing and is due on ${formatDateTime(due)} (${describeTimeUntil(due, input.now)}).`,
          values: [required.key, due.toISOString()],
        }),
      );
    } else {
      flags.push(
        makeFlag({
          code: "DOCUMENT_MISSING",
          field: required.key,
          reason: `${required.label} is missing. It is due on ${formatDateTime(due)}.`,
          values: [required.key, due.toISOString()],
        }),
      );
    }
  }
  return { items, flags };
}

// ------------------------------------------------------------------------------------- quantities

/** The part and quantity lines of a shipping document (invoice, packing list, goods receipt note). Unreadable lines are left out. */
export function quantityLines(values: FieldValues): QtyLine[] {
  const lines: QtyLine[] = [];
  for (const index of lineIndexes(values)) {
    const partNo = values[lineKey(index, "partNo")];
    const quantity = parseQuantity(values[lineKey(index, "quantity")]);
    if (partNo && quantity !== null) lines.push({ partNo, quantity });
  }
  return lines;
}

function totals(lines: QtyLine[] | null): Map<string, number> | null {
  if (lines === null) return null;
  const byPart = new Map<string, number>();
  for (const line of lines) byPart.set(line.partNo, (byPart.get(line.partNo) ?? 0) + line.quantity);
  return byPart;
}

export type ReconciliationRow = {
  partNo: string;
  /** What was ordered: from the vendor PO in Navision (purchases) or from the customer order (sales). */
  ordered: number | null;
  invoiced: number | null;
  packed: number | null;
  /** Received quantity from Navision's goods receipt. Purchases only. */
  received: number | null;
  status: "match" | "variance" | "waiting";
  /** A short description of the difference, for example "5 units short". Empty when the quantities agree. */
  note: string;
};

export type ReconcileInput = {
  direction: Direction;
  /** The vendor PO number or the order number, for the wording of reasons. */
  reference: string;
  ordered: QtyLine[] | null;
  /** Null when no invoice has been confirmed yet. */
  invoiced: QtyLine[] | null;
  packed: QtyLine[] | null;
  /** Purchases: quantities from Navision's goods receipt, null when none is recorded. Sales: always null. */
  received: QtyLine[] | null;
};

function units(count: number): string {
  return `${count} unit${count === 1 ? "" : "s"}`;
}

/**
 * Compares quantities per part. Purchases: invoice against packing list against received (the deck's
 * "invoiced 100, received 95: 5 units short"). Sales: ordered against invoice against packing list.
 */
export function reconcileQuantities(input: ReconcileInput): { rows: ReconciliationRow[]; flags: Flag[] } {
  const ordered = totals(input.ordered);
  const invoiced = totals(input.invoiced);
  const packed = totals(input.packed);
  const received = totals(input.received);
  const flags: Flag[] = [];

  const parts = new Set<string>();
  for (const source of [ordered, invoiced, packed, received]) {
    if (source) for (const partNo of source.keys()) parts.add(partNo);
  }

  // A part on the invoice that was never ordered is its own finding; its quantities are then not compared.
  const notOrdered = new Set<string>();
  if (ordered && invoiced) {
    const missingFromInvoice = [...ordered.keys()].filter((partNo) => !invoiced.has(partNo));
    for (const partNo of invoiced.keys()) {
      if (ordered.has(partNo)) continue;
      notOrdered.add(partNo);
      const expected = missingFromInvoice.length > 0 ? ` ${input.reference} has ${missingFromInvoice.join(", ")}, which is not on the invoice.` : "";
      flags.push(
        makeFlag({
          code: "INVOICE_PART_MISMATCH",
          field: partNo,
          reason: `The invoice lists ${partNo} (${invoiced.get(partNo)}), which is not on ${input.reference}.${expected}`,
          values: [partNo, invoiced.get(partNo), input.reference],
        }),
      );
    }
  }

  const rows: ReconciliationRow[] = [];
  for (const partNo of [...parts].sort()) {
    const row: ReconciliationRow = {
      partNo,
      ordered: ordered?.get(partNo) ?? null,
      invoiced: invoiced?.get(partNo) ?? null,
      packed: packed?.get(partNo) ?? null,
      received: received?.get(partNo) ?? null,
      status: "match",
      note: "",
    };
    if (notOrdered.has(partNo)) {
      rows.push({ ...row, status: "variance", note: `not on ${input.reference}` });
      continue;
    }

    // The quantities that must agree with each other.
    const compared: { label: string; quantity: number | null }[] =
      input.direction === "inbound"
        ? [
            { label: "invoiced", quantity: row.invoiced },
            { label: "packing list", quantity: row.packed },
            { label: "received", quantity: row.received },
          ]
        : [
            { label: "ordered", quantity: row.ordered },
            { label: "invoiced", quantity: row.invoiced },
            { label: "packing list", quantity: row.packed },
          ];
    const known = compared.filter((entry): entry is { label: string; quantity: number } => entry.quantity !== null);
    if (known.length < 2) {
      rows.push({ ...row, status: "waiting", note: "not enough documents yet to compare" });
      continue;
    }
    if (known.every((entry) => entry.quantity === known[0].quantity)) {
      rows.push({ ...row, status: input.direction === "inbound" && row.received === null ? "waiting" : "match", note: "" });
      continue;
    }

    // Describe the difference against the first quantity (the invoice for purchases, the order for sales).
    const base = known[0];
    const last = known[known.length - 1];
    const difference = last.quantity - base.quantity;
    const note = difference < 0 ? `${units(-difference)} short` : difference > 0 ? `${units(difference)} more than ${base.label}` : "quantities differ";
    rows.push({ ...row, status: "variance", note });
    flags.push(
      makeFlag({
        code: "QTY_VARIANCE",
        field: partNo,
        reason: `${partNo}: ${known.map((entry) => `${entry.label} ${entry.quantity}`).join(", ")}: ${note}.`,
        values: [partNo, ...known.map((entry) => `${entry.label}=${entry.quantity}`)],
        data: { partNo, difference: String(difference) },
      }),
    );
  }

  if (input.direction === "inbound" && received === null) {
    flags.push(
      makeFlag({
        code: "GOODS_RECEIPT_PENDING",
        field: "",
        reason: `Navision has no goods receipt for ${input.reference} yet, so the received quantities cannot be compared.`,
        values: [input.reference],
      }),
    );
  }
  return { rows, flags };
}

// ------------------------------------------------------------------------------------- the whole shipment

export type ShipmentAssessmentInput = {
  direction: Direction;
  reference: string;
  ordered: QtyLine[] | null;
  /** Confirmed documents with their current values. */
  documents: { type: DocumentType; values: FieldValues }[];
  pendingTypes: DocumentType[];
  received: QtyLine[] | null;
  dueAt: Date | null;
  now: Date;
  alertWindowHours: number;
};

export type ShipmentAssessment = { rows: ReconciliationRow[]; checklist: ChecklistItem[]; flags: Flag[] };

/** Everything story 5 checks for one shipment. Pure: the same documents, Navision data and time give the same result. */
export function assessShipment(input: ShipmentAssessmentInput): ShipmentAssessment {
  const linesOf = (type: DocumentType): QtyLine[] | null => {
    const documents = input.documents.filter((document) => document.type === type);
    return documents.length === 0 ? null : documents.flatMap((document) => quantityLines(document.values));
  };
  const quantities = reconcileQuantities({
    direction: input.direction,
    reference: input.reference,
    ordered: input.ordered,
    invoiced: linesOf("vendor_invoice"),
    packed: linesOf("packing_list"),
    received: input.received,
  });
  const checklist = buildChecklist({
    confirmedTypes: input.documents.map((document) => document.type),
    pendingTypes: input.pendingTypes,
    dueAt: input.dueAt,
    now: input.now,
    alertWindowHours: input.alertWindowHours,
  });
  return { rows: quantities.rows, checklist: checklist.items, flags: [...quantities.flags, ...checklist.flags] };
}

export type ShipmentStatus = "needs_review" | "waiting" | "resolved" | "verified";

export const SHIPMENT_STATUS_LABELS: Record<ShipmentStatus, string> = {
  needs_review: "Needs review",
  waiting: "Waiting",
  resolved: "Resolved by a person",
  verified: "No exceptions",
};

/**
 * needs_review: a blocking finding nobody has resolved. waiting: only non-urgent things are outstanding
 * (a document not yet due, no goods receipt yet). resolved: there were findings and a person recorded an outcome for each.
 * verified: nothing was found at all. A finding never closes by itself: it needs a recorded resolution.
 */
export function deriveShipmentStatus(flags: FlagWithDecision[]): ShipmentStatus {
  const open = flags.filter((flag) => flag.decision === null);
  if (open.some((flag) => flag.severity === "blocking")) return "needs_review";
  if (open.length > 0) return "waiting";
  return flags.some((flag) => flag.decision !== null) ? "resolved" : "verified";
}
