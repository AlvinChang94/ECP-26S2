// What: the export preview and its approval (story 2). Builds the exact files for Navision, and writes them only after a person approves.
// Who calls it: the preview page and its actions; the seed and the KPI replay (as simulated staff).
// To extend: what goes into the file is decided in src/domain/po/exportFile.ts. This file only orchestrates preview, approval and bookkeeping.
import type { PoVersionRow } from "@/adapters/db";
import type { ExportResult } from "@/adapters/navision/gateway";
import type { Actor } from "@/domain/audit";
import { diffValues, fieldLabel } from "@/domain/fields";
import { flagTitle } from "@/domain/flags";
import { sha256OfText } from "@/domain/hash";
import { buildCancellationExport, diffPoVersions, type PoVersionDiff } from "@/domain/po/amend";
import {
  buildSalesOrderExport,
  type CustomerCardExport,
  customerCardFileName,
  parseSalesOrderExport,
  piNumberFor,
  type SalesOrderExport,
  salesOrderFileName,
  serializeExportFile,
} from "@/domain/po/exportFile";
import { toCustomerPo } from "@/domain/po/types";
import { z } from "zod";
import { recordAudit } from "./audit";
import type { Deps } from "./deps";
import { loadDocument } from "./documents";
import { requireThat, UserError } from "./errors";
import { getOrder, latestExportedVersion, listPoVersions } from "./orders";
import { loadPoReview, type PoReview, requireSalesRole } from "./poReview";

type ExportDeps = Pick<Deps, "db" | "clock" | "navision" | "config">;

export type PreviewFile = {
  kind: "customer_card" | "sales_order";
  /** Where the file will be written, relative to the Navision folder. */
  path: string;
  /** The exact text that will be written. */
  text: string;
};

export type ExportPreview = {
  mode: "export" | "cancellation";
  orderNo: string;
  revision: number;
  /** True when a person may approve right now. */
  ready: boolean;
  /** In plain language, what still stops the approval. */
  problems: string[];
  files: PreviewFile[];
  /** Fingerprint of everything shown. Approval must quote it, so nobody approves something other than what they saw. */
  previewHash: string;
  /** Differences between the PO as it was read and its current values. */
  changes: { field: string; label: string; before: string | null; after: string | null }[];
  acceptedDifferences: SalesOrderExport["acceptedDifferences"];
  /** For an amendment: what changed compared with the version before it. */
  amendment: PoVersionDiff | null;
};

const CustomerCardDraftSchema = z.object({
  name: z.string(),
  address: z.string().nullable(),
  country: z.string().nullable(),
  email: z.string().nullable(),
});

function hashOfFiles(mode: string, orderNo: string, files: PreviewFile[]): string {
  return sha256OfText([mode, orderNo, ...files.map((file) => `${file.path}\n${file.text}`)].join("\n---\n"));
}

function customerCardFor(review: PoReview): CustomerCardExport | null {
  if (!review.version.customerCardJson || review.customer) return null;
  const draft = CustomerCardDraftSchema.parse(JSON.parse(review.version.customerCardJson));
  return {
    schema: "orderflow.customerCard.v1",
    name: draft.name,
    address: draft.address,
    country: draft.country,
    email: draft.email,
    paymentTerms: "advance",
    currency: review.po.currency ?? "USD",
    requestedForOrder: review.order.orderNo,
  };
}

async function previousVersionDiff(deps: ExportDeps, review: PoReview): Promise<PoVersionDiff | null> {
  if (!review.version.previousId) return null;
  const previous = await deps.db.poVersion.findUnique({ where: { id: review.version.previousId } });
  if (!previous) return null;
  const previousPo = toCustomerPo((await loadDocument(deps, previous.documentId)).values);
  return diffPoVersions(previousPo, review.po);
}

