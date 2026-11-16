// INVARIANT: nothing is written to data/navision/export/ without an approved preview.
// What: walks a PO through every step short of approval and checks the export folder stays empty; then tries every way around the approval.
// Who calls it: `npm test`. Design principle 3 in CLAUDE.md.
// To extend: any new kind of export must go through FileNavisionGateway.writeApproved and gets a case here.
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ExportNotApprovedError } from "@/adapters/navision/gateway";
import { sha256OfText } from "@/domain/hash";
import { parseSalesOrderExport } from "@/domain/po/exportFile";
import { acceptSuggestion, editField, overrideFlag, proposeCustomerCard } from "@/services/poEdit";
import { approveAndExport, approveCancellation, buildCancellationPreview, buildExportPreview } from "@/services/poExport";
import { loadPoReview } from "@/services/poReview";
import { captureCustomerPo, exportedOrder, setShipDate } from "../helpers/flows";
import { createWorkspace, FARAH, SAM, type TestWorkspace } from "../helpers/workspace";

let workspace: TestWorkspace;
beforeEach(() => {
  workspace = createWorkspace();
});
afterEach(async () => {
  await workspace.cleanup();
});

/** Every file under export/, as relative paths. Empty when nothing was ever written. */
function exportedFiles(): string[] {
  const root = path.join(workspace.navisionDir, "export");
  if (!existsSync(root)) return [];
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.relative(root, path.join(dir, entry.name))]));
  return walk(root).filter((file) => file !== ".gitkeep");
}

describe("INVARIANT: no export without an approved preview", () => {
  it("writes nothing while a PO is taken in, checked, edited, overridden and previewed", async () => {
    const { orderNo } = await captureCustomerPo(workspace.deps, "golden/files/po-combined.pdf");
    expect(exportedFiles()).toEqual([]);

    const review = await loadPoReview(workspace.deps, orderNo);
    const alias = review.flags.find((flag) => flag.code === "PART_ALIAS_SUGGESTED");
    await acceptSuggestion(workspace.deps, SAM, { orderNo, fingerprint: alias?.fingerprint as string, remember: true });
    await setShipDate(workspace.deps, orderNo);
    for (const flag of (await loadPoReview(workspace.deps, orderNo)).blocking) {
      await overrideFlag(workspace.deps, SAM, { orderNo, fingerprint: flag.fingerprint, reason: "Accepted for the test" });
    }
    const preview = await buildExportPreview(workspace.deps, orderNo);
    expect(preview.ready).toBe(true);
    await buildExportPreview(workspace.deps, orderNo); // looking at the preview again writes nothing either
    expect(exportedFiles()).toEqual([]);

    await approveAndExport(workspace.deps, SAM, { orderNo, previewHash: preview.previewHash });
    expect(exportedFiles()).toEqual([path.join("salesOrders", `${orderNo}-r1.json`)]);
  });

  it("refuses an approval that quotes a different preview than the current one", async () => {
    const { orderNo } = await captureCustomerPo(workspace.deps, "golden/files/po-clean-a.pdf");
    await setShipDate(workspace.deps, orderNo);
    const stale = await buildExportPreview(workspace.deps, orderNo);
    // The order changes after the person opened the preview.
    await editField(workspace.deps, SAM, { orderNo, field: "lines[0].quantity", value: "55" });
    await expect(approveAndExport(workspace.deps, SAM, { orderNo, previewHash: stale.previewHash })).rejects.toThrow(/changed after the preview was opened/);
    await expect(approveAndExport(workspace.deps, SAM, { orderNo, previewHash: "" })).rejects.toThrow(/changed after the preview was opened/);
    expect(exportedFiles()).toEqual([]);
  });

  it("refuses approval while a blocking flag is unresolved", async () => {
    const { orderNo } = await captureCustomerPo(workspace.deps, "golden/files/po-unknown-part.pdf");
    await setShipDate(workspace.deps, orderNo);
    const preview = await buildExportPreview(workspace.deps, orderNo);
    expect(preview.ready).toBe(false);
    await expect(approveAndExport(workspace.deps, SAM, { orderNo, previewHash: preview.previewHash })).rejects.toThrow(/cannot be approved yet/);
    expect(exportedFiles()).toEqual([]);
  });

  it("refuses approval by anyone who is not a sales team member", async () => {
    const { orderNo } = await captureCustomerPo(workspace.deps, "golden/files/po-clean-a.pdf");
    await setShipDate(workspace.deps, orderNo);
    const preview = await buildExportPreview(workspace.deps, orderNo);
    await expect(approveAndExport(workspace.deps, FARAH, { orderNo, previewHash: preview.previewHash })).rejects.toThrow(/Only a sales team member/);
    expect(exportedFiles()).toEqual([]);
  });

  it("does not create a customer card when one is only proposed", async () => {
    const { orderNo } = await captureCustomerPo(workspace.deps, "golden/files/po-unknown-customer.pdf");
    await proposeCustomerCard(workspace.deps, SAM, { orderNo, address: "", country: "Nepal", email: "" });
    await buildExportPreview(workspace.deps, orderNo);
    expect(exportedFiles()).toEqual([]);
  });

  it("the gateway itself refuses content that does not match the approved hash, even when called directly", async () => {
    const orderNo = await exportedOrder(workspace.deps);
    const version = await workspace.deps.db.poVersion.findFirst({ where: { orderNo } });
    const approved = parseSalesOrderExport(version?.exportJson as string);
    const tampered = { ...approved, orderNo: "ORD-9999", totalAmount: "1.00" };
    const approvalForTheOriginal = { approvedBy: "Sam Tan", approvedAt: workspace.clock.now(), previewHash: sha256OfText(version?.exportJson as string) };
    await expect(workspace.deps.navision.exportSalesOrder(tampered, approvalForTheOriginal)).rejects.toThrow(ExportNotApprovedError);
    expect(exportedFiles()).toEqual([path.join("salesOrders", `${orderNo}-r1.json`)]);
  });

  it("writes a cancellation only after the cancellation preview is confirmed with a reason", async () => {
    const orderNo = await exportedOrder(workspace.deps);
    const preview = await buildCancellationPreview(workspace.deps, orderNo);
    expect(exportedFiles()).toHaveLength(1);
    await expect(approveCancellation(workspace.deps, SAM, { orderNo, previewHash: "wrong", reason: "Customer cancelled" })).rejects.toThrow(/changed after the preview/);
    await expect(approveCancellation(workspace.deps, SAM, { orderNo, previewHash: preview.previewHash, reason: " " })).rejects.toThrow(/reason is required/);
    expect(exportedFiles()).toHaveLength(1);
    await approveCancellation(workspace.deps, SAM, { orderNo, previewHash: preview.previewHash, reason: "Customer cancelled" });
    expect(exportedFiles()).toHaveLength(2);
  });
});
