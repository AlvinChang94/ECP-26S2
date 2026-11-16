// What: badges for story 6: an order's derived status and its ship-date risk.
// Who calls it: the order dashboard and the order page.
// To extend: statuses and labels live in src/domain/order/status.ts; add the colour of a new status to STATUS_CLASS here.
import { ORDER_STATUS_LABELS, type OrderStatus, SHIP_RISK_LABELS, type ShipRisk } from "@/domain/order/status";

const STATUS_CLASS: Record<OrderStatus, string> = {
  in_review: "badge badge-warning",
  blocked: "badge badge-blocking",
  awaiting_payment: "badge badge-warning",
  waiting_stock: "badge badge-warning",
  ready_to_ship: "badge badge-ok",
  partly_shipped: "badge badge-info",
  shipped: "badge badge-neutral",
  cancelled: "badge badge-neutral",
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span className={STATUS_CLASS[status]} data-testid="order-status-badge">
      {ORDER_STATUS_LABELS[status]}
    </span>
  );
}

const RISK_CLASS: Record<ShipRisk, string> = {
  none: "badge badge-neutral",
  on_track: "badge badge-ok",
  at_risk: "badge badge-warning",
  late: "badge badge-blocking",
};

/** Shows nothing when there is no ship date to be at risk (shipped, cancelled, or no date set). */
export function ShipRiskBadge({ risk }: { risk: ShipRisk }) {
  if (risk === "none") return null;
  return (
    <span className={RISK_CLASS[risk]} data-testid="ship-risk">
      {SHIP_RISK_LABELS[risk]}
    </span>
  );
}
