// What: a vertical list of audit events (who did what, when).
// Who calls it: order, document, SPR and shipment pages.
// To extend: entries come from src/services/audit.ts; change the look here.
import type { TimelineEntry } from "@/domain/audit";
import { formatDateTime } from "@/domain/time";

export function Timeline({ entries, emptyText }: { entries: TimelineEntry[]; emptyText?: string }) {
  if (entries.length === 0) return <p className="muted">{emptyText ?? "Nothing recorded yet."}</p>;
  return (
    <ul className="timeline">
      {entries.map((entry) => (
        <li key={entry.id}>
          <div className="timeline-time">
            {formatDateTime(entry.at)} · {entry.actorName}
          </div>
          <div>{entry.summary}</div>
          {entry.reason ? <div className="muted small">Reason: {entry.reason}</div> : null}
        </li>
      ))}
    </ul>
  );
}
