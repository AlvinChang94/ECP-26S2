/** Mirrors the Prisma `Severity` enum. */
export type Severity = "INFO" | "WARNING" | "ERROR";

/** What a finding is about, e.g. { type: "order_line", id: "PO-1001#2" }. Maps to findings.subject_type/subject_id. */
export interface Subject {
  type: string;
  id: string;
}

/** JSON-safe detail values. Decimals are always strings, never numbers. */
export type DetailValue = string | number | boolean | null | readonly string[];

export interface Finding {
  ruleCode: string;
  reasonCode: string;
  severity: Severity;
  subject: Subject;
  /** One sentence a reviewer can act on, e.g. "Invoice quantity 480 differs from PO quantity 500." */
  explanation: string;
  details: Record<string, DetailValue>;
}

/**
 * A deterministic check. `evaluate` must be pure: no DB, network, clock or randomness.
 * Params come from `defaultParams`, optionally overridden by rule_configs.params.
 */
export interface Rule<I, P = Record<string, never>> {
  code: string;
  description: string;
  defaultParams: P;
  evaluate(input: I, params: P): Finding[];
}
