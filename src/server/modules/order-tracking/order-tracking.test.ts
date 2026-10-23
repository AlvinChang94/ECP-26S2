import { describe, expect, it } from "vitest";
import { runRules } from "@/server/engine";
import { compareOrderLines } from "./compare-order-lines";
import { loadOrderTrackingGolden } from "./golden";
import { crossDocumentLineRule } from "./rules";
import { orderStatusMachine } from "./status";
import type { OrderLineInput } from "./types";

const golden = loadOrderTrackingGolden();

describe("crossDocumentLineRule against data/golden/order-tracking", () => {
  const findings = golden.inputs.flatMap(
    (input) => runRules([crossDocumentLineRule], input).findings,
  );
  const codesBySubject = new Map<string, string[]>();
  for (const f of findings) {
    codesBySubject.set(f.subject.id, [...(codesBySubject.get(f.subject.id) ?? []), f.reasonCode]);
  }

  it("covers every order line and every extra document line", () => {
    const subjects = new Set([
      ...golden.orders.flatMap((o) => o.lines.map((l) => `${o.orderNumber}#${l.lineNo}`)),
      ...golden.documents.flatMap((d) => d.lines.map((l) => `${d.orderNumber}#${l.lineNo}`)),
    ]);
    const expected = golden.expectations.map((e) => `${e.orderNumber}#${e.lineNo}`);
    expect([...subjects].sort()).toEqual(expected.sort());
  });

  it.each(golden.expectations)("$orderNumber line $lineNo: $note", (exp) => {
    const codes = codesBySubject.get(`${exp.orderNumber}#${exp.lineNo}`) ?? [];
    expect([...codes].sort()).toEqual([...exp.codes].sort());
  });

  it("explains each finding in plain words", () => {
    const qty = findings.find((f) => f.subject.id === "PO-1001#2");
    expect(qty?.explanation).toBe("INVOICE INV-HL-5521 has quantity 480 but the order says 500.");
  });
});

describe("compareOrderLines edge cases", () => {
  const base: OrderLineInput = {
    sku: "ABC-1",
    description: "Widget",
    quantity: "10",
    uom: "PCS",
    unitPrice: "2.5000",
    weightKg: "100.000",
  };

  it("returns [] for identical lines", () => {
    expect(compareOrderLines(base, { ...base })).toEqual([]);
  });

  it("treats numerically equal decimals as equal", () => {
    expect(compareOrderLines(base, { ...base, quantity: "10.000", unitPrice: "2.5" })).toEqual([]);
  });

  it("allows weight exactly at the tolerance boundary and flags just over it", () => {
    expect(compareOrderLines(base, { ...base, weightKg: "102.000" })).toEqual([]);
    expect(compareOrderLines(base, { ...base, weightKg: "102.001" })).toEqual([
      {
        code: "WEIGHT_MISMATCH",
        field: "weightKg",
        expected: "100.000",
        actual: "102.001",
        severity: "WARNING",
      },
    ]);
  });

  it("skips quantity and price checks when the UOM differs", () => {
    const codes = compareOrderLines(base, { ...base, uom: "CTN", quantity: "1", unitPrice: "25" });
    expect(codes.map((m) => m.code)).toEqual(["UOM_MISMATCH"]);
  });

  it("skips price and weight when one side has no value", () => {
    expect(compareOrderLines(base, { ...base, unitPrice: null, weightKg: undefined })).toEqual([]);
  });

  it("avoids float rounding errors", () => {
    const line = { ...base, unitPrice: "0.3" };
    expect(compareOrderLines(line, { ...line, unitPrice: "0.30000" })).toEqual([]);
    expect(compareOrderLines(line, { ...line, unitPrice: "0.30000000000000004" })).toHaveLength(1);
  });
});

describe("orderStatusMachine", () => {
  it("needs a delivery order to move to DELIVERED", () => {
    expect(orderStatusMachine.check("CONFIRMED", "DELIVERED", [])).toEqual({
      ok: false,
      reason: "MISSING_EVIDENCE",
      missing: ["DELIVERY_ORDER"],
    });
  });

  it("cannot close an invoiced order with open findings without approval", () => {
    expect(orderStatusMachine.check("INVOICED", "CLOSED", [])).toMatchObject({ ok: false });
    expect(orderStatusMachine.check("INVOICED", "PENDING_APPROVAL", [])).toEqual({ ok: true });
    expect(orderStatusMachine.check("PENDING_APPROVAL", "CLOSED", ["APPROVAL"])).toEqual({
      ok: true,
    });
  });

  it("cannot cancel after delivery", () => {
    expect(orderStatusMachine.check("DELIVERED", "CANCELLED", [])).toEqual({
      ok: false,
      reason: "NOT_ALLOWED",
    });
  });
});
