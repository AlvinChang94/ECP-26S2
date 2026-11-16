// What: the payment status of an order as a badge: Awaiting, Proof received or Paid, with days waiting.
// Who calls it: the payments board, the payment page, the order dashboard and the order page.
// To extend: the status itself comes from derivePaymentState() in src/domain/payment/status.ts.
import { PAYMENT_STATUS_LABELS, type PaymentState } from "@/domain/payment/status";

const BADGE: Record<PaymentState["status"], string> = {
  not_invoiced: "badge-neutral",
  awaiting: "badge-warning",
  proof_received: "badge-info",
  paid: "badge-ok",
};

function days(count: number): string {
  return `${count} day${count === 1 ? "" : "s"}`;
}

export function PaymentBadge({ state, late }: { state: PaymentState; late?: boolean }) {
  const label = PAYMENT_STATUS_LABELS[state.status];
  let detail = "";
  if (state.daysWaiting !== null) {
    detail = state.status === "paid" ? ` · after ${days(state.daysWaiting)}` : ` · ${days(state.daysWaiting)} waiting`;
  }
  return (
    <span className={`badge ${late ? "badge-blocking" : BADGE[state.status]}`} data-testid="payment-status" data-status={state.status}>
      {label}
      {detail}
      {late ? " · late" : ""}
    </span>
  );
}
