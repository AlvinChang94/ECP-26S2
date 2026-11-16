// What: the history panel: for every field that was changed, who changed it, when, from what to what, with an Undo button.
// Who calls it: the PO review page.
// To extend: edits and undos are audit events (src/services/audit.ts); undo rules are in src/domain/fields.ts.
import { undoFieldAction } from "@/app/(app)/orders/[orderNo]/actions";
import type { DocumentTypeSpec } from "@/domain/documents";
import { type FieldEdit, fieldHistory, fieldLabel, undoTarget } from "@/domain/fields";
import { formatDateTime } from "@/domain/time";

function shown(value: string | null): string {
  return value === null ? "(empty)" : value;
}

export function FieldHistory({ orderNo, spec, edits, canEdit }: { orderNo: string; spec: DocumentTypeSpec; edits: FieldEdit[]; canEdit: boolean }) {
  const fields = [...new Set(edits.map((edit) => edit.field))];
  if (fields.length === 0) {
    return <p className="muted">No value has been changed. Everything is as it was read from the PDF.</p>;
  }
  return (
    <div className="stack">
      {fields.map((field) => {
        const history = fieldHistory(field, edits);
        const undo = undoTarget(field, edits);
        return (
          <div key={field} data-testid={`history-${field}`}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <strong>{fieldLabel(spec, field)}</strong>
              {canEdit && undo ? (
                <form action={undoFieldAction}>
                  <input type="hidden" name="orderNo" value={orderNo} />
                  <input type="hidden" name="field" value={field} />
                  <button className="btn btn-secondary btn-small" type="submit" title={`Restore ${shown(undo.restoreTo)}`}>
                    Undo (back to {shown(undo.restoreTo)})
                  </button>
                </form>
              ) : null}
            </div>
            <ul className="timeline" style={{ marginTop: 6 }}>
              {history.map((edit) => (
                <li key={edit.id}>
                  <div className="timeline-time">
                    {formatDateTime(edit.at)} · {edit.actorName} · {edit.action === "field_undo" ? "undo" : "edit"}
                  </div>
                  <div>
                    <span className="mono">{shown(edit.oldValue)}</span> → <span className="mono">{shown(edit.newValue)}</span>
                  </div>
                  {edit.reason ? <div className="muted small">{edit.reason}</div> : null}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
