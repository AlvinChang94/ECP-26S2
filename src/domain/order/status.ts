// What: story 6. One pure function that works out an order's status, owner, delay reason, next action and ship-date risk from what stories 1 to 5 recorded.
// Who calls it: the order dashboard service (list, detail, ship-date alerts) and the KPI replay. It reads nothing itself: everything comes in as arguments.
// To extend: add a status to ORDER_STATUS_LABELS and a step to planSteps() at the place it should rank. See the developer guide recipe "add a status".
import type { Flag } from "../flags";
import type { PaymentStatus } from "../payment/status";
import { REQUIRED_DOCUMENTS, type ShipmentStatus } from "../shipment/assess";
import { addDays, endOfBusinessDay, formatDate, startOfBusinessDay } from "../time";

export type OrderStatus = "in_review" | "blocked" | "awaiting_payment" | "waiting_stock" | "ready_to_ship" | "partly_shipped" | "shipped" | "cancelled";

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  in_review: "PO in review",
  blocked: "Blocked",
  awaiting_payment: "Awaiting payment",
  waiting_stock: "Waiting for stock",
  ready_to_ship: "Ready to ship",
  partly_shipped: "Partly shipped",
  shipped: "Shipped",
  cancelled: "Cancelled",
};

/** A finding recorded by an earlier story, with where it was recorded and whether a person has dealt with it. */
export type OrderFlag = Pick<Flag, "code" | "severity" | "field" | "reason" | "data"> & {
  /** "po" = found on the customer PO (stories 1 and 2). "shipment" = found on a shipment (story 5). */
  source: "po" | "shipment";
  /** The shipment number for shipment findings, the order number for PO findings. */
  sourceRef: string;
  /** True when a person has overridden or resolved it. */
  decided: boolean;
};

/** Everything the dashboard needs to know about one order. All of it was recorded by stories 1 to 5; the dashboard adds nothing. */
export type OrderState = {
  orderNo: string;
  poNumber: string | null;
  customerName: string | null;
  cancelled: boolean;
  /** Story 2: an approved export exists, so the order is in Navision and its PI was issued. */
  exported: boolean;
  /** Story 2: a newer PO document from the customer is waiting for review on an already exported order. */
  pendingChange: "amendment" | "cancellation" | null;
  /** YYYY-MM-DD, set by a sales team member. This is the ship ETA the dashboard shows. */
  promisedShipDate: string | null;
  paymentTerms: "advance" | "credit";
  piNumber: string | null;
  /** Story 4. "paid" only ever means Finance confirmed it. */
  payment: PaymentStatus;
  daysWaitingForPayment: number | null;
  paymentLate: boolean;
  /** Story 2: delivered against ordered units. Null while nothing was exported. */
  fulfilment: { state: "none" | "partial" | "complete"; totalOrdered: number; totalDelivered: number } | null;
  /** Story 3: SPRs raised for this order. */
  sprs: { sprNo: string; status: string; assignedTo: string | null; partNo: string; quantity: number }[];
  /** Story 5: shipments that serve this order (incoming goods bought for it, and its outgoing shipment). */
  shipments: { shipmentNo: string; reference: string; direction: "inbound" | "outbound"; status: ShipmentStatus; assigneeName: string | null; goodsReceived: boolean }[];
  /** Who looks after each kind of work when nobody was assigned by name (from the staff directory). */
  people: { sales: string; finance: string; purchase: string };
};

/** One thing a named person has to do for the order. */
export type OrderTask = { title: string; assignee: string; href: string };

export type ShipRisk = "none" | "on_track" | "at_risk" | "late";

export const SHIP_RISK_LABELS: Record<ShipRisk, string> = { none: "", on_track: "On track", at_risk: "At risk", late: "Late" };

export type OrderStatusResult = {
  status: OrderStatus;
  label: string;
  /** Who has to act next. Null when nobody does (shipped or cancelled). */
  owner: string | null;
  /** Why the order is not moving, in plain language. Null when nothing holds it up. */
  blockerReason: string | null;
  nextAction: string;
  shipRisk: ShipRisk;
  shipRiskNote: string | null;
  /** Every open task for this order with its assignee; the first one is the next action. */
  tasks: OrderTask[];
};

export type OrderStatusSettings = {
  /** An order that is still not ready this many days before its promised ship date is "at risk". */
  shipDateAlertDays: number;
};

export const DEFAULT_ORDER_STATUS_SETTINGS: OrderStatusSettings = { shipDateAlertDays: 2 };

function count(number: number, noun: string): string {
  return `${number} ${noun}${number === 1 ? "" : "s"}`;
}

