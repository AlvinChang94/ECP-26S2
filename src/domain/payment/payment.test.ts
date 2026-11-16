// What: unit tests for story 4 rules: proof-of-payment matching, payment status with days waiting, vendor payment calendar.
// Who calls it: `npm test`.
// To extend: add a row for every new matching rule; the four outcomes (exact, short, over, no match) must stay covered.
import { describe, expect, it } from "vitest";
import type { NavPurchaseOrder } from "../navision";
import { describeMatch, invoicesNamedBy, matchProof, type OpenInvoice, type ProofData } from "./matching";
import { derivePaymentState, isLatePayer, vendorPaymentsDue, vendorReminderDue } from "./status";

const invoices: OpenInvoice[] = [
  { orderNo: "ORD-0901", piNumber: "PI-0901", poNumber: "LT-PO-2201", customerName: "Lanka Tech Pte Ltd", currency: "USD", amount: "2480.00" },
  { orderNo: "ORD-0902", piNumber: "PI-0902", poNumber: "DD-7700", customerName: "Dubai Dist LLC", currency: "USD", amount: "8950.00" },
];

function proof(overrides: Partial<ProofData> = {}): ProofData {
  return { payerName: "Lanka Tech Pte Ltd", amount: "2,480.00", currency: "USD", paymentDate: "2026-11-13", reference: "PI-0901", bankReference: "TT1", ...overrides };
}

describe("matchProof: the four outcomes", () => {
  it.each([
    ["exact: same amount", proof(), "exact", "0.00", []],
    ["exact: written differently but the same value", proof({ amount: "2480" }), "exact", "0.00", []],
    ["short: less than the PI", proof({ amount: "2,400.00" }), "short", "-80.00", ["PAYMENT_SHORT@amount"]],
    ["over: more than the PI", proof({ amount: "2,500.00" }), "over", "20.00", ["PAYMENT_OVER@amount"]],
    ["no match: reference names nothing", proof({ reference: "PI-0999" }), "no_match", null, ["PAYMENT_REFERENCE_NOT_FOUND@reference"]],
  ])("%s", (_name, input, result, difference, flags) => {
    const match = matchProof(input, invoices, []);
    expect(match.result).toBe(result);
    expect(match.difference).toBe(difference);
    expect(match.flags.map((flag) => `${flag.code}@${flag.field}`)).toEqual(flags);
  });

  it("explains a short payment in a sentence a person can act on", () => {
    const [flag] = matchProof(proof({ amount: "2,400.00" }), invoices, []).flags;
    expect(flag.reason).toBe("Paid USD 2,400.00; PI-0901 is USD 2,480.00: 80.00 short.");
    expect(flag.severity).toBe("blocking");
  });

  it("describes each outcome for the status board", () => {
    expect(describeMatch(matchProof(proof(), invoices, []))).toBe("Exact match");
    expect(describeMatch(matchProof(proof({ amount: "2,400.00" }), invoices, []))).toBe("Short by 80.00");
    expect(describeMatch(matchProof(proof({ amount: "2,500.00" }), invoices, []))).toBe("Over by 20.00");
    expect(describeMatch(matchProof(proof({ reference: "nothing" }), invoices, []))).toBe("No match");
  });
});

describe("finding the PI by reference", () => {
  it.each([
    ["PI-0901", ["PI-0901"]],
    ["pi0901", ["PI-0901"]],
    ["Payment for PI 0901 / thank you", ["PI-0901"]],
    ["LT-PO-2201", ["PI-0901"]], // the customer's PO number
    ["ORD-0902", ["PI-0902"]], // the order number
    ["PI-09011", []], // a longer number is a different number
    ["0901", []], // the digits alone are too vague
    ["PI-0901 and PI-0902", ["PI-0901", "PI-0902"]],
  ])("%s -> %j", (reference, expected) => {
    expect(invoicesNamedBy(reference, invoices).map((invoice) => invoice.piNumber)).toEqual(expected);
  });

  it("asks a person to choose when the reference fits more than one PI", () => {
    const match = matchProof(proof({ reference: "PI-0901 and PI-0902" }), invoices, []);
    expect(match.result).toBe("no_match");
    expect(match.flags[0].reason).toContain("fits more than one open invoice");
  });

  it("compares with the PI a person linked by hand, and keeps the reference flag so a reason is still needed", () => {
    const match = matchProof(proof({ reference: "OUR-REF-77" }), invoices, [], invoices[0]);
    expect(match.result).toBe("exact");
    expect(match.invoice?.piNumber).toBe("PI-0901");
    expect(match.flags.map((flag) => flag.code)).toEqual(["PAYMENT_REFERENCE_NOT_FOUND"]);
    expect(match.flags[0].reason).toContain("linked to PI-0901 by hand");
  });
});

