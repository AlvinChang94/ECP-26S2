// What: creates and finds orders. An order starts when a customer PO document is confirmed; amendments and cancellations attach to it.
// Who calls it: the intake service (routing a confirmed PO), and pages that show an order.
// To extend: order-level actions (cancel, record delivery) live in poExport.ts and fulfilment.ts; the dashboard status is derived in src/domain/order.
import type { DocumentRow, OrderRow, PoVersionRow } from "@/adapters/db";
import type { Actor } from "@/domain/audit";
import { sameCompany } from "@/domain/po/partMatch";
import { toCustomerPo } from "@/domain/po/types";
import { recordAudit } from "./audit";
import { nextReference } from "./counters";
import type { Deps } from "./deps";
import { loadDocumentRow } from "./documents";
import { UserError } from "./errors";

export async function getOrder(deps: Pick<Deps, "db">, orderNo: string): Promise<OrderRow> {
  const order = await deps.db.order.findUnique({ where: { orderNo } });
  if (!order) throw new UserError(`Order ${orderNo} does not exist.`);
  return order;
}

export async function listPoVersions(deps: Pick<Deps, "db">, orderNo: string): Promise<PoVersionRow[]> {
  return deps.db.poVersion.findMany({ where: { orderNo }, orderBy: { revision: "asc" } });
}

/** The newest version that was exported to Navision, or null while the order is still a draft. */
export async function latestExportedVersion(deps: Pick<Deps, "db">, orderNo: string): Promise<PoVersionRow | null> {
  return deps.db.poVersion.findFirst({ where: { orderNo, status: "exported" }, orderBy: { revision: "desc" } });
}

/**
 * Open orders captured with the same PO number from the same customer.
 * Customer names are compared loosely (case, punctuation, legal suffix); an unreadable name matches any.
 */
export async function findOpenOrdersByPoNumber(
  deps: Pick<Deps, "db">,
  poNumber: string,
  customerName: string | null,
  exceptOrderNo?: string,
): Promise<OrderRow[]> {
  const candidates = await deps.db.order.findMany({ where: { poNumber, status: "open" }, orderBy: { receivedAt: "asc" } });
  return candidates.filter(
    (order) =>
      order.orderNo !== exceptOrderNo && (!customerName || !order.customerName || sameCompany(order.customerName, customerName)),
  );
}

/**
 * Routes a confirmed customer PO document: a new PO starts a new order; an amendment or cancellation
 * of a PO we already have becomes the next version of that order. Nothing is exported here.
 */
