import Decimal from "decimal.js";
import type { Finding, Rule } from "@/server/engine";
import { matchPayments } from "./match-payments";
import type {
  OpenInvoice,
  PartyAliases,
  Payment,
  PaymentMatch,
  PaymentMatchingParams,
} from "./types";

export interface PaymentMatchingInput {
  payments: Payment[];
  invoices: OpenInvoice[];
  parties: PartyAliases[];
}

const RULE_CODE = "PM_MATCH_PAYMENTS";

function findingsFor(payment: Payment, m: PaymentMatch): Finding[] {
  const subject = { type: "payment", id: payment.paymentId };
  const invoices = m.allocations.map((a) => a.invoiceNo);
  const details = {
    amount: payment.amount,
    status: m.status,
    method: m.method,
    invoices,
    difference: m.difference,
    customerCode: m.customerCode,
  };
  const make = (
    reasonCode: string,
    severity: Finding["severity"],
    explanation: string,
  ): Finding => ({
    ruleCode: RULE_CODE,
    reasonCode,
    severity,
    subject,
    explanation,
    details,
  });

  switch (m.status) {
    case "MATCHED": {
      const out: Finding[] = [];
      if (m.method !== "REFERENCE") {
        out.push(
          make(
            "PAYMENT_NO_REFERENCE",
            "INFO",
            `${payment.paymentId} has no invoice reference; matched by amount to ${invoices.join(", ")}.`,
          ),
        );
      }
      if (!new Decimal(m.difference).isZero()) {
        out.push(
          make(
            "PAYMENT_WITHIN_TOLERANCE",
            "INFO",
            `${payment.paymentId} differs from ${invoices.join(", ")} by ${m.difference}, within tolerance (e.g. bank charges).`,
          ),
        );
      }
      return out;
    }
    case "PARTIAL":
      return [
        make(
          "PAYMENT_PARTIAL",
          "WARNING",
          `${payment.paymentId} pays ${payment.amount} against ${invoices.join(", ")}; ${m.shortfall} is still outstanding.`,
        ),
      ];
    case "OVERPAID":
      return [
        make(
          "PAYMENT_OVERPAID",
          "WARNING",
          `${payment.paymentId} exceeds what is due on the referenced invoices by ${m.difference} (possible duplicate payment).`,
        ),
      ];
    case "AMBIGUOUS":
      return [
        {
          ...make(
            "PAYMENT_AMBIGUOUS",
            "WARNING",
            `${payment.paymentId} (${payment.amount}, no reference) matches more than one invoice set: ${m.candidates.map((c) => c.join("+")).join(" or ")}.`,
          ),
          details: { ...details, candidates: m.candidates.map((c) => c.join("+")) },
        },
      ];
    case "UNMATCHED":
      return [
        make(
          "PAYMENT_UNMATCHED",
          "ERROR",
          m.customerCode === null
            ? `${payment.paymentId} from "${payment.payerName}" could not be linked to a known customer.`
            : `${payment.paymentId} (${payment.amount}) matches no open invoice or combination for ${m.customerCode}.`,
        ),
      ];
  }
}

/** Matches every payment and raises a finding for anything a reviewer should look at. */
export const paymentMatchingRule: Rule<PaymentMatchingInput, PaymentMatchingParams> = {
  code: RULE_CODE,
  description: "Match payments to open invoices, including partial and unreferenced payments",
  defaultParams: { tolerance: "2.00", maxCombination: 3 },
  evaluate(input, params) {
    const matches = matchPayments(input.payments, input.invoices, input.parties, params);
    const byId = new Map(input.payments.map((p) => [p.paymentId, p]));
    return matches.flatMap((m) => findingsFor(byId.get(m.paymentId)!, m));
  },
};

/** One row per payment for the consolidated Excel file. */
export function toConsolidationRows(
  payments: readonly Payment[],
  matches: readonly PaymentMatch[],
) {
  const byId = new Map(payments.map((p) => [p.paymentId, p]));
  return matches.map((m) => {
    const p = byId.get(m.paymentId)!;
    return {
      paymentId: p.paymentId,
      valueDate: p.valueDate,
      payerName: p.payerName,
      customerCode: m.customerCode ?? "",
      amount: p.amount,
      currency: p.currency,
      reference: p.reference ?? "",
      sourceDocument: p.sourceDocument,
      status: m.status,
      method: m.method ?? "",
      invoices: m.allocations.map((a) => `${a.invoiceNo} (${a.amount})`).join(", "),
      difference: m.difference,
    };
  });
}
