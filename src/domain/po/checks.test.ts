// What: table-driven unit tests for every PO check rule (story 1).
// Who calls it: `npm test`.
// To extend: every new rule needs a flag code, a reason sentence and a row here (CLAUDE.md, "Testing and honesty").
import { describe, expect, it } from "vitest";
import type { FieldValues } from "../fields";
import type { Flag } from "../flags";
import type { NavCustomer, NavItem } from "../navision";
import { checkCustomerPo, checkExportReadiness, type PoCheckContext, type PoLineLookup } from "./checks";
import { toCustomerPo } from "./types";

const DOCK: NavItem = { itemNo: "AB1234X", description: "USB-C docking station 11-in-1", vendorId: "V001", price: "12.40", purchasePrice: "10.10", currency: "USD", stockQty: 160 };
const CABLE: NavItem = { itemNo: "CD-77", description: "HDMI cable 2 m", vendorId: "V001", price: "8.10", purchasePrice: "5.90", currency: "USD", stockQty: 900 };
const LANKA: NavCustomer = { customerNo: "C0001", name: "Lanka Tech Pte Ltd", address: "x", country: "Sri Lanka", email: "x", paymentTerms: "advance", currency: "USD" };

/** A PO with one line unless told otherwise. */
function poValues(overrides: FieldValues = {}): FieldValues {
  return {
    poNumber: "LT-PO-1",
    poKind: null,
    customerName: "Lanka Tech Pte Ltd",
    currency: "USD",
    "lines[0].partNo": "AB1234X",
    "lines[0].quantity": "100",
    "lines[0].unitPrice": "12.40",
    ...overrides,
  };
}

function found(item: NavItem): PoLineLookup {
  return { item, aliasItem: null, similar: [] };
}

function context(overrides: Partial<PoCheckContext> = {}): PoCheckContext {
  return { customer: LANKA, customerCardProposed: false, lines: { 0: found(DOCK) }, sameNumberOrders: [], previousVersion: null, ...overrides };
}

function check(values: FieldValues, ctx: PoCheckContext): Flag[] {
  return checkCustomerPo(toCustomerPo(values), ctx);
}

function codes(flags: Flag[]): string[] {
  return flags.map((flag) => `${flag.code}@${flag.field}`);
}

