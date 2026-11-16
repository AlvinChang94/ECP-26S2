// What: everything the PO review screen needs: the PO's current values, Navision lookups, flags and the decisions made on them.
// Who calls it: the order review, preview and detail pages; the export service; the seed and the replay.
// To extend: a new PO rule goes in src/domain/po/checks.ts. If it needs new Navision data, fetch it in buildPoCheckContext below.
import type { DocumentRow, OrderRow, PoVersionRow } from "@/adapters/db";
import type { Actor } from "@/domain/audit";
import { DOCUMENT_SPECS, type DocumentTypeSpec, type ExtractedField } from "@/domain/documents";
import { extractedValues, type FieldEdit, type FieldValues } from "@/domain/fields";
import { attachDecisions, type FlagDecisionRecord, type FlagWithDecision, unresolvedBlocking } from "@/domain/flags";
import type { NavCustomer, NavItem } from "@/domain/navision";
import { checkCustomerPo, checkExportReadiness, type PoCheckContext, type PoLineLookup } from "@/domain/po/checks";
import { aliasKey } from "@/domain/po/partMatch";
import { activeLines, type CustomerPo, toCustomerPo } from "@/domain/po/types";
import { addDays, businessDate } from "@/domain/time";
import type { Deps } from "./deps";
import { loadDocumentRow } from "./documents";
import { UserError } from "./errors";
import { findOpenOrdersByPoNumber, getOrder, listPoVersions } from "./orders";

export type PoReview = {
  order: OrderRow;
  /** The PO version being looked at (by default the order's current one). */
  version: PoVersionRow;
  versions: PoVersionRow[];
  document: DocumentRow;
  spec: DocumentTypeSpec;
  /** As read from the PDF, with page and bounding box. */
  fields: ExtractedField[];
  /** What was read from the PDF, by key. */
  original: FieldValues;
  /** Current values: the original plus every edit a person made. */
  values: FieldValues;
  edits: FieldEdit[];
  po: CustomerPo;
  flags: FlagWithDecision[];
  blocking: FlagWithDecision[];
  customer: NavCustomer | null;
  /** The Navision item behind each line, where the part number is one. */
  itemsByLine: Record<number, NavItem | null>;
  /** True while the version is a draft of an open order: only then may values be changed. */
  canEdit: boolean;
  /** A date the page offers for the promised ship date. It is only used if a person clicks it. */
  suggestedShipDate: string;
};

/**
 * For each PO line: the Navision item with that exact number, or else the remembered alias and similar items.
 * `rememberedAlias` answers "which item number was this part number fixed to before?" (the golden test passes its own).
 */
export async function lookupPoLines(
  navision: Deps["navision"],
  po: CustomerPo,
  rememberedAlias: (partNo: string) => Promise<string | null>,
): Promise<{ lines: Record<number, PoLineLookup>; itemsByLine: Record<number, NavItem | null> }> {
  const lines: Record<number, PoLineLookup> = {};
  const itemsByLine: Record<number, NavItem | null> = {};
  for (const line of activeLines(po)) {
    if (!line.partNo) {
      itemsByLine[line.index] = null;
      continue;
    }
    const item = await navision.getItem(line.partNo);
    itemsByLine[line.index] = item;
    if (item) {
      lines[line.index] = { item, aliasItem: null, similar: [] };
      continue;
    }
    const aliasTarget = await rememberedAlias(line.partNo);
    lines[line.index] = {
      item: null,
      aliasItem: aliasTarget ? await navision.getItem(aliasTarget) : null,
      similar: await navision.searchItems(line.partNo, 3),
    };
  }
  return { lines, itemsByLine };
}

/** Looks up in Navision (and the alias memory) everything the PO checks need. Reads only. */
export async function buildPoCheckContext(
  deps: Pick<Deps, "db" | "navision">,
  po: CustomerPo,
  position: { orderNo: string; version: Pick<PoVersionRow, "previousId" | "customerCardJson"> },
): Promise<{ context: PoCheckContext; customer: NavCustomer | null; itemsByLine: Record<number, NavItem | null> }> {
  const customer = po.customerName ? await deps.navision.getCustomerByName(po.customerName) : null;

  const { lines, itemsByLine } = await lookupPoLines(deps.navision, po, async (partNo) => {
    const alias = await deps.db.partAlias.findUnique({ where: { fromPartNo: aliasKey(partNo) } });
    return alias?.toItemNo ?? null;
  });

  const sameNumberOrders =
    po.poKind === "new" && po.poNumber ? await findOpenOrdersByPoNumber(deps, po.poNumber, po.customerName, position.orderNo) : [];

  const previous = position.version.previousId ? await deps.db.poVersion.findUnique({ where: { id: position.version.previousId } }) : null;

  return {
    customer,
    itemsByLine,
    context: {
      customer,
      customerCardProposed: position.version.customerCardJson !== null,
      lines,
      sameNumberOrders: sameNumberOrders.map((order) => ({ orderNo: order.orderNo })),
      previousVersion: previous ? { orderNo: previous.orderNo, revision: previous.revision } : null,
    },
  };
}

export async function listFlagDecisions(deps: Pick<Deps, "db">, entityType: string, entityId: string): Promise<FlagDecisionRecord[]> {
  const rows = await deps.db.flagDecision.findMany({ where: { entityType, entityId }, orderBy: { at: "asc" } });
  return rows.map((row) => ({ fingerprint: row.fingerprint, kind: row.kind as FlagDecisionRecord["kind"], reason: row.reason, byName: row.byName, at: row.at }));
}

/** Loads one PO version of an order with its flags. `versionId` defaults to the order's current version. */
export async function loadPoReview(deps: Pick<Deps, "db" | "navision" | "config">, orderNo: string, versionId?: string): Promise<PoReview> {
  const order = await getOrder(deps, orderNo);
  const versions = await listPoVersions(deps, orderNo);
  const version = versions.find((candidate) => candidate.id === (versionId ?? order.currentPoVersionId));
  if (!version) throw new UserError(`${orderNo} has no PO version to show.`);
  const document = await deps.db.document.findUnique({ where: { id: version.documentId } });
  if (!document) throw new UserError(`The PO document of ${orderNo} is missing.`);

  const loaded = await loadDocumentRow(deps, document);
  const po = toCustomerPo(loaded.values);
  const { context, customer, itemsByLine } = await buildPoCheckContext(deps, po, { orderNo, version });
  const decisions = await listFlagDecisions(deps, "document", document.id);
  const flags = attachDecisions([...checkCustomerPo(po, context), ...checkExportReadiness(po)], decisions);

  return {
    order,
    version,
    versions,
    document,
    spec: DOCUMENT_SPECS.customer_po,
    fields: loaded.fields,
    original: extractedValues(loaded.fields),
    values: loaded.values,
    edits: loaded.edits,
    po,
    flags,
    blocking: unresolvedBlocking(flags),
    customer,
    itemsByLine,
    canEdit: version.status === "draft" && order.status === "open",
    suggestedShipDate: businessDate(addDays(order.receivedAt, deps.config.suggestedShipLeadDays)),
  };
}

/** Only these roles work on customer POs. Finance and the approver may look but not change. */
export function requireSalesRole(actor: Actor): void {
  if (actor.role !== "sales" && actor.role !== "system") {
    throw new UserError("Only a sales team member can change or approve a customer PO. Switch persona to continue.");
  }
}
