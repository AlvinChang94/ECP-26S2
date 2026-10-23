import { creditNoteRecalcRule, zeroCommissionRule } from "./commission-check";
import { crossDocumentLineRule } from "./order-tracking";
import { paymentMatchingRule } from "./payment-matching";

/** The three candidate problem statements. Drop the two that are not chosen. */
export const MODULES = [
  {
    id: "order-tracking",
    title: "Order tracking",
    summary:
      "Read customer and vendor documents, match them across documents, route approvals and show order status.",
    rules: [crossDocumentLineRule],
  },
  {
    id: "payment-matching",
    title: "Payment matching",
    summary:
      "Consolidate payment proofs into one Excel file and match payments to invoices, including partial and unreferenced payments.",
    rules: [paymentMatchingRule],
  },
  {
    id: "commission-check",
    title: "Commission check",
    summary:
      "Label zero-commission lines, recalculate commission after credit notes (prorated by amount paid) and work out clawbacks.",
    rules: [zeroCommissionRule, creditNoteRecalcRule],
  },
] as const;

export type ModuleId = (typeof MODULES)[number]["id"];

/** Rule metadata for seeding rule_configs. */
export const ALL_RULES = MODULES.flatMap((m) =>
  m.rules.map((r) => ({
    module: m.id as ModuleId,
    code: r.code,
    description: r.description,
    defaultParams: { ...r.defaultParams } as Record<string, unknown>,
  })),
);
