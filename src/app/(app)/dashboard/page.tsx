// What: the order dashboard (story 6): every order with its status, owner, delay reason, next action and promised ship date.
// Who calls it: the "Order dashboard" link in the sidebar, and "/" redirects here.
// To extend: nothing is entered on this page. Everything shown is derived by deriveOrderStatus() in src/domain/order/status.ts.
import Link from "next/link";
import { oneParam } from "@/app/_lib/highlights";
import { requirePersona } from "@/app/_lib/session";
import { OrderStatusBadge, ShipRiskBadge } from "@/components/OrderBadges";
import { PageHeader } from "@/components/PageHeader";
import { ORDER_STATUS_LABELS, type OrderStatus } from "@/domain/order/status";
import { formatDate } from "@/domain/time";
import { getDeps } from "@/services/deps";
import { getOrderDashboard } from "@/services/orderDashboard";

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "All orders" },
  { value: "open", label: "Open (not shipped or cancelled)" },
  { value: "risk", label: "Ship date at risk or passed" },
  ...(Object.keys(ORDER_STATUS_LABELS) as OrderStatus[]).map((status) => ({ value: status, label: ORDER_STATUS_LABELS[status] })),
];

export default async function DashboardPage(props: PageProps<"/dashboard">) {
  const searchParams = await props.searchParams;
  const persona = await requirePersona();
  const deps = await getDeps();
  const search = oneParam(searchParams.search) ?? "";
  const status = oneParam(searchParams.status) ?? "all";
  const dashboard = await getOrderDashboard(deps, { search, status });
  const { tiles } = dashboard;
  const filtered = search !== "" || status !== "all";

  return (
    <>
      <PageHeader
        title="Order dashboard"
        subtitle="Every order in one place: where it stands, who acts next, what holds it up. Nothing is typed in here; it all comes from the other screens."
      />

      <div className="grid-4" style={{ marginBottom: 16 }}>
        <div className="tile">
          <div className="tile-label">Open orders</div>
          <div className="tile-value" data-testid="tile-open">
            {tiles.open}
          </div>
          <div className="tile-note">
            of {dashboard.totalOrders} orders in total · {tiles.readyToShip} ready or partly shipped
          </div>
        </div>
        <div className="tile">
          <div className="tile-label">Blocked</div>
          <div className="tile-value" data-testid="tile-blocked">
            {tiles.blocked}
          </div>
          <div className="tile-note">a shipment finding or a changed PO needs a person</div>
        </div>
        <div className="tile">
          <div className="tile-label">Ship date at risk</div>
          <div className="tile-value" data-testid="tile-risk">
            {tiles.shipDateAtRisk + tiles.shipDateLate}
          </div>
          <div className="tile-note">
            {tiles.shipDateAtRisk} at risk · {tiles.shipDateLate} past the promised date
          </div>
        </div>
        <div className="tile">
          <div className="tile-label">Awaiting payment</div>
          <div className="tile-value" data-testid="tile-awaiting-payment">
            {tiles.awaitingPayment}
          </div>
          <div className="tile-note">exported, not yet confirmed as paid by Finance</div>
        </div>
      </div>

      <div className="card">
        {/* A plain GET form: the search text and status become part of the address, so a filtered view can be bookmarked or shared. */}
        <form method="get" action="/dashboard" className="row" style={{ alignItems: "flex-end" }} data-testid="dashboard-filter">
          <div className="field">
            <label htmlFor="search">Search</label>
            <input id="search" type="search" name="search" defaultValue={search} placeholder="Order, customer, PO or PI number" size={32} />
          </div>
          <div className="field">
            <label htmlFor="status">Status</label>
            <select id="status" name="status" defaultValue={status}>
              {STATUS_FILTERS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <button className="btn btn-secondary" type="submit">
              Show
            </button>
          </div>
          {filtered ? (
            <div className="field">
              <Link href="/dashboard">Clear</Link>
            </div>
          ) : null}
        </form>
      </div>

      <div className="card card-tight">
        <div className="card-title">
          Orders ({dashboard.rows.length}
          {filtered ? ` of ${dashboard.totalOrders}` : ""})
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Customer</th>
              <th>Status</th>
              <th>Owner</th>
              <th>Next action, and what holds the order up</th>
              <th>Promised ship date</th>
            </tr>
          </thead>
          <tbody>
            {dashboard.rows.map(({ order, result }) => (
              <tr key={order.orderNo} data-testid={`order-row-${order.orderNo}`}>
                <td className="nowrap">
                  <Link href={`/orders/${order.orderNo}`}>{order.orderNo}</Link>
                  <div className="muted small mono">{order.poNumber ?? "PO number not read"}</div>
                </td>
                <td>{order.customerName ?? <span className="muted">not read</span>}</td>
                <td>
                  <OrderStatusBadge status={result.status} />
                </td>
                <td className="nowrap" data-testid="owner">
                  {result.owner ?? <span className="muted">nobody</span>}
                </td>
                <td>
                  <span data-testid="next-action">{result.nextAction}</span>
                  {result.blockerReason ? (
                    <div className="muted small" data-testid="delay-reason">
                      {result.blockerReason}
                    </div>
                  ) : null}
                </td>
                <td className="nowrap">
                  {order.promisedShipDate ? formatDate(order.promisedShipDate) : <span className="muted">not set</span>} <ShipRiskBadge risk={result.shipRisk} />
                </td>
              </tr>
            ))}
            {dashboard.rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
                  {filtered ? "No order matches this search and status." : "No orders yet. Import a customer PO from the Inbox to start."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="card card-tight" data-testid="tasks-by-person">
        <div className="card-title">Open tasks by person</div>
        <table className="table">
          <thead>
            <tr>
              <th>Assigned to</th>
              <th className="right">Tasks</th>
              <th className="right">Orders</th>
            </tr>
          </thead>
          <tbody>
            {dashboard.tasksByPerson.map((entry) => (
              <tr key={entry.assignee}>
                <td>
                  {entry.assignee}
                  {entry.assignee === persona.name ? <span className="muted small"> (you)</span> : null}
                </td>
                <td className="right">{entry.tasks}</td>
                <td className="right">{entry.orders}</td>
              </tr>
            ))}
            {dashboard.tasksByPerson.length === 0 ? (
              <tr>
                <td colSpan={3} className="muted">
                  No open tasks.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        <p className="muted small" style={{ padding: "0 16px 12px" }}>
          Each order&apos;s tasks, with who they are assigned to, are listed on its page. The promised ship date is the date a sales team member agreed with the customer;
          &quot;at risk&quot; means the order is blocked, or is still not ready {deps.config.shipDateAlertDays} days before that date.
        </p>
      </div>
    </>
  );
}
