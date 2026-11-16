// What: unit tests for the export file builder, amendment differences, cancellation file and partial fulfilment (story 2).
// Who calls it: `npm test`.
// To extend: the export file is what reaches Navision, so every new property needs a case here.
import { describe, expect, it } from "vitest";
import type { FieldValues } from "../fields";
import type { NavCustomer, NavItem } from "../navision";
import { buildCancellationExport, diffPoVersions } from "./amend";
import {
  buildSalesOrderExport,
  customerCardFileName,
  type ExportBuildInput,
  parseSalesOrderExport,
  piNumberFor,
  salesOrderFileName,
  serializeExportFile,
} from "./exportFile";
import { summarizeFulfilment, validateDelivery } from "./fulfilment";
import { toCustomerPo } from "./types";

const DOCK: NavItem = { itemNo: "AB1234X", description: "USB-C docking station 11-in-1", vendorId: "V001", price: "12.40", purchasePrice: "10.10", currency: "USD", stockQty: 160 };
const LANKA: NavCustomer = { customerNo: "C0001", name: "Lanka Tech Pte Ltd", address: "x", country: "Sri Lanka", email: "x", paymentTerms: "advance", currency: "USD" };

function values(overrides: FieldValues = {}): FieldValues {
  return {
    poNumber: "LT-PO-1",
    customerName: "Lanka Tech",
    orderDate: "12 Nov 2026",
    currency: "USD",
    promisedShipDate: "2026-11-23",
    "lines[0].partNo": "AB1234X",
    "lines[0].description": "docking stn",
    "lines[0].quantity": "1,000",
    "lines[0].unitPrice": "11.90",
    ...overrides,
  };
}

function input(overrides: Partial<ExportBuildInput> = {}, valueOverrides: FieldValues = {}): ExportBuildInput {
  return {
    orderNo: "ORD-2001",
    revision: 1,
    status: "open",
    po: toCustomerPo(values(valueOverrides)),
    customer: LANKA,
    newCustomerCard: null,
    itemsByLine: { 0: DOCK },
    acceptedDifferences: [{ flag: "PRICE_MISMATCH", field: "lines[0].unitPrice", reason: "Special deal", acceptedBy: "Sam Tan" }],
    source: { fileName: "po.pdf", sha256: "abc" },
    ...overrides,
  };
}

describe("buildSalesOrderExport", () => {
  it("copies the approved values into the file, with exact money and Navision's own names", () => {
    const result = buildSalesOrderExport(input());
    if (!result.ok) throw new Error(result.problems.join(" "));
    expect(result.file).toMatchObject({
      schema: "orderflow.salesOrder.v1",
      orderNo: "ORD-2001",
      customer: { customerNo: "C0001", name: "Lanka Tech Pte Ltd", newCustomerCardFile: null },
      customerPoNumber: "LT-PO-1",
      orderDate: "2026-11-12",
      promisedShipDate: "2026-11-23",
      totalAmount: "11900.00",
    });
    expect(result.file.lines).toEqual([
      { lineNo: 1, itemNo: "AB1234X", description: "USB-C docking station 11-in-1", quantity: 1000, unitPrice: "11.90", lineTotal: "11900.00" },
    ]);
    expect(result.file.acceptedDifferences[0].reason).toBe("Special deal");
  });

  it("writes money as decimal strings, never as JSON numbers", () => {
    const result = buildSalesOrderExport(input());
    if (!result.ok) throw new Error("expected a file");
    const text = serializeExportFile(result.file);
    expect(text).toContain('"unitPrice": "11.90"');
    expect(text).toContain('"totalAmount": "11900.00"');
    expect(text).not.toMatch(/"(unitPrice|lineTotal|totalAmount)": \d/);
  });

  it("gives the same text for the same input, and that text reads back to the same file", () => {
    const first = buildSalesOrderExport(input());
    const second = buildSalesOrderExport(input());
    if (!first.ok || !second.ok) throw new Error("expected files");
    expect(serializeExportFile(second.file)).toBe(serializeExportFile(first.file));
    expect(parseSalesOrderExport(serializeExportFile(first.file))).toEqual(first.file);
  });

  it("leaves out lines a person removed and renumbers the rest", () => {
    const result = buildSalesOrderExport(
      input({ itemsByLine: { 0: DOCK, 1: DOCK } }, { "lines[0].removed": "true", "lines[1].partNo": "AB1234X", "lines[1].quantity": "5", "lines[1].unitPrice": "12.40" }),
    );
    if (!result.ok) throw new Error("expected a file");
    expect(result.file.lines.map((line) => [line.lineNo, line.quantity])).toEqual([[1, 5]]);
  });

  it("points to the new customer card when the customer is not in Navision", () => {
    const card = { schema: "orderflow.customerCard.v1" as const, name: "Kathmandu Digital Hub", address: null, country: null, email: null, paymentTerms: "advance" as const, currency: "USD", requestedForOrder: "ORD-2001" };
    const result = buildSalesOrderExport(input({ customer: null, newCustomerCard: card }));
    if (!result.ok) throw new Error("expected a file");
    expect(result.file.customer).toEqual({ customerNo: null, name: "Kathmandu Digital Hub", newCustomerCardFile: "customerCards/kathmandu-digital-hub.json" });
  });

  it.each([
    ["no PO number", {}, { poNumber: null }, /PO number is missing/],
    ["no customer", { customer: null }, {}, /Customer is not matched/],
    ["no promised ship date", {}, { promisedShipDate: null }, /Promised ship date/],
    ["an unreadable quantity", {}, { "lines[0].quantity": "many" }, /quantity is missing or not a whole number/],
    ["an unreadable price", {}, { "lines[0].unitPrice": "cheap" }, /unit price is missing or not a valid amount/],
  ])("refuses to build a file with %s", (_name, overrides, valueOverrides, message) => {
    const result = buildSalesOrderExport(input(overrides as Partial<ExportBuildInput>, valueOverrides as FieldValues));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems.join(" ")).toMatch(message);
  });

  it("names files predictably", () => {
    expect(salesOrderFileName("ORD-1042", 2)).toBe("ORD-1042-r2.json");
    expect(customerCardFileName("Kathmandu Digital Hub (Pvt) Ltd.")).toBe("kathmandu-digital-hub-pvt-ltd.json");
    expect(piNumberFor("ORD-1042")).toBe("PI-1042");
  });
});