describe("other findings on a proof", () => {
  it("flags a different currency instead of comparing amounts", () => {
    const match = matchProof(proof({ currency: "SGD" }), invoices, []);
    expect(match.result).toBe("no_match");
    expect(match.flags.map((flag) => `${flag.code}@${flag.field}`)).toEqual(["PAYMENT_CURRENCY_MISMATCH@currency"]);
  });

  it("flags the same proof arriving twice", () => {
    const earlier = [{ reference: "pi 0901", amount: "2480.00", currency: "USD", payerName: "Lanka Tech Pte Ltd" }];
    const match = matchProof(proof(), invoices, earlier);
    expect(match.result).toBe("exact");
    expect(match.flags.map((flag) => `${flag.code}@${flag.field}`)).toEqual(["PAYMENT_DUPLICATE@reference"]);
  });

  it("does not call a second, different payment a duplicate", () => {
    const earlier = [{ reference: "PI-0901", amount: "1000.00", currency: "USD", payerName: "Lanka Tech Pte Ltd" }];
    expect(matchProof(proof(), invoices, earlier).flags).toEqual([]);
  });

  it.each([
    [{ amount: null }, "MISSING_FIELD@amount"],
    [{ amount: "a lot" }, "INVALID_VALUE@amount"],
    [{ currency: null }, "MISSING_FIELD@currency"],
    [{ reference: null }, "MISSING_FIELD@reference"],
  ])("flags an unreadable proof: %j", (overrides, expected) => {
    const match = matchProof(proof(overrides as Partial<ProofData>), invoices, []);
    expect(match.flags.map((flag) => `${flag.code}@${flag.field}`)).toContain(expected);
    expect(match.result === "exact").toBe(false);
  });

  it("gives the same result when run twice", () => {
    expect(matchProof(proof({ amount: "2,400.00" }), invoices, [])).toEqual(matchProof(proof({ amount: "2,400.00" }), invoices, []));
  });
});

describe("payment status and days waiting", () => {
  const issued = new Date("2026-11-13T01:00:00.000Z");
  const now = new Date("2026-11-16T01:00:00.000Z");

  it.each([
    ["no PI yet", { piIssuedAt: null, paymentConfirmedAt: null, hasProof: false }, "not_invoiced", null],
    ["awaiting for 3 days", { piIssuedAt: issued, paymentConfirmedAt: null, hasProof: false }, "awaiting", 3],
    ["proof received, still counting", { piIssuedAt: issued, paymentConfirmedAt: null, hasProof: true }, "proof_received", 3],
    ["paid after 1 day", { piIssuedAt: issued, paymentConfirmedAt: new Date("2026-11-14T05:00:00.000Z"), hasProof: true }, "paid", 1],
  ])("%s", (_name, facts, status, days) => {
    expect(derivePaymentState(facts, now)).toEqual({ status, daysWaiting: days });
  });

  it("never says Paid because of a proof alone, however good", () => {
    expect(derivePaymentState({ piIssuedAt: issued, paymentConfirmedAt: null, hasProof: true }, now).status).not.toBe("paid");
  });

  it("calls a customer a late payer only when nothing has arrived for long enough", () => {
    expect(isLatePayer({ status: "awaiting", daysWaiting: 9 }, 7)).toBe(true);
    expect(isLatePayer({ status: "awaiting", daysWaiting: 6 }, 7)).toBe(false);
    expect(isLatePayer({ status: "proof_received", daysWaiting: 9 }, 7)).toBe(false);
    expect(isLatePayer({ status: "paid", daysWaiting: 9 }, 7)).toBe(false);
  });
});

describe("vendor payment calendar", () => {
  const order = (poNumber: string, paymentDueDate: string, paid = false): NavPurchaseOrder => ({
    poNumber,
    vendorId: "V1",
    vendorName: `Vendor of ${poNumber}`,
    orderDate: "2026-10-01",
    forCustomerPoNumber: null,
    documentsDueAt: null,
    paymentDueDate,
    paid,
    currency: "USD",
    totalAmount: "100.00",
    lines: [],
  });
  const monday = new Date("2026-11-16T01:00:00.000Z"); // Monday 16 Nov, 09:00 in Singapore
  const orders = [order("PO-A", "2026-11-20"), order("PO-B", "2026-11-23"), order("PO-C", "2026-11-30"), order("PO-D", "2026-11-18", true), order("PO-E", "2026-11-14")];

  it("lists unpaid payments due within seven days, and overdue ones, soonest first", () => {
    expect(vendorPaymentsDue(orders, monday).map((payment) => [payment.poNumber, payment.daysUntilDue])).toEqual([
      ["PO-E", -2],
      ["PO-A", 4],
      ["PO-B", 7],
    ]);
  });

  it("counts days by Singapore calendar days, not by 24-hour blocks", () => {
    const lateEvening = new Date("2026-11-16T15:30:00.000Z"); // 23:30 on Monday in Singapore
    const afterMidnight = new Date("2026-11-16T16:30:00.000Z"); // 00:30 on Tuesday in Singapore
    expect(vendorPaymentsDue([order("PO-A", "2026-11-20")], lateEvening)[0].daysUntilDue).toBe(4);
    expect(vendorPaymentsDue([order("PO-A", "2026-11-20")], afterMidnight)[0].daysUntilDue).toBe(3);
  });

  it.each([
    [5, null],
    [4, null],
    [3, 3],
    [2, 3],
    [1, 1],
    [0, 1],
    [-1, null],
  ])("with reminders 3 and 1 days before: %i days out -> reminder %s", (daysUntilDue, expected) => {
    expect(vendorReminderDue({ daysUntilDue }, [3, 1])).toBe(expected);
  });
});
