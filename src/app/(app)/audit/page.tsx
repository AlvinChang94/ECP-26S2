// What: the audit log page: who did what and when, newest first, with a filter and a search box.
// Who calls it: the "Audit log" link in the sidebar.
// To extend: events are written by recordAudit() in src/services/audit.ts; this page only lists them.
import { PageHeader } from "@/components/PageHeader";
import { ROLE_LABELS, type ActorRole } from "@/domain/audit";
import { formatDateTime } from "@/domain/time";
import { listAuditLog } from "@/services/audit";
import { getDeps } from "@/services/deps";

const ENTITY_TYPES = ["document", "order", "spr", "payment", "shipment", "alias", "outbox", "system"];

export default async function AuditPage(props: PageProps<"/audit">) {
  const searchParams = await props.searchParams;
  const entityType = typeof searchParams.entityType === "string" ? searchParams.entityType : "";
  const search = typeof searchParams.q === "string" ? searchParams.q : "";
  const deps = await getDeps();
  const events = await listAuditLog(deps, { entityType: entityType || undefined, search: search || undefined });

  return (
    <>
      <PageHeader title="Audit log" subtitle="Every change, override, approval and reminder: who, when, old value, new value and reason." />
      <form method="get" className="card row">
        <select name="entityType" defaultValue={entityType} aria-label="Kind of record">
          <option value="">All records</option>
          {ENTITY_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <input type="search" name="q" defaultValue={search} placeholder="Search name, order or text" />
        <button className="btn btn-secondary" type="submit">
          Filter
        </button>
        <span className="muted">Showing {events.length} event{events.length === 1 ? "" : "s"} (newest 200 at most)</span>
      </form>
      <div className="card card-tight">
        <table className="table">
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>Action</th>
              <th>Record</th>
              <th>What happened</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">
                  No events match.
                </td>
              </tr>
            ) : null}
            {events.map((event) => (
              <tr key={event.id}>
                <td className="nowrap">{formatDateTime(event.at)}</td>
                <td>
                  {event.actorName}
                  <div className="muted small">{ROLE_LABELS[event.actorRole as ActorRole] ?? event.actorRole}</div>
                </td>
                <td className="mono">{event.action}</td>
                <td className="mono">
                  {event.entityType} {event.orderNo ?? event.entityId}
                </td>
                <td>
                  {event.summary}
                  {event.field ? (
                    <div className="muted small">
                      Field {event.field}: {event.oldValue ?? "(empty)"} → {event.newValue ?? "(empty)"}
                    </div>
                  ) : null}
                  {event.reason ? <div className="muted small">Reason: {event.reason}</div> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
