// What: the receipts and shipments queue (story 5): every tracked shipment with its document checklist, due date and status.
// Who calls it: the "Receipts and shipments" link in the sidebar; a shipping document whose reference matched nothing leads here.
// To extend: the list is built by listShipments() in src/services/shipments.ts; the rules are in src/domain/shipment/assess.ts.
import Link from "next/link";
import { readMessages } from "@/app/_lib/forms";
import { requirePersona } from "@/app/_lib/session";
import { FlagCard } from "@/components/FlagCard";
import { Notices } from "@/components/Notices";
import { PageHeader } from "@/components/PageHeader";
import { ShipmentStatusBadge } from "@/components/ShipmentBadges";
import { documentTypeLabel } from "@/domain/documents";
import { describeTimeUntil, formatDateTime } from "@/domain/time";
import { getDeps } from "@/services/deps";
import { listShipments, listUnmatchedDocuments, type ShipmentView, summarizeShipments } from "@/services/shipments";
import { linkDocumentAction, trackShipmentAction } from "./actions";

/** "3 of 4 present · AWB or BL missing · Import permit pending check" */
function checklistSummary(view: ShipmentView): string {
  const present = view.checklist.filter((item) => item.status === "present").length;
  const others = view.checklist.filter((item) => item.status !== "present").map((item) => `${item.label} ${item.status === "missing" ? "missing" : "pending check"}`);
  return [`${present} of ${view.checklist.length} present`, ...others].join(" · ");
}

