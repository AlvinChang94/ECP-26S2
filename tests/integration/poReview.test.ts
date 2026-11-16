// What: integration tests for story 2: edit, undo, history, alias memory, overrides, export preview and approval, amend, cancel, deliver.
// Who calls it: `npm test`.
// To extend: each test tells one small story a sales team member could act out on the review page.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readPdfText } from "@/adapters/extractor/pdfText";
import { renderProformaInvoice } from "@/adapters/pdf/proformaInvoicePdf";
import { parseSalesOrderExport } from "@/domain/po/exportFile";
import { listOrderTimeline } from "@/services/audit";
import { getFulfilment, recordDelivery } from "@/services/fulfilment";
import { acceptSuggestion, addLine, editField, listAliases, overrideFlag, proposeCustomerCard, removeAlias, undoField, withdrawOverride } from "@/services/poEdit";
import { approveAndExport, approveCancellation, buildCancellationPreview, buildExportPreview, exportedOrderFile } from "@/services/poExport";
import { loadPoReview } from "@/services/poReview";
import { approveExport, captureCustomerPo, exportedOrder, setShipDate } from "../helpers/flows";
import { createWorkspace, FARAH, SAM, type TestWorkspace } from "../helpers/workspace";

let workspace: TestWorkspace;
beforeEach(() => {
  workspace = createWorkspace();
});
afterEach(async () => {
  await workspace.cleanup();
});

function exportDir(): string {
  return path.join(workspace.navisionDir, "export", "salesOrders");
}

function codes(review: Awaited<ReturnType<typeof loadPoReview>>): string[] {
  return review.flags.filter((flag) => flag.decision === null).map((flag) => flag.code);
}

describe("editing a PO value", () => {
  it("records who changed what, from what to what, and shows the new value", async () => {
    const { orderNo } = await captureCustomerPo(workspace.deps, "golden/files/po-alias-hyphen.pdf");
    await editField(workspace.deps, SAM, { orderNo, field: "lines[0].partNo", value: "AB1234X" });

    const review = await loadPoReview(workspace.deps, orderNo);
    expect(review.values["lines[0].partNo"]).toBe("AB1234X");
    expect(review.original["lines[0].partNo"]).toBe("AB-1234X");
    expect(review.edits).toHaveLength(1);
    expect(review.edits[0]).toMatchObject({ field: "lines[0].partNo", oldValue: "AB-1234X", newValue: "AB1234X", actorName: "Sam Tan", action: "field_edit" });
    expect(review.edits[0].at.toISOString()).toBe(workspace.clock.now().toISOString());
    expect(codes(review)).not.toContain("PART_ALIAS_SUGGESTED");
  });

  it("undoes step by step, and logs each undo", async () => {
    const { orderNo } = await captureCustomerPo(workspace.deps, "golden/files/po-clean-a.pdf");
    await editField(workspace.deps, SAM, { orderNo, field: "lines[0].quantity", value: "60" });
    await editField(workspace.deps, SAM, { orderNo, field: "lines[0].quantity", value: "70" });

    await undoField(workspace.deps, SAM, { orderNo, field: "lines[0].quantity" });
    expect((await loadPoReview(workspace.deps, orderNo)).values["lines[0].quantity"]).toBe("60");
    await undoField(workspace.deps, SAM, { orderNo, field: "lines[0].quantity" });
    const review = await loadPoReview(workspace.deps, orderNo);
    expect(review.values["lines[0].quantity"]).toBe("50");
    expect(review.edits.map((edit) => edit.action)).toEqual(["field_edit", "field_edit", "field_undo", "field_undo"]);
    await expect(undoField(workspace.deps, SAM, { orderNo, field: "lines[0].quantity" })).rejects.toThrow(/nothing to undo/);
  });

  it("does nothing when the value is the same, and refuses fields that do not exist", async () => {
    const { orderNo } = await captureCustomerPo(workspace.deps, "golden/files/po-clean-a.pdf");
    expect(await editField(workspace.deps, SAM, { orderNo, field: "lines[0].quantity", value: " 50 " })).toEqual({ changed: false });
    await expect(editField(workspace.deps, SAM, { orderNo, field: "lines[0].colour", value: "blue" })).rejects.toThrow(/not a field/);
    await expect(editField(workspace.deps, SAM, { orderNo, field: "lines[9].partNo", value: "CD-77" })).rejects.toThrow(/not a field/);
  });

  it("lets only a sales team member change a PO", async () => {
    const { orderNo } = await captureCustomerPo(workspace.deps, "golden/files/po-clean-a.pdf");
    await expect(editField(workspace.deps, FARAH, { orderNo, field: "lines[0].quantity", value: "1" })).rejects.toThrow(/Only a sales team member/);
  });

  it("adds a line and removes one; a removed line can be restored with undo", async () => {
    const { orderNo } = await captureCustomerPo(workspace.deps, "golden/files/po-clean-a.pdf");
    await addLine(workspace.deps, SAM, orderNo, "WC-1080");
    await editField(workspace.deps, SAM, { orderNo, field: "lines[3].quantity", value: "5" });
    await editField(workspace.deps, SAM, { orderNo, field: "lines[3].unitPrice", value: "27.75" });
    await editField(workspace.deps, SAM, { orderNo, field: "lines[0].removed", value: "true" });
    let review = await loadPoReview(workspace.deps, orderNo);
    expect(review.po.lines.map((line) => [line.partNo, line.removed])).toEqual([
      ["CD-77", true],
      ["GH-310", false],
      ["HS-700", false],
      ["WC-1080", false],
    ]);
    await undoField(workspace.deps, SAM, { orderNo, field: "lines[0].removed" });
    review = await loadPoReview(workspace.deps, orderNo);
    expect(review.po.lines[0].removed).toBe(false);
  });
});

