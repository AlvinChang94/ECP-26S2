// What: compares two versions of a customer PO (an amendment with the version before it) and builds the cancellation file.
// Who calls it: the review, preview and order pages (to show what an amended PO changed) and the export service.
// To extend: lines are matched by part number; add a field to HEADER_FIELDS to have it compared too.
import type { SalesOrderExport } from "./exportFile";
import { activeLines, type CustomerPo, type PoLine } from "./types";

const HEADER_FIELDS: { key: keyof CustomerPo; label: string }[] = [
  { key: "customerName", label: "Customer" },
  { key: "orderDate", label: "PO date" },
  { key: "currency", label: "Currency" },
  { key: "paymentTerms", label: "Payment terms" },
  { key: "partialShipment", label: "Partial shipment" },
  { key: "promisedShipDate", label: "Promised ship date" },
];

export type LineChange = {
  partNo: string;
  change: "added" | "removed" | "changed";
  before: { quantity: string | null; unitPrice: string | null } | null;
  after: { quantity: string | null; unitPrice: string | null } | null;
};

export type PoVersionDiff = {
  header: { label: string; before: string | null; after: string | null }[];
  lines: LineChange[];
  /** True when nothing differs. */
  identical: boolean;
};

function lineValues(line: PoLine): { quantity: string | null; unitPrice: string | null } {
  return { quantity: line.quantity, unitPrice: line.unitPrice };
}

/** What changed from `previous` to `next`. Lines are paired by part number, in order. */
export function diffPoVersions(previous: CustomerPo, next: CustomerPo): PoVersionDiff {
  const header = HEADER_FIELDS.map(({ key, label }) => ({ label, before: previous[key] as string | null, after: next[key] as string | null })).filter(
    (entry) => (entry.before ?? null) !== (entry.after ?? null),
  );

  const remaining = [...activeLines(previous)];
  const lines: LineChange[] = [];
  for (const line of activeLines(next)) {
    const partNo = line.partNo ?? "(no part number)";
    const index = remaining.findIndex((candidate) => candidate.partNo === line.partNo);
    if (index === -1) {
      lines.push({ partNo, change: "added", before: null, after: lineValues(line) });
      continue;
    }
    const [match] = remaining.splice(index, 1);
    if (match.quantity !== line.quantity || match.unitPrice !== line.unitPrice) {
      lines.push({ partNo, change: "changed", before: lineValues(match), after: lineValues(line) });
    }
  }
  for (const line of remaining) {
    lines.push({ partNo: line.partNo ?? "(no part number)", change: "removed", before: lineValues(line), after: null });
  }
  return { header, lines, identical: header.length === 0 && lines.length === 0 };
}

/**
 * The file that tells Navision an exported order is cancelled: the last exported content,
 * with the next revision number and status "cancelled". Nothing else is altered.
 */
export function buildCancellationExport(lastExport: SalesOrderExport, revision: number): SalesOrderExport {
  return { ...lastExport, revision, status: "cancelled" };
}
