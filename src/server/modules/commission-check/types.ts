/** Decimal values are strings (e.g. "1000.00", "0.06") so they never pass through float. */
export type DecimalString = string;

/** One line of the ERP sales/commission report. */
export interface SalesLine {
  invoiceNo: string;
  lineNo: number;
  salesperson: string;
  sku: string;
  quantity: DecimalString;
  revenue: DecimalString; // net selling amount of the line
  cost: DecimalString;
  commissionRate: DecimalString; // e.g. "0.10" = 10%
  commissionAmount: DecimalString; // what the ERP calculated
}

export type ZeroCommissionLabel = "FREE_ITEM" | "NEGATIVE_GP" | "LOW_GP";

export interface LineLabel {
  label: ZeroCommissionLabel | null; // null = eligible for commission
  grossProfit: DecimalString;
  /** null for free items (no revenue to divide by). 4 dp, e.g. "0.0500". */
  gpPct: DecimalString | null;
}

export interface CreditNote {
  creditNoteNo: string;
  revenue: DecimalString; // amount credited to the customer
  cost: DecimalString; // cost reversed (goods returned); "0.00" for a pure price adjustment
}

export interface InvoiceCommission {
  invoiceNo: string;
  salesperson: string;
  revenue: DecimalString;
  cost: DecimalString;
  commissionRate: DecimalString;
  commissionPaid: DecimalString; // already paid out to the salesperson
  customerPaid: DecimalString; // collected from the customer so far
  creditNotes: CreditNote[];
}

export interface CommissionRecalc {
  invoiceNo: string;
  netRevenue: DecimalString;
  netGrossProfit: DecimalString;
  gpPct: DecimalString | null;
  eligible: boolean;
  /** Was the invoice eligible before credit notes? */
  eligibleBeforeCreditNotes: boolean;
  fullCommission: DecimalString;
  paidRatio: DecimalString; // customerPaid / netRevenue, capped to 0..1, 4 dp
  earnedCommission: DecimalString;
  clawback: DecimalString;
  topUp: DecimalString;
}

export interface CommissionParams {
  /** Commission is paid only when GP% is strictly above this, e.g. "0.06". */
  minGpPct: DecimalString;
  /**
   * What the rate applies to. ASSUMPTION to confirm with the client: GROSS_PROFIT here;
   * switch to REVENUE if commission is a percentage of sales.
   */
  basis: "GROSS_PROFIT" | "REVENUE";
}

export const DEFAULT_COMMISSION_PARAMS: CommissionParams = {
  minGpPct: "0.06",
  basis: "GROSS_PROFIT",
};
