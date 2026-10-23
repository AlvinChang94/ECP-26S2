import { readGoldenJson } from "@/server/golden";
import type { CommissionRecalc, InvoiceCommission, SalesLine, ZeroCommissionLabel } from "./types";

export interface GoldenLabelExpectation {
  invoiceNo: string;
  lineNo: number;
  label: ZeroCommissionLabel | null;
  gpPct: string | null;
  reasonCodes: string[];
  note: string;
}

export type GoldenRecalcExpectation = Omit<
  CommissionRecalc,
  "fullCommission" | "eligibleBeforeCreditNotes"
> & { reasonCodes: string[]; note: string };

export function loadCommissionGolden() {
  return {
    lines: readGoldenJson<SalesLine[]>("commission-check", "sales_lines.json"),
    labelExpectations: readGoldenJson<GoldenLabelExpectation[]>(
      "commission-check",
      "expected_labels.json",
    ),
    invoices: readGoldenJson<InvoiceCommission[]>("commission-check", "credit_note_invoices.json"),
    recalcExpectations: readGoldenJson<GoldenRecalcExpectation[]>(
      "commission-check",
      "expected_recalc.json",
    ),
  };
}
