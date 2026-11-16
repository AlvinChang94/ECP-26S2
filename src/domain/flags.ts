// What: the Flag type and the catalogue of every flag code (severity, title, whether a person may override it).
// Who calls it: every checking rule creates flags with makeFlag(); pages show them; services test "is anything blocking?".
// To extend: add a code to FLAG_CATALOGUE, create it in a rule with makeFlag(), and add a test. Flags are data, not UI text.

export type Severity = "blocking" | "warning" | "info";

/** One entry per flag code. `severity` is the default; a rule may pass a different one for a special case. */
export const FLAG_CATALOGUE = {
  // Story 1: customer PO checked against Navision
  PART_NOT_FOUND: { severity: "blocking", canOverride: true, title: "Part not in Navision" },
  PART_ALIAS_SUGGESTED: { severity: "blocking", canOverride: true, title: "Similar part suggested" },
  PRICE_MISMATCH: { severity: "blocking", canOverride: true, title: "Price differs from Navision" },
  QTY_EXCEEDS_STOCK: { severity: "warning", canOverride: true, title: "Quantity above stock" },
  CUSTOMER_NOT_FOUND: { severity: "blocking", canOverride: false, title: "Customer not in Navision" },
  NEW_CUSTOMER_CARD: { severity: "info", canOverride: false, title: "New customer card proposed" },
  DUPLICATE_PO: { severity: "blocking", canOverride: true, title: "PO number already captured" },
  MISSING_FIELD: { severity: "blocking", canOverride: false, title: "Required field missing" },
  INVALID_VALUE: { severity: "blocking", canOverride: false, title: "Value cannot be read" },
  PO_AMENDMENT: { severity: "info", canOverride: false, title: "Amends an earlier PO" },
  PO_CANCELLATION: { severity: "info", canOverride: false, title: "Cancels an earlier PO" },
  PREVIOUS_PO_NOT_FOUND: { severity: "warning", canOverride: true, title: "Earlier PO not found" },
  // Story 4: proof of payment matched to the PI
  PAYMENT_SHORT: { severity: "blocking", canOverride: true, title: "Paid less than the PI" },
  PAYMENT_OVER: { severity: "blocking", canOverride: true, title: "Paid more than the PI" },
  PAYMENT_REFERENCE_NOT_FOUND: { severity: "blocking", canOverride: true, title: "Reference matches no PI" },
  PAYMENT_CURRENCY_MISMATCH: { severity: "blocking", canOverride: true, title: "Currency differs from the PI" },
  PAYMENT_DUPLICATE: { severity: "blocking", canOverride: true, title: "Same proof received before" },
  // Story 5: goods receipts and shipment documents
  QTY_VARIANCE: { severity: "blocking", canOverride: true, title: "Quantities do not match" },
  INVOICE_PART_MISMATCH: { severity: "blocking", canOverride: true, title: "Part not on the order" },
  GOODS_RECEIPT_PENDING: { severity: "info", canOverride: false, title: "No goods receipt yet" },
  DOCUMENT_MISSING: { severity: "warning", canOverride: true, title: "Document missing" },
  DOCUMENT_DUE_SOON: { severity: "blocking", canOverride: true, title: "Document due soon" },
  DOCUMENT_OVERDUE: { severity: "blocking", canOverride: true, title: "Document overdue" },
  DOCUMENT_PENDING_CHECK: { severity: "info", canOverride: false, title: "Document waiting for a check" },
  REFERENCE_NOT_FOUND: { severity: "blocking", canOverride: false, title: "Reference matches nothing" },
} as const satisfies Record<string, { severity: Severity; canOverride: boolean; title: string }>;

export type FlagCode = keyof typeof FLAG_CATALOGUE;

/** A fix the system proposes. It is only ever applied when a person clicks it. */
export type FlagSuggestion = {
  label: string; // button text, for example "Use AB1234X"
  field: string; // the field the suggestion would change
  value: string; // the suggested new value
  source: "alias_memory" | "similar_part" | "navision";
};

/** A follow-up the person can start from the flag, for example raising an SPR for a shortage. */
export type FlagFollowUp = { kind: "raise_spr"; partNo: string; quantity: number };

