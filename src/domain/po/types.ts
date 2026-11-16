// What: the typed view of a customer PO, built from a document's current field values.
// Who calls it: PO checks, the export builder and the review pages.
// To extend: when you add a customer_po field in src/domain/documents.ts, add it to CustomerPo and toCustomerPo here.
import { type FieldValues, isLineRemoved, lineIndexes, lineKey } from "../fields";

export type PoKind = "new" | "amendment" | "cancellation";

export type PoLine = {
  index: number; // position in the document, starting at 0 (field keys use it: "lines[0].partNo")
  partNo: string | null;
  description: string | null;
  quantity: string | null; // kept as text exactly as read or typed; rules parse it
  unitPrice: string | null;
  lineTotal: string | null;
  removed: boolean;
};

export type CustomerPo = {
  poNumber: string | null;
  poKind: PoKind;
  poKindText: string | null; // the marking as written, for example "AMENDMENT 1"
  orderDate: string | null;
  customerName: string | null;
  customerAddress: string | null;
  currency: string | null;
  paymentTerms: string | null;
  partialShipment: string | null;
  totalAmount: string | null;
  promisedShipDate: string | null; // typed by staff
  lines: PoLine[];
};

/** Reads the PO marking. "AMENDMENT 1" or "REVISED" means amendment; anything with "CANCEL" means cancellation. */
export function detectPoKind(marking: string | null): PoKind {
  if (!marking) return "new";
  const text = marking.toUpperCase();
  if (text.includes("CANCEL")) return "cancellation";
  if (text.includes("AMEND") || text.includes("REVIS")) return "amendment";
  return "new";
}

export function toCustomerPo(values: FieldValues): CustomerPo {
  const lines: PoLine[] = lineIndexes(values).map((index) => ({
    index,
    partNo: values[lineKey(index, "partNo")] ?? null,
    description: values[lineKey(index, "description")] ?? null,
    quantity: values[lineKey(index, "quantity")] ?? null,
    unitPrice: values[lineKey(index, "unitPrice")] ?? null,
    lineTotal: values[lineKey(index, "lineTotal")] ?? null,
    removed: isLineRemoved(values, index),
  }));
  return {
    poNumber: values.poNumber ?? null,
    poKind: detectPoKind(values.poKind ?? null),
    poKindText: values.poKind ?? null,
    orderDate: values.orderDate ?? null,
    customerName: values.customerName ?? null,
    customerAddress: values.customerAddress ?? null,
    currency: values.currency ?? null,
    paymentTerms: values.paymentTerms ?? null,
    partialShipment: values.partialShipment ?? null,
    totalAmount: values.totalAmount ?? null,
    promisedShipDate: values.promisedShipDate ?? null,
    lines,
  };
}

/** Lines that are still part of the order (not removed by a person). */
export function activeLines(po: CustomerPo): PoLine[] {
  return po.lines.filter((line) => !line.removed);
}

/** True when the PO says partial shipment is allowed ("Allowed", "Yes", "Accepted"). */
export function partialShipmentAllowed(po: CustomerPo): boolean {
  const text = (po.partialShipment ?? "").toLowerCase();
  if (text.includes("not") || text.startsWith("no")) return false;
  return text.includes("allow") || text.includes("yes") || text.includes("accept");
}
