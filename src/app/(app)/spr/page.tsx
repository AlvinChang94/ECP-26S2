// What: the SPR list (story 3): suggested SPRs from stock shortages, and every SPR with its status.
// Who calls it: the "SPRs" link in the sidebar.
// To extend: the suggestion rule is suggestSprs() in src/domain/spr/suggestions.ts.
import Link from "next/link";
import { readMessages } from "@/app/_lib/forms";
import { requirePersona } from "@/app/_lib/session";
import { Notices } from "@/components/Notices";
import { PageHeader } from "@/components/PageHeader";
import { SprStatusBadge } from "@/components/spr/SprFacts";
import { displayMoney, formatMoney, toMoney } from "@/domain/money";
import { formatDateTime, hoursBetween } from "@/domain/time";
import { getDeps } from "@/services/deps";
import { listSprs, listSuggestedSprs } from "@/services/spr";

export default async function SprListPage(props: PageProps<"/spr">) {
  const searchParams = await props.searchParams;
  const persona = await requirePersona();
  const deps = await getDeps();
  const suggestions = await listSuggestedSprs(deps);
  const sprs = await listSprs(deps);
  const now = deps.clock.now();
  const canRaise = persona.role === "product_manager";

  return (
    <>
      <PageHeader title="SPRs" subtitle="Sales Purchase Requisitions: raised by a product manager from a part number, decided by Janet through a signed link.">
        {canRaise ? (
          <Link className="btn" href="/spr/new">
            New SPR
          </Link>
        ) : null}
      </PageHeader>
      <Notices messages={readMessages(searchParams)} />

      <div className="card card-tight">
        <div className="card-title">Suggested SPRs: open orders need more than the stock on hand ({suggestions.length})</div>
        <table className="table">
          <thead>
            <tr>
              <th>Part</th>
              <th>Open orders</th>
              <th className="right">Needed</th>
              <th className="right">In stock</th>
              <th className="right">Short by</th>
              <th>Already requested</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {suggestions.length === 0 ? (
              <tr>
                <td colSpan={7} className="muted">
                  No shortages: stock covers every open order.
                </td>
              </tr>
            ) : null}
            {suggestions.map((suggestion) => {
              // Link the SPR to an OrderFlow order when one is among those that need the part.
              const sourceOrder = suggestion.orders.find((order) => order.orderRef.startsWith("ORD-"))?.orderRef;
              const quantity = suggestion.toRequest > 0 ? suggestion.toRequest : suggestion.shortBy;
              return (
                <tr key={suggestion.partNo} data-testid={`suggestion-${suggestion.partNo}`}>
                  <td className="mono">{suggestion.partNo}</td>
                  <td>
                    {suggestion.orders.map((order) => (
                      <div key={order.orderRef} className="small">
                        <span className="mono">{order.orderRef}</span> {order.customerName}: {order.quantity}
                      </div>
                    ))}
                  </td>
                  <td className="right">{suggestion.demandQty}</td>
                  <td className="right">{suggestion.stockQty}</td>
                  <td className="right">
                    <strong>{suggestion.shortBy}</strong>
                  </td>
                  <td>
                    {suggestion.sprs.length === 0 ? <span className="muted">nothing yet</span> : null}
                    {suggestion.sprs.map((spr) => (
                      <div key={spr.sprNo} className="small">
                        <Link href={`/spr/${spr.sprNo}`}>{spr.sprNo}</Link>: {spr.quantity} ({spr.status})
                      </div>
                    ))}
                  </td>
                  <td>
                    {suggestion.toRequest === 0 ? (
                      <span className="badge badge-ok">Covered by SPRs</span>
                    ) : canRaise ? (
                      <Link
                        className="btn btn-secondary btn-small"
                        href={`/spr/new?partNo=${encodeURIComponent(suggestion.partNo)}&quantity=${quantity}${sourceOrder ? `&orderNo=${sourceOrder}` : ""}`}
                      >
                        Open pre-filled SPR for {quantity}
                      </Link>
                    ) : (
                      <span className="muted small">A product manager can raise it</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="card card-tight">
        <div className="card-title">All SPRs ({sprs.length})</div>
        <table className="table">
          <thead>
            <tr>
              <th>SPR</th>
              <th>Part</th>
              <th className="right">Qty</th>
              <th>Vendor</th>
              <th className="right">Total</th>
              <th>Status</th>
              <th>With</th>
              <th>Timing</th>
            </tr>
          </thead>
          <tbody>
            {sprs.length === 0 ? (
              <tr>
                <td colSpan={8} className="muted">
                  No SPRs yet.
                </td>
              </tr>
            ) : null}
            {sprs.map((spr) => (
              <tr key={spr.sprNo}>
                <td>
                  <Link href={`/spr/${spr.sprNo}`}>{spr.sprNo}</Link>
                </td>
                <td className="mono">{spr.partNo}</td>
                <td className="right">{spr.quantity}</td>
                <td>{spr.vendorName}</td>
                <td className="right">
                  {spr.currency} {displayMoney(formatMoney(toMoney(spr.unitPrice).times(spr.quantity)))}
                </td>
                <td>
                  <SprStatusBadge status={spr.status} />
                </td>
                <td>{spr.status === "Submitted" ? spr.assignedTo : spr.decidedBy ?? ""}</td>
                <td className="small">
                  {spr.status === "Submitted" && spr.submittedAt ? `waiting ${Math.floor(hoursBetween(spr.submittedAt, now))} hours` : null}
                  {spr.decidedAt && spr.submittedAt ? `decided after ${Math.round(hoursBetween(spr.submittedAt, spr.decidedAt))} hours, ${formatDateTime(spr.decidedAt)}` : null}
                  {spr.status === "Draft" ? "not submitted" : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
