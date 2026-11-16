// What: the golden dataset: sample PDFs covering every case in the brief, each with its expected type, fields and flags.
// Who calls it: scripts/generate-sample-data.ts writes the result to data/golden. scripts/golden-runner.ts checks the app against it.
// To extend: add a case below. Expected flags are written by hand from the scenario (never copied from the app's output).
import type { NavGoodsReceipt, NavPurchaseOrder } from "../../src/domain/navision";
import { formatMoney, toMoney } from "../../src/domain/money";
import type { GoldenCase, GoldenContext, GoldenDocument } from "./goldenTypes";
import { CUSTOMERS, DEMO_NOW, itemByNo, SELLER_NAME, SYNTHETIC_NOTE, UNKNOWN_CUSTOMERS, vendorByName } from "./master";
import {
  type CustomerPoSpec,
  type PricedLine,
  type ProofOfPaymentSpec,
  type RenderedPdf,
  renderCustomerPo,
  renderGoodsReceipt,
  renderImportPermit,
  renderInvoice,
  renderPackingList,
  renderProforma,
  renderProofOfPayment,
  renderTransportDocument,
  renderUnknownDocument,
  renderVendorPo,
} from "./pdfs";

export type GoldenDataset = {
  files: { path: string; bytes: Uint8Array }[];
  cases: GoldenCase[];
  context: GoldenContext;
  purchaseOrders: NavPurchaseOrder[];
  goodsReceipts: NavGoodsReceipt[];
};

/** A PO line for a real catalogue item. `writtenAs` prints a different part number (an alias or a typo). */
export function itemLine(
  itemNo: string,
  quantity: number | string,
  options: { unitPrice?: string | null; writtenAs?: string } = {},
): PricedLine {
  const item = itemByNo(itemNo);
  return {
    partNo: options.writtenAs ?? item.itemNo,
    description: item.description,
    quantity: String(quantity),
    unitPrice: options.unitPrice === undefined ? item.price : options.unitPrice,
  };
}

export function customerBlock(name: string): { name: string; address: string } {
  const known = CUSTOMERS.find((customer) => customer.name === name);
  if (known) return { name: known.name, address: `${known.address}, ${known.country}` };
  const unknown = UNKNOWN_CUSTOMERS.find((customer) => customer.name === name);
  if (unknown) return unknown;
  throw new Error(`No sample customer called ${name}`);
}

type PoShortcut = Omit<Partial<CustomerPoSpec>, "customer" | "poNumber" | "lines"> & {
  customer: string;
  poNumber: string | null;
  lines: PricedLine[];
};

/** Fills in the usual values so each case only states what makes it special. */
function po(spec: PoShortcut): CustomerPoSpec {
  return {
    layout: spec.layout ?? "A",
    marking: spec.marking,
    poNumber: spec.poNumber,
    poDate: spec.poDate ?? (spec.layout === "B" ? "12 Nov 2026" : "2026-11-12"),
    customer: customerBlock(spec.customer),
    currency: spec.currency ?? "USD",
    paymentTerms: spec.paymentTerms ?? "Advance payment",
    partialShipment: spec.partialShipment,
    deliveryRequiredBy: spec.deliveryRequiredBy ?? (spec.layout === "B" ? "26 Nov 2026" : "2026-11-26"),
    lines: spec.lines,
  };
}

