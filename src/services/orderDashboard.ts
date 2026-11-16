// What: story 6. Gathers what stories 1 to 5 recorded about an order and hands it to deriveOrderStatus(). Also sends ship-date alerts.
// Who calls it: the order dashboard page, the order page, runDueJobs (ship-date alerts) and the KPI replay.
// To extend: this file only collects facts. The rules (status, owner, next action, risk) are in src/domain/order/status.ts.
import type { OrderRow } from "@/adapters/db";
import { SYSTEM_ACTOR } from "@/domain/audit";
import type { StaffMember } from "@/domain/navision";
import { buildShipDateAlert, shipDateAlertKey } from "@/domain/notifications";
import {
  customerUpdate,
  type DashboardTiles,
  deriveOrderStatus,
  type OrderFlag,
  type OrderState,
  type OrderStatus,
  type OrderStatusResult,
  type ShipRisk,
  summarizeOrders,
} from "@/domain/order/status";
import { derivePaymentState, isLatePayer } from "@/domain/payment/status";
import { addDays, businessDate } from "@/domain/time";
import { recordAudit } from "./audit";
import type { Deps } from "./deps";
import { getFulfilment } from "./fulfilment";
import { getOrder } from "./orders";
import { loadPoReview } from "./poReview";
import { listShipments, type ShipmentView } from "./shipments";

type DashboardDeps = Pick<Deps, "db" | "navision" | "config" | "clock">;

export type OrderOverview = {
  order: OrderRow;
  /** The facts the status was derived from (kept so a page can show them and a test can check them). */
  state: OrderState;
  flags: OrderFlag[];
  result: OrderStatusResult;
  /** One line a sales team member can send to the customer. */
  customerUpdate: string;
  /** Shipments that serve this order, for links on the order page. */
  shipments: ShipmentView[];
};

/** Things that are the same for every order in one request, read once. */
type Context = { now: Date; shipments: ShipmentView[]; staff: StaffMember[]; people: OrderState["people"] };

async function loadContext(deps: DashboardDeps, now: Date): Promise<Context> {
  const staff = (await deps.navision.getStaffDirectory()).staff;
  const nameOf = (role: StaffMember["role"], fallback: string): string => staff.find((member) => member.role === role)?.name ?? fallback;
  return {
    now,
    shipments: await listShipments(deps, now),
    staff,
    people: { sales: nameOf("sales", "Sales team"), finance: nameOf("finance", "Finance"), purchase: nameOf("purchase", "Purchase team") },
  };
}