function openBlocking(flags: OrderFlag[], source: OrderFlag["source"], sourceRef?: string): OrderFlag[] {
  return flags.filter((flag) => flag.source === source && flag.severity === "blocking" && !flag.decided && (sourceRef === undefined || flag.sourceRef === sourceRef));
}

/** A step is one open piece of work. `status` says what the order's status is while this step is the most urgent one. */
type Step = { status: OrderStatus | null; task: OrderTask; reason: string | null };

/**
 * Lists the open work of an order, most urgent first. The order of the blocks below IS the ranking of statuses:
 * a PO still in review outranks everything, then anything blocked, then payment, then stock, then shipping.
 */
function planSteps(state: OrderState, flags: OrderFlag[]): Step[] {
  const steps: Step[] = [];
  const { people } = state;
  const orderPage = `/orders/${state.orderNo}`;

  // Stories 1 and 2: the customer PO has not been approved and exported yet.
  if (!state.exported) {
    const findings = openBlocking(flags, "po");
    steps.push({
      status: "in_review",
      task: {
        title:
          findings.length > 0
            ? `Fix or override ${count(findings.length, "finding")} on the customer PO`
            : state.promisedShipDate
              ? "Approve the export preview"
              : "Set the promised ship date and approve the export preview",
        assignee: people.sales,
        href: `${orderPage}/review`,
      },
      // The review page lists every finding; the dashboard quotes the first so the line stays readable.
      reason: findings.length > 0 ? `${count(findings.length, "finding")} on the customer PO. ${findings[0].reason}${findings.length > 1 ? ` (and ${findings.length - 1} more)` : ""}` : null,
    });
    return steps;
  }

  // Story 2: the customer changed or cancelled the PO after it was exported.
  if (state.pendingChange) {
    const what = state.pendingChange === "cancellation" ? "cancellation" : "amended PO";
    steps.push({
      status: "blocked",
      task: { title: `Review the customer's ${what}`, assignee: people.sales, href: `${orderPage}/review` },
      reason: `The customer sent ${state.pendingChange === "cancellation" ? "a cancellation" : "an amended PO"} that has not been reviewed yet.`,
    });
  }

  // Story 5: a shipment for this order has a quantity difference or a document due date that needs a person.
  for (const shipment of state.shipments.filter((candidate) => candidate.status === "needs_review")) {
    const findings = openBlocking(flags, "shipment", shipment.shipmentNo);
    steps.push({
      status: "blocked",
      task: {
        title: `Resolve ${count(findings.length, "finding")} on shipment ${shipment.shipmentNo} (${shipment.reference})`,
        assignee: shipment.assigneeName ?? (shipment.direction === "inbound" ? people.purchase : people.sales),
        href: `/shipments/${shipment.shipmentNo}`,
      },
      reason: findings.map((flag) => flag.reason).join(" ") || `Shipment ${shipment.shipmentNo} needs review.`,
    });
  }

  // Story 4: advance payment has not been confirmed by Finance.
  if (state.paymentTerms === "advance" && state.payment !== "paid") {
    const pi = state.piNumber ?? "the proforma invoice";
    const proofIn = state.payment === "proof_received";
    steps.push({
      status: "awaiting_payment",
      task: {
        title: proofIn ? `Check the bank and confirm the payment for ${pi}` : state.paymentLate ? `Review and send the payment reminder for ${pi}` : `Wait for the customer's payment for ${pi}`,
        assignee: people.finance,
        href: `/payments/${state.orderNo}`,
      },
      reason: proofIn
        ? `A proof of payment for ${pi} has arrived, but Finance has not yet confirmed that the money is in the bank.`
        : `Payment for ${pi} has not arrived${state.daysWaitingForPayment === null ? "" : ` (${count(state.daysWaitingForPayment, "day")} waiting)`}.`,
    });
  }

  // Story 3: an SPR raised for this order is still waiting for the approver.
  for (const spr of state.sprs.filter((candidate) => candidate.status === "Submitted")) {
    const approver = spr.assignedTo ?? "the approver";
    steps.push({
      status: "waiting_stock",
      task: { title: `Approve or reject ${spr.sprNo} (${spr.quantity} x ${spr.partNo})`, assignee: approver, href: `/spr/${spr.sprNo}` },
      reason: `${spr.sprNo} (${spr.quantity} x ${spr.partNo}) for this order is waiting for ${approver}'s decision.`,
    });
  }

  // Story 5: goods bought for this order are tracked but Navision has no goods receipt for them yet.
  for (const shipment of state.shipments.filter((candidate) => candidate.direction === "inbound" && !candidate.goodsReceived && candidate.status !== "needs_review")) {
    steps.push({
      status: "waiting_stock",
      task: { title: `Follow up the incoming shipment ${shipment.shipmentNo} (${shipment.reference})`, assignee: shipment.assigneeName ?? people.purchase, href: `/shipments/${shipment.shipmentNo}` },
      reason: `Goods on vendor PO ${shipment.reference} have not been received yet.`,
    });
  }

  // Story 5: documents that are missing but not yet due are work for someone, without changing the order's status.
  for (const shipment of state.shipments.filter((candidate) => candidate.status === "waiting")) {
    const missing = flags.filter((flag) => flag.source === "shipment" && flag.sourceRef === shipment.shipmentNo && flag.code === "DOCUMENT_MISSING" && !flag.decided);
    if (missing.length === 0) continue;
    const labels = missing.map((flag) => REQUIRED_DOCUMENTS.find((required) => required.key === flag.field)?.label ?? flag.field);
    steps.push({
      status: null,
      task: {
        title: `Get the missing ${labels.join(", ")} for shipment ${shipment.shipmentNo} (${shipment.reference})`,
        assignee: shipment.assigneeName ?? (shipment.direction === "inbound" ? people.purchase : people.sales),
        href: `/shipments/${shipment.shipmentNo}`,
      },
      reason: null,
    });
  }

  // Nothing holds the order up: it can ship (or the rest of it can).
  if (!steps.some((step) => step.status !== null)) {
    const fulfilment = state.fulfilment;
    const partly = fulfilment?.state === "partial";
    const remaining = fulfilment ? fulfilment.totalOrdered - fulfilment.totalDelivered : 0;
    steps.unshift({
      status: partly ? "partly_shipped" : "ready_to_ship",
      task: {
        title: partly ? `Ship the remaining ${count(remaining, "unit")} and record the delivery` : "Warehouse packs and ships; record the delivery on the order page",
        assignee: people.sales,
        href: orderPage,
      },
      reason: partly ? `${remaining} of ${fulfilment?.totalOrdered ?? 0} units have not shipped yet.` : null,
    });
  }
  return steps;
}

