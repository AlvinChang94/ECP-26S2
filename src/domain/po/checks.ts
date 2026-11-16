// What: the deterministic checks of a customer PO against Navision. Each finding becomes a flag with a code and a reason sentence.
// Who calls it: the PO review service (with live Navision lookups) and the golden test (with the golden Navision files).
// To extend: add a rule as a small function that returns flags and call it from checkCustomerPo. See the developer guide recipe.
import { lineKey } from "../fields";
import { type Flag, makeFlag } from "../flags";
import { displayMoney, moneyEquals, parseMoney, parseQuantity, percentDifference } from "../money";
import type { NavCustomer, NavItem } from "../navision";
import { parseDateText } from "../time";
import { activeLines, type CustomerPo, partialShipmentAllowed, type PoLine } from "./types";

/** What Navision (and the alias memory) knows about the part number written on one PO line. */
export type PoLineLookup = {
  /** The Navision item with exactly this part number, or null. */
  item: NavItem | null;
  /** The item a person mapped this part number to before (alias memory), if it still exists in Navision. */
  aliasItem: NavItem | null;
  /** Items whose number looks similar, best first. Only used as suggestions. */
  similar: NavItem[];
};

export type PoCheckContext = {
  customer: NavCustomer | null;
  /** True once a person has proposed a new customer card for this PO. */
  customerCardProposed: boolean;
  /** Lookup per line, keyed by the line's index. */
  lines: Record<number, PoLineLookup>;
  /** Other open orders that were captured with the same PO number from the same customer. */
  sameNumberOrders: { orderNo: string }[];
  /** The earlier version this document amends or cancels, when it was linked to an existing order. */
  previousVersion: { orderNo: string; revision: number } | null;
};

function lineLabel(line: PoLine): string {
  return `Line ${line.index + 1}`;
}

function checkHeader(po: CustomerPo, context: PoCheckContext): Flag[] {
  const flags: Flag[] = [];
  if (!po.poNumber) {
    flags.push(makeFlag({ code: "MISSING_FIELD", field: "poNumber", reason: "The PO number could not be read from the document. Type it in from the PDF." }));
  }
  if (!po.customerName) {
    flags.push(makeFlag({ code: "MISSING_FIELD", field: "customerName", reason: "The customer name could not be read from the document. Type it in from the PDF." }));
  } else if (!context.customer) {
    if (context.customerCardProposed) {
      flags.push(
        makeFlag({
          code: "NEW_CUSTOMER_CARD",
          field: "customerName",
          reason: `A new customer card for "${po.customerName}" will be written to Navision together with this order when you approve the export.`,
          values: [po.customerName],
        }),
      );
    } else {
      flags.push(
        makeFlag({
          code: "CUSTOMER_NOT_FOUND",
          field: "customerName",
          reason: `"${po.customerName}" is not a customer in Navision. Correct the name, or propose a new customer card (it is only created when you approve the export).`,
          values: [po.customerName],
        }),
      );
    }
  }
  return flags;
}

/** New PO, amendment or cancellation: is there an earlier order it clashes with or belongs to? */
function checkAgainstEarlierOrders(po: CustomerPo, context: PoCheckContext): Flag[] {
  const marking = po.poKindText ?? "";
  if (po.poKind === "new") {
    if (context.sameNumberOrders.length === 0 || !po.poNumber) return [];
    const others = context.sameNumberOrders.map((order) => order.orderNo).join(", ");
    return [
      makeFlag({
        code: "DUPLICATE_PO",
        field: "poNumber",
        reason: `PO number ${po.poNumber} was already captured as ${others}. If the customer changed the order it should be marked as an amendment; otherwise this may be the same PO sent twice.`,
        values: [po.poNumber, others],
      }),
    ];
  }
  if (!context.previousVersion) {
    return [
      makeFlag({
        code: "PREVIOUS_PO_NOT_FOUND",
        field: "poKind",
        reason: `This document is marked "${marking}", but no earlier PO with number ${po.poNumber ?? "(missing)"} has been captured. Check the PO number, or treat it as a new order.`,
        values: [marking, po.poNumber],
      }),
    ];
  }
  if (po.poKind === "amendment") {
    return [
      makeFlag({
        code: "PO_AMENDMENT",
        field: "poKind",
        reason: `This document is marked "${marking}" and amends ${context.previousVersion.orderNo}. Compare it with the earlier version before approving.`,
        values: [context.previousVersion.orderNo, context.previousVersion.revision],
      }),
    ];
  }
  return [
    makeFlag({
      code: "PO_CANCELLATION",
      field: "poKind",
      reason: `This document is marked "${marking}" and asks to cancel ${context.previousVersion.orderNo}. A person must confirm the cancellation.`,
      values: [context.previousVersion.orderNo],
    }),
  ];
}

