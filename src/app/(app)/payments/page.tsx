// What: the payment board (story 4): every exported order as Awaiting, Proof received or Paid with days waiting; vendor payments due.
// Who calls it: the "Payments" link in the sidebar.
// To extend: the board is built by getPaymentBoard() in src/services/payments.ts; statuses come from src/domain/payment/status.ts.
import Link from "next/link";
import { readMessages } from "@/app/_lib/forms";
import { requirePersona } from "@/app/_lib/session";
import { Notices } from "@/components/Notices";
import { PageHeader } from "@/components/PageHeader";
import { PaymentBadge } from "@/components/PaymentBadge";
import { displayMoney } from "@/domain/money";
import { formatDate, formatDateTime } from "@/domain/time";
import { getDeps } from "@/services/deps";
import { getPaymentBoard, listVendorPayments } from "@/services/payments";
import { linkProofAction } from "./actions";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function weekday(isoDate: string): string {
  return WEEKDAYS[new Date(`${isoDate}T00:00:00Z`).getUTCDay()];
}

function dueText(daysUntilDue: number): string {
  if (daysUntilDue < 0) return `${-daysUntilDue} day${daysUntilDue === -1 ? "" : "s"} overdue`;
  if (daysUntilDue === 0) return "due today";
  return `in ${daysUntilDue} day${daysUntilDue === 1 ? "" : "s"}`;
}