function riskOf(state: OrderState, status: OrderStatus, now: Date, settings: OrderStatusSettings): { shipRisk: ShipRisk; shipRiskNote: string | null } {
  if (status === "cancelled" || status === "shipped") return { shipRisk: "none", shipRiskNote: null };
  if (!state.promisedShipDate) return { shipRisk: "none", shipRiskNote: "No promised ship date has been set yet." };
  const date = formatDate(state.promisedShipDate);
  if (now.getTime() >= endOfBusinessDay(state.promisedShipDate).getTime()) {
    return { shipRisk: "late", shipRiskNote: `The promised ship date ${date} has passed and the order has not fully shipped.` };
  }
  if (status === "blocked") return { shipRisk: "at_risk", shipRiskNote: `The order is blocked and is promised to ship on ${date}.` };
  const windowStart = addDays(startOfBusinessDay(state.promisedShipDate), -settings.shipDateAlertDays);
  if (status !== "ready_to_ship" && now.getTime() >= windowStart.getTime()) {
    return { shipRisk: "at_risk", shipRiskNote: `Promised to ship on ${date} and still "${ORDER_STATUS_LABELS[status]}".` };
  }
  return { shipRisk: "on_track", shipRiskNote: null };
}

/**
 * The order dashboard's one rule. The same state, flags and time always give the same answer.
 * It only reads what stories 1 to 5 recorded: it never changes an order and it has no data of its own.
 */
export function deriveOrderStatus(
  state: OrderState,
  flags: OrderFlag[],
  now: Date,
  settings: OrderStatusSettings = DEFAULT_ORDER_STATUS_SETTINGS,
): OrderStatusResult {
  if (state.cancelled) {
    return { status: "cancelled", label: ORDER_STATUS_LABELS.cancelled, owner: null, blockerReason: null, nextAction: "None: the order was cancelled.", shipRisk: "none", shipRiskNote: null, tasks: [] };
  }
  if (state.fulfilment?.state === "complete") {
    return { status: "shipped", label: ORDER_STATUS_LABELS.shipped, owner: null, blockerReason: null, nextAction: "None: every unit has been delivered.", shipRisk: "none", shipRiskNote: null, tasks: [] };
  }

  const steps = planSteps(state, flags);
  // planSteps always returns at least one step that sets a status for an order that is neither cancelled nor shipped.
  const lead = steps.find((step) => step.status !== null) ?? steps[0];
  const status = lead.status ?? "ready_to_ship";
  return {
    status,
    label: ORDER_STATUS_LABELS[status],
    owner: lead.task.assignee,
    blockerReason: lead.reason,
    nextAction: lead.task.title,
    ...riskOf(state, status, now, settings),
    tasks: [lead.task, ...steps.filter((step) => step !== lead).map((step) => step.task)],
  };
}