/** Part number, quantity and unit price must be present and readable before anything else can be checked. */
function checkLineValues(line: PoLine): Flag[] {
  const flags: Flag[] = [];
  const label = lineLabel(line);
  if (!line.partNo) {
    flags.push(makeFlag({ code: "MISSING_FIELD", field: lineKey(line.index, "partNo"), reason: `${label}: the part number is missing. Type it in from the PDF.` }));
  }
  if (!line.quantity) {
    flags.push(makeFlag({ code: "MISSING_FIELD", field: lineKey(line.index, "quantity"), reason: `${label}: the quantity is missing. Type it in from the PDF.` }));
  } else {
    const quantity = parseQuantity(line.quantity);
    if (quantity === null || quantity <= 0) {
      flags.push(
        makeFlag({
          code: "INVALID_VALUE",
          field: lineKey(line.index, "quantity"),
          reason: `${label}: the quantity "${line.quantity}" is not a whole number above zero.`,
          values: [line.quantity],
        }),
      );
    }
  }
  if (!line.unitPrice) {
    flags.push(makeFlag({ code: "MISSING_FIELD", field: lineKey(line.index, "unitPrice"), reason: `${label}: the unit price is missing. Type it in from the PDF.` }));
  } else if (parseMoney(line.unitPrice) === null) {
    flags.push(
      makeFlag({
        code: "INVALID_VALUE",
        field: lineKey(line.index, "unitPrice"),
        reason: `${label}: the unit price "${line.unitPrice}" is not a valid amount.`,
        values: [line.unitPrice],
      }),
    );
  }
  return flags;
}

/** Is the part number a Navision item? If not: a remembered alias, a similar item, or nothing. */
function checkPartNumber(line: PoLine, lookup: PoLineLookup | undefined): Flag[] {
  if (!line.partNo || lookup?.item) return [];
  const field = lineKey(line.index, "partNo");
  const label = lineLabel(line);

  if (lookup?.aliasItem) {
    const target = lookup.aliasItem;
    return [
      makeFlag({
        code: "PART_ALIAS_SUGGESTED",
        field,
        reason: `${label}: part number ${line.partNo} is not in Navision. It was fixed to ${target.itemNo} (${target.description}) before and remembered. Confirm to use it again.`,
        values: [line.partNo, target.itemNo, "alias_memory"],
        suggestion: { label: `Use ${target.itemNo}`, field, value: target.itemNo, source: "alias_memory" },
        data: { written: line.partNo, suggested: target.itemNo, source: "alias_memory" },
      }),
    ];
  }
  const [best, ...others] = lookup?.similar ?? [];
  if (best) {
    const alternatives = others.length > 0 ? ` Other candidates: ${others.map((item) => item.itemNo).join(", ")}.` : "";
    return [
      makeFlag({
        code: "PART_ALIAS_SUGGESTED",
        field,
        reason: `${label}: part number ${line.partNo} is not in Navision. A similar item exists: ${best.itemNo} (${best.description}).${alternatives}`,
        values: [line.partNo, best.itemNo, "similar_part"],
        suggestion: { label: `Use ${best.itemNo}`, field, value: best.itemNo, source: "similar_part" },
        data: { written: line.partNo, suggested: best.itemNo, source: "similar_part" },
      }),
    ];
  }
  return [
    makeFlag({
      code: "PART_NOT_FOUND",
      field,
      reason: `${label}: part number ${line.partNo} is not in Navision and nothing similar was found. Check the part number with the customer.`,
      values: [line.partNo],
    }),
  ];
}

