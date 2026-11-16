// What: partial fulfilment: ordered, delivered and remaining quantity per part of an exported order.
// Who calls it: the order page, the delivery service (to stop over-delivery) and the order status rules.
// To extend: deliveries are recorded by a person; if Navision later reports shipped quantities, feed them in as deliveries.

export type OrderedLine = { itemNo: string; description: string; quantity: number };
export type DeliveryEntry = { partNo: string; quantity: number };

export type FulfilmentLine = { itemNo: string; description: string; ordered: number; delivered: number; remaining: number };

export type Fulfilment = {
  lines: FulfilmentLine[];
  totalOrdered: number;
  totalDelivered: number;
  /** none = nothing delivered yet, partial = some delivered, complete = everything delivered. */
  state: "none" | "partial" | "complete";
};

export function summarizeFulfilment(ordered: OrderedLine[], deliveries: DeliveryEntry[]): Fulfilment {
  // The same part on two lines counts as one total, because deliveries are recorded per part.
  const byPart = new Map<string, FulfilmentLine>();
  for (const line of ordered) {
    const entry = byPart.get(line.itemNo);
    if (entry) entry.ordered += line.quantity;
    else byPart.set(line.itemNo, { itemNo: line.itemNo, description: line.description, ordered: line.quantity, delivered: 0, remaining: 0 });
  }
  for (const delivery of deliveries) {
    const entry = byPart.get(delivery.partNo);
    if (entry) entry.delivered += delivery.quantity;
  }
  const lines = [...byPart.values()].map((line) => ({ ...line, remaining: Math.max(0, line.ordered - line.delivered) }));
  const totalOrdered = lines.reduce((sum, line) => sum + line.ordered, 0);
  const totalDelivered = lines.reduce((sum, line) => sum + Math.min(line.delivered, line.ordered), 0);
  const state = totalDelivered === 0 ? "none" : totalDelivered >= totalOrdered ? "complete" : "partial";
  return { lines, totalOrdered, totalDelivered, state };
}

/** Why a delivery cannot be recorded, or null when it is fine. */
export function validateDelivery(fulfilment: Fulfilment, partNo: string, quantity: number): string | null {
  const line = fulfilment.lines.find((candidate) => candidate.itemNo === partNo);
  if (!line) return `${partNo} is not on this order.`;
  if (!Number.isInteger(quantity) || quantity <= 0) return "The delivered quantity must be a whole number above zero.";
  if (quantity > line.remaining) return `Only ${line.remaining} of ${partNo} remain to be delivered; ${quantity} is too many.`;
  return null;
}