export default async function PaymentsPage(props: PageProps<"/payments">) {
  const searchParams = await props.searchParams;
  const persona = await requirePersona();
  const deps = await getDeps();
  const board = await getPaymentBoard(deps);
  const vendorPayments = await listVendorPayments(deps);
  const isFinance = persona.role === "finance";
  const linkable = board.rows.filter((row) => row.state.status !== "paid");

  return (
    <>
      <PageHeader title="Payments" subtitle="Which orders are paid, which are waiting, and which vendor payments are coming up. Only Finance confirms that money arrived." />
      <Notices messages={readMessages(searchParams)} />

      <div className="grid-4" style={{ marginBottom: 16 }}>
        <div className="tile">
          <div className="tile-label">Awaiting payment</div>
          <div className="tile-value" data-testid="tile-awaiting">
            {board.tiles.awaitingCount}
          </div>
          <div className="tile-note">
            open amount incl. unconfirmed proofs: {board.tiles.awaitingTotals.map((total) => `${total.currency} ${displayMoney(total.amount)}`).join(", ") || "none"}
          </div>
        </div>
        <div className="tile">
          <div className="tile-label">Proof received</div>
          <div className="tile-value" data-testid="tile-proof">
            {board.tiles.proofReceivedCount}
          </div>
          <div className="tile-note">waiting for Finance to confirm</div>
        </div>
        <div className="tile">
          <div className="tile-label">Paid and confirmed today</div>
          <div className="tile-value" data-testid="tile-paid-today">
            {board.tiles.paidTodayCount}
          </div>
          <div className="tile-note">warehouse notified for each</div>
        </div>
        <div className="tile">
          <div className="tile-label">Late payers</div>
          <div className="tile-value">{board.tiles.lateCount}</div>
          <div className="tile-note">no payment or proof after {deps.config.latePaymentAfterDays} days</div>
        </div>
      </div>

      <div className="card card-tight">
        <div className="card-title">Orders ({board.rows.length})</div>
        <table className="table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Customer</th>
              <th>PI</th>
              <th className="right">Amount</th>
              <th>Terms</th>
              <th>Status</th>
              <th>Proof of payment</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {board.rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="muted">
                  No exported orders yet. An order appears here once its export to Navision is approved.
                </td>
              </tr>
            ) : null}
            {board.rows.map((row) => (
              <tr key={row.order.orderNo} data-testid={`payment-row-${row.order.orderNo}`}>
                <td>
                  <Link href={`/orders/${row.order.orderNo}`}>{row.order.orderNo}</Link>
                </td>
                <td>{row.order.customerName}</td>
                <td className="mono">{row.order.piNumber}</td>
                <td className="right">
                  {row.order.currency} {displayMoney(row.order.totalAmount)}
                </td>
                <td>{row.order.paymentTerms === "advance" ? "Advance" : "Credit"}</td>
                <td>
                  <PaymentBadge state={row.state} late={row.late} />
                </td>
                <td className="small">
                  {row.proofs.length === 0 ? <span className="muted">none</span> : null}
                  {row.proofs.map((proof) => (
                    <div key={proof.proof.id}>
                      {proof.summary}
                      {proof.flags.some((flag) => flag.code === "PAYMENT_DUPLICATE") ? " · possible duplicate" : ""}
                    </div>
                  ))}
                </td>
                <td>
                  <Link className={row.state.status === "proof_received" ? "btn btn-small" : "btn btn-secondary btn-small"} href={`/payments/${row.order.orderNo}`}>
                    {row.state.status === "proof_received" ? "Review and confirm" : row.state.status === "paid" ? "View" : "Open"}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {board.unmatched.length > 0 ? (
        <div className="card card-tight" data-testid="unmatched-proofs">
          <div className="card-title">Proofs that match no order ({board.unmatched.length})</div>
          <table className="table">
            <thead>
              <tr>
                <th>Document</th>
                <th>Paid by</th>
                <th className="right">Amount</th>
                <th>Reference</th>
                <th>Why it did not match</th>
                <th>Link to an order</th>
              </tr>
            </thead>
            <tbody>
              {board.unmatched.map((proof) => (
                <tr key={proof.proof.id}>
                  <td className="mono">
                    <Link href={`/documents/${proof.document.id}`}>{proof.document.fileName}</Link>
                  </td>
                  <td>{proof.data.payerName}</td>
                  <td className="right">
                    {proof.data.currency} {displayMoney(proof.data.amount)}
                  </td>
                  <td className="mono">{proof.data.reference}</td>
                  <td className="small">{proof.match.flags.map((flag) => flag.reason).join(" ")}</td>
                  <td>
                    {isFinance ? (
                      <form action={linkProofAction} className="inline-form">
                        <input type="hidden" name="proofId" value={proof.proof.id} />
                        <select name="orderNo" defaultValue="" aria-label="Order this proof pays" required>
                          <option value="" disabled>
                            Choose the order...
                          </option>
                          {linkable.map((row) => (
                            <option key={row.order.orderNo} value={row.order.orderNo}>
                              {row.order.orderNo} · {row.order.customerName} · {row.order.currency} {displayMoney(row.order.totalAmount)}
                            </option>
                          ))}
                        </select>
                        <button className="btn btn-secondary btn-small" type="submit">
                          Link
                        </button>
                      </form>
                    ) : (
                      <span className="muted small">Finance can link it</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="card card-tight" data-testid="vendor-payments">
        <div className="card-title">Vendor payments due in the next 7 days ({vendorPayments.length})</div>
        <table className="table">
          <thead>
            <tr>
              <th>Vendor</th>
              <th>Vendor PO</th>
              <th>Due</th>
              <th className="right">Amount</th>
              <th>Reminders written</th>
            </tr>
          </thead>
          <tbody>
            {vendorPayments.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">
                  No vendor payment falls due in the next seven days.
                </td>
              </tr>
            ) : null}
            {vendorPayments.map((payment) => (
              <tr key={payment.poNumber}>
                <td>{payment.vendorName}</td>
                <td className="mono">{payment.poNumber}</td>
                <td>
                  {weekday(payment.dueDate)} {formatDate(payment.dueDate)}{" "}
                  <span className={payment.daysUntilDue <= 1 ? "badge badge-blocking" : "badge badge-neutral"}>{dueText(payment.daysUntilDue)}</span>
                </td>
                <td className="right">
                  {payment.currency} {displayMoney(payment.amount)}
                </td>
                <td className="small">
                  {payment.remindersWritten.length === 0 ? (
                    <span className="muted">
                      none yet (written {deps.config.vendorPaymentReminderDays.join(" and ")} days before the due date, when due jobs run)
                    </span>
                  ) : (
                    payment.remindersWritten.map((reminder) => (
                      <div key={reminder.daysBefore}>
                        <span className="badge badge-ok">{reminder.daysBefore}-day reminder</span> {formatDateTime(reminder.at)}
                      </div>
                    ))
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small" style={{ padding: "0 16px 12px" }}>
          From the purchase orders in Navision. Paying a vendor happens in Navision or the bank, not here; this list and its reminders only make sure it is not forgotten.
        </p>
      </div>
    </>
  );
}