/** Builds the preview: the exact files, what changed, and whether it can be approved. Changes nothing. */
export async function buildExportPreview(deps: ExportDeps, orderNo: string): Promise<ExportPreview> {
  const review = await loadPoReview(deps, orderNo);
  if (review.version.kind === "cancellation" || review.order.status === "cancelled") return buildCancellationPreview(deps, orderNo);

  const problems: string[] = [];
  if (review.version.status !== "draft") problems.push(`Revision ${review.version.revision} of ${orderNo} was already exported. There is nothing new to approve.`);
  for (const flag of review.blocking) problems.push(`${flagTitle(flag.code)}: ${flag.reason}`);

  const card = customerCardFor(review);
  const acceptedDifferences = review.flags
    .filter((flag) => flag.decision?.kind === "override")
    .map((flag) => ({ flag: flag.code, field: flag.field, reason: flag.decision?.reason ?? "", acceptedBy: flag.decision?.byName ?? "" }));
  const built = buildSalesOrderExport({
    orderNo,
    revision: review.version.revision,
    status: "open",
    po: review.po,
    customer: review.customer,
    newCustomerCard: card,
    itemsByLine: review.itemsByLine,
    acceptedDifferences,
    source: { fileName: review.document.fileName, sha256: review.document.sha256 },
  });

  const files: PreviewFile[] = [];
  if (card) files.push({ kind: "customer_card", path: `export/customerCards/${customerCardFileName(card.name)}`, text: serializeExportFile(card) });
  if (built.ok) {
    files.push({ kind: "sales_order", path: `export/salesOrders/${salesOrderFileName(orderNo, review.version.revision)}`, text: serializeExportFile(built.file) });
  } else if (review.blocking.length === 0) {
    // Normally every builder problem is also a blocking flag; anything left over is shown as it is.
    problems.push(...built.problems);
  }

  return {
    mode: "export",
    orderNo,
    revision: review.version.revision,
    ready: problems.length === 0 && built.ok,
    problems,
    files,
    previewHash: hashOfFiles("export", orderNo, files),
    changes: diffValues(review.original, review.values).map((change) => ({ ...change, label: fieldLabel(review.spec, change.field) })),
    acceptedDifferences,
    amendment: await previousVersionDiff(deps, review),
  };
}

export type ApprovalResult = { paths: string[]; orderNo: string };

/**
 * A person approves the preview. The files are rebuilt and must be identical to what was shown (same hash);
 * only then are they handed to the Navision gateway, which checks each file's hash once more before writing.
 */
export async function approveAndExport(deps: ExportDeps, actor: Actor, input: { orderNo: string; previewHash: string }): Promise<ApprovalResult> {
  requireSalesRole(actor);
  const preview = await buildExportPreview(deps, input.orderNo);
  requireThat(preview.mode === "export", "This order is waiting for a cancellation to be confirmed, not for an export.");
  requireThat(preview.ready, `The export cannot be approved yet: ${preview.problems.join(" ")}`);
  requireThat(preview.previewHash === input.previewHash, "The order changed after the preview was opened. Review the preview again before approving.");

  const review = await loadPoReview(deps, input.orderNo);
  const now = deps.clock.now();
  const results: ExportResult[] = [];
  let exported: SalesOrderExport | null = null;
  // The customer card comes first, so the order never refers to a customer that was not sent.
  for (const file of preview.files) {
    const approval = { approvedBy: actor.name, approvedAt: now, previewHash: sha256OfText(file.text) };
    if (file.kind === "customer_card") {
      results.push(await deps.navision.createCustomerCard(JSON.parse(file.text) as CustomerCardExport, approval));
    } else {
      exported = parseSalesOrderExport(file.text);
      results.push(await deps.navision.exportSalesOrder(exported, approval));
    }
  }
  if (!exported) throw new UserError("The preview did not contain a sales order file.");
  const orderFile = results[results.length - 1];

  // An amendment replaces the revision that was in Navision before.
  await deps.db.poVersion.updateMany({ where: { orderNo: input.orderNo, status: "exported" }, data: { status: "superseded" } });
  await deps.db.poVersion.update({
    where: { id: review.version.id },
    data: { status: "exported", exportPath: orderFile.path, exportHash: orderFile.sha256, exportJson: serializeExportFile(exported), exportedAt: now, exportedBy: actor.name },
  });
  await deps.db.order.update({
    where: { orderNo: input.orderNo },
    data: {
      exportedAt: review.order.exportedAt ?? now,
      poNumber: exported.customerPoNumber,
      customerName: exported.customer.name,
      customerNo: exported.customer.customerNo,
      promisedShipDate: exported.promisedShipDate,
      totalAmount: exported.totalAmount,
      currency: exported.currency,
      paymentTerms: exported.paymentTerms,
      // The proforma invoice exists from the first export on; payment waiting time is counted from here.
      piNumber: review.order.piNumber ?? piNumberFor(input.orderNo),
      piIssuedAt: review.order.piIssuedAt ?? now,
    },
  });
  await recordAudit(deps, {
    actor,
    action: "export_approved",
    entityType: "order",
    entityId: input.orderNo,
    orderNo: input.orderNo,
    newValue: results.map((result) => result.path).join("\n"),
    summary:
      `${actor.name} approved the preview of ${input.orderNo} revision ${preview.revision}. ` +
      `Written for Navision: ${results.map((result) => result.path).join(", ")}.`,
  });
  return { paths: results.map((result) => result.path), orderNo: input.orderNo };
}

// ------------------------------------------------------------------------------------- cancellation