async function buildOverview(deps: DashboardDeps, order: OrderRow, context: Context): Promise<OrderOverview> {
  const { now } = context;
  const exported = order.exportedAt !== null;
  const current = order.currentPoVersionId ? await deps.db.poVersion.findUnique({ where: { id: order.currentPoVersionId } }) : null;
  const draftOpen = order.status === "open" && current?.status === "draft";
  const flags: OrderFlag[] = [];

  // Stories 1 and 2: findings on a PO that is still a draft (a new PO, or an amendment of an exported one).
  let salesOwner = context.people.sales;
  if (current) {
    const document = await deps.db.document.findUnique({ where: { id: current.documentId } });
    // The sales team member who confirmed the PO looks after the order.
    const confirmedBy = context.staff.find((member) => member.role === "sales" && member.name === document?.confirmedBy);
    if (confirmedBy) salesOwner = confirmedBy.name;
  }
  if (draftOpen) {
    const review = await loadPoReview(deps, order.orderNo);
    for (const flag of review.flags) {
      flags.push({ code: flag.code, severity: flag.severity, field: flag.field, reason: flag.reason, data: flag.data, source: "po", sourceRef: order.orderNo, decided: flag.decision !== null });
    }
  }

  // Story 4: payment. "paid" comes only from Finance's confirmation on the order row.
  const hasProof = exported ? (await deps.db.paymentProof.count({ where: { orderNo: order.orderNo } })) > 0 : false;
  const payment = derivePaymentState({ piIssuedAt: order.piIssuedAt, paymentConfirmedAt: order.paymentConfirmedAt, hasProof }, now);

  // Story 2: delivered against ordered.
  const fulfilment = exported ? await getFulfilment(deps, order.orderNo) : null;

  // Story 3: SPRs raised for this order.
  const sprs = await deps.db.spr.findMany({ where: { sourceOrderNo: order.orderNo }, orderBy: { sprNo: "asc" } });

  // Story 5: shipments that serve this order, with their findings.
  const shipments = context.shipments.filter((view) => view.orderNo === order.orderNo);
  for (const view of shipments) {
    for (const flag of view.flags) {
      flags.push({ code: flag.code, severity: flag.severity, field: flag.field, reason: flag.reason, data: flag.data, source: "shipment", sourceRef: view.shipment.shipmentNo, decided: flag.decision !== null });
    }
  }

  const state: OrderState = {
    orderNo: order.orderNo,
    poNumber: order.poNumber,
    customerName: order.customerName,
    cancelled: order.status === "cancelled",
    exported,
    pendingChange: exported && draftOpen ? (current?.kind === "cancellation" ? "cancellation" : "amendment") : null,
    promisedShipDate: order.promisedShipDate,
    paymentTerms: order.paymentTerms === "credit" ? "credit" : "advance",
    piNumber: order.piNumber,
    payment: payment.status,
    daysWaitingForPayment: payment.daysWaiting,
    paymentLate: isLatePayer(payment, deps.config.latePaymentAfterDays),
    fulfilment: fulfilment ? { state: fulfilment.state, totalOrdered: fulfilment.totalOrdered, totalDelivered: fulfilment.totalDelivered } : null,
    sprs: sprs.map((spr) => ({ sprNo: spr.sprNo, status: spr.status, assignedTo: spr.assignedTo, partNo: spr.partNo, quantity: spr.quantity })),
    shipments: shipments.map((view) => ({
      shipmentNo: view.shipment.shipmentNo,
      reference: view.reference,
      direction: view.direction,
      status: view.status,
      assigneeName: view.shipment.assigneeName,
      goodsReceived: view.direction === "outbound" || view.goodsReceipt !== null,
    })),
    people: { ...context.people, sales: salesOwner },
  };
  const result = deriveOrderStatus(state, flags, now, { shipDateAlertDays: deps.config.shipDateAlertDays });
  return { order, state, flags, result, customerUpdate: customerUpdate(state, result, flags), shipments };
}

/** Status, owner, next action, risk and tasks of one order. */
export async function getOrderOverview(deps: DashboardDeps, orderNo: string): Promise<OrderOverview> {
  const order = await getOrder(deps, orderNo);
  return buildOverview(deps, order, await loadContext(deps, deps.clock.now()));
}

export type DashboardFilter = {
  /** Matches the order number, the customer name, the customer's PO number or the PI number. */
  search?: string | null;
  /** One status, "open" (everything not shipped or cancelled), "risk" (ship date at risk or passed) or "all". */
  status?: string | null;
};

export type OrderDashboard = {
  rows: OrderOverview[];
  /** How many orders exist before the filter was applied. */
  totalOrders: number;
  /** Counted over every order, not just the filtered rows. */
  tiles: DashboardTiles;
  /** Open tasks per person, over every order: who has how much to do. */
  tasksByPerson: { assignee: string; tasks: number; orders: number }[];
};

const RISK_ORDER: Record<ShipRisk, number> = { late: 0, at_risk: 1, on_track: 2, none: 3 };
const STATUS_ORDER: Record<OrderStatus, number> = { blocked: 0, in_review: 1, awaiting_payment: 2, waiting_stock: 3, partly_shipped: 4, ready_to_ship: 5, shipped: 6, cancelled: 7 };

function matchesFilter(overview: OrderOverview, filter: DashboardFilter): boolean {
  const { order, result } = overview;
  const status = filter.status || "all";
  if (status === "open" && (result.status === "shipped" || result.status === "cancelled")) return false;
  if (status === "risk" && result.shipRisk !== "at_risk" && result.shipRisk !== "late") return false;
  if (status !== "all" && status !== "open" && status !== "risk" && result.status !== status) return false;
  const search = (filter.search ?? "").trim().toLowerCase();
  if (!search) return true;
  return [order.orderNo, order.customerName, order.poNumber, order.piNumber].some((value) => (value ?? "").toLowerCase().includes(search));
}