describe("alias memory", () => {
  it("remembers a fix when asked, and suggests it on the next PO without applying it", async () => {
    // LT-DOCK-01 is the customer's own code: nothing in Navision looks like it.
    const first = await captureCustomerPo(workspace.deps, "golden/files/po-alias-remembered.pdf");
    expect(codes(await loadPoReview(workspace.deps, first.orderNo))).toContain("PART_NOT_FOUND");

    await editField(workspace.deps, SAM, { orderNo: first.orderNo, field: "lines[0].partNo", value: "AB1234X", rememberAlias: true });
    expect((await listAliases(workspace.deps)).map((alias) => [alias.fromPartNo, alias.toItemNo])).toEqual([["LT-DOCK-01", "AB1234X"]]);

    // The same customer code arrives again on another PO.
    const bytesAgain = "golden/files/po-alias-remembered.pdf";
    await editField(workspace.deps, SAM, { orderNo: first.orderNo, field: "poNumber", value: "LT-PO-FIRST" });
    const second = await captureCustomerPo(workspace.deps, bytesAgain);
    const review = await loadPoReview(workspace.deps, second.orderNo);
    const flag = review.flags.find((candidate) => candidate.code === "PART_ALIAS_SUGGESTED");
    expect(flag?.suggestion).toMatchObject({ value: "AB1234X", source: "alias_memory" });
    // Suggested in context, but not applied: the value is still what the customer wrote.
    expect(review.values["lines[0].partNo"]).toBe("LT-DOCK-01");

    await acceptSuggestion(workspace.deps, SAM, { orderNo: second.orderNo, fingerprint: flag?.fingerprint as string });
    expect((await loadPoReview(workspace.deps, second.orderNo)).values["lines[0].partNo"]).toBe("AB1234X");
    expect((await listAliases(workspace.deps))[0].timesConfirmed).toBe(1);
  });

  it("remembers a similar-part suggestion only when the person ticks the box", async () => {
    const { orderNo } = await captureCustomerPo(workspace.deps, "golden/files/po-alias-hyphen.pdf");
    const flag = (await loadPoReview(workspace.deps, orderNo)).flags.find((candidate) => candidate.code === "PART_ALIAS_SUGGESTED");
    await acceptSuggestion(workspace.deps, SAM, { orderNo, fingerprint: flag?.fingerprint as string, remember: false });
    expect(await listAliases(workspace.deps)).toEqual([]);

    const again = await captureCustomerPo(workspace.deps, "golden/files/po-combined.pdf");
    const flagAgain = (await loadPoReview(workspace.deps, again.orderNo)).flags.find((candidate) => candidate.code === "PART_ALIAS_SUGGESTED");
    await acceptSuggestion(workspace.deps, SAM, { orderNo: again.orderNo, fingerprint: flagAgain?.fingerprint as string, remember: true });
    expect((await listAliases(workspace.deps)).map((alias) => alias.fromPartNo)).toEqual(["AB-1234X"]);

    await removeAlias(workspace.deps, SAM, "AB-1234X");
    expect(await listAliases(workspace.deps)).toEqual([]);
  });

  it("does not remember a target that is not a Navision item", async () => {
    const { orderNo } = await captureCustomerPo(workspace.deps, "golden/files/po-alias-hyphen.pdf");
    await editField(workspace.deps, SAM, { orderNo, field: "lines[0].partNo", value: "STILL-WRONG", rememberAlias: true });
    expect(await listAliases(workspace.deps)).toEqual([]);
  });
});

