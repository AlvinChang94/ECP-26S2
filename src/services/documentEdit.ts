// What: edit and undo for the fields of any confirmed document that is not a customer PO (proofs of payment, shipping documents).
// Who calls it: the payments and shipments services, when a person corrects a value the reader got wrong.
// To extend: customer POs have their own, richer version in poEdit.ts. Both record the same audit events (field_edit, field_undo).
import type { Actor } from "@/domain/audit";
import { fieldLabel, findFieldSpec, normalizeInput, undoTarget } from "@/domain/fields";
import { recordAudit } from "./audit";
import type { Deps } from "./deps";
import { loadDocument } from "./documents";
import { requireThat } from "./errors";

type EditDeps = Pick<Deps, "db" | "clock">;

export type DocumentEditInput = { documentId: string; field: string; value: string | null; orderNo?: string | null; reason?: string | null };

/** A person changes one value of a document. Recorded as an audit event; the extracted value stays as it was read. */
export async function editDocumentField(deps: EditDeps, actor: Actor, input: DocumentEditInput): Promise<{ changed: boolean }> {
  const loaded = await loadDocument(deps, input.documentId);
  requireThat(loaded.spec && loaded.document.typeStatus === "confirmed", "Confirm the document type before changing its values.");
  requireThat(findFieldSpec(loaded.spec, input.field), `"${input.field}" is not a field of a ${loaded.spec.label}.`);

  const oldValue = loaded.values[input.field] ?? null;
  const newValue = normalizeInput(input.value);
  if (oldValue === newValue) return { changed: false };
  await recordAudit(deps, {
    actor,
    action: "field_edit",
    entityType: "document",
    entityId: input.documentId,
    orderNo: input.orderNo ?? null,
    field: input.field,
    oldValue,
    newValue,
    reason: input.reason ?? null,
    summary: `${actor.name} changed ${fieldLabel(loaded.spec, input.field)} on ${loaded.document.fileName} from "${oldValue ?? "(empty)"}" to "${newValue ?? "(empty)"}".`,
  });
  return { changed: true };
}

/** Restores the value from before the latest edit of a field. The undo is itself recorded. */
export async function undoDocumentField(deps: EditDeps, actor: Actor, input: { documentId: string; field: string; orderNo?: string | null }): Promise<void> {
  const loaded = await loadDocument(deps, input.documentId);
  requireThat(loaded.spec, "This document has no confirmed type.");
  const target = undoTarget(input.field, loaded.edits);
  requireThat(target, "There is nothing to undo for this field.");
  const current = loaded.values[input.field] ?? null;
  await recordAudit(deps, {
    actor,
    action: "field_undo",
    entityType: "document",
    entityId: input.documentId,
    orderNo: input.orderNo ?? null,
    field: input.field,
    oldValue: current,
    newValue: target.restoreTo,
    summary: `${actor.name} undid a change to ${fieldLabel(loaded.spec, input.field)} on ${loaded.document.fileName}: back to "${target.restoreTo ?? "(empty)"}".`,
  });
}
