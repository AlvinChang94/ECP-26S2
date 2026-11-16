// What: generates about 60 synthetic orders and 20 goods receipts spread over six simulated months, with baseline timestamps.
// Who calls it: scripts/generate-sample-data.ts writes the result to data/replay; scripts/replay.ts measures the KPIs from it.
// To extend: change the probabilities below. Every number here is invented test data, not a measurement of Spectra.
import Decimal from "decimal.js";
import type { NavGoodsReceipt, NavItem, NavPurchaseOrder } from "../../src/domain/navision";
import { formatMoney, toMoney } from "../../src/domain/money";
import { customerBlock } from "./golden";
import { CUSTOMERS, ITEMS, itemByNo, SELLER_NAME, SYNTHETIC_NOTE, UNKNOWN_CUSTOMERS, VENDORS } from "./master";
import { type PricedLine, renderCustomerPo, renderInvoice, renderPackingList } from "./pdfs";
import type { ReplayFile, ReplayOrder, ReplayReceipt, ReplaySeededError } from "./replayTypes";
import { createRng, type Rng } from "./rng";

export const REPLAY_SEED = "spectra-orderflow-replay-v1";
const PERIOD_START = new Date("2026-05-18T00:00:00.000Z"); // a Monday
const PERIOD_END = "2026-11-15";
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export type ReplayDataset = {
  file: ReplayFile;
  files: { path: string; bytes: Uint8Array }[];
  purchaseOrders: NavPurchaseOrder[];
  goodsReceipts: NavGoodsReceipt[];
};

/** A business-hours timestamp (09:00 to 17:59 Singapore time) on a weekday on or after `dayIndex` days from the start. */
function businessTime(rng: Rng, dayIndex: number): Date {
  let date = new Date(PERIOD_START.getTime() + dayIndex * DAY);
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) date = new Date(date.getTime() + DAY);
  // 09:00 SGT is 01:00 UTC.
  return new Date(date.getTime() + (1 + rng.int(0, 8)) * HOUR + rng.int(0, 59) * 60 * 1000);
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** "AB1234X" -> "AB-1234X", "CD-77" -> "CD77": how a customer might write the same part number. */
function aliasSpelling(itemNo: string): string {
  if (itemNo.includes("-")) return itemNo.replace("-", "");
  const match = /^([A-Z]+)(\d.*)$/.exec(itemNo);
  return match ? `${match[1]}-${match[2]}` : `${itemNo}-A`;
}

const UNLISTED_PARTS = ["ZX-9907", "QQ-00417", "VV-3105", "JK-88021"];
const LOW_STOCK_ITEMS = ["EF-9", "UPS-650", "NAS-2B", "PRJ-X20", "TC-LBL4"];

function safeQuantity(rng: Rng, item: NavItem): number {
  // Stay well below the stock on hand so that only the seeded cases exceed it.
  return rng.int(1, Math.max(1, Math.min(60, Math.floor(item.stockQty * 0.3))));
}