describe("overrides", () => {
  it("accepts a special-deal price with a reason, and reopens the finding when the price changes again", async () => {
    const { orderNo } = await captureCustomerPo(workspace.deps, "golden/files/po-price-lower.pdf");
    const flag = (await loadPoReview(workspace.deps, orderNo)).flags.find((candidate) => candidate.code === "PRICE_MISMATCH");
    await overrideFlag(workspace.deps, SAM, { orderNo, fingerprint: flag?.fingerprint as string, reason: "Special deal agreed with the customer" });

    let review = await loadPoReview(workspace.deps, orderNo);
    const decided = review.flags.find((candidate) => candidate.code === "PRICE_MISMATCH");
    expect(decided?.decision).toMatchObject({ kind: "override", byName: "Sam Tan", reason: "Special deal agreed with the customer" });
    expect(review.blocking.map((blocking) => blocking.code)).toEqual(["MISSING_FIELD"]); // only the ship date is left

    // A different price is a different finding: the earlier acceptance does not cover it.
    await editField(workspace.deps, SAM, { orderNo, field: "lines[0].unitPrice", value: "120.00" });
    review = await loadPoReview(workspace.deps, orderNo);
    expect(review.flags.find((candidate) => candidate.code === "PRICE_MISMATCH")?.decision).toBeNull();
  });

  it("can be taken back while the PO is a draft", async () => {
    const { orderNo } = await captureCustomerPo(workspace.deps, "golden/files/po-price-lower.pdf");
    const flag = (await loadPoReview(workspace.deps, orderNo)).flags.find((candidate) => candidate.code === "PRICE_MISMATCH");
    await overrideFlag(workspace.deps, SAM, { orderNo, fingerprint: flag?.fingerprint as string, reason: "Special deal agreed" });
    await withdrawOverride(workspace.deps, SAM, { orderNo, fingerprint: flag?.fingerprint as string });
    expect((await loadPoReview(workspace.deps, orderNo)).blocking.map((blocking) => blocking.code)).toContain("PRICE_MISMATCH");
  });
});

