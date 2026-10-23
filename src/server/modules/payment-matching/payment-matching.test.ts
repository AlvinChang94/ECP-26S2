import { describe, expect, it } from "vitest";
import { runRules } from "@/server/engine";
import { loadPaymentMatchingGolden } from "./golden";
import { matchPayment, matchPayments, resolveCustomer } from "./match-payments";
import { paymentMatchingRule } from "./rules";
import type { OpenInvoice, Payment } from "./types";

const { input, expectations } = loadPaymentMatchingGolden();

describe("payment matching against data/golden/payment-matching", () => {
  const matches = matchPayments(input.payments, input.invoices, input.parties);
  const findings = runRules([paymentMatchingRule], input).findings;

  it("has an expectation for every payment", () => {
    expect(expectations.map((e) => e.paymentId).sort()).toEqual(
      input.payments.map((p) => p.paymentId).sort(),
    );
  });

  it.each(expectations)("$paymentId: $note", (exp) => {
    const m = matches.find((x) => x.paymentId === exp.paymentId)!;
    expect({ status: m.status, method: m.method, allocations: m.allocations }).toEqual({
      status: exp.status,
      method: exp.method,
      allocations: exp.allocations,
    });
    const codes = findings.filter((f) => f.subject.id === exp.paymentId).map((f) => f.reasonCode);
    expect(codes.sort()).toEqual([...exp.reasonCodes].sort());
  });

  it("records the shortfall on a partial payment and the bank-charge difference", () => {
    expect(matches.find((m) => m.paymentId === "P-03")!.shortfall).toBe("1700.00");
    expect(matches.find((m) => m.paymentId === "P-02")!.difference).toBe("-2.00");
  });

  it("lists both candidates for an ambiguous payment", () => {
    expect(matches.find((m) => m.paymentId === "P-05")!.candidates).toEqual([
      ["INV-2004"],
      ["INV-2005"],
    ]);
  });
});

describe("matchPayment edge cases", () => {
  const inv = (invoiceNo: string, amountDue: string, issueDate = "2026-01-01"): OpenInvoice => ({
    invoiceNo,
    customerCode: "C1",
    issueDate,
    amountDue,
  });
  const pay = (amount: string, reference: string | null = null): Payment => ({
    paymentId: "X",
    payerName: "X",
    amount,
    currency: "SGD",
    valueDate: "2026-02-01",
    reference,
    sourceDocument: "x.pdf",
  });

  it("allocates a short payment to the oldest referenced invoice first", () => {
    const m = matchPayment(pay("150.00", "A1 A2"), "C1", [
      inv("A2", "100.00", "2026-01-02"),
      inv("A1", "100.00", "2026-01-01"),
    ]);
    expect(m.status).toBe("PARTIAL");
    expect(m.allocations).toEqual([
      { invoiceNo: "A1", amount: "100.00" },
      { invoiceNo: "A2", amount: "50.00" },
    ]);
    expect(m.shortfall).toBe("50.00");
  });

  it("treats a difference exactly at the tolerance as a match and just over as not", () => {
    expect(matchPayment(pay("98.00"), "C1", [inv("A1", "100.00")]).status).toBe("MATCHED");
    expect(matchPayment(pay("97.99"), "C1", [inv("A1", "100.00")]).status).toBe("UNMATCHED");
  });

  it("does not match by amount when the payer is unknown", () => {
    expect(matchPayment(pay("100.00"), null, [inv("A1", "100.00")]).status).toBe("UNMATCHED");
  });

  it("uses exact decimal sums (0.10 + 0.20 = 0.30)", () => {
    const m = matchPayment(pay("0.30"), "C1", [inv("A1", "0.10"), inv("A2", "0.20")], {
      tolerance: "0",
      maxCombination: 2,
    });
    expect(m.method).toBe("AMOUNT_COMBINATION");
  });

  it("resolves payer aliases ignoring case and punctuation", () => {
    const parties = [{ code: "C9", name: "Acme Pte. Ltd.", aliases: ["ACME SG"] }];
    expect(resolveCustomer("acme pte ltd", parties)).toBe("C9");
    expect(resolveCustomer("Acme-SG", parties)).toBe("C9");
    expect(resolveCustomer("Acme Holdings", parties)).toBeNull();
  });
});
