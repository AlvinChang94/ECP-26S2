import { runRules, type Finding } from "@/server/engine";
import type { ModuleId } from "@/server/modules";
import { creditNoteRecalcRule, zeroCommissionRule } from "@/server/modules/commission-check";
import { loadCommissionGolden } from "@/server/modules/commission-check/golden";
import { crossDocumentLineRule } from "@/server/modules/order-tracking";
import { loadOrderTrackingGolden } from "@/server/modules/order-tracking/golden";
import { paymentMatchingRule } from "@/server/modules/payment-matching";
import { loadPaymentMatchingGolden } from "@/server/modules/payment-matching/golden";

/**
 * PLACEHOLDER data for the UI: runs the real rules over the golden datasets in memory.
 * Statuses are assigned deterministically so the status filter has something to show.
 * Replace with a query on the findings table once a problem statement is chosen.
 */

export const FINDING_STATUSES = ["OPEN", "ACKNOWLEDGED", "RESOLVED", "DISMISSED"] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];
export const SEVERITIES = ["ERROR", "WARNING", "INFO"] as const;

export interface FindingRow extends Finding {
  id: string;
  module: ModuleId;
  status: FindingStatus;
}

function placeholderStatus(i: number): FindingStatus {
  if (i % 7 === 3) return "RESOLVED";
  if (i % 5 === 2) return "ACKNOWLEDGED";
  if (i % 11 === 6) return "DISMISSED";
  return "OPEN";
}

export function demoFindings(): FindingRow[] {
  const ot = loadOrderTrackingGolden();
  const pm = loadPaymentMatchingGolden();
  const cc = loadCommissionGolden();

  const byModule: [ModuleId, Finding[]][] = [
    ["order-tracking", ot.inputs.flatMap((i) => runRules([crossDocumentLineRule], i).findings)],
    ["payment-matching", runRules([paymentMatchingRule], pm.input).findings],
    [
      "commission-check",
      [
        ...runRules([zeroCommissionRule], { lines: cc.lines }).findings,
        ...runRules([creditNoteRecalcRule], { invoices: cc.invoices }).findings,
      ],
    ],
  ];

  return byModule
    .flatMap(([module, findings]) => findings.map((f) => ({ ...f, module })))
    .map((f, i) => ({ ...f, id: String(i + 1), status: placeholderStatus(i) }));
}
