// INVARIANT: an override without a reason is rejected. The same holds for a resolution on a shipment, and nothing closes by itself.
// What: tries to accept or resolve flagged differences with a missing, blank or too-short reason, in the rule and through the services.
// Who calls it: `npm test`. Design principle 5 in CLAUDE.md: an override needs a reason and the person's name.
// To extend: every new place where a person accepts or resolves a flag must call validateDecisionInput and get a case here.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FLAG_CATALOGUE, type FlagCode, validateDecisionInput } from "@/domain/flags";
import { UserError } from "@/services/errors";
import { confirmDocumentType, ingestDocument, parseDocumentType } from "@/services/intake";
import { runDueJobs } from "@/services/jobs";
import { overrideFlag } from "@/services/poEdit";
import { loadPoReview } from "@/services/poReview";
import { getShipment, recordResolution } from "@/services/shipments";
import { captureCustomerPo } from "../helpers/flows";
import { createWorkspace, PETER, readDataFile, SAM, type TestWorkspace } from "../helpers/workspace";

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

/** The golden case "invoiced 100, received 95": one blocking QTY_VARIANCE finding on shipment SHP-0001. */
async function shipmentWithShortReceipt(workspace: TestWorkspace): Promise<string> {
  for (const part of ["invoice", "packing-list", "awb", "permit"]) {
    const fileName = `ship-receipt-short-${part}.pdf`;
    const { documentId } = await ingestDocument(workspace.deps, PETER, { bytes: readDataFile(`golden/files/${fileName}`), fileName, channel: "email", sender: null });
    const document = await workspace.deps.db.document.findUniqueOrThrow({ where: { id: documentId } });
    await confirmDocumentType(workspace.deps, PETER, documentId, parseDocumentType(document.detectedType));
  }
  return "SHP-0001";
}

describe("INVARIANT: a resolution on a shipment needs a reason and a name, and nothing closes automatically", () => {
  it("the rule rejects a resolution without a reason or without a name", () => {
    for (const reason of [undefined, null, "", "   ", "ok"]) {
      expect(validateDecisionInput({ code: "QTY_VARIANCE", canOverride: true }, { reason, byName: "Peter Goh" }, "resolution"), JSON.stringify(reason)).not.toBeNull();
    }
    for (const byName of [undefined, null, "", "   "]) {
      expect(validateDecisionInput({ code: "QTY_VARIANCE", canOverride: true }, { reason: "Vendor ships the rest next week", byName }, "resolution"), JSON.stringify(byName)).not.toBeNull();
    }
  });

  it("the service rejects a resolution without a reason, or from a person without a name, and records nothing", async () => {
    const shipmentNo = await shipmentWithShortReceipt(workspace);
    const finding = (await getShipment(workspace.deps, shipmentNo)).flags[0];
    expect(finding.code).toBe("QTY_VARIANCE");

    for (const reason of ["", "   ", "ok"]) {
      await expect(recordResolution(workspace.deps, PETER, { shipmentNo, fingerprint: finding.fingerprint, reason })).rejects.toThrow(UserError);
    }
    await expect(recordResolution(workspace.deps, { name: "", role: "purchase" }, { shipmentNo, fingerprint: finding.fingerprint, reason: "Vendor ships the rest next week" })).rejects.toThrow(/name of the person/);
    expect(await workspace.deps.db.flagDecision.count()).toBe(0);
    expect(await workspace.deps.db.auditEvent.count({ where: { action: "flag_resolution" } })).toBe(0);
    expect((await getShipment(workspace.deps, shipmentNo)).status).toBe("needs_review");
  });

  it("a finding stays open however long the system runs: only a person's recorded resolution closes it", async () => {
    const shipmentNo = await shipmentWithShortReceipt(workspace);
    // Two months pass with the due jobs running twice a day.
    for (let step = 0; step < 120; step++) {
      workspace.clock.advanceHours(12);
      await runDueJobs(workspace.deps);
    }
    expect(await workspace.deps.db.flagDecision.count()).toBe(0);
    const view = await getShipment(workspace.deps, shipmentNo);
    expect(view.status).toBe("needs_review");
    expect(view.flags.map((flag) => [flag.code, flag.decision])).toEqual([["QTY_VARIANCE", null]]);

    await recordResolution(workspace.deps, PETER, { shipmentNo, fingerprint: view.flags[0].fingerprint, reason: "Vendor ships the 5 missing units next week" });
    const [decision] = await workspace.deps.db.flagDecision.findMany();
    expect(decision).toMatchObject({ entityType: "shipment", entityId: shipmentNo, kind: "resolution", byName: "Peter Goh", byRole: "purchase" });
    expect((await getShipment(workspace.deps, shipmentNo)).status).toBe("resolved");
  });
});