describe("amendments and cancellations", () => {
  it("lists what an amended PO changed: quantities, prices, added and removed lines", () => {
    const before = toCustomerPo(values({ "lines[1].partNo": "CD-77", "lines[1].quantity": "10", "lines[1].unitPrice": "8.10" }));
    const after = toCustomerPo(
      values({ "lines[0].quantity": "1,500", promisedShipDate: "2026-12-01", "lines[1].partNo": "EF-9", "lines[1].quantity": "2", "lines[1].unitPrice": "140.00" }),
    );
    const diff = diffPoVersions(before, after);
    expect(diff.identical).toBe(false);
    expect(diff.header).toEqual([{ label: "Promised ship date", before: "2026-11-23", after: "2026-12-01" }]);
    expect(diff.lines).toEqual([
      { partNo: "AB1234X", change: "changed", before: { quantity: "1,000", unitPrice: "11.90" }, after: { quantity: "1,500", unitPrice: "11.90" } },
      { partNo: "EF-9", change: "added", before: null, after: { quantity: "2", unitPrice: "140.00" } },
      { partNo: "CD-77", change: "removed", before: { quantity: "10", unitPrice: "8.10" }, after: null },
    ]);
  });

  it("reports identical versions as identical", () => {
    expect(diffPoVersions(toCustomerPo(values()), toCustomerPo(values())).identical).toBe(true);
  });

  it("builds a cancellation file that only changes the revision and the status", () => {
    const result = buildSalesOrderExport(input());
    if (!result.ok) throw new Error("expected a file");
    const cancelled = buildCancellationExport(result.file, 2);
    expect(cancelled).toEqual({ ...result.file, revision: 2, status: "cancelled" });
  });
});

describe("partial fulfilment", () => {
  const ordered = [
    { itemNo: "RAM-16D4", description: "Memory", quantity: 120 },
    { itemNo: "FD-64U3", description: "Flash drive", quantity: 300 },
  ];

  it.each([
    ["nothing delivered", [], "none", [120, 300]],
    ["part of one line delivered", [{ partNo: "RAM-16D4", quantity: 95 }], "partial", [25, 300]],
    ["everything delivered in several deliveries", [{ partNo: "RAM-16D4", quantity: 95 }, { partNo: "RAM-16D4", quantity: 25 }, { partNo: "FD-64U3", quantity: 300 }], "complete", [0, 0]],
  ])("%s", (_name, deliveries, state, remaining) => {
    const fulfilment = summarizeFulfilment(ordered, deliveries);
    expect(fulfilment.state).toBe(state);
    expect(fulfilment.lines.map((line) => line.remaining)).toEqual(remaining);
  });

  it("adds up the same part ordered on two lines", () => {
    const fulfilment = summarizeFulfilment([...ordered, { itemNo: "RAM-16D4", description: "Memory", quantity: 30 }], []);
    expect(fulfilment.lines.find((line) => line.itemNo === "RAM-16D4")?.ordered).toBe(150);
  });

  it.each([
    ["more than remains", "RAM-16D4", 30, /Only 25 of RAM-16D4 remain/],
    ["a part that is not on the order", "ZZ-1", 1, /not on this order/],
    ["zero", "RAM-16D4", 0, /whole number above zero/],
    ["a fraction", "RAM-16D4", 1.5, /whole number above zero/],
  ])("refuses a delivery of %s", (_name, partNo, quantity, message) => {
    const fulfilment = summarizeFulfilment(ordered, [{ partNo: "RAM-16D4", quantity: 95 }]);
    expect(validateDelivery(fulfilment, partNo, quantity)).toMatch(message);
  });

  it("accepts a delivery of exactly what remains", () => {
    const fulfilment = summarizeFulfilment(ordered, [{ partNo: "RAM-16D4", quantity: 95 }]);
    expect(validateDelivery(fulfilment, "RAM-16D4", 25)).toBeNull();
  });
});
