import type { Severity } from "@/server/engine";

/** Decimal values are strings (e.g. "12.5000") so they never pass through float. */
export type DecimalString = string;

export interface OrderLineInput {
  sku: string;
  description: string;
  quantity: DecimalString;
  uom: string;
  /** Optional: delivery orders usually carry no prices. */
  unitPrice?: DecimalString | null;
  /** Optional: invoices often carry no weights. */
  weightKg?: DecimalString | null;
}

export interface NumberedLine extends OrderLineInput {
  lineNo: number;
}

/** The customer order (expected side) plus the vendor/customer documents to check against it. */
export interface OrderDocumentsInput {
  orderNumber: string;
  orderLines: NumberedLine[];
  documents: {
    documentRef: string;
    documentType: string;
    lines: NumberedLine[];
  }[];
}

export const LINE_REASON_CODES = [
  "SKU_MISMATCH",
  "UOM_MISMATCH",
  "QTY_MISMATCH",
  "UNIT_PRICE_MISMATCH",
  "WEIGHT_MISMATCH",
] as const;

export type LineReasonCode = (typeof LINE_REASON_CODES)[number];

/** Line-level codes plus codes for lines present on only one side. */
export type OrderTrackingReasonCode =
  LineReasonCode | "LINE_MISSING_ON_DOCUMENT" | "LINE_NOT_ON_ORDER";

export interface Mismatch {
  code: LineReasonCode;
  field: keyof OrderLineInput;
  expected: string;
  actual: string;
  severity: Severity;
}

export interface MatchTolerances {
  /** Allowed relative weight difference, e.g. "0.02" = 2%. */
  weightPct: DecimalString;
}

export const DEFAULT_TOLERANCES: MatchTolerances = { weightPct: "0.02" };
