import { describe, expect, it } from "vitest";
import { defineStateMachine, runRules, RULE_FAILED, type Rule } from "./index";

type Input = { values: number[] };

const tooBig: Rule<Input, { max: number }> = {
  code: "TOO_BIG",
  description: "Flags values above max",
  defaultParams: { max: 10 },
  evaluate: (input, { max }) =>
    input.values
      .filter((v) => v > max)
      .map((v) => ({
        ruleCode: "TOO_BIG",
        reasonCode: "VALUE_ABOVE_MAX",
        severity: "WARNING",
        subject: { type: "value", id: String(v) },
        explanation: `${v} is above ${max}`,
        details: { max },
      })),
};

const broken: Rule<Input> = {
  code: "BROKEN",
  description: "Always throws",
  defaultParams: {},
  evaluate: () => {
    throw new Error("boom");
  },
};

describe("runRules", () => {
  it("applies default params and counts findings per rule", () => {
    const result = runRules([tooBig], { values: [5, 11, 20] });
    expect(result.findings.map((f) => f.subject.id)).toEqual(["11", "20"]);
    expect(result.countsByRule).toEqual({ TOO_BIG: 2 });
  });

  it("merges param overrides over defaults", () => {
    const result = runRules(
      [tooBig],
      { values: [5, 11, 20] },
      { params: { TOO_BIG: { max: 15 } } },
    );
    expect(result.findings.map((f) => f.subject.id)).toEqual(["20"]);
  });

  it("skips disabled rules", () => {
    expect(runRules([tooBig], { values: [99] }, { disabled: ["TOO_BIG"] }).findings).toEqual([]);
  });

  it("turns a throwing rule into a RULE_FAILED finding and keeps running the others", () => {
    const result = runRules([broken, tooBig], { values: [50] });
    expect(result.findings.map((f) => f.reasonCode)).toEqual([RULE_FAILED, "VALUE_ABOVE_MAX"]);
    expect(result.findings[0].explanation).toContain("boom");
  });
});

describe("defineStateMachine", () => {
  const machine = defineStateMachine<"DRAFT" | "SUBMITTED" | "APPROVED", "FORM" | "SIGNATURE">({
    states: ["DRAFT", "SUBMITTED", "APPROVED"],
    initial: "DRAFT",
    transitions: [
      { from: "DRAFT", to: "SUBMITTED", requires: ["FORM"] },
      { from: "SUBMITTED", to: "APPROVED", requires: ["FORM", "SIGNATURE"] },
      { from: ["SUBMITTED", "APPROVED"], to: "DRAFT" },
    ],
  });

  it("allows a transition when all evidence is present", () => {
    expect(machine.check("SUBMITTED", "APPROVED", ["FORM", "SIGNATURE"])).toEqual({ ok: true });
  });

  it("reports exactly which evidence is missing", () => {
    expect(machine.check("SUBMITTED", "APPROVED", ["FORM"])).toEqual({
      ok: false,
      reason: "MISSING_EVIDENCE",
      missing: ["SIGNATURE"],
    });
  });

  it("rejects transitions that are not defined", () => {
    expect(machine.check("DRAFT", "APPROVED", ["FORM", "SIGNATURE"])).toEqual({
      ok: false,
      reason: "NOT_ALLOWED",
    });
  });

  it("supports multiple from-states and lists allowed targets", () => {
    expect(machine.allowedTargets("APPROVED")).toEqual(["DRAFT"]);
    expect(machine.allowedTargets("SUBMITTED")).toEqual(["APPROVED", "DRAFT"]);
    expect(machine.requiredEvidence("APPROVED", "DRAFT")).toEqual([]);
    expect(machine.requiredEvidence("DRAFT", "APPROVED")).toBeNull();
  });

  it("rejects definitions that reference unknown states", () => {
    expect(() =>
      defineStateMachine<"A" | "B">({
        states: ["A"],
        initial: "A",
        transitions: [{ from: "A", to: "B" }],
      }),
    ).toThrow(/unknown state "B"/);
  });
});
