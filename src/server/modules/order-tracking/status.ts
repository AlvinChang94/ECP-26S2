import { defineStateMachine } from "@/server/engine";

export const ORDER_STATUSES = [
  "RECEIVED",
  "CONFIRMED",
  "DELIVERED",
  "INVOICED",
  "PENDING_APPROVAL",
  "CLOSED",
  "CANCELLED",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export type OrderEvidence =
  | "CUSTOMER_PO"
  | "VENDOR_CONFIRMATION"
  | "DELIVERY_ORDER"
  | "INVOICE"
  | "NO_OPEN_FINDINGS"
  | "APPROVAL";

/**
 * Example order lifecycle for the dashboard. An order with open findings goes to
 * PENDING_APPROVAL; it can only close once the findings are cleared or approved.
 */
export const orderStatusMachine = defineStateMachine<OrderStatus, OrderEvidence>({
  states: ORDER_STATUSES,
  initial: "RECEIVED",
  transitions: [
    { from: "RECEIVED", to: "CONFIRMED", requires: ["CUSTOMER_PO", "VENDOR_CONFIRMATION"] },
    { from: "CONFIRMED", to: "DELIVERED", requires: ["DELIVERY_ORDER"] },
    { from: "DELIVERED", to: "INVOICED", requires: ["INVOICE"] },
    { from: "INVOICED", to: "CLOSED", requires: ["NO_OPEN_FINDINGS"] },
    { from: "INVOICED", to: "PENDING_APPROVAL" },
    { from: "PENDING_APPROVAL", to: "CLOSED", requires: ["APPROVAL"] },
    { from: ["RECEIVED", "CONFIRMED"], to: "CANCELLED" },
  ],
});
