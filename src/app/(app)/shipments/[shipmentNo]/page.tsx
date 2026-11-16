// What: the exception review page of one shipment (story 5): quantity reconciliation, required documents, findings, actions and the audit trail.
// Who calls it: a row on /shipments, a confirmed shipping document in the Inbox, and the order page.
// To extend: the page only shows what loadShipmentView() worked out and takes a person's decision. It never closes a finding by itself.
import Link from "next/link";
import { notFound } from "next/navigation";
import { readMessages } from "@/app/_lib/forms";
import { requirePersona } from "@/app/_lib/session";
import { FlagCard } from "@/components/FlagCard";
import { Notices } from "@/components/Notices";
import { PageHeader } from "@/components/PageHeader";
import { ChecklistBadge, ShipmentStatusBadge } from "@/components/ShipmentBadges";
import { Timeline } from "@/components/Timeline";
import { documentTypeLabel } from "@/domain/documents";
import { lineIndexes, lineKey } from "@/domain/fields";
import { REQUIRED_DOCUMENTS, type ReconciliationRow } from "@/domain/shipment/assess";
import { describeTimeUntil, formatDateTime } from "@/domain/time";
import { getDeps } from "@/services/deps";
import { UserError } from "@/services/errors";
import { listOutbox, notificationLabel } from "@/services/outbox";
import { getShipment, listAssignees, listShipmentTimeline, type ShipmentView } from "@/services/shipments";
import { assignShipmentAction, editShipmentDocumentAction, recordResolutionAction, reopenFindingAction, requestDocumentAction } from "../actions";

function quantity(value: number | null) {
  return value === null ? <span className="muted">none yet</span> : value;
}

function ResultBadge({ row }: { row: ReconciliationRow }) {
  if (row.status === "match") return <span className="badge badge-ok">Match</span>;
  if (row.status === "waiting") return <span className="badge badge-neutral">Waiting{row.note ? `: ${row.note}` : ""}</span>;
  return <span className="badge badge-blocking">{row.note}</span>;
}