export async function attachPoDocument(
  deps: Pick<Deps, "db" | "clock" | "navision">,
  actor: Actor,
  document: DocumentRow,
): Promise<{ orderNo: string; versionId: string }> {
  const { values } = await loadDocumentRow(deps, document);
  const po = toCustomerPo(values);
  const now = deps.clock.now();

  // An amendment or cancellation belongs to the earlier order with the same PO number, if we have one.
  const earlier = po.poKind !== "new" && po.poNumber ? (await findOpenOrdersByPoNumber(deps, po.poNumber, po.customerName))[0] : undefined;

  if (earlier) {
    const versions = await listPoVersions(deps, earlier.orderNo);
    const previous = versions[versions.length - 1];
    // A draft that is replaced before anyone exported it is simply superseded.
    if (previous.status === "draft") {
      await deps.db.poVersion.update({ where: { id: previous.id }, data: { status: "superseded" } });
    }
    const version = await deps.db.poVersion.create({
      data: {
        orderNo: earlier.orderNo,
        revision: previous.revision + 1,
        kind: po.poKind,
        status: "draft",
        documentId: document.id,
        previousId: previous.id,
        createdAt: now,
      },
    });
    await deps.db.order.update({ where: { orderNo: earlier.orderNo }, data: { currentPoVersionId: version.id } });
    await recordAudit(deps, {
      actor,
      action: "po_amended",
      entityType: "order",
      entityId: earlier.orderNo,
      orderNo: earlier.orderNo,
      summary:
        po.poKind === "cancellation"
          ? `A cancellation for ${earlier.orderNo} (PO ${po.poNumber}) was captured from ${document.fileName}. It waits for a person to confirm.`
          : `An amendment for ${earlier.orderNo} (PO ${po.poNumber}) was captured from ${document.fileName} as revision ${version.revision}.`,
    });
    return { orderNo: earlier.orderNo, versionId: version.id };
  }

  const orderNo = await nextReference(deps, "order");
  const customer = po.customerName ? await deps.navision.getCustomerByName(po.customerName) : null;
  const version = await deps.db.poVersion.create({
    data: { orderNo, revision: 1, kind: po.poKind, status: "draft", documentId: document.id, createdAt: now },
  });
  await deps.db.order.create({
    data: {
      orderNo,
      poNumber: po.poNumber,
      customerName: po.customerName,
      customerNo: customer?.customerNo ?? null,
      status: "open",
      currentPoVersionId: version.id,
      receivedAt: document.receivedAt,
      paymentTerms: customer?.paymentTerms ?? "advance",
      currency: po.currency,
      createdAt: now,
    },
  });
  await recordAudit(deps, {
    actor,
    action: "order_created",
    entityType: "order",
    entityId: orderNo,
    orderNo,
    summary: `${orderNo} was created from ${document.fileName} (PO ${po.poNumber ?? "number not read"}, ${po.customerName ?? "customer not read"}).`,
  });
  return { orderNo, versionId: version.id };
}

/**
 * Undoes attachPoDocument when a person changes the document's type afterwards.
 * Only possible while nothing was exported from it.
 */
export async function detachPoDocument(deps: Pick<Deps, "db" | "clock">, actor: Actor, document: DocumentRow): Promise<void> {
  const version = await deps.db.poVersion.findUnique({ where: { documentId: document.id } });
  if (!version) return;
  if (version.status !== "draft") {
    throw new UserError("This document already led to an export to Navision, so its type can no longer be changed.");
  }
  await deps.db.poVersion.update({ where: { id: version.id }, data: { status: "void" } });
  const previous = version.previousId ? await deps.db.poVersion.findUnique({ where: { id: version.previousId } }) : null;
  if (previous) {
    // Give the order back to the version this document had replaced.
    if (previous.status === "superseded") await deps.db.poVersion.update({ where: { id: previous.id }, data: { status: "draft" } });
    await deps.db.order.update({ where: { orderNo: version.orderNo }, data: { currentPoVersionId: previous.id } });
  } else {
    await deps.db.order.update({
      where: { orderNo: version.orderNo },
      data: { status: "cancelled", cancelledAt: deps.clock.now(), cancelledBy: actor.name, cancelReason: "The document was not a customer PO." },
    });
  }
  await recordAudit(deps, {
    actor,
    action: "order_cancelled",
    entityType: "order",
    entityId: version.orderNo,
    orderNo: version.orderNo,
    summary: `${actor.name} changed the type of ${document.fileName}, so its PO draft for ${version.orderNo} was withdrawn.`,
  });
}

/** Keeps the order's cached PO number, customer and currency in step with the current PO version (for lists and search). */
export async function refreshOrderSummary(deps: Pick<Deps, "db">, orderNo: string): Promise<void> {
  const order = await getOrder(deps, orderNo);
  if (!order.currentPoVersionId) return;
  const version = await deps.db.poVersion.findUnique({ where: { id: order.currentPoVersionId } });
  if (!version || version.kind === "cancellation") return;
  const document = await deps.db.document.findUnique({ where: { id: version.documentId } });
  if (!document) return;
  const po = toCustomerPo((await loadDocumentRow(deps, document)).values);
  await deps.db.order.update({
    where: { orderNo },
    data: { poNumber: po.poNumber, customerName: po.customerName, currency: po.currency ?? order.currency },
  });
}
