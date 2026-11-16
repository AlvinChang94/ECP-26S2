// What: partial fulfilment of an exported order: record a delivery and show delivered and remaining quantities.
// Who calls it: the order page and its actions; the order status rules read the result.
// To extend: if Navision later reports shipped quantities, read them here instead of (or as well as) the Delivery table.
import type { Actor } from "@/domain/audit";
import { type Fulfilment, summarizeFulfilment, validateDelivery } from "@/domain/po/fulfilment";
import { recordAudit } from "./audit";
import type { Deps } from "./deps";
import { requireThat, UserError } from "./errors";
import { getOrder } from "./orders";
import { exportedOrderFile } from "./poExport";

/** Ordered, delivered and remaining per part. Null while the order has not been exported. */
export async function getFulfilment(deps: Pick<Deps, "db">, orderNo: string): Promise<Fulfilment | null> {
  const file = await exportedOrderFile(deps, orderNo);
  if (!file) return null;
  const deliveries = await deps.db.delivery.findMany({ where: { orderNo }, orderBy: { recordedAt: "asc" } });
  return summarizeFulfilment(
    file.lines.map((line) => ({ itemNo: line.itemNo, description: line.description, quantity: line.quantity })),
    deliveries.map((delivery) => ({ partNo: delivery.partNo, quantity: delivery.quantity })),
  );
}

export async function listDeliveries(deps: Pick<Deps, "db">, orderNo: string) {
  return deps.db.delivery.findMany({ where: { orderNo }, orderBy: { recordedAt: "asc" } });
}

/** A person records that some units of a part were delivered. Never more than what remains. */
export async function recordDelivery(
  deps: Pick<Deps, "db" | "clock">,
  actor: Actor,
  input: { orderNo: string; partNo: string; quantity: number | null; note: string | null },
): Promise<void> {
  requireThat(actor.role === "sales" || actor.role === "purchase" || actor.role === "system", "Only a sales or purchase team member can record a delivery.");
  const order = await getOrder(deps, input.orderNo);
  requireThat(order.status === "open", `${input.orderNo} is cancelled, so no delivery can be recorded.`);
  const fulfilment = await getFulfilment(deps, input.orderNo);
  requireThat(fulfilment, `${input.orderNo} has not been exported yet, so nothing can be delivered.`);
  requireThat(input.quantity !== null, "Type the delivered quantity as a whole number.");
  const problem = validateDelivery(fulfilment, input.partNo, input.quantity);
  if (problem) throw new UserError(problem);

  await deps.db.delivery.create({
    data: { orderNo: input.orderNo, partNo: input.partNo, quantity: input.quantity, note: input.note, recordedBy: actor.name, recordedAt: deps.clock.now() },
  });
  const line = fulfilment.lines.find((candidate) => candidate.itemNo === input.partNo);
  const remaining = (line?.remaining ?? 0) - input.quantity;
  await recordAudit(deps, {
    actor,
    action: "delivery_recorded",
    entityType: "order",
    entityId: input.orderNo,
    orderNo: input.orderNo,
    field: input.partNo,
    newValue: String(input.quantity),
    reason: input.note,
    summary: `${actor.name} recorded delivery of ${input.quantity} x ${input.partNo}. Remaining: ${remaining}.`,
  });
}
