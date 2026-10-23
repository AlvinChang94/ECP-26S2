import type { Finding, Rule } from "./types";

export interface RunOptions {
  /** Per-rule param overrides (e.g. from rule_configs), merged over each rule's defaultParams. */
  params?: Record<string, Record<string, unknown> | undefined>;
  /** Rule codes to skip (e.g. rule_configs.enabled = false). */
  disabled?: readonly string[];
}

export interface RunResult {
  findings: Finding[];
  /** Number of findings per rule code, including rules that found nothing. */
  countsByRule: Record<string, number>;
}

export const RULE_FAILED = "RULE_FAILED";

/**
 * Applies rules to one input in order and concatenates their findings. A rule that throws
 * does not stop the others; it produces a RULE_FAILED finding instead, so failures stay visible.
 */
export function runRules<I>(
  rules: readonly Rule<I, unknown>[],
  input: I,
  options: RunOptions = {},
): RunResult {
  const findings: Finding[] = [];
  const countsByRule: Record<string, number> = {};
  const disabled = new Set(options.disabled ?? []);

  for (const rule of rules) {
    if (disabled.has(rule.code)) continue;
    const params = { ...(rule.defaultParams as object), ...options.params?.[rule.code] };
    try {
      const found = rule.evaluate(input, params);
      findings.push(...found);
      countsByRule[rule.code] = found.length;
    } catch (err) {
      findings.push({
        ruleCode: rule.code,
        reasonCode: RULE_FAILED,
        severity: "ERROR",
        subject: { type: "rule", id: rule.code },
        explanation: `Rule ${rule.code} failed: ${err instanceof Error ? err.message : String(err)}`,
        details: {},
      });
      countsByRule[rule.code] = 1;
    }
  }

  return { findings, countsByRule };
}
