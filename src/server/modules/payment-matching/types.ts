/** Decimal values are strings (e.g. "1250.00") so they never pass through float. */
export type DecimalString = string;

export interface OpenInvoice {
  invoiceNo: string;
  customerCode: string;
  issueDate: string; // ISO date; oldest invoices are allocated first
  amountDue: DecimalString; // outstanding amount
}

/** A payment as extracted from a payment proof (bank slip, transfer screenshot, PDF advice). */
export interface Payment {
  paymentId: string;
  payerName: string;
  amount: DecimalString;
  currency: string;
  valueDate: string; // ISO date
  /** Free text from the slip, e.g. "INV2002 / INV 2003". null when the payer gave none. */
  reference: string | null;
  sourceDocument: string;
}

export interface PartyAliases {
  code: string;
  name: string;
  aliases: string[];
}

export type MatchStatus = "MATCHED" | "PARTIAL" | "OVERPAID" | "AMBIGUOUS" | "UNMATCHED";
export type MatchMethod = "REFERENCE" | "AMOUNT_SINGLE" | "AMOUNT_COMBINATION";

export interface Allocation {
  invoiceNo: string;
  amount: DecimalString;
}

export interface PaymentMatch {
  paymentId: string;
  customerCode: string | null;
  status: MatchStatus;
  method: MatchMethod | null;
  allocations: Allocation[];
  /** payment amount minus allocated total; non-zero within tolerance (e.g. bank charges) or when overpaid. */
  difference: DecimalString;
  /** For PARTIAL: what is still owed on the referenced invoices. */
  shortfall: DecimalString;
  /** For AMBIGUOUS: the competing invoice sets. */
  candidates: string[][];
}

export interface PaymentMatchingParams {
  /** Absolute difference treated as a match, e.g. bank charges deducted by the payer's bank. */
  tolerance: DecimalString;
  /** Largest number of invoices one unreferenced payment may be split across. */
  maxCombination: number;
}

export const DEFAULT_PAYMENT_PARAMS: PaymentMatchingParams = {
  tolerance: "2.00",
  maxCombination: 3,
};