/** The revision number a cancellation file would get: the cancellation document's own, or the next free one. */
function cancellationRevision(versions: PoVersionRow[]): number {
  const draftCancellation = versions.find((version) => version.kind === "cancellation" && version.status === "draft");
  return draftCancellation ? draftCancellation.revision : Math.max(0, ...versions.map((version) => version.revision)) + 1;
}

/**
 * What cancelling the order would do. If the order was exported, a "cancelled" revision of the same file is shown
 * for approval. If it never reached Navision, nothing is written and the draft is simply closed.
 */
export async function buildCancellationPreview(deps: ExportDeps, orderNo: string): Promise<ExportPreview> {
  const order = await getOrder(deps, orderNo);
  const versions = await listPoVersions(deps, orderNo);
  const revision = cancellationRevision(versions);
  const lastExported = await latestExportedVersion(deps, orderNo);
  const problems: string[] = [];
  if (order.status === "cancelled") problems.push(`${orderNo} is already cancelled.`);

  const files: PreviewFile[] = [];
  if (lastExported?.exportJson) {
    const cancelled = buildCancellationExport(parseSalesOrderExport(lastExported.exportJson), revision);
    files.push({ kind: "sales_order", path: `export/salesOrders/${salesOrderFileName(orderNo, revision)}`, text: serializeExportFile(cancelled) });
  }
  return {
    mode: "cancellation",
    orderNo,
    revision,
    ready: problems.length === 0,
    problems,
    files,
    previewHash: hashOfFiles("cancellation", orderNo, files),
    changes: [],
    acceptedDifferences: [],
    amendment: null,
  };
}

/** A person confirms the cancellation, with a reason. Closes the draft, or writes the cancelled revision for Navision. */
export async function approveCancellation(
  deps: ExportDeps,
  actor: Actor,
  input: { orderNo: string; previewHash: string; reason: string },
): Promise<ApprovalResult> {
  requireSalesRole(actor);
  requireThat(input.reason.trim().length >= 3, "A reason is required to cancel an order.");
  const preview = await buildCancellationPreview(deps, input.orderNo);
  requireThat(preview.ready, preview.problems.join(" "));
  requireThat(preview.previewHash === input.previewHash, "The order changed after the preview was opened. Review it again before confirming.");

  const now = deps.clock.now();
  const paths: string[] = [];
  const versions = await listPoVersions(deps, input.orderNo);
  const cancellationVersion = versions.find((version) => version.kind === "cancellation" && version.status === "draft");
  for (const file of preview.files) {
    const cancelled = parseSalesOrderExport(file.text);
    const result = await deps.navision.exportSalesOrder(cancelled, { approvedBy: actor.name, approvedAt: now, previewHash: sha256OfText(file.text) });
    paths.push(result.path);
    if (cancellationVersion) {
      await deps.db.poVersion.update({
        where: { id: cancellationVersion.id },
        data: { status: "exported", exportPath: result.path, exportHash: result.sha256, exportJson: file.text, exportedAt: now, exportedBy: actor.name },
      });
    }
  }
  // Whatever was still a draft is closed with the order.
  await deps.db.poVersion.updateMany({ where: { orderNo: input.orderNo, status: "draft" }, data: { status: "cancelled" } });
  await deps.db.order.update({
    where: { orderNo: input.orderNo },
    data: { status: "cancelled", cancelledAt: now, cancelledBy: actor.name, cancelReason: input.reason.trim() },
  });
  await recordAudit(deps, {
    actor,
    action: "order_cancelled",
    entityType: "order",
    entityId: input.orderNo,
    orderNo: input.orderNo,
    reason: input.reason.trim(),
    newValue: paths.join("\n") || null,
    summary:
      paths.length > 0
        ? `${actor.name} cancelled ${input.orderNo}. Written for Navision: ${paths.join(", ")}.`
        : `${actor.name} cancelled ${input.orderNo}. It had not been exported, so the draft was closed and nothing was written to Navision.`,
  });
  return { paths, orderNo: input.orderNo };
}

/** The last file that was exported for an order (its lines, total and promised ship date), or null while it is a draft. */
export async function exportedOrderFile(deps: Pick<Deps, "db">, orderNo: string): Promise<SalesOrderExport | null> {
  const version = await latestExportedVersion(deps, orderNo);
  if (!version?.exportJson) return null;
  const file = parseSalesOrderExport(version.exportJson);
  if (file.status !== "cancelled") return file;
  // After a cancellation the previous open revision still describes what the order was.
  const earlier = await deps.db.poVersion.findFirst({
    where: { orderNo, exportJson: { not: null }, kind: { not: "cancellation" } },
    orderBy: { revision: "desc" },
  });
  return earlier?.exportJson ? parseSalesOrderExport(earlier.exportJson) : file;
}
