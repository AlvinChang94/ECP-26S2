// INVARIANT: an override without a reason is rejected.
// What: tries to accept flagged differences with a missing, blank or too-short reason, in the rule and through the service.
// Who calls it: `npm test`. Design principle 5 in CLAUDE.md: an override needs a reason and the person's name.
// To extend: every new place where a person accepts or resolves a flag must call validateDecisionInput and get a case here.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FLAG_CATALOGUE, type FlagCode, validateDecisionInput } from "@/domain/flags";
import { UserError } from "@/services/errors";
import { overrideFlag } from "@/services/poEdit";
import { loadPoReview } from "@/services/poReview";
import { captureCustomerPo } from "../helpers/flows";
import { createWorkspace, SAM, type TestWorkspace } from "../helpers/workspace";

let workspace: TestWorkspace;
beforeEach(() => {
  workspace = createWorkspace();
});
afterEach(async () => {
  await workspace.cleanup();
});

describe("INVARIANT: an override needs a reason and a name", () => {
  it("the rule rejects a missing, blank or too-short reason for every flag that can be overridden", () => {
    const overridable = (Object.keys(FLAG_CATALOGUE) as FlagCode[]).filter((code) => FLAG_CATALOGUE[code].canOverride);
    expect(overridable.length).toBeGreaterThan(5);
    for (const code of overridable) {
      for (const reason of [undefined, null, "", "   ", "ok"]) {
        expect(validateDecisionInput({ code, canOverride: true }, { reason, byName: "Sam Tan" }, "override"), `${code} ${JSON.stringify(reason)}`).not.toBeNull();
      }
      expect(validateDecisionInput({ code, canOverride: true }, { reason: "A real reason", byName: "" }, "override"), code).not.toBeNull();
    }
  });

  it("the service rejects an override without a reason and records nothing", async () => {
    const { orderNo } = await captureCustomerPo(workspace.deps, "golden/files/po-price-lower.pdf");
    const flag = (await loadPoReview(workspace.deps, orderNo)).flags.find((candidate) => candidate.code === "PRICE_MISMATCH");

    for (const reason of ["", "   ", "ok"]) {
      await expect(overrideFlag(workspace.deps, SAM, { orderNo, fingerprint: flag?.fingerprint as string, reason })).rejects.toThrow(UserError);
    }
    expect(await workspace.deps.db.flagDecision.count()).toBe(0);
    expect(await workspace.deps.db.auditEvent.count({ where: { action: "flag_override" } })).toBe(0);
    // The finding is still blocking.
    expect((await loadPoReview(workspace.deps, orderNo)).blocking.map((blocking) => blocking.code)).toContain("PRICE_MISMATCH");
  });

  it("stores the reason, the name and the time when an override is given properly", async () => {
    const { orderNo } = await captureCustomerPo(workspace.deps, "golden/files/po-price-lower.pdf");
    const flag = (await loadPoReview(workspace.deps, orderNo)).flags.find((candidate) => candidate.code === "PRICE_MISMATCH");
    await overrideFlag(workspace.deps, SAM, { orderNo, fingerprint: flag?.fingerprint as string, reason: "Special deal agreed by phone" });

    const [decision] = await workspace.deps.db.flagDecision.findMany();
    expect(decision).toMatchObject({ kind: "override", flagCode: "PRICE_MISMATCH", reason: "Special deal agreed by phone", byName: "Sam Tan", byRole: "sales" });
    expect(decision.at.toISOString()).toBe(workspace.clock.now().toISOString());
    const [event] = await workspace.deps.db.auditEvent.findMany({ where: { action: "flag_override" } });
    expect(event).toMatchObject({ actorName: "Sam Tan", reason: "Special deal agreed by phone", orderNo });
  });

  it("refuses to override a flag that must be fixed, whatever the reason", async () => {
    const { orderNo } = await captureCustomerPo(workspace.deps, "golden/files/po-missing-po-number.pdf");
    const flag = (await loadPoReview(workspace.deps, orderNo)).flags.find((candidate) => candidate.code === "MISSING_FIELD" && candidate.field === "poNumber");
    await expect(overrideFlag(workspace.deps, SAM, { orderNo, fingerprint: flag?.fingerprint as string, reason: "We do not need a PO number" })).rejects.toThrow(/cannot be overridden/);
  });
});