export default async function ShipmentPage(props: PageProps<"/shipments/[shipmentNo]">) {
  const { shipmentNo } = await props.params;
  const searchParams = await props.searchParams;
  const persona = await requirePersona();
  const deps = await getDeps();

  let view: ShipmentView;
  try {
    view = await getShipment(deps, shipmentNo);
  } catch (error) {
    if (error instanceof UserError) notFound();
    throw error;
  }
  const now = deps.clock.now();
  const canAct = persona.role === "purchase" || persona.role === "sales";
  const inbound = view.direction === "inbound";
  const timeline = await listShipmentTimeline(deps, view);
  const messages = await listOutbox(deps, { entityType: "shipment", entityId: shipmentNo });
  const assignees = await listAssignees(deps);
  const exceptions = view.flags.filter((flag) => flag.severity !== "info");
  const notes = view.flags.filter((flag) => flag.severity === "info");
  const dueFlagOpen = view.flags.some((flag) => (flag.code === "DOCUMENT_DUE_SOON" || flag.code === "DOCUMENT_OVERDUE") && flag.decision === null);
  const withLines = view.documents.filter((entry) => lineIndexes(entry.values).length > 0);

  return (
    <>
      <PageHeader
        title={`Shipment ${shipmentNo}`}
        subtitle={`${inbound ? "Incoming goods for vendor PO" : "Outgoing goods for order"} ${view.reference} · ${view.partyName}`}
      >
        <ShipmentStatusBadge status={view.status} />
        <Link className="btn btn-secondary" href="/shipments">
          Back to the list
        </Link>
      </PageHeader>
      <Notices messages={readMessages(searchParams)} />

      <div className={dueFlagOpen ? "notice notice-warning" : "notice notice-info"} data-testid="due-date">
        {view.dueAt ? (
          <>
            Required documents are due on <strong>{formatDateTime(view.dueAt)}</strong> ({describeTimeUntil(view.dueAt, now)}).
            {dueFlagOpen ? " At least one is still missing." : ""}
          </>
        ) : (
          "No due date is known for this shipment's documents."
        )}
        {view.orderNo ? (
          <>
            {" "}
            This shipment serves order <Link href={`/orders/${view.orderNo}`}>{view.orderNo}</Link>.
          </>
        ) : null}
      </div>

      <div className="grid-2">
        <div className="card card-tight" data-testid="reconciliation">
          <div className="card-title">Quantity reconciliation</div>
          <table className="table">
            <thead>
              <tr>
                <th>Part</th>
                <th className="right">{inbound ? "On vendor PO" : "Ordered"}</th>
                <th className="right">Invoiced</th>
                <th className="right">Packing list</th>
                {inbound ? <th className="right">Received (Navision)</th> : null}
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((row) => (
                <tr key={row.partNo} data-testid={`qty-row-${row.partNo}`}>
                  <td className="mono nowrap">{row.partNo}</td>
                  <td className="right">{quantity(row.ordered)}</td>
                  <td className="right">{quantity(row.invoiced)}</td>
                  <td className="right">{quantity(row.packed)}</td>
                  {inbound ? <td className="right">{quantity(row.received)}</td> : null}
                  <td>
                    <ResultBadge row={row} />
                  </td>
                </tr>
              ))}
              {view.rows.length === 0 ? (
                <tr>
                  <td colSpan={inbound ? 6 : 5} className="muted">
                    No quantities to compare yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
          <p className="muted small" style={{ padding: "0 16px 12px" }}>
            {inbound
              ? view.goodsReceipt
                ? `Received quantities come from Navision goods receipt ${view.goodsReceipt.grNo}, recorded ${formatDateTime(new Date(view.goodsReceipt.receivedAt))}.`
                : "Navision has no goods receipt for this vendor PO yet."
              : "For a sale, the order, the invoice and the packing list are compared. There is no goods receipt."}{" "}
            Invoice and packing-list quantities are read from the PDFs below.
          </p>
        </div>

        <div className="card card-tight" data-testid="checklist">
          <div className="card-title">Required documents</div>
          <table className="table">
            <tbody>
              {view.checklist.map((item) => {
                const required = REQUIRED_DOCUMENTS.find((candidate) => candidate.key === item.key);
                const present = view.documents.filter((entry) => required?.types.includes(entry.type));
                const waiting = view.pending.filter((document) => required?.types.some((type) => type === document.detectedType));
                return (
                  <tr key={item.key} data-testid={`checklist-${item.key}`}>
                    <td>{item.label}</td>
                    <td>
                      <ChecklistBadge status={item.status} />
                    </td>
                    <td>
                      {present.map((entry) => (
                        <div key={entry.document.id}>
                          <Link href={`/documents/${entry.document.id}`}>{entry.document.fileName}</Link>
                        </div>
                      ))}
                      {item.status === "pending_check"
                        ? waiting.map((document) => (
                            <div key={document.id}>
                              <Link href={`/documents/${document.id}`}>{document.fileName}</Link> <span className="muted small">arrived, confirm its type</span>
                            </div>
                          ))
                        : null}
                      {item.status === "missing" ? (
                        <form action={requestDocumentAction}>
                          <input type="hidden" name="shipmentNo" value={shipmentNo} />
                          <input type="hidden" name="documentKey" value={item.key} />
                          <button className="btn btn-secondary btn-small" type="submit" disabled={!canAct} data-testid={`request-${item.key}`}>
                            Request document
                          </button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {view.documents
            .filter((entry) => entry.type === "goods_receipt")
            .map((entry) => (
              <p className="muted small" style={{ padding: "0 16px" }} key={entry.document.id}>
                Also on file: goods receipt note <Link href={`/documents/${entry.document.id}`}>{entry.document.fileName}</Link> (evidence only; received quantities come
                from Navision).
              </p>
            ))}
        </div>
      </div>

      <div className="card" data-testid="findings">
        <h2>Findings for a person to review</h2>
        {exceptions.length === 0 ? <p className="muted">Nothing needs review: the quantities agree and no required document is missing.</p> : null}
        {exceptions.map((flag) => (
          <FlagCard key={flag.fingerprint} flag={flag}>
            {flag.decision ? (
              <form action={reopenFindingAction}>
                <input type="hidden" name="shipmentNo" value={shipmentNo} />
                <input type="hidden" name="fingerprint" value={flag.fingerprint} />
                <button className="btn btn-secondary btn-small" type="submit" disabled={!canAct}>
                  Reopen
                </button>
              </form>
            ) : (
              <form action={recordResolutionAction} className="row" style={{ alignItems: "flex-end" }}>
                <input type="hidden" name="shipmentNo" value={shipmentNo} />
                <input type="hidden" name="fingerprint" value={flag.fingerprint} />
                <div className="field" style={{ flex: 1 }}>
                  <label htmlFor={`reason-${flag.fingerprint}`}>What was decided, and why (required)</label>
                  <input
                    id={`reason-${flag.fingerprint}`}
                    type="text"
                    name="reason"
                    style={{ width: "100%" }}
                    placeholder={flag.code === "QTY_VARIANCE" ? "For example: vendor confirmed the missing units ship next week" : "For example: vendor confirmed the document follows tomorrow morning"}
                  />
                </div>
                <div className="field">
                  <button className="btn btn-small" type="submit" disabled={!canAct} data-testid={`resolve-${flag.code}`}>
                    Record resolution as {persona.name}
                  </button>
                </div>
              </form>
            )}
          </FlagCard>
        ))}
        {notes.map((flag) => (
          <FlagCard key={flag.fingerprint} flag={flag} />
        ))}
        <p className="muted small">
          A finding stays open until a person records what was decided. If the quantities change, or a missing document passes its due date, that is a new finding and
          needs a new decision. OrderFlow detects and alerts; it does not correct quantities or stop a shipment.
        </p>
        {!canAct ? <p className="muted small">Only the purchase team or a sales team member can act here. You are signed in as {persona.name}.</p> : null}
      </div>

      <div className="grid-2">
        <div className="card" data-testid="assignment">
          <h2>Who follows this up</h2>
          <p>
            Assigned to: <strong data-testid="assignee">{view.shipment.assigneeName ?? "nobody yet"}</strong>
            {view.shipment.assigneeName ? null : <span className="muted"> (alerts go to the {inbound ? "purchase team" : "sales team"} until someone is assigned)</span>}
          </p>
          <form action={assignShipmentAction} className="row" style={{ alignItems: "flex-end" }}>
            <input type="hidden" name="shipmentNo" value={shipmentNo} />
            <div className="field">
              <label htmlFor="staffId">Assign to a team member</label>
              <select id="staffId" name="staffId" defaultValue="">
                <option value="" disabled>
                  Choose
                </option>
                {assignees.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <button className="btn btn-secondary btn-small" type="submit" disabled={!canAct}>
                Assign
              </button>
            </div>
          </form>
        </div>

        <div className="card" data-testid="shipment-messages">
          <h2>Alerts and requests sent</h2>
          {messages.length === 0 ? <p className="muted">Nothing has been sent about this shipment.</p> : null}
          <ul className="timeline">
            {messages.map((message) => (
              <li key={message.id}>
                <div className="timeline-time">
                  {formatDateTime(message.createdAt)} · {notificationLabel(message.type)}
                </div>
                <div>
                  To {message.toName}: {message.subject}
                </div>
              </li>
            ))}
          </ul>
          {messages.length > 0 ? (
            <p className="muted small">
              The full text of each message is in the <Link href="/outbox">Outbox</Link>.
            </p>
          ) : null}
        </div>
      </div>

      {withLines.length > 0 ? (
        <div className="card">
          <h2>What was read from the documents</h2>
          <p className="muted">If the reader got a part number or quantity wrong, correct it here. Each correction is recorded with your name and the shipment is checked again.</p>
          {withLines.map((entry) => (
            <details key={entry.document.id} style={{ marginTop: 8 }}>
              <summary>
                {documentTypeLabel(entry.type)}: {entry.document.fileName}
                {entry.edits.length > 0 ? <span className="muted small"> · {entry.edits.length} correction{entry.edits.length === 1 ? "" : "s"} made</span> : null}
              </summary>
              <form action={editShipmentDocumentAction} style={{ marginTop: 8 }}>
                <input type="hidden" name="shipmentNo" value={shipmentNo} />
                <input type="hidden" name="documentId" value={entry.document.id} />
                <table className="table">
                  <thead>
                    <tr>
                      <th>Line</th>
                      <th>Part no.</th>
                      <th>Quantity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineIndexes(entry.values).map((index) => (
                      <tr key={index}>
                        <td>{index + 1}</td>
                        <td>
                          <input type="text" name={`field:${lineKey(index, "partNo")}`} defaultValue={entry.values[lineKey(index, "partNo")] ?? ""} size={16} aria-label={`Line ${index + 1} part number`} />
                        </td>
                        <td>
                          <input type="text" name={`field:${lineKey(index, "quantity")}`} defaultValue={entry.values[lineKey(index, "quantity")] ?? ""} size={8} aria-label={`Line ${index + 1} quantity`} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="row" style={{ marginTop: 8 }}>
                  <button className="btn btn-secondary btn-small" type="submit" disabled={!canAct}>
                    Save corrections
                  </button>
                  <Link href={`/documents/${entry.document.id}`}>Open the PDF</Link>
                </div>
              </form>
            </details>
          ))}
        </div>
      ) : null}

      <div className="card" data-testid="audit-trail">
        <h2>Audit trail</h2>
        <Timeline entries={timeline} />
      </div>
    </>
  );
}