export type Flag = {
  code: FlagCode;
  severity: Severity;
  /** The field the flag is about, for example "lines[0].unitPrice". Empty string means the whole document. */
  field: string;
  /** A plain-language sentence a staff member can act on. */
  reason: string;
  canOverride: boolean;
  /** Identifies this exact finding. A decision (override or resolution) is tied to it, so a changed value needs a new decision. */
  fingerprint: string;
  suggestion?: FlagSuggestion;
  followUp?: FlagFollowUp;
  /** Structured details (expected, actual, difference) for tests and message templates. */
  data?: Record<string, string>;
};

export type MakeFlagInput = {
  code: FlagCode;
  field: string;
  reason: string;
  /** Values that make this finding unique, for example the PO price and the Navision price. */
  values?: (string | number | null | undefined)[];
  severity?: Severity;
  suggestion?: FlagSuggestion;
  followUp?: FlagFollowUp;
  data?: Record<string, string>;
};

export function makeFlag(input: MakeFlagInput): Flag {
  const entry = FLAG_CATALOGUE[input.code];
  const values = (input.values ?? []).map((value) => (value === null || value === undefined ? "" : String(value)));
  return {
    code: input.code,
    severity: input.severity ?? entry.severity,
    field: input.field,
    reason: input.reason,
    canOverride: entry.canOverride,
    fingerprint: [input.code, input.field, ...values].join("|"),
    ...(input.suggestion ? { suggestion: input.suggestion } : {}),
    ...(input.followUp ? { followUp: input.followUp } : {}),
    ...(input.data ? { data: input.data } : {}),
  };
}

export function flagTitle(code: FlagCode): string {
  return FLAG_CATALOGUE[code].title;
}

/** A person's recorded decision about one flag. Stored in the FlagDecision table. */
export type FlagDecisionRecord = {
  fingerprint: string;
  kind: "override" | "resolution";
  reason: string;
  byName: string;
  at: Date;
};

export type FlagWithDecision = Flag & { decision: FlagDecisionRecord | null };

/** Pairs each flag with the decision recorded for exactly that finding (same fingerprint), if any. */
export function attachDecisions(flags: Flag[], decisions: FlagDecisionRecord[]): FlagWithDecision[] {
  return flags.map((flag) => ({
    ...flag,
    decision: decisions.find((decision) => decision.fingerprint === flag.fingerprint) ?? null,
  }));
}

/** Blocking flags that nobody has decided yet. Export stays disabled while this list is not empty. */
export function unresolvedBlocking(flags: FlagWithDecision[]): FlagWithDecision[] {
  return flags.filter((flag) => flag.severity === "blocking" && flag.decision === null);
}

/** Flags of any severity except info that nobody has decided yet (used for "needs review" on shipments). */
export function unresolvedExceptions(flags: FlagWithDecision[]): FlagWithDecision[] {
  return flags.filter((flag) => flag.severity !== "info" && flag.decision === null);
}

export type DecisionInput = { reason: string | null | undefined; byName: string | null | undefined };

/**
 * An override or resolution must say why and who. Returns an error sentence, or null when the input is acceptable.
 * Invariant test: tests/invariants/override-needs-reason.test.ts
 */
export function validateDecisionInput(flag: Pick<Flag, "code" | "canOverride">, input: DecisionInput, kind: "override" | "resolution"): string | null {
  if (kind === "override" && !flag.canOverride) {
    return `${flagTitle(flag.code)} cannot be overridden. Fix the value instead.`;
  }
  if (!input.reason || input.reason.trim().length < 3) {
    return "A reason is required (at least a few words that explain the decision).";
  }
  if (!input.byName || input.byName.trim().length === 0) {
    return "The name of the person making the decision is required.";
  }
  return null;
}

/** Orders flags for display: blocking first, then warning, then info; ties keep their original order. */
export function sortFlags<T extends Flag>(flags: T[]): T[] {
  const rank: Record<Severity, number> = { blocking: 0, warning: 1, info: 2 };
  return flags
    .map((flag, index) => ({ flag, index }))
    .sort((a, b) => rank[a.flag.severity] - rank[b.flag.severity] || a.index - b.index)
    .map((entry) => entry.flag);
}
