import Decimal from "decimal.js";
import type { Finding, Rule } from "@/server/engine";
import { labelZeroCommission, recalculateCommission } from "./commission";
import type { CommissionParams, InvoiceCommission, SalesLine } from "./types";

const LABEL_TEXT = {
  FREE_ITEM: "is a free item",
  NEGATIVE_GP: "has negative gross profit",
  LOW_GP: "has gross profit at or below the minimum",
} as const;

/** Labels zero-commission lines and flags lines where the ERP still paid commission. */
export const zeroCommissionRule: Rule<{ lines: SalesLine[] }, CommissionParams> = {
  code: "CC_ZERO_COMMISSION_LINES",
  description: "Label free-item, negative-GP and low-GP lines; flag commission paid on them",
  defaultParams: { minGpPct: "0.06", basis: "GROSS_PROFIT" },
  evaluate({ lines }, params) {
    return lines.flatMap((line): Finding[] => {
      const { label, grossProfit, gpPct } = labelZeroCommission(line, params);
      if (!label) return [];
      const subject = { type: "sales_line", id: `${line.invoiceNo}#${line.lineNo}` };
      const details = { label, grossProfit, gpPct, commissionAmount: line.commissionAmount };
      const out: Finding[] = [
        {
          ruleCode: "CC_ZERO_COMMISSION_LINES",
          reasonCode: label,
          severity: "INFO",
          subject,
          explanation: `${line.invoiceNo} line ${line.lineNo} (${line.sku}) ${LABEL_TEXT[label]}${gpPct ? ` (GP ${gpPct})` : ""}; commission should be 0.`,
          details,
        },
      ];
      if (new Decimal(line.commissionAmount).gt(0)) {
        out.push({
          ruleCode: "CC_ZERO_COMMISSION_LINES",
          reasonCode: "COMMISSION_PAID_ON_INELIGIBLE_LINE",
          severity: "ERROR",
          subject,
          explanation: `${line.invoiceNo} line ${line.lineNo} pays ${line.commissionAmount} commission although it ${LABEL_TEXT[label]}.`,
          details,
        });
      }
      return out;
    });
  },
};

/** Recalculates commission after credit notes and reports clawbacks and top-ups. */
export const creditNoteRecalcRule: Rule<{ invoices: InvoiceCommission[] }, CommissionParams> = {
  code: "CC_CREDIT_NOTE_RECALC",
  description: "Recalculate commission after credit notes, prorated by what the customer paid",
  defaultParams: { minGpPct: "0.06", basis: "GROSS_PROFIT" },
  evaluate({ invoices }, params) {
    return invoices.flatMap((inv): Finding[] => {
      const r = recalculateCommission(inv, params);
      const subject = { type: "invoice", id: inv.invoiceNo };
      const details = {
        netRevenue: r.netRevenue,
        netGrossProfit: r.netGrossProfit,
        gpPct: r.gpPct,
        paidRatio: r.paidRatio,
        earnedCommission: r.earnedCommission,
        commissionPaid: inv.commissionPaid,
        clawback: r.clawback,
        topUp: r.topUp,
        creditNotes: inv.creditNotes.map((cn) => cn.creditNoteNo),
      };
      const out: Finding[] = [];
      const push = (reasonCode: string, severity: Finding["severity"], explanation: string) =>
        out.push({
          ruleCode: "CC_CREDIT_NOTE_RECALC",
          reasonCode,
          severity,
          subject,
          explanation,
          details,
        });

      if (r.eligibleBeforeCreditNotes && !r.eligible) {
        push(
          "CREDIT_NOTE_DROPS_GP_BELOW_THRESHOLD",
          "WARNING",
          `Credit notes on ${inv.invoiceNo} reduce GP to ${r.gpPct}, at or below ${params.minGpPct}; no commission is due.`,
        );
      }
      if (new Decimal(r.clawback).gt(0)) {
        push(
          "CLAWBACK_REQUIRED",
          "WARNING",
          `${inv.salesperson} was paid ${inv.commissionPaid} on ${inv.invoiceNo} but earned ${r.earnedCommission}; claw back ${r.clawback}.`,
        );
      }
      if (new Decimal(r.topUp).gt(0)) {
        push(
          "COMMISSION_UNDERPAID",
          "INFO",
          `${inv.salesperson} has earned ${r.earnedCommission} on ${inv.invoiceNo} but was paid ${inv.commissionPaid}; top up ${r.topUp}.`,
        );
      }
      return out;
    });
  },
};