/** The order dashboard: every order with its derived status. Closed orders sink to the bottom, urgent ones rise to the top. */
export async function getOrderDashboard(deps: DashboardDeps, filter: DashboardFilter = {}): Promise<OrderDashboard> {
  const context = await loadContext(deps, deps.clock.now());
  const orders = await deps.db.order.findMany({ orderBy: { orderNo: "asc" } });
  const all: OrderOverview[] = [];
  for (const order of orders) all.push(await buildOverview(deps, order, context));

  const closed = (overview: OrderOverview): number => (overview.result.status === "shipped" || overview.result.status === "cancelled" ? 1 : 0);
  all.sort(
    (a, b) =>
      closed(a) - closed(b) ||
      RISK_ORDER[a.result.shipRisk] - RISK_ORDER[b.result.shipRisk] ||
      STATUS_ORDER[a.result.status] - STATUS_ORDER[b.result.status] ||
      (a.order.promisedShipDate ?? "9999").localeCompare(b.order.promisedShipDate ?? "9999") ||
      a.order.orderNo.localeCompare(b.order.orderNo),
  );

  const perPerson = new Map<string, { tasks: number; orders: Set<string> }>();
  for (const overview of all) {
    for (const task of overview.result.tasks) {
      const entry = perPerson.get(task.assignee) ?? { tasks: 0, orders: new Set<string>() };
      entry.tasks++;
      entry.orders.add(overview.order.orderNo);
      perPerson.set(task.assignee, entry);
    }
  }
  return {
    rows: all.filter((overview) => matchesFilter(overview, filter)),
    totalOrders: all.length,
    tiles: summarizeOrders(all.map((overview) => overview.result)),
    tasksByPerson: [...perPerson.entries()]
      .map(([assignee, entry]) => ({ assignee, tasks: entry.tasks, orders: entry.orders.size }))
      .sort((a, b) => b.tasks - a.tasks || a.assignee.localeCompare(b.assignee)),
  };
}

// ------------------------------------------------------------------------------------- ship-date alerts

/**
 * Run by runDueJobs: when an order is inside the alert window before its promised ship date (or past it) and is still
 * not ready or shipped, the person who has to act next is told once. This is a reminder; it changes nothing on the order.
 */
export async function shipDateAlertSweep(deps: Deps, now: Date): Promise<string[]> {
  const lines: string[] = [];
  // Only orders whose promised ship date is close enough (or already past) can need an alert.
  const cutoff = businessDate(addDays(now, deps.config.shipDateAlertDays));
  const candidates = await deps.db.order.findMany({ where: { status: "open", promisedShipDate: { not: null, lte: cutoff } }, orderBy: { orderNo: "asc" } });
  let context: Context | null = null;

  for (const order of candidates) {
    if (!order.promisedShipDate) continue;
    // One alert per order and promised date. Checked first because it is cheap.
    const alreadySent = await deps.db.outboxMessage.findUnique({ where: { dedupeKey: shipDateAlertKey(order.orderNo, order.promisedShipDate) } });
    if (alreadySent) continue;
    // Fully delivered orders need no alert (also cheap, and most old orders are in this group).
    if ((await getFulfilment(deps, order.orderNo))?.state === "complete") continue;

    context ??= await loadContext(deps, now);
    const overview = await buildOverview(deps, order, context);
    const { result } = overview;
    if (result.shipRisk !== "at_risk" && result.shipRisk !== "late") continue;

    // The alert goes to whoever has to act next; if that is not a member of staff we know, to the order's sales team member.
    const recipient = context.staff.find((member) => member.name === result.owner) ?? context.staff.find((member) => member.name === overview.state.people.sales);
    if (!recipient) continue;
    const sent = await deps.notifier.send(
      buildShipDateAlert(recipient, {
        orderNo: order.orderNo,
        customerName: order.customerName ?? "",
        promisedShipDate: order.promisedShipDate,
        statusLabel: result.label,
        blockerReason: result.blockerReason,
        nextAction: result.nextAction,
      }),
    );
    if (sent.duplicate) continue;
    const line = `${order.orderNo}: ship-date alert sent to ${recipient.name} (${result.label}, promised ${order.promisedShipDate}).`;
    lines.push(line);
    await recordAudit(deps, {
      actor: SYSTEM_ACTOR,
      action: "ship_date_alert",
      entityType: "order",
      entityId: order.orderNo,
      orderNo: order.orderNo,
      summary: `Ship-date alert sent to ${recipient.name}: ${order.orderNo} is "${result.label}" and is promised to ship on ${order.promisedShipDate}.`,
    });
  }
  return lines;
}
