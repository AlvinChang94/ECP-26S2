// What: the demo scenario: Navision transaction files, the PDFs the seed loads as history (ORD-1031 to ORD-1042), and the Inbox files.
// Who calls it: scripts/generate-sample-data.ts (writes the files) and scripts/seed.ts (replays the history through the services).
// To extend: add an order to SCENARIO_ORDERS or a file to buildInboxFiles(); order numbers are asserted by the seed.
import Decimal from "decimal.js";
import type { NavGoodsReceipt, NavOpenOrder, NavPurchaseOrder } from "../../src/domain/navision";
import { displayMoney, formatMoney, parseMoney, parseQuantity, toMoney } from "../../src/domain/money";
import { customerBlock, itemLine } from "./golden";
import { customerByName, DEMO_NOW, itemByNo, SELLER_NAME, vendorByName } from "./master";
import {
  type PricedLine,
  type RenderedPdf,
  renderCustomerPo,
  renderImportPermit,
  renderInvoice,
  renderPackingList,
  renderProofOfPayment,
  renderTransportDocument,
  renderUnknownDocument,
} from "./pdfs";

export type ScenarioFile = { path: string; bytes: Uint8Array };

function hoursBefore(hours: number): Date {
  return new Date(DEMO_NOW.getTime() - hours * 60 * 60 * 1000);
}

export function orderTotal(lines: PricedLine[]): string {
  let total = new Decimal(0);
  for (const line of lines) {
    const quantity = parseQuantity(line.quantity);
    const price = parseMoney(line.unitPrice);
    if (quantity !== null && price !== null) total = total.plus(price.times(quantity));
  }
  return formatMoney(total);
}

// ------------------------------------------------------------------------------------- historical orders

export type ScenarioOrder = {
  /** The order number the seed must end up with. The seed stops with an error if the numbers drift. */
  orderNo: string;
  customer: string;
  poNumber: string;
  layout: "A" | "B";
  lines: PricedLine[];
  /** When the PO arrived, in hours before the demo's "now". */
  arrivedHoursAgo: number;
  channel: "email" | "whatsapp";
  promisedShipDate: string;
  file: string;
};

