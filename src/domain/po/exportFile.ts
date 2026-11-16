// What: builds the exact file content that is written to Navision for a sales order or a new customer card.
// Who calls it: the export service (preview and approval) and the NavisionGateway (which checks the approved hash).
// To extend: add a property to SalesOrderExport and set it in buildSalesOrderExport; the preview shows it automatically.
import Decimal from "decimal.js";
import { formatMoney, lineTotal, parseMoney, parseQuantity, sumMoney } from "../money";
import type { NavCustomer, NavItem } from "../navision";
import { parseDateText } from "../time";
import { activeLines, type CustomerPo } from "./types";

export type SalesOrderExportLine = {
  lineNo: number;
  itemNo: string;
  description: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
};

export type SalesOrderExport = {
  schema: "orderflow.salesOrder.v1";
  orderNo: string;
  revision: number;
  status: "open" | "cancelled";
  customer: { customerNo: string | null; name: string; newCustomerCardFile: string | null };
  customerPoNumber: string;
  orderDate: string | null;
  promisedShipDate: string | null;
  currency: string;
  paymentTerms: "advance" | "credit";
  lines: SalesOrderExportLine[];
  totalAmount: string;
  /** Flagged differences that a person accepted, with their reason. Kept in the file so Navision users can see why. */
  acceptedDifferences: { flag: string; field: string; reason: string; acceptedBy: string }[];
  source: { fileName: string; sha256: string };
};

export type CustomerCardExport = {
  schema: "orderflow.customerCard.v1";
  name: string;
  address: string | null;
  country: string | null;
  email: string | null;
  paymentTerms: "advance" | "credit";
  currency: string;
  requestedForOrder: string;
};

/** The one way export files are turned into text. Preview, hash and the written file all use it. */
export function serializeExportFile(file: SalesOrderExport | CustomerCardExport): string {
  return JSON.stringify(file, null, 2) + "\n";
}

/** File name of a customer card inside export/customerCards: "Kathmandu Digital Hub" -> "kathmandu-digital-hub.json". */
export function customerCardFileName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "customer"}.json`;
}

export function salesOrderFileName(orderNo: string, revision: number): string {
  return `${orderNo}-r${revision}.json`;
}

export type ExportBuildInput = {
  orderNo: string;
  revision: number;
  status: "open" | "cancelled";
  po: CustomerPo;
  /** The Navision customer the PO was matched to, or null when a new customer card is proposed. */
  customer: NavCustomer | null;
  newCustomerCard: CustomerCardExport | null;
  /** Navision item per line index, where found. Used for the official description. */
  itemsByLine: Record<number, NavItem | null>;
  acceptedDifferences: { flag: string; field: string; reason: string; acceptedBy: string }[];
  source: { fileName: string; sha256: string };
};

export type ExportBuildResult = { ok: true; file: SalesOrderExport } | { ok: false; problems: string[] };

/**
 * Builds the sales order file from the PO's current values. It only copies and formats values:
 * anything that cannot be written exactly (a missing number, an unreadable price) is returned as a problem instead.
 */
export function buildSalesOrderExport(input: ExportBuildInput): ExportBuildResult {
  const problems: string[] = [];
  const { po } = input;

  if (!po.poNumber) problems.push("PO number is missing.");
  const customerName = input.customer?.name ?? input.newCustomerCard?.name ?? null;
  if (!customerName) problems.push("Customer is not matched to Navision and no new customer card is proposed.");

  const promisedShipDate = parseDateText(po.promisedShipDate);
  if (input.status === "open" && !promisedShipDate) problems.push("Promised ship date is missing or not a valid date.");

  const lines: SalesOrderExportLine[] = [];
  const totals: Decimal[] = [];
  const active = activeLines(po);
  if (active.length === 0) problems.push("The PO has no lines.");
  active.forEach((line, position) => {
    const label = `Line ${line.index + 1}`;
    const quantity = parseQuantity(line.quantity);
    const unitPrice = parseMoney(line.unitPrice);
    if (!line.partNo) problems.push(`${label}: part number is missing.`);
    if (quantity === null || quantity <= 0) problems.push(`${label}: quantity is missing or not a whole number above zero.`);
    if (unitPrice === null || unitPrice.isNegative()) problems.push(`${label}: unit price is missing or not a valid amount.`);
    if (!line.partNo || quantity === null || quantity <= 0 || unitPrice === null || unitPrice.isNegative()) return;
    const total = lineTotal(unitPrice, quantity);
    totals.push(total);
    lines.push({
      lineNo: position + 1,
      itemNo: line.partNo,
      description: input.itemsByLine[line.index]?.description ?? line.description ?? "",
      quantity,
      unitPrice: formatMoney(unitPrice),
      lineTotal: formatMoney(total),
    });
  });

  if (problems.length > 0) return { ok: false, problems };

  return {
    ok: true,
    file: {
      schema: "orderflow.salesOrder.v1",
      orderNo: input.orderNo,
      revision: input.revision,
      status: input.status,
      customer: {
        customerNo: input.customer?.customerNo ?? null,
        name: customerName as string,
        newCustomerCardFile: input.newCustomerCard ? `customerCards/${customerCardFileName(input.newCustomerCard.name)}` : null,
      },
      customerPoNumber: po.poNumber as string,
      orderDate: parseDateText(po.orderDate),
      promisedShipDate,
      currency: po.currency ?? input.customer?.currency ?? input.newCustomerCard?.currency ?? "USD",
      paymentTerms: input.customer?.paymentTerms ?? input.newCustomerCard?.paymentTerms ?? "advance",
      lines,
      totalAmount: formatMoney(sumMoney(totals)),
      acceptedDifferences: input.acceptedDifferences,
      source: input.source,
    },
  };
}