// ------------------------------------------------------------------------------------- customer-ready update

/** A finding in words a customer can be told: "5 units short", "AWB or BL pending". */
function customerPhrase(flag: OrderFlag): string {
  if (flag.code === "QTY_VARIANCE") {
    const difference = Number(flag.data?.difference ?? "0");
    return difference < 0 ? `${count(-difference, "unit")} short` : "a quantity difference is being checked";
  }
  if (flag.code === "INVOICE_PART_MISMATCH") return "a part number is being checked";
  if (flag.code === "DOCUMENT_DUE_SOON" || flag.code === "DOCUMENT_OVERDUE" || flag.code === "DOCUMENT_MISSING") {
    return `${REQUIRED_DOCUMENTS.find((required) => required.key === flag.field)?.label ?? "a document"} pending`;
  }
  return "a check is in progress";
}

/**
 * One line a sales team member can send to the customer, built from a fixed template per status.
 * Example: "Shipment at risk: 5 units short; AWB or BL pending. Promised ship date: 18 Nov 2026."
 */
export function customerUpdate(state: OrderState, result: OrderStatusResult, flags: OrderFlag[]): string {
  const po = state.poNumber ? `your PO ${state.poNumber}` : "your PO";
  const pi = state.piNumber ?? "the proforma invoice";
  let line: string;
  switch (result.status) {
    case "cancelled":
      return `Order ${state.orderNo} (${po}) has been cancelled.`;
    case "shipped":
      return `Order ${state.orderNo} (${po}) has shipped in full.`;
    case "in_review":
      line = `We have received ${po} and are checking it.`;
      break;
    case "awaiting_payment":
      line =
        state.payment === "proof_received"
          ? `We have received your proof of payment for ${pi} and are confirming it with our bank.`
          : `Proforma invoice ${pi} has been sent. Your order ships once payment is received.`;
      break;
    case "blocked": {
      const findings = flags.filter((flag) => flag.source === "shipment" && flag.severity === "blocking" && !flag.decided);
      if (findings.length > 0) line = `Shipment at risk: ${findings.map(customerPhrase).join("; ")}.`;
      else if (state.pendingChange === "cancellation") line = "We have received your cancellation request and are reviewing it.";
      else line = "We have received your amended PO and are reviewing it.";
      break;
    }
    case "waiting_stock":
      line = "Part of your order is being purchased from our supplier. We will confirm the ship date.";
      break;
    case "partly_shipped":
      line = `${state.fulfilment?.totalDelivered ?? 0} of ${state.fulfilment?.totalOrdered ?? 0} units have shipped. The rest will follow.`;
      break;
    case "ready_to_ship":
      line = "Payment received. Your order is being prepared for shipment.";
      break;
  }
  if (!state.promisedShipDate) return line;
  return result.shipRisk === "late"
    ? `${line} We have passed the promised ship date of ${formatDate(state.promisedShipDate)} and will confirm a new date.`
    : `${line} Promised ship date: ${formatDate(state.promisedShipDate)}.`;
}

// ------------------------------------------------------------------------------------- summary tiles

export type DashboardTiles = { open: number; blocked: number; shipDateAtRisk: number; shipDateLate: number; awaitingPayment: number; readyToShip: number };

/** The numbers on the dashboard tiles, counted from the same derived statuses the list shows. */
export function summarizeOrders(results: Pick<OrderStatusResult, "status" | "shipRisk">[]): DashboardTiles {
  const countWhere = (test: (result: Pick<OrderStatusResult, "status" | "shipRisk">) => boolean): number => results.filter(test).length;
  return {
    open: countWhere((result) => result.status !== "cancelled" && result.status !== "shipped"),
    blocked: countWhere((result) => result.status === "blocked"),
    shipDateAtRisk: countWhere((result) => result.shipRisk === "at_risk"),
    shipDateLate: countWhere((result) => result.shipRisk === "late"),
    awaitingPayment: countWhere((result) => result.status === "awaiting_payment"),
    readyToShip: countWhere((result) => result.status === "ready_to_ship" || result.status === "partly_shipped"),
  };
}