export default async function ShipmentsPage(props: PageProps<"/shipments">) {
  const searchParams = await props.searchParams;
  const persona = await requirePersona();
  const deps = await getDeps();
  const now = deps.clock.now();
  const shipments = await listShipments(deps, now);
  const unmatched = await listUnmatchedDocuments(deps);
  const tiles = summarizeShipments(shipments, unmatched.length);
  const canAct = persona.role === "purchase" || persona.role === "sales";

  return (
    <>
      <PageHeader
        title="Receipts and shipments"
        subtitle="Per shipment: do the invoice, packing list and received quantities agree, and are the required documents in before the due date?"
      />
      <Notices messages={readMessages(searchParams)} />

      <div className="grid-4" style={{ marginBottom: 16 }}>
        <div className="tile">
          <div className="tile-label">Needs review</div>
          <div className="tile-value" data-testid="tile-needs-review">
            {tiles.needsReview}
          </div>
          <div className="tile-note">a quantity difference or a document due date needs a person</div>
        </div>
        <div className="tile">
          <div className="tile-label">Waiting</div>
          <div className="tile-value">{tiles.waiting}</div>
          <div className="tile-note">a document or the goods receipt is not in yet, and nothing is due</div>
        </div>
        <div className="tile">
          <div className="tile-label">Due-date alerts open</div>
          <div className="tile-value" data-testid="tile-due-alerts">
            {tiles.dueAlerts}
          </div>
          <div className="tile-note">a required document is missing within {deps.config.documentAlertWindowHours} hours of its due date, or after it</div>
        </div>
        <div className="tile">
          <div className="tile-label">Documents matching no shipment</div>
          <div className="tile-value">{tiles.unmatchedDocuments}</div>
          <div className="tile-note">their reference names no vendor PO and no order</div>
        </div>
      </div>

      <div className="card card-tight">
        <div className="card-title">Shipments ({shipments.length})</div>
        <table className="table">
          <thead>
            <tr>
              <th>Shipment</th>
              <th>Reference</th>
              <th>Vendor or customer</th>
              <th>For order</th>
              <th>Required documents</th>
              <th>Documents due</th>
              <th>Status</th>
              <th>Assigned to</th>
            </tr>
          </thead>
          <tbody>
            {shipments.map((view) => {
              const topFinding = view.flags.find((flag) => flag.severity !== "info" && flag.decision === null);
              return (
                <tr key={view.shipment.shipmentNo} data-testid={`shipment-row-${view.reference}`}>
                  <td className="nowrap">
                    <Link href={`/shipments/${view.shipment.shipmentNo}`}>{view.shipment.shipmentNo}</Link>
                    <div className="muted small">{view.direction === "inbound" ? "Incoming (purchase)" : "Outgoing (sale)"}</div>
                  </td>
                  <td className="mono nowrap">{view.reference}</td>
                  <td>{view.partyName}</td>
                  <td className="nowrap">{view.orderNo ? <Link href={`/orders/${view.orderNo}`}>{view.orderNo}</Link> : <span className="muted">none</span>}</td>
                  <td>
                    {checklistSummary(view)}
                    {topFinding ? <div className="muted small">{topFinding.reason}</div> : null}
                  </td>
                  <td className="nowrap">
                    {view.dueAt ? (
                      <>
                        {formatDateTime(view.dueAt)}
                        <div className="muted small">{describeTimeUntil(view.dueAt, now)}</div>
                      </>
                    ) : (
                      <span className="muted">not known</span>
                    )}
                  </td>
                  <td>
                    <ShipmentStatusBadge status={view.status} />
                  </td>
                  <td>{view.shipment.assigneeName ?? <span className="muted">nobody yet</span>}</td>
                </tr>
              );
            })}
            {shipments.length === 0 ? (
              <tr>
                <td colSpan={8} className="muted">
                  No shipment is tracked yet. A shipment appears here when its first document is confirmed in the Inbox, or when you start tracking it below.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {unmatched.length > 0 ? (
        <div className="card" data-testid="unmatched-documents">
          <h2>Documents that match no shipment</h2>
          <p className="muted">
            The system does not guess. Type the vendor PO number or the order number the document belongs to, and it is linked with your name in the audit log.
          </p>
          {unmatched.map((entry) => (
            <FlagCard key={entry.document.id} flag={{ ...entry.flag, decision: null }}>
              <form action={linkDocumentAction} className="row" style={{ alignItems: "flex-end" }}>
                <input type="hidden" name="documentId" value={entry.document.id} />
                <span>
                  <Link href={`/documents/${entry.document.id}`}>{entry.document.fileName}</Link> <span className="muted small">({documentTypeLabel(entry.type)})</span>
                </span>
                <div className="field">
                  <label htmlFor={`reference-${entry.document.id}`}>Vendor PO or order number</label>
                  <input id={`reference-${entry.document.id}`} type="text" name="reference" placeholder="PO-8341 or ORD-1038" size={22} />
                </div>
                <div className="field">
                  <button className="btn btn-secondary btn-small" type="submit" disabled={!canAct}>
                    Link
                  </button>
                </div>
              </form>
            </FlagCard>
          ))}
        </div>
      ) : null}

      <div className="card">
        <h2>Track a shipment before its documents arrive</h2>
        <p className="muted">
          Enter a vendor PO number from Navision (a purchase) or an order number (a sale). Its required documents are then checked against the due date even if
          nothing has been received yet.
        </p>
        <form action={trackShipmentAction} className="row" style={{ alignItems: "flex-end" }}>
          <div className="field">
            <label htmlFor="track-reference">Vendor PO or order number</label>
            <input id="track-reference" type="text" name="reference" placeholder="PO-8345" size={22} />
          </div>
          <div className="field">
            <button className="btn btn-secondary" type="submit" disabled={!canAct}>
              Start tracking
            </button>
          </div>
        </form>
        {!canAct ? <p className="muted small">Only the purchase team or a sales team member can do this. You are signed in as {persona.name}.</p> : null}
      </div>

      <p className="muted small">
        OrderFlow compares what the documents and Navision say and alerts people before a due date. It cannot stop a wrong quantity being entered in Navision, and
        it never changes a quantity or closes a finding by itself.
      </p>
    </>
  );
}