export const SCENARIO_ORDERS: ScenarioOrder[] = [
  { orderNo: "ORD-1031", customer: "Lanka Tech Pte Ltd", poNumber: "LT-PO-2291", layout: "A", lines: [itemLine("CD-77", 100), itemLine("HS-700", 50)], arrivedHoursAgo: 14 * 24, channel: "email", promisedShipDate: "2026-11-10", file: "po-ord-1031-lanka-tech.pdf" },
  { orderNo: "ORD-1032", customer: "Dubai Dist LLC", poNumber: "DD-7802", layout: "B", lines: [itemLine("WC-1080", 40), itemLine("LP-15S", 30)], arrivedHoursAgo: 6 * 24, channel: "email", promisedShipDate: "2026-11-23", file: "po-ord-1032-dubai-dist.pdf" },
  { orderNo: "ORD-1033", customer: "Dhaka IT Solutions", poNumber: "DH-5107", layout: "A", lines: [itemLine("GH-310", 30), itemLine("MS-M185", 100)], arrivedHoursAgo: 3 * 24 + 5, channel: "whatsapp", promisedShipDate: "2026-11-24", file: "po-ord-1033-dhaka-it.pdf" },
  { orderNo: "ORD-1034", customer: "Colombo PC House", poNumber: "CP-1131", layout: "B", lines: [itemLine("KM-2210", 20), itemLine("TB-240", 25)], arrivedHoursAgo: 4 * 24, channel: "email", promisedShipDate: "2026-11-25", file: "po-ord-1034-colombo-pc.pdf" },
  { orderNo: "ORD-1035", customer: "Meridian Parts", poNumber: "MP-0456", layout: "A", lines: [itemLine("RT-AX55", 12), itemLine("SW-1608", 6)], arrivedHoursAgo: 5 * 24, channel: "email", promisedShipDate: "2026-11-26", file: "po-ord-1035-meridian-parts.pdf" },
  { orderNo: "ORD-1036", customer: "Alpine Manufacturing", poNumber: "AM-9920", layout: "B", lines: [itemLine("UPS-650", 10), itemLine("PSU-550B", 15)], arrivedHoursAgo: 9 * 24 + 3, channel: "email", promisedShipDate: "2026-11-18", file: "po-ord-1036-alpine-manufacturing.pdf" },
  { orderNo: "ORD-1037", customer: "Nova Controls", poNumber: "NC-3381", layout: "A", lines: [itemLine("RAM-16D4", 120), itemLine("FD-64U3", 300)], arrivedHoursAgo: 8 * 24, channel: "whatsapp", promisedShipDate: "2026-11-20", file: "po-ord-1037-nova-controls.pdf" },
  { orderNo: "ORD-1038", customer: "Karachi Compute", poNumber: "KC-1007", layout: "B", lines: [itemLine("HS-700", 80), itemLine("LP-15S", 40)], arrivedHoursAgo: 7 * 24, channel: "email", promisedShipDate: "2026-11-19", file: "po-ord-1038-karachi-compute.pdf" },
  { orderNo: "ORD-1039", customer: "Muscat Micro Trading", poNumber: "MM-3342", layout: "A", lines: [itemLine("TB-240", 30, { writtenAs: "TB240" }), itemLine("PRJ-X20", 4, { unitPrice: "255.00" })], arrivedHoursAgo: 20, channel: "email", promisedShipDate: "2026-11-30", file: "po-ord-1039-muscat-micro.pdf" },
  { orderNo: "ORD-1040", customer: "Lanka Tech Pte Ltd", poNumber: "LT-PO-2305", layout: "A", lines: [itemLine("EF-9", 60)], arrivedHoursAgo: 3 * 24, channel: "email", promisedShipDate: "2026-11-27", file: "po-ord-1040-lanka-tech.pdf" },
  { orderNo: "ORD-1041", customer: "Dubai Dist LLC", poNumber: "DD-7810", layout: "B", lines: [itemLine("LP-15S", 100)], arrivedHoursAgo: 5 * 24 + 6, channel: "email", promisedShipDate: "2026-11-22", file: "po-ord-1041-dubai-dist.pdf" },
  { orderNo: "ORD-1042", customer: "Beacon Devices", poNumber: "BD-PO-5521", layout: "A", lines: [itemLine("PC-4402", 100)], arrivedHoursAgo: 12 * 24, channel: "email", promisedShipDate: "2026-11-18", file: "po-ord-1042-beacon-devices.pdf" },
];

export function scenarioOrder(orderNo: string): ScenarioOrder {
  const order = SCENARIO_ORDERS.find((candidate) => candidate.orderNo === orderNo);
  if (!order) throw new Error(`No scenario order ${orderNo}`);
  return order;
}

function piNumberFor(orderNo: string): string {
  return orderNo.replace("ORD-", "PI-");
}