export async function buildGoldenDataset(): Promise<GoldenDataset> {
  const files: { path: string; bytes: Uint8Array }[] = [];
  const cases: GoldenCase[] = [];
  const purchaseOrders: NavPurchaseOrder[] = [];
  const goodsReceipts: NavGoodsReceipt[] = [];

  /** Stores the PDF and returns its entry for a case. */
  const document = (name: string, expectedType: string, rendered: RenderedPdf): GoldenDocument => {
    const file = `files/${name}.pdf`;
    files.push({ path: file, bytes: rendered.bytes });
    return { file, expectedType, expectedFields: rendered.fields };
  };

  // ------------------------------------------------------------------------------ customer POs (stories 1 and 2)

  const poCase = async (
    id: string,
    title: string,
    spec: CustomerPoSpec,
    expectedFlags: GoldenCase["expectedFlags"],
    note?: string,
  ): Promise<void> => {
    cases.push({
      id,
      title,
      story: 1,
      kind: "customer_po",
      documents: [document(id, "customer_po", await renderCustomerPo(spec))],
      expectedFlags,
      ...(note ? { note } : {}),
    });
  };

  await poCase(
    "po-clean-a",
    "Clean PO, classic layout, three lines",
    po({ customer: "Lanka Tech Pte Ltd", poNumber: "LT-PO-2240", lines: [itemLine("CD-77", 50), itemLine("GH-310", 24), itemLine("HS-700", 40)] }),
    [],
  );
  await poCase(
    "po-clean-b",
    "Clean PO, compact layout with different labels and column order",
    po({ layout: "B", customer: "Dubai Dist LLC", poNumber: "DD-7755", lines: [itemLine("WC-1080", 30), itemLine("LP-15S", 60)] }),
    [],
  );
  await poCase(
    "po-clean-single",
    "Clean PO with one line and a quantity written with a thousands separator",
    po({ customer: "Colombo PC House", poNumber: "CP-1125", lines: [itemLine("MS-M185", "1,000")] }),
    [],
  );
  await poCase(
    "po-alias-hyphen",
    "Part number written with a hyphen (AB-1234X on the PO, AB1234X in Navision)",
    po({ customer: "Lanka Tech Pte Ltd", poNumber: "LT-PO-2241", lines: [itemLine("AB1234X", 100, { writtenAs: "AB-1234X" })] }),
    [{ code: "PART_ALIAS_SUGGESTED", field: "lines[0].partNo" }],
    "The deck's example. The system suggests AB1234X; a person confirms.",
  );
  await poCase(
    "po-alias-spacing",
    "Two part numbers written without their hyphen or with a space",
    po({
      layout: "B",
      customer: "Dhaka IT Solutions",
      poNumber: "DH-5090",
      lines: [itemLine("GH-310", 20, { writtenAs: "GH 310" }), itemLine("CD-77", 10, { writtenAs: "CD77" }), itemLine("HS-700", 15)],
    }),
    [
      { code: "PART_ALIAS_SUGGESTED", field: "lines[0].partNo" },
      { code: "PART_ALIAS_SUGGESTED", field: "lines[1].partNo" },
    ],
  );
  await poCase(
    "po-alias-remembered",
    "Customer's own part code that was fixed before and remembered (alias memory)",
    po({ customer: "Lanka Tech Pte Ltd", poNumber: "LT-PO-2242", lines: [itemLine("AB1234X", 50, { writtenAs: "LT-DOCK-01" })] }),
    [{ code: "PART_ALIAS_SUGGESTED", field: "lines[0].partNo" }],
    "LT-DOCK-01 looks nothing like AB1234X; the suggestion can only come from the remembered alias in context.json.",
  );
  await poCase(
    "po-alias-typo",
    "Part number with one wrong character",
    po({ customer: "Karachi Compute", poNumber: "KC-0998", lines: [itemLine("KM-2210", 10, { writtenAs: "KM-2211" })] }),
    [{ code: "PART_ALIAS_SUGGESTED", field: "lines[0].partNo" }],
  );
  await poCase(
    "po-unknown-part",
    "A part that is not in Navision and looks like nothing in it",
    po({
      customer: "Muscat Micro Trading",
      poNumber: "MM-3320",
      lines: [{ partNo: "ZX-9907", description: "Industrial tablet 10-inch", quantity: "5", unitPrice: "310.00" }, itemLine("FD-64U3", 100)],
    }),
    [{ code: "PART_NOT_FOUND", field: "lines[0].partNo" }],
  );
  await poCase(
    "po-unknown-part-b",
    "Unknown part on the compact layout",
    po({
      layout: "B",
      customer: "Nova Controls",
      poNumber: "NC-3370",
      lines: [itemLine("TC-LBL4", 3), { partNo: "QQ-00417", description: "Barcode scanner cradle", quantity: "12", unitPrice: "18.75" }],
    }),
    [{ code: "PART_NOT_FOUND", field: "lines[1].partNo" }],
  );
  await poCase(
    "po-price-lower",
    "Unit price below the Navision price (a special deal)",
    po({ customer: "Beacon Devices", poNumber: "BD-PO-5510", lines: [itemLine("EF-9", 10, { unitPrice: "132.00" })] }),
    [{ code: "PRICE_MISMATCH", field: "lines[0].unitPrice" }],
    "Spectra has case-by-case pricing: staff accept the difference with a reason (override) or change the price (fix).",
  );
  await poCase(
    "po-price-higher",
    "Unit price above the Navision price",
    po({ layout: "B", customer: "Nova Controls", poNumber: "NC-3371", lines: [itemLine("SW-1608", 4, { unitPrice: "92.50" }), itemLine("RT-AX55", 6)] }),
    [{ code: "PRICE_MISMATCH", field: "lines[0].unitPrice" }],
  );
  await poCase(
    "po-qty-above-stock",
    "Quantity above the stock on hand (200 ordered, 160 in stock)",
    po({ customer: "Alpine Manufacturing", poNumber: "AM-9901", lines: [itemLine("AB1234X", 200)] }),
    [{ code: "QTY_EXCEEDS_STOCK", field: "lines[0].quantity" }],
    "Should suggest an SPR for the 40 units that are short.",
  );
  await poCase(
    "po-qty-above-stock-split",
    "Two lines of the same part that together exceed the stock",
    po({ customer: "Karachi Compute", poNumber: "KC-0999", lines: [itemLine("NAS-2B", 8), itemLine("NAS-2B", 6), itemLine("FD-64U3", 50)] }),
    [{ code: "QTY_EXCEEDS_STOCK", field: "lines[0].quantity" }],
  );
  await poCase(
    "po-unknown-customer",
    "Customer that is not in Navision (needs a new customer card)",
    po({ customer: "Kathmandu Digital Hub", poNumber: "KDH-0007", lines: [itemLine("WC-1080", 12), itemLine("HS-700", 12)] }),
    [{ code: "CUSTOMER_NOT_FOUND", field: "customerName" }],
  );
  await poCase(
    "po-unknown-customer-b",
    "Unknown customer on the compact layout",
    po({ layout: "B", customer: "Male Island Tech", poNumber: "MIT-112", lines: [itemLine("LP-15S", 25)] }),
    [{ code: "CUSTOMER_NOT_FOUND", field: "customerName" }],
  );
  await poCase(
    "po-amended",
    "Amended PO for an order that already exists",
    po({ customer: "Lanka Tech Pte Ltd", poNumber: "LT-PO-2201", marking: "AMENDMENT 1", lines: [itemLine("AB1234X", 150)] }),
    [{ code: "PO_AMENDMENT" }],
    "LT-PO-2201 is in context.json as ORD-0901, so this must link to it and must not be called a duplicate.",
  );
  await poCase(
    "po-amended-unknown",
    "Amended PO whose earlier version was never captured",
    po({ layout: "B", customer: "Muscat Micro Trading", poNumber: "MM-4444", marking: "AMENDMENT 2", lines: [itemLine("PSU-550B", 10)] }),
    [{ code: "PREVIOUS_PO_NOT_FOUND" }],
  );
  await poCase(
    "po-cancelled",
    "Cancellation of a PO that already exists",
    po({ layout: "B", customer: "Dubai Dist LLC", poNumber: "DD-7700", marking: "CANCELLATION", lines: [itemLine("EF-9", 20), itemLine("GH-310", 150)] }),
    [{ code: "PO_CANCELLATION" }],
  );
  await poCase(
    "po-partial",
    "Quantity above stock where the customer allows partial shipment",
    po({ customer: "Meridian Parts", poNumber: "MP-0440", partialShipment: "Allowed", lines: [itemLine("PRJ-X20", 12)] }),
    [{ code: "QTY_EXCEEDS_STOCK", field: "lines[0].quantity" }],
    "Partial fulfilment: 9 can ship now, 3 remain.",
  );
  await poCase(
    "po-duplicate",
    "The same PO number arriving again with no amendment marking",
    po({ customer: "Colombo PC House", poNumber: "CP-1100", lines: [itemLine("KM-2210", 20), itemLine("TB-240", 25)] }),
    [{ code: "DUPLICATE_PO", field: "poNumber" }],
  );
  await poCase(
    "po-missing-po-number",
    "PO with no PO number on it",
    po({ customer: "Dhaka IT Solutions", poNumber: null, lines: [itemLine("MS-M185", 40)] }),
    [{ code: "MISSING_FIELD", field: "poNumber" }],
  );
  await poCase(
    "po-missing-price",
    "PO where one line has no unit price",
    po({ layout: "B", customer: "Beacon Devices", poNumber: "BD-PO-5511", lines: [itemLine("RAM-16D4", 20), itemLine("PSU-550B", 5, { unitPrice: null })] }),
    [{ code: "MISSING_FIELD", field: "lines[1].unitPrice" }],
  );
  await poCase(
    "po-combined",
    "Several problems at once: alias, quantity above stock and a price difference",
    po({
      customer: "Dhaka IT Solutions",
      poNumber: "DH-5091",
      lines: [itemLine("AB1234X", 300, { writtenAs: "AB-1234X", unitPrice: "11.90" }), itemLine("EF-9", 60), itemLine("UPS-650", 5, { unitPrice: "55.00" })],
    }),
    [
      { code: "PART_ALIAS_SUGGESTED", field: "lines[0].partNo" },
      { code: "QTY_EXCEEDS_STOCK", field: "lines[1].quantity" },
      { code: "PRICE_MISMATCH", field: "lines[2].unitPrice" },
    ],
    "Price and stock are only checked once a line's part number is a Navision item, so line 1 shows the alias flag only.",
  );

  // ------------------------------------------------------------------------------ proof of payment (story 4)

  const proofCase = async (
    id: string,
    title: string,
    spec: ProofOfPaymentSpec,
    expectedFlags: GoldenCase["expectedFlags"],
    note?: string,
  ): Promise<void> => {
    cases.push({
      id,
      title,
      story: 4,
      kind: "proof_of_payment",
      documents: [document(id, "proof_of_payment", await renderProofOfPayment(spec))],
      expectedFlags,
      ...(note ? { note } : {}),
    });
  };

  await proofCase(
    "pop-exact",
    "Payment that matches the PI exactly",
    { layout: "A", payerName: "Lanka Tech Pte Ltd", amount: "2,480.00", currency: "USD", paymentDate: "2026-11-13", reference: "PI-0901", bankReference: "TT2611130001" },
    [],
  );
  await proofCase(
    "pop-exact-po-reference",
    "Exact payment that quotes the customer's PO number instead of the PI number",
    { layout: "B", payerName: "Dubai Dist LLC", amount: "8,950.00", currency: "USD", paymentDate: "13 Nov 2026", reference: "DD-7700", bankReference: "RB-778120" },
    [],
  );
  await proofCase(
    "pop-short",
    "Payment of less than the PI amount",
    { layout: "A", payerName: "Lanka Tech Pte Ltd", amount: "2,400.00", currency: "USD", paymentDate: "2026-11-13", reference: "PI-0901", bankReference: "TT2611130002" },
    [{ code: "PAYMENT_SHORT", field: "amount" }],
    "80.00 short, for example bank charges deducted.",
  );
  await proofCase(
    "pop-over",
    "Payment of more than the PI amount",
    { layout: "B", payerName: "Dubai Dist LLC", amount: "9,000.00", currency: "USD", paymentDate: "14 Nov 2026", reference: "PI-0902", bankReference: "RB-778121" },
    [{ code: "PAYMENT_OVER", field: "amount" }],
  );
  await proofCase(
    "pop-wrong-reference",
    "Payment whose reference matches no open PI",
    { layout: "A", payerName: "Dhaka IT Solutions", amount: "1,250.00", currency: "USD", paymentDate: "2026-11-14", reference: "PI-0999", bankReference: "TT2611140003" },
    [{ code: "PAYMENT_REFERENCE_NOT_FOUND", field: "reference" }],
  );
  await proofCase(
    "pop-duplicate",
    "The same proof of payment sent a second time",
    { layout: "A", payerName: "Colombo PC House", amount: "5,300.00", currency: "USD", paymentDate: "2026-11-12", reference: "PI-0903", bankReference: "TT2611120004" },
    [{ code: "PAYMENT_DUPLICATE", field: "reference" }],
    "context.json already holds a proof with this reference, amount and payer.",
  );
  await proofCase(
    "pop-currency",
    "Payment in a different currency from the PI",
    { layout: "B", payerName: "Lanka Tech Pte Ltd", amount: "2,480.00", currency: "SGD", paymentDate: "14 Nov 2026", reference: "PI-0901", bankReference: "RB-778122" },
    [{ code: "PAYMENT_CURRENCY_MISMATCH", field: "currency" }],
  );

  // ------------------------------------------------------------------------------ goods receipts and shipment documents (story 5)

  type ShipmentCase = {
    id: string;
    title: string;
    poNumber: string;
    vendor: string;
    /** What Spectra ordered (the vendor PO in Navision). */
    ordered: { itemNo: string; quantity: number }[];
    /** Quantities on the vendor invoice; defaults to what was ordered. `false` leaves the invoice out. */
    invoiced?: { partNo: string; quantity: number }[] | false;
    packed?: { partNo: string; quantity: number }[] | false;
    transport?: "air" | "sea" | false;
    permit?: boolean;
    /** Adds a goods receipt note PDF (evidence only; the received quantity still comes from Navision). */
    goodsReceiptNote?: boolean;
    /** Received quantity per part in Navision; null means no goods receipt has been recorded yet. */
    received: { itemNo: string; quantity: number }[] | null;
    documentsDueAt?: string;
    expectedFlags: GoldenCase["expectedFlags"];
    note?: string;
  };

  const shipmentCase = async (spec: ShipmentCase): Promise<void> => {
    const vendor = vendorByName(spec.vendor);
    const description = (partNo: string): string => {
      const item = spec.ordered.map((line) => itemByNo(line.itemNo)).find((candidate) => candidate.itemNo === partNo);
      return item?.description ?? itemByNo(spec.ordered[0].itemNo).description;
    };
    const orderedAsParts = spec.ordered.map((line) => ({ partNo: line.itemNo, quantity: line.quantity }));
    const documents: GoldenDocument[] = [];
    const number = spec.poNumber.replace("PO-", "");

    if (spec.invoiced !== false) {
      const invoiced = spec.invoiced ?? orderedAsParts;
      documents.push(
        document(
          `${spec.id}-invoice`,
          "vendor_invoice",
          await renderInvoice({
            invoiceNumber: `INV-${number}1`,
            invoiceDate: "2026-11-10",
            issuerName: vendor.name,
            billTo: SELLER_NAME,
            poNumber: spec.poNumber,
            currency: "USD",
            lines: invoiced.map((line) => ({
              partNo: line.partNo,
              description: description(line.partNo),
              quantity: String(line.quantity),
              unitPrice: itemByNo(spec.ordered[0].itemNo).purchasePrice,
            })),
          }),
        ),
      );
    }
    if (spec.packed !== false) {
      const packed = spec.packed ?? orderedAsParts;
      documents.push(
        document(
          `${spec.id}-packing-list`,
          "packing_list",
          await renderPackingList({
            packingListNumber: `PL-${number}2`,
            packingDate: "2026-11-10",
            shipperName: vendor.name,
            consigneeName: SELLER_NAME,
            poNumber: spec.poNumber,
            lines: packed.map((line) => ({
              partNo: line.partNo,
              description: description(line.partNo),
              quantity: String(line.quantity),
              cartons: String(Math.max(1, Math.ceil(line.quantity / 20))),
            })),
          }),
        ),
      );
    }
    const transport = spec.transport === undefined ? "air" : spec.transport;
    if (transport) {
      documents.push(
        document(
          `${spec.id}-${transport === "air" ? "awb" : "bl"}`,
          "awb_bl",
          await renderTransportDocument({
            mode: transport,
            documentNumber: transport === "air" ? `618-${number}4405` : `SOL${number}7731`,
            shipperName: vendor.name,
            consigneeName: SELLER_NAME,
            origin: transport === "air" ? "Sample Origin Airport" : "Sample Origin Port",
            destination: transport === "air" ? "Singapore Changi Airport" : "Port of Singapore",
            pieces: String(Math.max(1, Math.ceil(spec.ordered[0].quantity / 20))),
            reference: spec.poNumber,
          }),
        ),
      );
    }
    if (spec.permit !== false) {
      documents.push(
        document(
          `${spec.id}-permit`,
          "import_permit",
          await renderImportPermit({
            permitNumber: `IP-2026-${number}`,
            importerName: SELLER_NAME,
            issueDate: "2026-11-11",
            validUntil: "2026-12-11",
            reference: spec.poNumber,
            goods: description(spec.ordered[0].itemNo),
          }),
        ),
      );
    }
    if (spec.goodsReceiptNote && spec.received) {
      documents.push(
        document(
          `${spec.id}-grn`,
          "goods_receipt",
          await renderGoodsReceipt({
            grNumber: `GR-${number}`,
            receivedDate: "2026-11-14",
            vendorName: vendor.name,
            poNumber: spec.poNumber,
            lines: spec.received.map((line) => ({ partNo: line.itemNo, description: description(line.itemNo), quantity: String(line.quantity) })),
          }),
        ),
      );
    }

    const total = spec.ordered.reduce(
      (sum, line) => sum.plus(toMoney(itemByNo(line.itemNo).purchasePrice).times(line.quantity)),
      toMoney("0"),
    );
    purchaseOrders.push({
      poNumber: spec.poNumber,
      vendorId: vendor.vendorId,
      vendorName: vendor.name,
      orderDate: "2026-10-28",
      forCustomerPoNumber: null,
      documentsDueAt: spec.documentsDueAt ?? "2026-12-15T08:00:00.000Z",
      paymentDueDate: "2026-12-20",
      paid: false,
      currency: "USD",
      totalAmount: formatMoney(total),
      lines: spec.ordered.map((line) => ({ itemNo: line.itemNo, quantity: line.quantity, unitPrice: itemByNo(line.itemNo).purchasePrice })),
    });
    if (spec.received) {
      goodsReceipts.push({
        grNo: `GR-${number}`,
        poNumber: spec.poNumber,
        receivedAt: "2026-11-14T03:00:00.000Z",
        lines: spec.received.map((line) => ({ itemNo: line.itemNo, receivedQty: line.quantity })),
      });
    }
    cases.push({
      id: spec.id,
      title: spec.title,
      story: 5,
      kind: "shipment",
      documents,
      shipment: { direction: "inbound", reference: spec.poNumber },
      expectedFlags: spec.expectedFlags,
      ...(spec.note ? { note: spec.note } : {}),
    });
  };

  await shipmentCase({
    id: "ship-receipt-short",
    title: "Invoice 100, packing list 100, received 95",
    poNumber: "PO-9101",
    vendor: "Pacific Components",
    ordered: [{ itemNo: "PC-4402", quantity: 100 }],
    received: [{ itemNo: "PC-4402", quantity: 95 }],
    expectedFlags: [{ code: "QTY_VARIANCE", field: "PC-4402" }],
    note: "The deck's example: 5 units short.",
  });
  await shipmentCase({
    id: "ship-all-matching",
    title: "Invoice, packing list and receipt all agree and every document is present",
    poNumber: "PO-9102",
    vendor: "Apex Industrial",
    ordered: [{ itemNo: "KM-2210", quantity: 240 }],
    received: [{ itemNo: "KM-2210", quantity: 240 }],
    expectedFlags: [],
  });
  await shipmentCase({
    id: "ship-invoice-part-mismatch",
    title: "Vendor invoice lists a different part number from the vendor PO",
    poNumber: "PO-9103",
    vendor: "Delta Parts",
    ordered: [{ itemNo: "RT-AX55", quantity: 60 }],
    invoiced: [{ partNo: "RT-AX56", quantity: 60 }],
    transport: "sea",
    received: [{ itemNo: "RT-AX55", quantity: 60 }],
    expectedFlags: [{ code: "INVOICE_PART_MISMATCH", field: "RT-AX56" }],
  });
  await shipmentCase({
    id: "ship-packing-list-differs",
    title: "Packing list and receipt show fewer units than the invoice",
    poNumber: "PO-9104",
    vendor: "Nova Logistics",
    ordered: [{ itemNo: "HS-700", quantity: 120 }],
    packed: [{ partNo: "HS-700", quantity: 110 }],
    received: [{ itemNo: "HS-700", quantity: 110 }],
    expectedFlags: [{ code: "QTY_VARIANCE", field: "HS-700" }],
  });
  await shipmentCase({
    id: "ship-over-receipt",
    title: "More units received than invoiced",
    poNumber: "PO-9105",
    vendor: "Beta Parts",
    ordered: [{ itemNo: "GH-310", quantity: 100 }],
    received: [{ itemNo: "GH-310", quantity: 104 }],
    expectedFlags: [{ code: "QTY_VARIANCE", field: "GH-310" }],
  });
  await shipmentCase({
    id: "ship-awb-missing",
    title: "AWB or BL missing",
    poNumber: "PO-9106",
    vendor: "Alpha Supply",
    ordered: [{ itemNo: "CD-77", quantity: 500 }],
    transport: false,
    received: [{ itemNo: "CD-77", quantity: 500 }],
    expectedFlags: [{ code: "DOCUMENT_MISSING", field: "awb_bl" }],
  });
  await shipmentCase({
    id: "ship-permit-missing",
    title: "Import permit missing",
    poNumber: "PO-9107",
    vendor: "Pacific Components",
    ordered: [{ itemNo: "RAM-16D4", quantity: 80 }],
    permit: false,
    received: [{ itemNo: "RAM-16D4", quantity: 80 }],
    expectedFlags: [{ code: "DOCUMENT_MISSING", field: "import_permit" }],
  });
  await shipmentCase({
    id: "ship-all-present-bl",
    title: "Sea shipment with a bill of lading: every document present",
    poNumber: "PO-9108",
    vendor: "Delta Parts",
    ordered: [{ itemNo: "PSU-550B", quantity: 40 }],
    transport: "sea",
    received: [{ itemNo: "PSU-550B", quantity: 40 }],
    expectedFlags: [],
  });
  await shipmentCase({
    id: "ship-no-receipt-yet",
    title: "Documents are in but Navision has no goods receipt yet",
    poNumber: "PO-9109",
    vendor: "Apex Industrial",
    ordered: [{ itemNo: "WC-1080", quantity: 150 }],
    received: null,
    expectedFlags: [{ code: "GOODS_RECEIPT_PENDING" }],
  });
  await shipmentCase({
    id: "ship-with-receipt-note",
    title: "A goods receipt note PDF is among the documents; all quantities agree",
    poNumber: "PO-9110",
    vendor: "Nova Logistics",
    ordered: [{ itemNo: "LP-15S", quantity: 200 }],
    goodsReceiptNote: true,
    received: [{ itemNo: "LP-15S", quantity: 200 }],
    expectedFlags: [],
  });
  await shipmentCase({
    id: "ship-awb-due-soon",
    title: "AWB or BL still missing six hours before the documents are due",
    poNumber: "PO-9111",
    vendor: "Beta Parts",
    ordered: [{ itemNo: "UPS-650", quantity: 30 }],
    transport: false,
    received: [{ itemNo: "UPS-650", quantity: 30 }],
    documentsDueAt: new Date(DEMO_NOW.getTime() + 6 * 60 * 60 * 1000).toISOString(),
    expectedFlags: [{ code: "DOCUMENT_DUE_SOON", field: "awb_bl" }],
  });

  // ------------------------------------------------------------------------------ classification only

  cases.push({
    id: "doc-proforma-invoice",
    title: "A proforma invoice is recognised and read (filed only, no workflow yet)",
    story: 1,
    kind: "classify_only",
    documents: [
      document(
        "doc-proforma-invoice",
        "proforma_invoice",
        await renderProforma({
          piNumber: "PI-0901",
          piDate: "2026-11-05",
          customerName: "Lanka Tech Pte Ltd",
          poNumber: "LT-PO-2201",
          currency: "USD",
          lines: [itemLine("AB1234X", 200)],
        }),
      ),
    ],
    expectedFlags: [],
  });
  cases.push({
    id: "doc-vendor-po",
    title: "A PO issued by Spectra to a vendor is not mistaken for a customer PO",
    story: 1,
    kind: "classify_only",
    documents: [
      document(
        "doc-vendor-po",
        "vendor_po",
        await renderVendorPo({
          poNumber: "PO-9102",
          orderDate: "2026-10-28",
          vendorName: "Apex Industrial",
          currency: "USD",
          lines: [{ ...itemLine("KM-2210", 240), unitPrice: itemByNo("KM-2210").purchasePrice }],
        }),
      ),
    ],
    expectedFlags: [],
  });
  cases.push({
    id: "doc-unknown",
    title: "A PDF that is none of the known document types",
    story: 1,
    kind: "classify_only",
    documents: [
      document(
        "doc-unknown",
        "unknown",
        await renderUnknownDocument("NOTICE OF OFFICE CLOSURE", [
          "Dear partners,",
          "Our office will be closed for stocktaking on the last Friday of the month.",
          "Enquiries sent on that day will be answered on the following Monday.",
          "Thank you for your understanding.",
        ]),
      ),
    ],
    expectedFlags: [],
    note: "The type must come back as unknown, so a person has to choose it.",
  });

  const context: GoldenContext = {
    _note: SYNTHETIC_NOTE,
    now: DEMO_NOW.toISOString(),
    aliases: [{ fromPartNo: "LT-DOCK-01", toItemNo: "AB1234X" }],
    existingOrders: [
      { orderNo: "ORD-0901", poNumber: "LT-PO-2201", customerName: "Lanka Tech Pte Ltd", status: "open" },
      { orderNo: "ORD-0902", poNumber: "DD-7700", customerName: "Dubai Dist LLC", status: "open" },
      { orderNo: "ORD-0903", poNumber: "CP-1100", customerName: "Colombo PC House", status: "open" },
    ],
    openInvoices: [
      { orderNo: "ORD-0901", piNumber: "PI-0901", poNumber: "LT-PO-2201", customerName: "Lanka Tech Pte Ltd", currency: "USD", amount: "2480.00" },
      { orderNo: "ORD-0902", piNumber: "PI-0902", poNumber: "DD-7700", customerName: "Dubai Dist LLC", currency: "USD", amount: "8950.00" },
      { orderNo: "ORD-0903", piNumber: "PI-0903", poNumber: "CP-1100", customerName: "Colombo PC House", currency: "USD", amount: "5300.00" },
    ],
    priorProofs: [{ reference: "PI-0903", amount: "5300.00", currency: "USD", payerName: "Colombo PC House" }],
  };

  return { files, cases, context, purchaseOrders, goodsReceipts };
}
