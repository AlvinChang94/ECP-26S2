// What: the payment status of an order (Awaiting, Proof received, Paid), days waiting, and the vendor payment calendar.
// Who calls it: the payments service and page, the order status rules, and runDueJobs (vendor payment reminders).
// To extend: "Paid" only ever comes from a Finance confirmation; never derive it from a proof or a match.
import type { NavPurchaseOrder } from "../navision";
import { businessDate, startOfBusinessDay, wholeDaysBetween } from "../time";

export type PaymentStatus = "not_invoiced" | "awaiting" | "proof_received" | "paid";

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  not_invoiced: "No PI yet",
  awaiting: "Awaiting",
  proof_received: "Proof received",
  paid: "Paid",
};

export type PaymentState = {
  status: PaymentStatus;
  /** Whole days since the PI was issued (or, once paid, how many days the payment took). Null before a PI exists. */
  daysWaiting: number | null;
};

export type PaymentFacts = {
  /** When the PI was issued (the order's first export). Null while the order is a draft. */
  piIssuedAt: Date | null;
  /** Set only when a Finance person confirmed that the money arrived. */
  paymentConfirmedAt: Date | null;
  /** True when at least one proof of payment is attached to the order. */
  hasProof: boolean;
};

/**
 * Paid needs a Finance confirmation. A proof, however well it matches, only makes the status "Proof received".
 * Invariant test: tests/invariants/paid-needs-finance.test.ts
 */
export function derivePaymentState(facts: PaymentFacts, now: Date): PaymentState {
  if (!facts.piIssuedAt) return { status: "not_invoiced", daysWaiting: null };
  if (facts.paymentConfirmedAt) return { status: "paid", daysWaiting: wholeDaysBetween(facts.piIssuedAt, facts.paymentConfirmedAt) };
  return { status: facts.hasProof ? "proof_received" : "awaiting", daysWaiting: wholeDaysBetween(facts.piIssuedAt, now) };
}

/** A customer is a late payer when the PI has been unpaid, with no proof, for at least `lateAfterDays` days. */
export function isLatePayer(state: PaymentState, lateAfterDays: number): boolean {
  return state.status === "awaiting" && state.daysWaiting !== null && state.daysWaiting >= lateAfterDays;
}

// ------------------------------------------------------------------------------------- vendor payment calendar

export type VendorPaymentDue = {
  poNumber: string;
  vendorName: string;
  currency: string;
  amount: string;
  dueDate: string; // YYYY-MM-DD
  /** Business days from today to the due date: 0 = due today, negative = overdue. */
  daysUntilDue: number;
};

function daysUntil(dueDate: string, now: Date): number {
  const today = startOfBusinessDay(businessDate(now));
  return Math.round((startOfBusinessDay(dueDate).getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
}

/** Unpaid vendor POs that are overdue or fall due within the next `windowDays` days, soonest first. */
export function vendorPaymentsDue(purchaseOrders: NavPurchaseOrder[], now: Date, windowDays = 7): VendorPaymentDue[] {
  return purchaseOrders
    .filter((order) => !order.paid)
    .map((order) => ({
      poNumber: order.poNumber,
      vendorName: order.vendorName,
      currency: order.currency,
      amount: order.totalAmount,
      dueDate: order.paymentDueDate,
      daysUntilDue: daysUntil(order.paymentDueDate, now),
    }))
    .filter((payment) => payment.daysUntilDue <= windowDays)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.poNumber.localeCompare(b.poNumber));
}

/**
 * Which "N days before" reminder is due now for a payment, or null.
 * With reminders at 3 and 1 days before: 3 days out gives 3, 2 days out gives 3 (still the current one),
 * 1 day out or the due day itself gives 1. Overdue payments get no further reminder here; they stay on the calendar.
 */
export function vendorReminderDue(payment: Pick<VendorPaymentDue, "daysUntilDue">, reminderDaysBefore: number[]): number | null {
  if (payment.daysUntilDue < 0) return null;
  const reached = reminderDaysBefore.filter((daysBefore) => payment.daysUntilDue <= daysBefore);
  return reached.length === 0 ? null : Math.min(...reached);
}