function poDate(order: ScenarioOrder): string {
  const date = hoursBefore(order.arrivedHoursAgo + 24).toISOString().slice(0, 10);
  if (order.layout === "A") return date;
  const [year, month, day] = date.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${day} ${months[month - 1]} ${year}`;
}

async function renderScenarioPo(order: ScenarioOrder, marking?: string, lines?: PricedLine[]): Promise<RenderedPdf> {
  return renderCustomerPo({
    layout: order.layout,
    marking,
    poNumber: order.poNumber,
    poDate: poDate(order),
    customer: customerBlock(order.customer),
    currency: "USD",
    paymentTerms: "Advance payment",
    deliveryRequiredBy: order.promisedShipDate,
    lines: lines ?? order.lines,
  });
}

/** Proofs of payment loaded by the seed. `amount` defaults to the full order total. */
export const SCENARIO_PROOFS: { orderNo: string; file: string; layout: "A" | "B"; amount?: string; paidHoursAgo: number }[] = [
  { orderNo: "ORD-1031", file: "payment-ord-1031.pdf", layout: "A", paidHoursAgo: 13 * 24 },
  { orderNo: "ORD-1032", file: "payment-ord-1032.pdf", layout: "B", paidHoursAgo: 5 * 24 },
  { orderNo: "ORD-1034", file: "payment-ord-1034.pdf", layout: "A", paidHoursAgo: 26 },
  { orderNo: "ORD-1035", file: "payment-ord-1035-short.pdf", layout: "B", amount: "1350.00", paidHoursAgo: 30 },
  { orderNo: "ORD-1037", file: "payment-ord-1037.pdf", layout: "A", paidHoursAgo: 7 * 24 },
  { orderNo: "ORD-1038", file: "payment-ord-1038.pdf", layout: "B", paidHoursAgo: 6 * 24 },
  { orderNo: "ORD-1040", file: "payment-ord-1040.pdf", layout: "A", paidHoursAgo: 2 * 24 },
  { orderNo: "ORD-1042", file: "payment-ord-1042.pdf", layout: "A", paidHoursAgo: 10 * 24 },
];

// ------------------------------------------------------------------------------------- Navision transaction files (demo)

const dueToday = new Date(DEMO_NOW.getTime() + 7 * 60 * 60 * 1000).toISOString(); // 16:00 on the demo day

function purchaseOrder(
  poNumber: string,
  vendorName: string,
  lines: { itemNo: string; quantity: number }[],
  extra: { forCustomerPoNumber?: string; documentsDueAt: string | null; paymentDueDate: string; paid?: boolean; orderDate: string },
): NavPurchaseOrder {
  const vendor = vendorByName(vendorName);
  const total = lines.reduce((sum, line) => sum.plus(toMoney(itemByNo(line.itemNo).purchasePrice).times(line.quantity)), new Decimal(0));
  return {
    poNumber,
    vendorId: vendor.vendorId,
    vendorName: vendor.name,
    orderDate: extra.orderDate,
    forCustomerPoNumber: extra.forCustomerPoNumber ?? null,
    documentsDueAt: extra.documentsDueAt,
    paymentDueDate: extra.paymentDueDate,
    paid: extra.paid ?? false,
    currency: "USD",
    totalAmount: formatMoney(total),
    lines: lines.map((line) => ({ itemNo: line.itemNo, quantity: line.quantity, unitPrice: itemByNo(line.itemNo).purchasePrice })),
  };
}

export const DEMO_PURCHASE_ORDERS: NavPurchaseOrder[] = [
  purchaseOrder("PO-8330", "Beta Parts", [{ itemNo: "GH-310", quantity: 200 }], { documentsDueAt: null, paymentDueDate: "2026-11-06", paid: true, orderDate: "2026-10-05" }),
  purchaseOrder("PO-8336", "Alpha Supply", [{ itemNo: "AB1234X", quantity: 2000 }], { documentsDueAt: null, paymentDueDate: "2026-11-20", orderDate: "2026-10-19" }),
  purchaseOrder("PO-8338", "Beta Parts", [{ itemNo: "UPS-650", quantity: 60 }, { itemNo: "EF-9", quantity: 34 }], { documentsDueAt: null, paymentDueDate: "2026-11-23", orderDate: "2026-10-22" }),
  purchaseOrder("PO-8341", "Pacific Components", [{ itemNo: "PC-4402", quantity: 100 }], { forCustomerPoNumber: "BD-PO-5521", documentsDueAt: dueToday, paymentDueDate: "2026-11-27", orderDate: "2026-11-05" }),
  purchaseOrder("PO-8342", "Apex Industrial", [{ itemNo: "KM-2210", quantity: 240 }], { documentsDueAt: "2026-11-18T04:00:00.000Z", paymentDueDate: "2026-11-19", orderDate: "2026-10-30" }),
  purchaseOrder("PO-8343", "Delta Parts", [{ itemNo: "RT-AX55", quantity: 60 }], { documentsDueAt: "2026-11-20T10:00:00.000Z", paymentDueDate: "2026-12-04", orderDate: "2026-11-02" }),
  purchaseOrder("PO-8344", "Nova Logistics", [{ itemNo: "HS-700", quantity: 120 }], { documentsDueAt: "2026-11-19T02:00:00.000Z", paymentDueDate: "2026-12-01", orderDate: "2026-11-03" }),
  purchaseOrder("PO-8345", "Pacific Components", [{ itemNo: "NAS-2B", quantity: 10 }], { documentsDueAt: "2026-11-26T08:00:00.000Z", paymentDueDate: "2026-12-10", orderDate: "2026-11-09" }),
];

export const DEMO_GOODS_RECEIPTS: NavGoodsReceipt[] = [
  { grNo: "GR-2048", poNumber: "PO-8341", receivedAt: hoursBefore(19).toISOString(), lines: [{ itemNo: "PC-4402", receivedQty: 95 }] },
  { grNo: "GR-2049", poNumber: "PO-8342", receivedAt: hoursBefore(44).toISOString(), lines: [{ itemNo: "KM-2210", receivedQty: 240 }] },
  { grNo: "GR-2050", poNumber: "PO-8343", receivedAt: hoursBefore(28).toISOString(), lines: [{ itemNo: "RT-AX55", receivedQty: 60 }] },
  { grNo: "GR-2051", poNumber: "PO-8344", receivedAt: hoursBefore(50).toISOString(), lines: [{ itemNo: "HS-700", receivedQty: 120 }] },
];

function openOrder(orderNo: string, customerName: string, poNumber: string, promisedShipDate: string, lines: [string, number][]): NavOpenOrder {
  const customer = customerByName(customerName);
  return {
    orderNo,
    customerNo: customer.customerNo,
    customerName: customer.name,
    poNumber,
    promisedShipDate,
    lines: lines.map(([itemNo, quantity]) => ({ itemNo, quantity, shippedQty: 0 })),
  };
}

/** Open orders that were keyed into Navision before OrderFlow existed. Three parts are short across them. */
export const DEMO_CUSTOMER_ORDERS: NavOpenOrder[] = [
  openOrder("SO-24101", "Lanka Tech Pte Ltd", "LT-PO-2270", "2026-11-25", [["TC-LBL4", 10]]),
  openOrder("SO-24102", "Dubai Dist LLC", "DD-7781", "2026-11-27", [["NAS-2B", 10], ["PRJ-X20", 6]]),
  openOrder("SO-24103", "Karachi Compute", "KC-0991", "2026-11-21", [["NAS-2B", 8], ["UPS-650", 20]]),
  openOrder("SO-24104", "Muscat Micro Trading", "MM-3310", "2026-12-02", [["PRJ-X20", 5], ["UPS-650", 25]]),
  openOrder("SO-24105", "Colombo PC House", "CP-1120", "2026-11-30", [["SW-1608", 12]]),
];

// ------------------------------------------------------------------------------------- shipment documents loaded by the seed

export type ScenarioShipmentDoc = {
  file: string;
  /** The reference the document carries: a vendor PO number, or an order's PO number for outgoing shipments. */
  reference: string;
  arrivedHoursAgo: number;
  channel: "email" | "whatsapp";
  sender: string;
  /** false = the seed imports it but leaves the type unconfirmed, so it shows as "Pending check". */
  confirm: boolean;
};

export const SCENARIO_SHIPMENT_DOCS: ScenarioShipmentDoc[] = [
  // PO-8341 for ORD-1042: invoice 100, packing list 100, Navision received 95, AWB missing, permit waiting for a check
  { file: "invoice-po-8341.pdf", reference: "PO-8341", arrivedHoursAgo: 22, channel: "email", sender: "export@pacificcomponents.example", confirm: true },
  { file: "packing-list-po-8341.pdf", reference: "PO-8341", arrivedHoursAgo: 22, channel: "email", sender: "export@pacificcomponents.example", confirm: true },
  { file: "permit-po-8341.pdf", reference: "PO-8341", arrivedHoursAgo: 2, channel: "whatsapp", sender: "Forwarder (sample)", confirm: false },
  // PO-8342: everything present and matching
  { file: "invoice-po-8342.pdf", reference: "PO-8342", arrivedHoursAgo: 48, channel: "email", sender: "sales@apexindustrial.example", confirm: true },
  { file: "packing-list-po-8342.pdf", reference: "PO-8342", arrivedHoursAgo: 48, channel: "email", sender: "sales@apexindustrial.example", confirm: true },
  { file: "awb-po-8342.pdf", reference: "PO-8342", arrivedHoursAgo: 47, channel: "email", sender: "sales@apexindustrial.example", confirm: true },
  { file: "permit-po-8342.pdf", reference: "PO-8342", arrivedHoursAgo: 46, channel: "email", sender: "Forwarder (sample)", confirm: true },
  // PO-8343: sea shipment, import permit still missing (due in four days)
  { file: "invoice-po-8343.pdf", reference: "PO-8343", arrivedHoursAgo: 30, channel: "email", sender: "orders@deltaparts.example", confirm: true },
  { file: "packing-list-po-8343.pdf", reference: "PO-8343", arrivedHoursAgo: 30, channel: "email", sender: "orders@deltaparts.example", confirm: true },
  { file: "bl-po-8343.pdf", reference: "PO-8343", arrivedHoursAgo: 29, channel: "email", sender: "orders@deltaparts.example", confirm: true },
  // PO-8344: everything present and matching
  { file: "invoice-po-8344.pdf", reference: "PO-8344", arrivedHoursAgo: 52, channel: "email", sender: "desk@novalogistics.example", confirm: true },
  { file: "packing-list-po-8344.pdf", reference: "PO-8344", arrivedHoursAgo: 52, channel: "email", sender: "desk@novalogistics.example", confirm: true },
  { file: "awb-po-8344.pdf", reference: "PO-8344", arrivedHoursAgo: 51, channel: "email", sender: "desk@novalogistics.example", confirm: true },
  { file: "permit-po-8344.pdf", reference: "PO-8344", arrivedHoursAgo: 51, channel: "email", sender: "Forwarder (sample)", confirm: true },
  // Outgoing shipment for ORD-1038 (Karachi Compute): invoice, packing list and AWB are in; the permit is not
  { file: "invoice-ord-1038.pdf", reference: "KC-1007", arrivedHoursAgo: 20, channel: "email", sender: "sam.tan@spectra.example", confirm: true },
  { file: "packing-list-ord-1038.pdf", reference: "KC-1007", arrivedHoursAgo: 20, channel: "email", sender: "warehouse@spectra.example", confirm: true },
  { file: "awb-ord-1038.pdf", reference: "KC-1007", arrivedHoursAgo: 18, channel: "email", sender: "Forwarder (sample)", confirm: true },
];

async function inboundDocuments(poNumber: string, options: { transport: "air" | "sea" | null; permit: boolean }): Promise<ScenarioFile[]> {
  const order = DEMO_PURCHASE_ORDERS.find((candidate) => candidate.poNumber === poNumber);
  if (!order) throw new Error(`No demo purchase order ${poNumber}`);
  const number = poNumber.replace("PO-", "");
  const slug = poNumber.toLowerCase();
  const lines = order.lines.map((line) => ({
    partNo: line.itemNo,
    description: itemByNo(line.itemNo).description,
    quantity: String(line.quantity),
    unitPrice: line.unitPrice,
  }));
  const files: ScenarioFile[] = [];
  const invoice = await renderInvoice({ invoiceNumber: `INV-${number}1`, invoiceDate: order.orderDate, issuerName: order.vendorName, billTo: SELLER_NAME, poNumber, currency: "USD", lines });
  files.push({ path: `invoice-${slug}.pdf`, bytes: invoice.bytes });
  const packingList = await renderPackingList({
    packingListNumber: `PL-${number}2`,
    packingDate: order.orderDate,
    shipperName: order.vendorName,
    consigneeName: SELLER_NAME,
    poNumber,
    lines: lines.map((line) => ({ partNo: line.partNo, description: line.description, quantity: line.quantity, cartons: String(Math.ceil(Number(line.quantity) / 20)) })),
  });
  files.push({ path: `packing-list-${slug}.pdf`, bytes: packingList.bytes });
  if (options.transport) {
    const transport = await renderTransportDocument({
      mode: options.transport,
      documentNumber: options.transport === "air" ? `618-${number}4405` : `SOL${number}7731`,
      shipperName: order.vendorName,
      consigneeName: SELLER_NAME,
      origin: options.transport === "air" ? "Sample Origin Airport" : "Sample Origin Port",
      destination: options.transport === "air" ? "Singapore Changi Airport" : "Port of Singapore",
      pieces: String(Math.ceil(order.lines[0].quantity / 20)),
      reference: poNumber,
    });
    files.push({ path: `${options.transport === "air" ? "awb" : "bl"}-${slug}.pdf`, bytes: transport.bytes });
  }
  if (options.permit) {
    const permit = await renderImportPermit({
      permitNumber: `IP-2026-${number}`,
      importerName: SELLER_NAME,
      issueDate: "2026-11-12",
      validUntil: "2026-12-12",
      reference: poNumber,
      goods: itemByNo(order.lines[0].itemNo).description,
    });
    files.push({ path: `permit-${slug}.pdf`, bytes: permit.bytes });
  }
  return files;
}

/** Everything in data/seed: the PDFs the seed script feeds through the services to build the demo history. */
export async function buildSeedFiles(): Promise<ScenarioFile[]> {
  const files: ScenarioFile[] = [];
  for (const order of SCENARIO_ORDERS) {
    files.push({ path: order.file, bytes: (await renderScenarioPo(order)).bytes });
  }
  // The cancellation that closed ORD-1041.
  files.push({ path: "cancellation-ord-1041-dubai-dist.pdf", bytes: (await renderScenarioPo(scenarioOrder("ORD-1041"), "CANCELLATION")).bytes });

  for (const proof of SCENARIO_PROOFS) {
    const order = scenarioOrder(proof.orderNo);
    const rendered = await renderProofOfPayment({
      layout: proof.layout,
      payerName: order.customer,
      amount: displayMoney(proof.amount ?? orderTotal(order.lines)),
      currency: "USD",
      paymentDate: hoursBefore(proof.paidHoursAgo).toISOString().slice(0, 10),
      reference: piNumberFor(order.orderNo),
      bankReference: `TT${order.orderNo.replace("ORD-", "")}${String(proof.paidHoursAgo).padStart(4, "0")}`,
    });
    files.push({ path: proof.file, bytes: rendered.bytes });
  }

  files.push(...(await inboundDocuments("PO-8341", { transport: null, permit: true })));
  files.push(...(await inboundDocuments("PO-8342", { transport: "air", permit: true })));
  files.push(...(await inboundDocuments("PO-8343", { transport: "sea", permit: false })));
  files.push(...(await inboundDocuments("PO-8344", { transport: "air", permit: true })));

  // Outgoing shipment documents for ORD-1038. They quote the customer's PO number, which links them to the order.
  const outbound = scenarioOrder("ORD-1038");
  const outboundInvoice = await renderInvoice({
    title: "COMMERCIAL INVOICE",
    invoiceNumber: "SI-1038",
    invoiceDate: "2026-11-15",
    issuerName: SELLER_NAME,
    billTo: outbound.customer,
    poNumber: outbound.poNumber,
    currency: "USD",
    lines: outbound.lines,
  });
  files.push({ path: "invoice-ord-1038.pdf", bytes: outboundInvoice.bytes });
  const outboundPacking = await renderPackingList({
    packingListNumber: "SPL-1038",
    packingDate: "2026-11-15",
    shipperName: SELLER_NAME,
    consigneeName: outbound.customer,
    poNumber: outbound.poNumber,
    lines: outbound.lines.map((line) => ({ partNo: line.partNo, description: line.description, quantity: line.quantity, cartons: String(Math.ceil(Number(line.quantity) / 20)) })),
  });
  files.push({ path: "packing-list-ord-1038.pdf", bytes: outboundPacking.bytes });
  const outboundAwb = await renderTransportDocument({
    mode: "air",
    documentNumber: "618-10384411",
    shipperName: SELLER_NAME,
    consigneeName: outbound.customer,
    origin: "Singapore Changi Airport",
    destination: "Sample Destination Airport",
    pieces: "6",
    reference: outbound.poNumber,
  });
  files.push({ path: "awb-ord-1038.pdf", bytes: outboundAwb.bytes });
  return files;
}

// ------------------------------------------------------------------------------------- Inbox (waiting for the live demo)

export type InboxManifestEntry = {
  file: string;
  channel: "email" | "whatsapp";
  sender: string;
  /** Minutes before the demo's "now" at which the message arrived. */
  receivedMinutesAgo: number;
  /** What this file is for in the demo script. */
  purpose: string;
};

export async function buildInboxFiles(): Promise<{ files: ScenarioFile[]; manifest: InboxManifestEntry[] }> {
  const files: ScenarioFile[] = [];
  const manifest: InboxManifestEntry[] = [];
  const add = (entry: InboxManifestEntry, rendered: RenderedPdf): void => {
    files.push({ path: entry.file, bytes: rendered.bytes });
    manifest.push(entry);
  };

  add(
    { file: "po-colombo-pc-house-cp-1140.pdf", channel: "email", sender: "orders@colombopc.example", receivedMinutesAgo: 35, purpose: "Story 1 and 2 happy path: a clean PO." },
    await renderCustomerPo({ layout: "A", poNumber: "CP-1140", poDate: "2026-11-15", customer: customerBlock("Colombo PC House"), currency: "USD", paymentTerms: "Advance payment", deliveryRequiredBy: "2026-11-30", lines: [itemLine("GH-310", 12), itemLine("WC-1080", 20)] }),
  );
  add(
    { file: "po-lanka-tech-lt-po-2310.pdf", channel: "whatsapp", sender: "Lanka Tech purchasing (sample)", receivedMinutesAgo: 28, purpose: "Story 1 and 2: AB-1234X alias and a special-deal price to override." },
    await renderCustomerPo({ layout: "A", poNumber: "LT-PO-2310", poDate: "2026-11-15", customer: customerBlock("Lanka Tech Pte Ltd"), currency: "USD", paymentTerms: "Advance payment", deliveryRequiredBy: "2026-12-01", lines: [itemLine("AB1234X", 100, { writtenAs: "AB-1234X", unitPrice: "11.90" }), itemLine("CD-77", 40)] }),
  );
  add(
    { file: "po-dhaka-it-dh-5120.pdf", channel: "email", sender: "buy@dhakait.example", receivedMinutesAgo: 20, purpose: "Story 2 and 3: AB-1234X again (remembered alias) and 200 ordered with 160 in stock (suggests an SPR)." },
    await renderCustomerPo({ layout: "B", poNumber: "DH-5120", poDate: "15 Nov 2026", customer: customerBlock("Dhaka IT Solutions"), currency: "USD", paymentTerms: "Advance payment", partialShipment: "Allowed", deliveryRequiredBy: "2 Dec 2026", lines: [itemLine("AB1234X", 200, { writtenAs: "AB-1234X" })] }),
  );
  add(
    { file: "po-kathmandu-digital-hub-kdh-0012.pdf", channel: "email", sender: "hello@kathmandudigital.example", receivedMinutesAgo: 16, purpose: "Story 1 and 2: unknown customer, needs a new customer card." },
    await renderCustomerPo({ layout: "A", poNumber: "KDH-0012", poDate: "2026-11-15", customer: customerBlock("Kathmandu Digital Hub"), currency: "USD", paymentTerms: "Advance payment", deliveryRequiredBy: "2026-12-03", lines: [itemLine("WC-1080", 10), itemLine("HS-700", 10)] }),
  );
  const dhaka = scenarioOrder("ORD-1033");
  add(
    { file: "payment-dhaka-it-pi-1033.pdf", channel: "whatsapp", sender: "Dhaka IT accounts (sample)", receivedMinutesAgo: 12, purpose: "Story 4 happy path: proof that matches PI-1033 exactly." },
    await renderProofOfPayment({ layout: "A", payerName: dhaka.customer, amount: displayMoney(orderTotal(dhaka.lines)), currency: "USD", paymentDate: "2026-11-15", reference: "PI-1033", bankReference: "TT2611150933" }),
  );
  const alpine = scenarioOrder("ORD-1036");
  add(
    { file: "payment-alpine-own-reference.pdf", channel: "email", sender: "purchase@alpinemfg.example", receivedMinutesAgo: 10, purpose: "Story 4 failure path: the reference matches no PI; Finance links it by hand with a reason." },
    await renderProofOfPayment({ layout: "B", payerName: alpine.customer, amount: displayMoney(orderTotal(alpine.lines)), currency: "USD", paymentDate: "15 Nov 2026", reference: "AM-PAY-7781", bankReference: "RB-901336" }),
  );
  add(
    { file: "awb-pacific-components-po-8341.pdf", channel: "email", sender: "export@pacificcomponents.example", receivedMinutesAgo: 8, purpose: "Story 5 and 6: the missing AWB for PO-8341 (ORD-1042)." },
    await renderTransportDocument({ mode: "air", documentNumber: "618-83414405", shipperName: "Pacific Components", consigneeName: SELLER_NAME, origin: "Sample Origin Airport", destination: "Singapore Changi Airport", pieces: "5", reference: "PO-8341" }),
  );
  const dubai = scenarioOrder("ORD-1032");
  add(
    { file: "po-dubai-dist-dd-7802-amendment-1.pdf", channel: "email", sender: "purchasing@dubaidist.example", receivedMinutesAgo: 6, purpose: "Story 2: amended PO for ORD-1032 (quantity change and one new line)." },
    await renderScenarioPo(dubai, "AMENDMENT 1", [itemLine("WC-1080", 55), itemLine("LP-15S", 30), itemLine("HS-700", 20)]),
  );
  add(
    { file: "po-muscat-micro-mm-3342-cancellation.pdf", channel: "email", sender: "trade@muscatmicro.example", receivedMinutesAgo: 4, purpose: "Story 2: cancellation of ORD-1039, which is still a draft." },
    await renderScenarioPo(scenarioOrder("ORD-1039"), "CANCELLATION"),
  );
  add(
    { file: "notice-office-closure.pdf", channel: "whatsapp", sender: "Unknown sender (sample)", receivedMinutesAgo: 2, purpose: "Story 1 failure path: not a known document type, a person must choose." },
    await renderUnknownDocument("NOTICE OF OFFICE CLOSURE", [
      "Dear partners,",
      "Our office will be closed for stocktaking on the last Friday of the month.",
      "Enquiries sent on that day will be answered on the following Monday.",
    ]),
  );
  return { files, manifest };
}
