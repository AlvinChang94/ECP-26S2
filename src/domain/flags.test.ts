// What: unit tests for flags as data: creation, decisions (override and resolution) and "is anything still blocking?".
// Who calls it: `npm test`.
// To extend: when you add a flag code to FLAG_CATALOGUE, the first test below checks its entry is complete.
import { describe, expect, it } from "vitest";
import {
  attachDecisions,
  FLAG_CATALOGUE,
  type FlagCode,
  type FlagDecisionRecord,
  makeFlag,
  sortFlags,
  unresolvedBlocking,
  unresolvedExceptions,
  validateDecisionInput,
} from "./flags";

describe("flag catalogue", () => {
  it("gives every code a severity, a title and an override rule", () => {
    for (const [code, entry] of Object.entries(FLAG_CATALOGUE)) {
      expect(["blocking", "warning", "info"], code).toContain(entry.severity);
      expect(entry.title.length, code).toBeGreaterThan(3);
      expect(typeof entry.canOverride, code).toBe("boolean");
    }
  });
});

describe("makeFlag", () => {
  it("carries code, severity, field and a plain-language reason", () => {
    const flag = makeFlag({
      code: "PRICE_MISMATCH",
      field: "lines[0].unitPrice",
      reason: "Line 1: the PO price 11.90 differs from the Navision price 12.40.",
      values: ["11.90", "12.40"],
    });
    expect(flag).toMatchObject({ code: "PRICE_MISMATCH", severity: "blocking", field: "lines[0].unitPrice", canOverride: true });
    expect(flag.reason).toContain("11.90");
    expect(flag.fingerprint).toBe("PRICE_MISMATCH|lines[0].unitPrice|11.90|12.40");
  });

  it("gives a different fingerprint when the flagged value changes, so an old decision no longer applies", () => {
    const before = makeFlag({ code: "PRICE_MISMATCH", field: "lines[0].unitPrice", reason: "x", values: ["11.90", "12.40"] });
    const after = makeFlag({ code: "PRICE_MISMATCH", field: "lines[0].unitPrice", reason: "x", values: ["11.50", "12.40"] });
    expect(after.fingerprint).not.toBe(before.fingerprint);
  });
});

describe("decisions", () => {
  const price = makeFlag({ code: "PRICE_MISMATCH", field: "lines[0].unitPrice", reason: "price differs", values: ["11.90", "12.40"] });
  const stock = makeFlag({ code: "QTY_EXCEEDS_STOCK", field: "lines[0].quantity", reason: "short by 40", values: [200, 160] });
  const amendment = makeFlag({ code: "PO_AMENDMENT", field: "", reason: "amends ORD-1" });
  const decision: FlagDecisionRecord = {
    fingerprint: price.fingerprint,
    kind: "override",
    reason: "Special deal agreed by phone",
    byName: "Sam Tan",
    at: new Date("2026-11-16T01:00:00.000Z"),
  };

  it("keeps export blocked until every blocking flag has a decision", () => {
    expect(unresolvedBlocking(attachDecisions([price, stock, amendment], []))).toHaveLength(1);
    expect(unresolvedBlocking(attachDecisions([price, stock, amendment], [decision]))).toHaveLength(0);
  });

  it("does not let a decision for one value cover a different value", () => {
    const changed = makeFlag({ code: "PRICE_MISMATCH", field: "lines[0].unitPrice", reason: "price differs", values: ["10.00", "12.40"] });
    expect(unresolvedBlocking(attachDecisions([changed], [decision]))).toHaveLength(1);
  });

  it("counts warnings as exceptions to review but never info flags", () => {
    const open = unresolvedExceptions(attachDecisions([price, stock, amendment], [decision]));
    expect(open.map((flag) => flag.code)).toEqual(["QTY_EXCEEDS_STOCK"]);
  });

  it("sorts blocking first, then warning, then info", () => {
    expect(sortFlags([amendment, stock, price]).map((flag) => flag.severity)).toEqual(["blocking", "warning", "info"]);
  });
});

describe("validateDecisionInput", () => {
  const overridable = { code: "PRICE_MISMATCH" as FlagCode, canOverride: true };

  it.each([
    ["", "Sam Tan"],
    ["   ", "Sam Tan"],
    [null, "Sam Tan"],
    ["ok", "Sam Tan"],
  ])("rejects an override with reason %j", (reason, byName) => {
    expect(validateDecisionInput(overridable, { reason, byName }, "override")).toMatch(/reason is required/);
  });

  it("rejects an override with no name", () => {
    expect(validateDecisionInput(overridable, { reason: "Special deal agreed", byName: " " }, "override")).toMatch(/name/);
  });

  it("accepts a reason and a name", () => {
    expect(validateDecisionInput(overridable, { reason: "Special deal agreed", byName: "Sam Tan" }, "override")).toBeNull();
  });

  it("refuses to override a flag that must be fixed", () => {
    const mustFix = { code: "MISSING_FIELD" as FlagCode, canOverride: false };
    expect(validateDecisionInput(mustFix, { reason: "Not needed here", byName: "Sam Tan" }, "override")).toMatch(/cannot be overridden/);
  });
});