export async function buildReplayDataset(): Promise<ReplayDataset> {
  const rng = createRng(REPLAY_SEED);
  const files: { path: string; bytes: Uint8Array }[] = [];
  const orders: ReplayOrder[] = [];
  let unknownCustomersUsed = 0;

  for (let index = 0; index < 60; index++) {
    const id = `RPL-${String(index + 1).padStart(3, "0")}`;
    const arrivedAt = businessTime(rng, Math.floor(index * 2.6) + rng.int(0, 1));
    const seededErrors: ReplaySeededError[] = [];
    let customerName = rng.pick(CUSTOMERS).name;
    let spr: ReplayOrder["spr"] = null;

    // Lines: one to three different catalogue items at the Navision price.
    const lineCount = rng.int(1, 3);
    const chosen: NavItem[] = [];
    while (chosen.length < lineCount) {
      const item = rng.pick(ITEMS);
      if (!chosen.includes(item) && !LOW_STOCK_ITEMS.includes(item.itemNo)) chosen.push(item);
    }
    const lines: PricedLine[] = chosen.map((item) => ({
      partNo: item.itemNo,
      description: item.description,
      quantity: String(safeQuantity(rng, item)),
      unitPrice: item.price,
    }));

    const roll = rng.next();
    const target = rng.int(0, lines.length - 1);
    if (roll < 0.15) {
      // The docking station is the part customers most often write differently, as in the deck.
      const item = rng.chance(0.5) ? itemByNo("AB1234X") : chosen[target];
      const written = aliasSpelling(item.itemNo);
      lines[target] = { partNo: written, description: item.description, quantity: String(safeQuantity(rng, item)), unitPrice: item.price };
      seededErrors.push({
        code: "PART_ALIAS_SUGGESTED",
        field: `lines[${target}].partNo`,
        detail: `${written} written for ${item.itemNo}`,
        resolution: { action: "use_suggestion" },
      });
    } else if (roll < 0.27) {
      const item = chosen[target];
      const percent = rng.int(3, 8);
      const special = toMoney(item.price).times(new Decimal(100).minus(percent)).dividedBy(100);
      lines[target] = { ...lines[target], unitPrice: formatMoney(special) };
      seededErrors.push({
        code: "PRICE_MISMATCH",
        field: `lines[${target}].unitPrice`,
        detail: `${formatMoney(special)} on the PO, ${item.price} in Navision (${percent}% lower)`,
        resolution: { action: "override", reason: "Special deal agreed with the customer (simulated staff decision)." },
      });
    } else if (roll < 0.32) {
      const intended = chosen[target];
      const unlisted = rng.pick(UNLISTED_PARTS);
      lines[target] = { ...lines[target], partNo: unlisted };
      seededErrors.push({
        code: "PART_NOT_FOUND",
        field: `lines[${target}].partNo`,
        detail: `${unlisted} is not in Navision; the customer meant ${intended.itemNo}`,
        resolution: { action: "set_value", field: `lines[${target}].partNo`, value: intended.itemNo },
      });
    } else if (roll < 0.44) {
      const item = itemByNo(rng.pick(LOW_STOCK_ITEMS));
      const quantity = item.stockQty + rng.int(3, 30);
      lines[target] = { partNo: item.itemNo, description: item.description, quantity: String(quantity), unitPrice: item.price };
      seededErrors.push({
        code: "QTY_EXCEEDS_STOCK",
        field: `lines[${target}].quantity`,
        detail: `${quantity} ordered, ${item.stockQty} in stock`,
        resolution: { action: "none" },
      });
      spr = { partNo: item.itemNo, quantity: quantity - item.stockQty };
    } else if (roll < 0.48 && unknownCustomersUsed < UNKNOWN_CUSTOMERS.length) {
      customerName = UNKNOWN_CUSTOMERS[unknownCustomersUsed].name;
      unknownCustomersUsed++;
      seededErrors.push({
        code: "CUSTOMER_NOT_FOUND",
        field: "customerName",
        detail: `${customerName} is not in Navision`,
        resolution: { action: "propose_customer_card" },
      });
    }

    const poNumber = `R${String(2600 + index)}-${customerName.replace(/[^A-Z]/g, "").slice(0, 3) || "PO"}`;
    const rendered = await renderCustomerPo({
      layout: rng.chance(0.5) ? "A" : "B",
      poNumber,
      poDate: isoDay(arrivedAt),
      customer: customerBlock(customerName),
      currency: "USD",
      paymentTerms: "Advance payment",
      lines,
    });
    const poFile = `files/${id.toLowerCase()}-po.pdf`;
    files.push({ path: poFile, bytes: rendered.bytes });

    // Baseline: how long the same order took in the (synthetic) past.
    const hasErrors = seededErrors.length > 0;
    const keyingHours = rng.int(3, 20) + (hasErrors ? rng.int(8, 40) : 0);
    const navisionCreatedAt = new Date(arrivedAt.getTime() + keyingHours * HOUR);
    const sprSubmittedAt = spr ? new Date(arrivedAt.getTime() + rng.int(4, 30) * HOUR) : null;
    const sprDecidedAt = sprSubmittedAt ? new Date(sprSubmittedAt.getTime() + rng.int(18, 130) * HOUR) : null;
    const promised = new Date(arrivedAt.getTime() + rng.int(10, 21) * DAY);
    const lateDays = rng.chance(0.35) ? rng.int(1, 9) : -rng.int(0, 2);
    const actual = new Date(promised.getTime() + lateDays * DAY);

    orders.push({
      id,
      poFile,
      poNumber,
      customerName,
      channel: rng.chance(0.7) ? "email" : "whatsapp",
      arrivedAt: arrivedAt.toISOString(),
      lineCount: lines.length,
      seededErrors,
      spr,
      baseline: {
        navisionCreatedAt: navisionCreatedAt.toISOString(),
        sprSubmittedAt: sprSubmittedAt ? sprSubmittedAt.toISOString() : null,
        sprDecidedAt: sprDecidedAt ? sprDecidedAt.toISOString() : null,
        promisedShipDate: isoDay(promised),
        actualShipDate: isoDay(actual),
      },
    });
  }

  // Goods receipts: one vendor PO each, with an invoice, a packing list and the quantity Navision says was received.
  const receipts: ReplayReceipt[] = [];
  const purchaseOrders: NavPurchaseOrder[] = [];
  const goodsReceipts: NavGoodsReceipt[] = [];
  for (let index = 0; index < 20; index++) {
    const id = `RPR-${String(index + 1).padStart(3, "0")}`;
    const poNumber = `PO-${7001 + index}`;
    const item = rng.pick(ITEMS);
    const vendor = VENDORS.find((candidate) => candidate.vendorId === item.vendorId) ?? VENDORS[0];
    const quantity = rng.int(2, 20) * 10;
    const arrivedAt = businessTime(rng, index * 8 + rng.int(0, 3));
    const seededErrors: ReplayReceipt["seededErrors"] = [];
    let received = quantity;
    let invoicedPart = item.itemNo;

    const roll = rng.next();
    if (roll < 0.2) {
      received = quantity - rng.int(1, 8);
      seededErrors.push({ code: "QTY_VARIANCE", field: item.itemNo, detail: `invoiced ${quantity}, received ${received}` });
    } else if (roll < 0.25) {
      received = quantity + rng.int(1, 5);
      seededErrors.push({ code: "QTY_VARIANCE", field: item.itemNo, detail: `invoiced ${quantity}, received ${received}` });
    } else if (roll < 0.3) {
      invoicedPart = `${item.itemNo}B`;
      seededErrors.push({ code: "INVOICE_PART_MISMATCH", field: invoicedPart, detail: `invoice lists ${invoicedPart}, the vendor PO has ${item.itemNo}` });
    }

    const invoice = await renderInvoice({
      invoiceNumber: `INV-${7001 + index}1`,
      invoiceDate: isoDay(arrivedAt),
      issuerName: vendor.name,
      billTo: SELLER_NAME,
      poNumber,
      currency: "USD",
      lines: [{ partNo: invoicedPart, description: item.description, quantity: String(quantity), unitPrice: item.purchasePrice }],
    });
    const packingList = await renderPackingList({
      packingListNumber: `PL-${7001 + index}2`,
      packingDate: isoDay(arrivedAt),
      shipperName: vendor.name,
      consigneeName: SELLER_NAME,
      poNumber,
      lines: [{ partNo: item.itemNo, description: item.description, quantity: String(quantity), cartons: String(Math.ceil(quantity / 20)) }],
    });
    const invoiceFile = `files/${id.toLowerCase()}-invoice.pdf`;
    const packingListFile = `files/${id.toLowerCase()}-packing-list.pdf`;
    files.push({ path: invoiceFile, bytes: invoice.bytes }, { path: packingListFile, bytes: packingList.bytes });

    purchaseOrders.push({
      poNumber,
      vendorId: vendor.vendorId,
      vendorName: vendor.name,
      orderDate: isoDay(new Date(arrivedAt.getTime() - 14 * DAY)),
      forCustomerPoNumber: null,
      documentsDueAt: null,
      paymentDueDate: isoDay(new Date(arrivedAt.getTime() + 21 * DAY)),
      paid: true,
      currency: "USD",
      totalAmount: formatMoney(toMoney(item.purchasePrice).times(quantity)),
      lines: [{ itemNo: item.itemNo, quantity, unitPrice: item.purchasePrice }],
    });
    goodsReceipts.push({
      grNo: `GR-${7001 + index}`,
      poNumber,
      receivedAt: new Date(arrivedAt.getTime() - 4 * HOUR).toISOString(),
      lines: [{ itemNo: item.itemNo, receivedQty: received }],
    });
    receipts.push({
      id,
      poNumber,
      vendorName: vendor.name,
      arrivedAt: arrivedAt.toISOString(),
      invoiceFile,
      packingListFile,
      lineCount: 1,
      seededErrors,
    });
  }

  return {
    file: {
      _note: `${SYNTHETIC_NOTE} Baseline timestamps are invented to exercise the KPI replay; they say nothing about Spectra's real speed.`,
      seed: REPLAY_SEED,
      period: { from: isoDay(PERIOD_START), to: PERIOD_END },
      orders,
      receipts,
    },
    files,
    purchaseOrders,
    goodsReceipts,
  };
}
