// What: the page of one order: what was exported, delivered and remaining quantities, PO versions, and the timeline.
// Who calls it: the order dashboard, the Inbox and the review and preview pages link here.
// To extend: status, owner and next action (story 6) are derived in src/domain/order and shown at the top of this page.
import Link from "next/link";
import { notFound } from "next/navigation";
import { readMessages } from "@/app/_lib/forms";
import { requirePersona } from "@/app/_lib/session";
import { Notices } from "@/components/Notices";
import { PageHeader } from "@/components/PageHeader";
import { Timeline } from "@/components/Timeline";
import { displayMoney } from "@/domain/money";
import { formatDate, formatDateTime } from "@/domain/time";
import { listOrderTimeline } from "@/services/audit";
import { getDeps } from "@/services/deps";
import { UserError } from "@/services/errors";
import { getFulfilment } from "@/services/fulfilment";
import { getOrder, listPoVersions } from "@/services/orders";
import { exportedOrderFile } from "@/services/poExport";
import { recordDeliveryAction } from "./actions";

const KIND_LABELS: Record<string, string> = { new: "PO", amendment: "Amendment", cancellation: "Cancellation" };
const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  exported: "Exported",
  superseded: "Replaced",
  cancelled: "Cancelled",
  void: "Withdrawn",
};

export default async function OrderPage(props: PageProps<"/orders/[orderNo]">) {
  const { orderNo } = await props.params;
  const searchParams = await props.searchParams;
  const persona = await requirePersona();
  const deps = await getDeps();

  let order;
  try {
    order = await getOrder(deps, orderNo);
  } catch (error) {
    if (error instanceof UserError) notFound();
    throw error;
  }
  const versions = await listPoVersions(deps, orderNo);
  const documents = await deps.db.document.findMany({ where: { id: { in: versions.map((version) => version.documentId) } } });
  const exported = await exportedOrderFile(deps, orderNo);
  const fulfilment = await getFulfilment(deps, orderNo);
  const timeline = await listOrderTimeline(deps, orderNo);
  const current = versions.find((version) => version.id === order.currentPoVersionId);
  const open = order.status === "open";
  const canRecordDelivery = open && (persona.role === "sales" || persona.role === "purchase");

  return (
    <>
      <PageHeader title={`${orderNo}: ${order.customerName ?? "customer not read"}`} subtitle={`Customer PO ${order.poNumber ?? "(number not read)"} · received ${formatDateTime(order.receivedAt)}`}>
        <Link className="btn btn-secondary" href={`/orders/${orderNo}/review`}>
          Review the PO
        </Link>
        {open && current?.status === "draft" ? (
          <Link className="btn" href={`/orders/${orderNo}/preview`}>
            {current.kind === "cancellation" ? "Review the cancellation" : "Preview the export"}
          </Link>
        ) : null}
        {exported ? (
          <a className="btn btn-secondary" href={`/api/orders/${orderNo}/pi`} data-testid="download-pi">
            Download PI (PDF)
          </a>
        ) : null}
        {open ? (
          <Link className="btn btn-danger" href={`/orders/${orderNo}/preview?mode=cancel`}>
            Cancel order
          </Link>
        ) : null}
      </PageHeader>
      <Notices messages={readMessages(searchParams)} />

      {order.status === "cancelled" ? (
        <div className="notice notice-warning" data-testid="order-cancelled">
          Cancelled by {order.cancelledBy} on {formatDateTime(order.cancelledAt)}. Reason: {order.cancelReason}
        </div>
      ) : null}

      <div className="grid-2">
        <div>
          <div className="card card-tight">
            <div className="card-title">{exported ? "In Navision (last approved export)" : "Not exported yet"}</div>
            {exported ? (
              <table className="table">
                <tbody>
                  <tr>
                    <td className="muted">Customer</td>
                    <td>
                      {exported.customer.name} <span className="muted">({exported.customer.customerNo ?? "new customer card"})</span>
                    </td>
                  </tr>
                  <tr>
                    <td className="muted">Promised ship date</td>
                    <td>{formatDate(exported.promisedShipDate)}</td>
                  </tr>
                  <tr>
                    <td className="muted">Total</td>
                    <td>
                      {exported.currency} {displayMoney(exported.totalAmount)}
                    </td>
                  </tr>
                  <tr>
                    <td className="muted">Payment terms</td>
                    <td>{exported.paymentTerms === "advance" ? "Advance payment" : "Credit"}</td>
                  </tr>
                  <tr>
                    <td className="muted">Proforma invoice</td>
                    <td>
                      {order.piNumber} <span className="muted">issued {formatDateTime(order.piIssuedAt)}</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            ) : (
              <p className="muted" style={{ padding: 16 }}>
                This order is still a draft. It reaches Navision only after a sales team member approves the export preview.
              </p>
            )}
          </div>

          {fulfilment ? (
            <div className="card card-tight" data-testid="fulfilment">
              <div className="card-title row" style={{ justifyContent: "space-between" }}>
                <span>Delivered and remaining</span>
                <span className={fulfilment.state === "complete" ? "badge badge-ok" : fulfilment.state === "partial" ? "badge badge-warning" : "badge badge-neutral"}>
                  {fulfilment.state === "complete" ? "Fully delivered" : fulfilment.state === "partial" ? "Partly delivered" : "Nothing delivered yet"}
                </span>
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th>Part</th>
                    <th className="right">Ordered</th>
                    <th className="right">Delivered</th>
                    <th className="right">Remaining</th>
                    {canRecordDelivery ? <th>Record a delivery</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {fulfilment.lines.map((line) => (
                    <tr key={line.itemNo}>
                      <td>
                        <span className="mono">{line.itemNo}</span>
                        <div className="muted small">{line.description}</div>
                      </td>
                      <td className="right">{line.ordered}</td>
                      <td className="right">{line.delivered}</td>
                      <td className="right">
                        <strong>{line.remaining}</strong>
                      </td>
                      {canRecordDelivery ? (
                        <td>
                          {line.remaining > 0 ? (
                            <form action={recordDeliveryAction} className="inline-form">
                              <input type="hidden" name="orderNo" value={orderNo} />
                              <input type="hidden" name="partNo" value={line.itemNo} />
                              <input type="number" name="quantity" min={1} max={line.remaining} placeholder="Qty" aria-label={`Delivered quantity of ${line.itemNo}`} style={{ width: 80 }} required />
                              <button className="btn btn-secondary btn-small" type="submit">
                                Record
                              </button>
                            </form>
                          ) : (
                            <span className="muted">Complete</span>
                          )}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <div className="card card-tight">
            <div className="card-title">PO versions ({versions.length})</div>
            <table className="table">
              <thead>
                <tr>
                  <th>Revision</th>
                  <th>Kind</th>
                  <th>Status</th>
                  <th>Document</th>
                  <th>Exported</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((version) => {
                  const document = documents.find((candidate) => candidate.id === version.documentId);
                  return (
                    <tr key={version.id}>
                      <td>
                        <Link href={`/orders/${orderNo}/review?version=${version.id}`}>Revision {version.revision}</Link>
                      </td>
                      <td>{KIND_LABELS[version.kind] ?? version.kind}</td>
                      <td>{STATUS_LABELS[version.status] ?? version.status}</td>
                      <td className="mono">{document ? <Link href={`/documents/${document.id}`}>{document.fileName}</Link> : "(missing)"}</td>
                      <td>{version.exportedAt ? `${formatDateTime(version.exportedAt)} by ${version.exportedBy}` : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <h2>Timeline</h2>
          <Timeline entries={timeline} />
        </div>
      </div>
    </>
  );
}