describe("export preview and approval", () => {
  it("shows the exact file and the changes, then writes that file on approval", async () => {
    const { orderNo } = await captureCustomerPo(workspace.deps, "golden/files/po-alias-hyphen.pdf");
    const suggestion = (await loadPoReview(workspace.deps, orderNo)).flags.find((candidate) => candidate.code === "PART_ALIAS_SUGGESTED");
    await acceptSuggestion(workspace.deps, SAM, { orderNo, fingerprint: suggestion?.fingerprint as string });
    await setShipDate(workspace.deps, orderNo, "2026-11-25");

    const preview = await buildExportPreview(workspace.deps, orderNo);
    expect(preview.ready).toBe(true);
    expect(preview.files.map((file) => file.path)).toEqual([`export/salesOrders/${orderNo}-r1.json`]);
    expect(preview.changes).toEqual([
      { field: "promisedShipDate", label: "Promised ship date", before: null, after: "2026-11-25" },
      { field: "lines[0].partNo", label: "Line 1: Part no.", before: "AB-1234X", after: "AB1234X" },
    ]);

    const result = await approveAndExport(workspace.deps, SAM, { orderNo, previewHash: preview.previewHash });
    const written = readFileSync(path.join(workspace.navisionDir, result.paths[0]), "utf8");
    expect(written).toBe(preview.files[0].text);
    expect(parseSalesOrderExport(written).lines[0]).toMatchObject({ itemNo: "AB1234X", quantity: 100, unitPrice: "12.40", lineTotal: "1240.00" });

    const order = await workspace.deps.db.order.findUnique({ where: { orderNo } });
    expect(order).toMatchObject({ promisedShipDate: "2026-11-25", totalAmount: "1240.00", piNumber: orderNo.replace("ORD-", "PI-"), customerNo: "C0001" });
    expect(order?.exportedAt?.toISOString()).toBe(workspace.clock.now().toISOString());
    const timeline = await listOrderTimeline(workspace.deps, orderNo);
    expect(timeline.at(-1)).toMatchObject({ action: "export_approved", actorName: "Sam Tan" });
  });

  it("is not ready while a blocking finding is open, and says why", async () => {
    const { orderNo } = await captureCustomerPo(workspace.deps, "golden/files/po-price-lower.pdf");
    await setShipDate(workspace.deps, orderNo);
    const preview = await buildExportPreview(workspace.deps, orderNo);
    expect(preview.ready).toBe(false);
    expect(preview.problems.join(" ")).toContain("Price differs from Navision");
    await expect(approveAndExport(workspace.deps, SAM, { orderNo, previewHash: preview.previewHash })).rejects.toThrow(/cannot be approved yet/);
    expect(existsSync(exportDir())).toBe(false);
  });

  it("keeps the accepted difference and its reason in the exported file", async () => {
    const { orderNo } = await captureCustomerPo(workspace.deps, "golden/files/po-price-lower.pdf");
    await setShipDate(workspace.deps, orderNo);
    const flag = (await loadPoReview(workspace.deps, orderNo)).flags.find((candidate) => candidate.code === "PRICE_MISMATCH");
    await overrideFlag(workspace.deps, SAM, { orderNo, fingerprint: flag?.fingerprint as string, reason: "Special deal agreed with the customer" });
    await approveExport(workspace.deps, orderNo);
    const file = await exportedOrderFile(workspace.deps, orderNo);
    expect(file?.lines[0].unitPrice).toBe("132.00");
    expect(file?.acceptedDifferences).toEqual([
      { flag: "PRICE_MISMATCH", field: "lines[0].unitPrice", reason: "Special deal agreed with the customer", acceptedBy: "Sam Tan" },
    ]);
  });

  it("creates the customer card first when the customer is new", async () => {
    const { orderNo } = await captureCustomerPo(workspace.deps, "golden/files/po-unknown-customer.pdf");
    await setShipDate(workspace.deps, orderNo);
    expect((await buildExportPreview(workspace.deps, orderNo)).ready).toBe(false);

    await proposeCustomerCard(workspace.deps, SAM, { orderNo, address: "", country: "Nepal", email: "hello@kathmandudigital.example" });
    const preview = await buildExportPreview(workspace.deps, orderNo);
    expect(preview.ready).toBe(true);
    expect(preview.files.map((file) => file.kind)).toEqual(["customer_card", "sales_order"]);
    // Nothing is created by proposing: only the approval writes the card.
    expect(existsSync(path.join(workspace.navisionDir, "export", "customerCards"))).toBe(false);

    const result = await approveAndExport(workspace.deps, SAM, { orderNo, previewHash: preview.previewHash });
    expect(result.paths).toEqual(["export/customerCards/kathmandu-digital-hub.json", `export/salesOrders/${orderNo}-r1.json`]);
    const file = await exportedOrderFile(workspace.deps, orderNo);
    expect(file?.customer).toEqual({ customerNo: null, name: "Kathmandu Digital Hub", newCustomerCardFile: "customerCards/kathmandu-digital-hub.json" });
  });

  it("cannot be edited or exported a second time once exported", async () => {
    const orderNo = await exportedOrder(workspace.deps);
    await expect(editField(workspace.deps, SAM, { orderNo, field: "lines[0].quantity", value: "1" })).rejects.toThrow(/can no longer be edited/);
    const preview = await buildExportPreview(workspace.deps, orderNo);
    expect(preview.ready).toBe(false);
    expect(readdirSync(exportDir())).toEqual([`${orderNo}-r1.json`]);
  });
});