/** Exact decimal comparison of the PO unit price with the Navision sales price. */
function checkPrice(line: PoLine, item: NavItem, poCurrency: string | null): Flag[] {
  if (parseMoney(line.unitPrice) === null) return [];
  const field = lineKey(line.index, "unitPrice");
  const label = lineLabel(line);
  if (poCurrency && poCurrency.toUpperCase() !== item.currency.toUpperCase()) {
    return [
      makeFlag({
        code: "PRICE_MISMATCH",
        field,
        reason: `${label}: the PO is in ${poCurrency} but the Navision price for ${item.itemNo} is in ${item.currency}, so the prices cannot be compared. Check the currency.`,
        values: [line.unitPrice, item.price, poCurrency, item.currency],
      }),
    ];
  }
  if (moneyEquals(line.unitPrice, item.price)) return [];
  const percent = percentDifference(line.unitPrice, item.price);
  const direction = percent && percent.startsWith("-") ? `${percent.slice(1)}% lower` : `${percent}% higher`;
  return [
    makeFlag({
      code: "PRICE_MISMATCH",
      field,
      reason: `${label}: the PO unit price ${displayMoney(line.unitPrice)} differs from the Navision price ${displayMoney(item.price)} for ${item.itemNo} (${direction}). Change the price, or accept the difference with a reason, for example a special deal.`,
      values: [line.unitPrice, item.price],
      suggestion: { label: `Use ${displayMoney(item.price)}`, field, value: item.price, source: "navision" },
      data: { poPrice: line.unitPrice as string, navisionPrice: item.price, percent: percent ?? "" },
    }),
  ];
}

/** Adds up each part across the PO's lines and compares the total with the stock on hand. One flag per part. */
function checkStock(po: CustomerPo, context: PoCheckContext): Flag[] {
  const totals = new Map<string, { item: NavItem; ordered: number; firstLine: PoLine }>();
  for (const line of activeLines(po)) {
    const item = context.lines[line.index]?.item;
    const quantity = parseQuantity(line.quantity);
    if (!item || quantity === null || quantity <= 0) continue;
    const entry = totals.get(item.itemNo);
    if (entry) entry.ordered += quantity;
    else totals.set(item.itemNo, { item, ordered: quantity, firstLine: line });
  }
  const flags: Flag[] = [];
  for (const { item, ordered, firstLine } of totals.values()) {
    if (ordered <= item.stockQty) continue;
    const shortBy = ordered - item.stockQty;
    const partial = partialShipmentAllowed(po) ? ` The customer allows partial shipment, so ${item.stockQty} can ship now.` : "";
    flags.push(
      makeFlag({
        code: "QTY_EXCEEDS_STOCK",
        field: lineKey(firstLine.index, "quantity"),
        reason: `${item.itemNo}: ${ordered} ordered on this PO, ${item.stockQty} in stock: short by ${shortBy}.${partial} An SPR can be raised for the shortage.`,
        values: [item.itemNo, ordered, item.stockQty],
        followUp: { kind: "raise_spr", partNo: item.itemNo, quantity: shortBy },
        data: { itemNo: item.itemNo, ordered: String(ordered), stock: String(item.stockQty), shortBy: String(shortBy) },
      }),
    );
  }
  return flags;
}

/**
 * Checks a customer PO against Navision. Pure: the same PO and the same context always give the same flags,
 * and nothing is changed. Price and stock are only checked once a line's part number is a Navision item.
 */
export function checkCustomerPo(po: CustomerPo, context: PoCheckContext): Flag[] {
  const flags: Flag[] = [...checkHeader(po, context), ...checkAgainstEarlierOrders(po, context)];
  // A cancellation only needs to identify the order; its lines are not going to be exported.
  if (po.poKind === "cancellation") return flags;

  const lines = activeLines(po);
  if (lines.length === 0) {
    flags.push(makeFlag({ code: "MISSING_FIELD", field: "lines", reason: "No order lines could be read from the document. Add the lines from the PDF." }));
    return flags;
  }
  for (const line of lines) {
    const lookup = context.lines[line.index];
    flags.push(...checkLineValues(line), ...checkPartNumber(line, lookup));
    if (lookup?.item) flags.push(...checkPrice(line, lookup.item, po.currency));
  }
  flags.push(...checkStock(po, context));
  return flags;
}

/** Things a person must add before the order can be exported (not read from the document). */
export function checkExportReadiness(po: CustomerPo): Flag[] {
  if (po.poKind === "cancellation") return [];
  if (!po.promisedShipDate) {
    return [
      makeFlag({
        code: "MISSING_FIELD",
        field: "promisedShipDate",
        reason: "The promised ship date is not set. Enter the date agreed with the customer; it is written to Navision with the order.",
      }),
    ];
  }
  if (parseDateText(po.promisedShipDate) === null) {
    return [
      makeFlag({
        code: "INVALID_VALUE",
        field: "promisedShipDate",
        reason: `The promised ship date "${po.promisedShipDate}" is not a date. Use the form 2026-11-23 or 23 Nov 2026.`,
        values: [po.promisedShipDate],
      }),
    ];
  }
  return [];
}