describe("checkCustomerPo", () => {
  it("raises nothing for a clean PO", () => {
    expect(check(poValues(), context())).toEqual([]);
  });

  describe("one rule at a time", () => {
    const cases: { name: string; values: FieldValues; ctx: PoCheckContext; expected: string[]; reason: RegExp }[] = [
      {
        name: "PART_NOT_FOUND when the part is unknown and nothing looks like it",
        values: poValues({ "lines[0].partNo": "ZX-9907" }),
        ctx: context({ lines: { 0: { item: null, aliasItem: null, similar: [] } } }),
        expected: ["PART_NOT_FOUND@lines[0].partNo"],
        reason: /ZX-9907 is not in Navision and nothing similar/,
      },
      {
        name: "PART_ALIAS_SUGGESTED when a similar item exists",
        values: poValues({ "lines[0].partNo": "AB-1234X" }),
        ctx: context({ lines: { 0: { item: null, aliasItem: null, similar: [DOCK] } } }),
        expected: ["PART_ALIAS_SUGGESTED@lines[0].partNo"],
        reason: /A similar item exists: AB1234X/,
      },
      {
        name: "PART_ALIAS_SUGGESTED from alias memory, which wins over a similar item",
        values: poValues({ "lines[0].partNo": "LT-DOCK-01" }),
        ctx: context({ lines: { 0: { item: null, aliasItem: DOCK, similar: [CABLE] } } }),
        expected: ["PART_ALIAS_SUGGESTED@lines[0].partNo"],
        reason: /fixed to AB1234X .* before and remembered/,
      },
      {
        name: "PRICE_MISMATCH when the unit price is lower",
        values: poValues({ "lines[0].unitPrice": "11.90" }),
        ctx: context(),
        expected: ["PRICE_MISMATCH@lines[0].unitPrice"],
        reason: /11\.90 differs from the Navision price 12\.40 for AB1234X \(4\.0% lower\)/,
      },
      {
        name: "PRICE_MISMATCH when the unit price is higher",
        values: poValues({ "lines[0].unitPrice": "13.00" }),
        ctx: context(),
        expected: ["PRICE_MISMATCH@lines[0].unitPrice"],
        reason: /4\.8% higher/,
      },
      {
        name: "PRICE_MISMATCH when the currencies differ",
        values: poValues({ currency: "SGD" }),
        ctx: context(),
        expected: ["PRICE_MISMATCH@lines[0].unitPrice"],
        reason: /PO is in SGD but the Navision price for AB1234X is in USD/,
      },
      {
        name: "QTY_EXCEEDS_STOCK when more is ordered than is in stock",
        values: poValues({ "lines[0].quantity": "200" }),
        ctx: context(),
        expected: ["QTY_EXCEEDS_STOCK@lines[0].quantity"],
        reason: /200 ordered on this PO, 160 in stock: short by 40/,
      },
      {
        name: "CUSTOMER_NOT_FOUND when the customer is not in Navision",
        values: poValues({ customerName: "Kathmandu Digital Hub" }),
        ctx: context({ customer: null }),
        expected: ["CUSTOMER_NOT_FOUND@customerName"],
        reason: /"Kathmandu Digital Hub" is not a customer in Navision/,
      },
      {
        name: "NEW_CUSTOMER_CARD (not blocking) once a person proposed a card",
        values: poValues({ customerName: "Kathmandu Digital Hub" }),
        ctx: context({ customer: null, customerCardProposed: true }),
        expected: ["NEW_CUSTOMER_CARD@customerName"],
        reason: /new customer card .* will be written/,
      },
      {
        name: "DUPLICATE_PO when the PO number was captured before",
        values: poValues(),
        ctx: context({ sameNumberOrders: [{ orderNo: "ORD-0901" }] }),
        expected: ["DUPLICATE_PO@poNumber"],
        reason: /already captured as ORD-0901/,
      },
      {
        name: "MISSING_FIELD for a missing PO number",
        values: poValues({ poNumber: null }),
        ctx: context(),
        expected: ["MISSING_FIELD@poNumber"],
        reason: /PO number could not be read/,
      },
      {
        name: "MISSING_FIELD for a missing unit price",
        values: poValues({ "lines[0].unitPrice": null }),
        ctx: context(),
        expected: ["MISSING_FIELD@lines[0].unitPrice"],
        reason: /Line 1: the unit price is missing/,
      },
      {
        name: "INVALID_VALUE for a quantity that is not a whole number",
        values: poValues({ "lines[0].quantity": "2OO" }),
        ctx: context(),
        expected: ["INVALID_VALUE@lines[0].quantity"],
        reason: /"2OO" is not a whole number/,
      },
      {
        name: "PO_AMENDMENT (information) when the document amends a known order",
        values: poValues({ poKind: "AMENDMENT 1" }),
        ctx: context({ previousVersion: { orderNo: "ORD-0901", revision: 1 } }),
        expected: ["PO_AMENDMENT@poKind"],
        reason: /amends ORD-0901/,
      },
      {
        name: "PREVIOUS_PO_NOT_FOUND when an amendment has no earlier version",
        values: poValues({ poKind: "AMENDMENT 2" }),
        ctx: context(),
        expected: ["PREVIOUS_PO_NOT_FOUND@poKind"],
        reason: /no earlier PO with number LT-PO-1/,
      },
      {
        name: "PO_CANCELLATION when the document cancels a known order",
        values: poValues({ poKind: "CANCELLATION" }),
        ctx: context({ previousVersion: { orderNo: "ORD-0902", revision: 1 } }),
        expected: ["PO_CANCELLATION@poKind"],
        reason: /asks to cancel ORD-0902/,
      },
    ];

    it.each(cases)("$name", ({ values, ctx, expected, reason }) => {
      const flags = check(values, ctx);
      expect(codes(flags)).toEqual(expected);
      expect(flags[0].reason).toMatch(reason);
    });
  });

  it("gives blocking severity to what stops an export and warning to a stock shortage", () => {
    const price = check(poValues({ "lines[0].unitPrice": "11.90" }), context())[0];
    const stock = check(poValues({ "lines[0].quantity": "200" }), context())[0];
    expect(price.severity).toBe("blocking");
    expect(stock.severity).toBe("warning");
  });

  it("suggests a fix but never applies it", () => {
    const values = poValues({ "lines[0].partNo": "AB-1234X" });
    const before = JSON.stringify(values);
    const [flag] = check(values, context({ lines: { 0: { item: null, aliasItem: null, similar: [DOCK] } } }));
    expect(flag.suggestion).toEqual({ label: "Use AB1234X", field: "lines[0].partNo", value: "AB1234X", source: "similar_part" });
    expect(JSON.stringify(values)).toBe(before);
  });

  it("does not check price or stock until the part number is a Navision item", () => {
    const values = poValues({ "lines[0].partNo": "AB-1234X", "lines[0].unitPrice": "1.00", "lines[0].quantity": "9999" });
    expect(codes(check(values, context({ lines: { 0: { item: null, aliasItem: null, similar: [DOCK] } } })))).toEqual(["PART_ALIAS_SUGGESTED@lines[0].partNo"]);
  });

  it("adds up the same part across lines before comparing with stock, and flags it once", () => {
    const values = poValues({ "lines[0].quantity": "100", "lines[1].partNo": "AB1234X", "lines[1].quantity": "70", "lines[1].unitPrice": "12.40" });
    const flags = check(values, context({ lines: { 0: found(DOCK), 1: found(DOCK) } }));
    expect(codes(flags)).toEqual(["QTY_EXCEEDS_STOCK@lines[0].quantity"]);
    expect(flags[0].followUp).toEqual({ kind: "raise_spr", partNo: "AB1234X", quantity: 10 });
  });

  it("mentions partial shipment when the customer allows it", () => {
    const [flag] = check(poValues({ "lines[0].quantity": "200", partialShipment: "Allowed" }), context());
    expect(flag.reason).toContain("allows partial shipment, so 160 can ship now");
  });

  it("ignores lines a person removed", () => {
    const values = poValues({ "lines[1].partNo": "ZX-9907", "lines[1].quantity": "1", "lines[1].unitPrice": "1.00", "lines[1].removed": "true" });
    expect(check(values, context({ lines: { 0: found(DOCK), 1: { item: null, aliasItem: null, similar: [] } } }))).toEqual([]);
  });

  it("asks for lines when none could be read", () => {
    expect(codes(check({ poNumber: "X-1", customerName: "Lanka Tech Pte Ltd" }, context({ lines: {} })))).toEqual(["MISSING_FIELD@lines"]);
  });

  it("does not check the lines of a cancellation", () => {
    const values = poValues({ poKind: "CANCELLATION", "lines[0].partNo": "ZX-9907" });
    const flags = check(values, context({ previousVersion: { orderNo: "ORD-1", revision: 1 }, lines: { 0: { item: null, aliasItem: null, similar: [] } } }));
    expect(codes(flags)).toEqual(["PO_CANCELLATION@poKind"]);
  });

  it("reports several problems on one PO, in document order", () => {
    const values = poValues({
      "lines[0].partNo": "AB-1234X",
      "lines[1].partNo": "CD-77",
      "lines[1].quantity": "1000",
      "lines[1].unitPrice": "7.50",
    });
    const flags = check(values, context({ lines: { 0: { item: null, aliasItem: null, similar: [DOCK] }, 1: found(CABLE) } }));
    expect(codes(flags)).toEqual(["PART_ALIAS_SUGGESTED@lines[0].partNo", "PRICE_MISMATCH@lines[1].unitPrice", "QTY_EXCEEDS_STOCK@lines[1].quantity"]);
  });

  it("gives the same flags when run twice on the same input", () => {
    const values = poValues({ "lines[0].unitPrice": "11.90", "lines[0].quantity": "200" });
    expect(check(values, context())).toEqual(check(values, context()));
  });
});

describe("checkExportReadiness", () => {
  it("requires a promised ship date typed by staff", () => {
    expect(codes(checkExportReadiness(toCustomerPo(poValues())))).toEqual(["MISSING_FIELD@promisedShipDate"]);
  });

  it("rejects a promised ship date that is not a date", () => {
    expect(codes(checkExportReadiness(toCustomerPo(poValues({ promisedShipDate: "next week" }))))).toEqual(["INVALID_VALUE@promisedShipDate"]);
  });

  it("accepts a valid date and asks nothing of a cancellation", () => {
    expect(checkExportReadiness(toCustomerPo(poValues({ promisedShipDate: "2026-11-23" })))).toEqual([]);
    expect(checkExportReadiness(toCustomerPo(poValues({ poKind: "CANCELLATION" })))).toEqual([]);
  });
});