describe("the proforma invoice", () => {
  it("is a PDF built from the approved export", async () => {
    const orderNo = await exportedOrder(workspace.deps);
    const file = await exportedOrderFile(workspace.deps, orderNo);
    if (!file) throw new Error("expected an exported file");
    const bytes = await renderProformaInvoice(
      { piNumber: "PI-1001", piDate: "2026-11-16", sellerName: "Spectra Innovations", customerName: file.customer.name, poNumber: file.customerPoNumber, currency: file.currency, paymentTerms: "Advance payment", lines: file.lines, totalAmount: file.totalAmount },
      "SYNTHETIC SAMPLE",
    );
    const text = (await readPdfText(bytes)).fullText;
    expect(text).toContain("PROFORMA INVOICE");
    expect(text).toContain("PI-1001");
    expect(text).toContain("LT-PO-2240");
    expect(text).toContain("2,005.00"); // 50 x 8.10 + 24 x 33.50 + 40 x 19.90 = 405 + 804 + 796
  });
});

describe("amend, cancel and partial fulfilment", () => {
  it("exports an amended PO as revision 2 and retires revision 1", async () => {
    const orderNo = await exportedOrder(workspace.deps, "seed/po-ord-1032-dubai-dist.pdf");
    const amendment = await captureCustomerPo(workspace.deps, "inbox/po-dubai-dist-dd-7802-amendment-1.pdf");
    expect(amendment.orderNo).toBe(orderNo);

    await setShipDate(workspace.deps, orderNo, "2026-11-28");
    const preview = await buildExportPreview(workspace.deps, orderNo);
    expect(preview.revision).toBe(2);
    expect(preview.amendment?.lines).toEqual([
      { partNo: "WC-1080", change: "changed", before: { quantity: "40", unitPrice: "27.75" }, after: { quantity: "55", unitPrice: "27.75" } },
      { partNo: "HS-700", change: "added", before: null, after: { quantity: "20", unitPrice: "19.90" } },
    ]);
    await approveAndExport(workspace.deps, SAM, { orderNo, previewHash: preview.previewHash });

    expect(readdirSync(exportDir()).sort()).toEqual([`${orderNo}-r1.json`, `${orderNo}-r2.json`]);
    const versions = await workspace.deps.db.poVersion.findMany({ where: { orderNo }, orderBy: { revision: "asc" } });
    expect(versions.map((version) => version.status)).toEqual(["superseded", "exported"]);
    expect((await exportedOrderFile(workspace.deps, orderNo))?.lines.map((line) => line.quantity)).toEqual([55, 30, 20]);
  });

  it("closes a draft when its cancellation is confirmed, writing nothing to Navision", async () => {
    const { orderNo } = await captureCustomerPo(workspace.deps, "seed/po-ord-1039-muscat-micro.pdf");
    const cancellation = await captureCustomerPo(workspace.deps, "inbox/po-muscat-micro-mm-3342-cancellation.pdf");
    expect(cancellation.orderNo).toBe(orderNo);

    const preview = await buildCancellationPreview(workspace.deps, orderNo);
    expect(preview.files).toEqual([]);
    await expect(approveCancellation(workspace.deps, SAM, { orderNo, previewHash: preview.previewHash, reason: "" })).rejects.toThrow(/reason is required/);
    await approveCancellation(workspace.deps, SAM, { orderNo, previewHash: preview.previewHash, reason: "Customer cancelled by email" });

    const order = await workspace.deps.db.order.findUnique({ where: { orderNo } });
    expect(order).toMatchObject({ status: "cancelled", cancelledBy: "Sam Tan", cancelReason: "Customer cancelled by email" });
    expect(existsSync(exportDir())).toBe(false);
  });

  it("writes a cancelled revision when the order had already been exported", async () => {
    const orderNo = await exportedOrder(workspace.deps, "seed/po-ord-1041-dubai-dist.pdf");
    await captureCustomerPo(workspace.deps, "seed/cancellation-ord-1041-dubai-dist.pdf");
    const preview = await buildCancellationPreview(workspace.deps, orderNo);
    expect(preview.files.map((file) => file.path)).toEqual([`export/salesOrders/${orderNo}-r2.json`]);
    await approveCancellation(workspace.deps, SAM, { orderNo, previewHash: preview.previewHash, reason: "Customer cancelled the PO" });

    const cancelled = parseSalesOrderExport(readFileSync(path.join(exportDir(), `${orderNo}-r2.json`), "utf8"));
    expect(cancelled).toMatchObject({ status: "cancelled", revision: 2, orderNo });
    expect((await workspace.deps.db.order.findUnique({ where: { orderNo } }))?.status).toBe("cancelled");
    // The cancelled order still shows what it was.
    expect((await exportedOrderFile(workspace.deps, orderNo))?.status).toBe("open");
  });

  it("cancels an exported order without a cancellation document, through the same preview", async () => {
    const orderNo = await exportedOrder(workspace.deps);
    const preview = await buildCancellationPreview(workspace.deps, orderNo);
    await approveCancellation(workspace.deps, SAM, { orderNo, previewHash: preview.previewHash, reason: "Customer phoned to cancel" });
    expect(readdirSync(exportDir()).sort()).toEqual([`${orderNo}-r1.json`, `${orderNo}-r2.json`]);
    await expect(approveCancellation(workspace.deps, SAM, { orderNo, previewHash: preview.previewHash, reason: "again" })).rejects.toThrow(/already cancelled/);
  });

  it("tracks delivered and remaining quantities and stops over-delivery", async () => {
    const orderNo = await exportedOrder(workspace.deps);
    expect((await getFulfilment(workspace.deps, orderNo))?.state).toBe("none");
    await recordDelivery(workspace.deps, SAM, { orderNo, partNo: "CD-77", quantity: 30, note: "First box" });
    let fulfilment = await getFulfilment(workspace.deps, orderNo);
    expect(fulfilment?.state).toBe("partial");
    expect(fulfilment?.lines.find((line) => line.itemNo === "CD-77")).toMatchObject({ ordered: 50, delivered: 30, remaining: 20 });

    await expect(recordDelivery(workspace.deps, SAM, { orderNo, partNo: "CD-77", quantity: 21, note: null })).rejects.toThrow(/Only 20 of CD-77 remain/);
    await recordDelivery(workspace.deps, SAM, { orderNo, partNo: "CD-77", quantity: 20, note: null });
    await recordDelivery(workspace.deps, SAM, { orderNo, partNo: "GH-310", quantity: 24, note: null });
    await recordDelivery(workspace.deps, SAM, { orderNo, partNo: "HS-700", quantity: 40, note: null });
    fulfilment = await getFulfilment(workspace.deps, orderNo);
    expect(fulfilment?.state).toBe("complete");
  });

  it("does not record a delivery for an order that is still a draft", async () => {
    const { orderNo } = await captureCustomerPo(workspace.deps, "golden/files/po-clean-a.pdf");
    await expect(recordDelivery(workspace.deps, SAM, { orderNo, partNo: "CD-77", quantity: 1, note: null })).rejects.toThrow(/not been exported/);
  });
});
