// What: the facts of one SPR and the evidence behind it, shown the same way to the product manager and to the approver.
// Who calls it: the SPR page (/spr/[sprNo]) and the public approval page (/approve/[token]).
// To extend: evidence is captured when the SPR is submitted (buildEvidence in src/services/spr.ts); add a field there and show it here.
import type { SprRow } from "@/adapters/db";
import { displayMoney, formatMoney, marginPercent, toMoney } from "@/domain/money";
import { formatDateTime } from "@/domain/time";
import type { SprEvidence } from "@/services/spr";

export function SprFacts({ spr }: { spr: SprRow }) {
  const total = formatMoney(toMoney(spr.unitPrice).times(spr.quantity));
  return (
    <table className="table">
      <tbody>
        <tr>
          <td className="muted" style={{ width: "36%" }}>
            Part number
          </td>
          <td>
            <span className="mono">{spr.partNo}</span> <span className="muted">{spr.description}</span>
          </td>
        </tr>
        <tr>
          <td className="muted">Vendor</td>
          <td>
            <span className="readonly-value" data-testid="spr-vendor">
              {spr.vendorName}
            </span>{" "}
            <span className="muted small">from Navision</span>
          </td>
        </tr>
        <tr>
          <td className="muted">Unit price</td>
          <td>
            <span className="readonly-value" data-testid="spr-unit-price">
              {spr.currency} {displayMoney(spr.unitPrice)}
            </span>{" "}
            <span className="muted small">from Navision</span>
          </td>
        </tr>
        <tr>
          <td className="muted">Quantity</td>
          <td>
            {spr.quantity} <span className="muted small">typed by {spr.requestedBy}</span>
          </td>
        </tr>
        <tr>
          <td className="muted">Total</td>
          <td>
            <strong>
              {spr.currency} {displayMoney(total)}
            </strong>
          </td>
        </tr>
        <tr>
          <td className="muted">Reason</td>
          <td>{spr.reason}</td>
        </tr>
        {spr.sellPrice ? (
          <tr>
            <td className="muted">Sell price and margin</td>
            <td>
              {spr.currency} {displayMoney(spr.sellPrice)} · margin {marginPercent(spr.sellPrice, spr.unitPrice)}%{" "}
              <span className="muted small">(optional figure, shown because SHOW_MARGIN is on)</span>
            </td>
          </tr>
        ) : null}
        <tr>
          <td className="muted">Requested by</td>
          <td>
            {spr.requestedBy} on {formatDateTime(spr.createdAt)}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

export function SprEvidencePanel({ spr, evidence }: { spr: SprRow; evidence: SprEvidence | null }) {
  if (!evidence) return <p className="muted">Evidence is captured when the SPR is submitted.</p>;
  const shortBy = evidence.demandQty - evidence.stockQty;
  return (
    <div className="stack">
      <div className="grid-3">
        <div className="tile">
          <div className="tile-label">Stock on hand</div>
          <div className="tile-value" data-testid="evidence-stock">
            {evidence.stockQty}
          </div>
          <div className="tile-note">{spr.partNo} in Navision</div>
        </div>
        <div className="tile">
          <div className="tile-label">Needed by open orders</div>
          <div className="tile-value">{evidence.demandQty}</div>
          <div className="tile-note">{shortBy > 0 ? `short by ${shortBy}` : "covered by stock: this is a restocking request"}</div>
        </div>
        <div className="tile">
          <div className="tile-label">Last purchase price</div>
          <div className="tile-value">{displayMoney(evidence.lastPurchasePrice)}</div>
          <div className="tile-note">{evidence.currency} per unit, from Navision</div>
        </div>
      </div>

      {evidence.openOrders.length > 0 ? (
        <table className="table">
          <thead>
            <tr>
              <th>Open order needing {spr.partNo}</th>
              <th>Customer</th>
              <th className="right">Units still needed</th>
            </tr>
          </thead>
          <tbody>
            {evidence.openOrders.map((order) => (
              <tr key={order.orderRef}>
                <td className="mono">{order.orderRef}</td>
                <td>{order.customerName}</td>
                <td className="right">{order.quantity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">No open order needs this part at the moment.</p>
      )}

      {evidence.sourceOrder ? (
        <div>
          <h3>
            Customer PO behind this request: {evidence.sourceOrder.orderNo} ({evidence.sourceOrder.customerName}, PO {evidence.sourceOrder.poNumber})
          </h3>
          <table className="table">
            <thead>
              <tr>
                <th>Part</th>
                <th className="right">Quantity</th>
                <th className="right">Unit price</th>
              </tr>
            </thead>
            <tbody>
              {evidence.sourceOrder.lines.map((line, index) => (
                <tr key={index}>
                  <td className="mono">{line.partNo}</td>
                  <td className="right">{line.quantity}</td>
                  <td className="right">{line.unitPrice}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <p className="muted small">Figures as they were when the SPR was submitted ({formatDateTime(new Date(evidence.capturedAt))}).</p>
    </div>
  );
}

const STATUS_BADGES: Record<string, string> = { Draft: "badge-neutral", Submitted: "badge-warning", Approved: "badge-ok", Rejected: "badge-blocking" };

export function SprStatusBadge({ status }: { status: string }) {
  return (
    <span className={`badge ${STATUS_BADGES[status] ?? "badge-neutral"}`} data-testid="spr-status">
      {status}
    </span>
  );
}
