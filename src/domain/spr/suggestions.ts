// What: suggested SPRs: parts where open customer orders need more than the stock on hand.
// Who calls it: the SPR service, which gathers the open orders (Navision and OrderFlow), the stock and the SPRs already raised.
// To extend: the rule is one subtraction on purpose. If Navision can report reserved stock, subtract that here.

/** One open order line that still needs units of a part. */
export type DemandLine = { partNo: string; quantity: number; orderRef: string; customerName: string };

export type OpenSpr = { sprNo: string; partNo: string; quantity: number; status: string };

export type SprSuggestion = {
  partNo: string;
  /** Units still needed across all open orders. */
  demandQty: number;
  stockQty: number;
  /** demandQty minus stockQty: how many units are missing. */
  shortBy: number;
  /** Units already asked for in SPRs that are not rejected. */
  alreadyRequested: number;
  /** shortBy minus alreadyRequested, never below zero: what is left to request. */
  toRequest: number;
  orders: { orderRef: string; customerName: string; quantity: number }[];
  sprs: OpenSpr[];
};

/**
 * Pure: the same orders, stock and SPRs always give the same list.
 * Sorted by the largest shortage first, then by part number.
 */
export function suggestSprs(demand: DemandLine[], stockByPart: Record<string, number>, openSprs: OpenSpr[]): SprSuggestion[] {
  const byPart = new Map<string, DemandLine[]>();
  for (const line of demand) {
    if (line.quantity <= 0) continue;
    byPart.set(line.partNo, [...(byPart.get(line.partNo) ?? []), line]);
  }

  const suggestions: SprSuggestion[] = [];
  for (const [partNo, lines] of byPart) {
    const stockQty = stockByPart[partNo];
    if (stockQty === undefined) continue; // not a Navision item: nothing to compare with
    const demandQty = lines.reduce((sum, line) => sum + line.quantity, 0);
    const shortBy = demandQty - stockQty;
    if (shortBy <= 0) continue;
    const sprs = openSprs.filter((spr) => spr.partNo === partNo && spr.status !== "Rejected");
    const alreadyRequested = sprs.reduce((sum, spr) => sum + spr.quantity, 0);
    suggestions.push({
      partNo,
      demandQty,
      stockQty,
      shortBy,
      alreadyRequested,
      toRequest: Math.max(0, shortBy - alreadyRequested),
      orders: lines.map((line) => ({ orderRef: line.orderRef, customerName: line.customerName, quantity: line.quantity })),
      sprs,
    });
  }
  return suggestions.sort((a, b) => b.shortBy - a.shortBy || a.partNo.localeCompare(b.partNo));
}
