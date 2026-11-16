// What: writes audit events and reads them back for timelines, history panels and the audit log page.
// Who calls it: every service that changes something calls recordAudit(); pages call the list functions.
// To extend: add the action name in src/domain/audit.ts, then call recordAudit() from your service.
import type { AuditInput, TimelineEntry } from "@/domain/audit";
import type { FieldEdit } from "@/domain/fields";
import type { Deps } from "./deps";

/** Writes one audit event. The time always comes from the Clock. */
export async function recordAudit(deps: Pick<Deps, "db" | "clock">, input: AuditInput): Promise<number> {
  const row = await deps.db.auditEvent.create({
    data: {
      at: deps.clock.now(),
      actorName: input.actor.name,
      actorRole: input.actor.role,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      orderNo: input.orderNo ?? null,
      field: input.field ?? null,
      oldValue: input.oldValue ?? null,
      newValue: input.newValue ?? null,
      reason: input.reason ?? null,
      summary: input.summary,
    },
  });
  return row.id;
}

type AuditRow = {
  id: number;
  at: Date;
  actorName: string;
  actorRole: string;
  action: string;
  summary: string;
  reason: string | null;
};

function toTimelineEntry(row: AuditRow): TimelineEntry {
  return {
    id: row.id,
    at: row.at,
    actorName: row.actorName,
    actorRole: row.actorRole,
    action: row.action,
    summary: row.summary,
    reason: row.reason,
  };
}

/** The field edits of one document, oldest first: the input for currentValues() and the history panel. */
export async function listFieldEdits(deps: Pick<Deps, "db">, documentId: string): Promise<FieldEdit[]> {
  const rows = await deps.db.auditEvent.findMany({
    where: { entityType: "document", entityId: documentId, action: { in: ["field_edit", "field_undo"] } },
    orderBy: { id: "asc" },
  });
  return rows
    .filter((row) => row.field !== null)
    .map((row) => ({
      id: row.id,
      field: row.field as string,
      oldValue: row.oldValue,
      newValue: row.newValue,
      action: row.action as FieldEdit["action"],
      actorName: row.actorName,
      at: row.at,
      reason: row.reason,
    }));
}

/** Everything that happened to one entity (a document, an SPR, a shipment), oldest first. */
export async function listEntityTimeline(deps: Pick<Deps, "db">, entityType: string, entityId: string): Promise<TimelineEntry[]> {
  const rows = await deps.db.auditEvent.findMany({ where: { entityType, entityId }, orderBy: { id: "asc" } });
  return rows.map(toTimelineEntry);
}

/**
 * Everything that happened to one order across documents, payments, SPRs and shipments, oldest first.
 * Events recorded with the order number are included, and so are the events of the order's PO documents
 * (a document is received and confirmed before it belongs to an order).
 */
export async function listOrderTimeline(deps: Pick<Deps, "db">, orderNo: string): Promise<TimelineEntry[]> {
  const versions = await deps.db.poVersion.findMany({ where: { orderNo }, select: { documentId: true } });
  const documentIds = versions.map((version) => version.documentId);
  const rows = await deps.db.auditEvent.findMany({
    where: { OR: [{ orderNo }, { entityType: "document", entityId: { in: documentIds } }] },
    orderBy: { id: "asc" },
  });
  return rows.map(toTimelineEntry);
}

export type AuditLogFilter = { entityType?: string; search?: string; limit?: number };

/** The newest audit events first, for the audit log page. */
export async function listAuditLog(deps: Pick<Deps, "db">, filter: AuditLogFilter = {}) {
  const search = filter.search?.trim();
  return deps.db.auditEvent.findMany({
    where: {
      ...(filter.entityType ? { entityType: filter.entityType } : {}),
      ...(search
        ? { OR: [{ summary: { contains: search } }, { actorName: { contains: search } }, { entityId: { contains: search } }, { orderNo: { contains: search } }] }
        : {}),
    },
    orderBy: { id: "desc" },
    take: filter.limit ?? 200,
  });
}
