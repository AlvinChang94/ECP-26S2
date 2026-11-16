// What: draws every kind of synthetic sample PDF and returns, with the bytes, the field values a reader should find in it.
// Who calls it: golden.ts, scenario.ts and replay.ts in this folder.
// To extend: add a render function for a new document type; return the expected fields so the golden test can check extraction.
import Decimal from "decimal.js";
import { displayMoney, formatMoney, parseMoney, parseQuantity } from "../../src/domain/money";
import { renderProformaInvoice } from "../../src/adapters/pdf/proformaInvoicePdf";
import { PdfWriter } from "../../src/adapters/pdf/pdfWriter";
import { SELLER_NAME } from "./master";

export const SAMPLE_FOOTER = "SYNTHETIC SAMPLE - generated test data for the Spectra OrderFlow POC. Not a real document.";

/** The bytes of a PDF plus what an extractor is expected to read from it (field key -> text, or null when absent). */
export type RenderedPdf = { bytes: Uint8Array; fields: Record<string, string | null> };

export type PricedLine = { partNo: string; description: string; quantity: string; unitPrice: string | null };
export type QuantityLine = { partNo: string; description: string; quantity: string; cartons?: string };

/** quantity x unit price as display text ("2,480.00"), or null when either part is missing. */
function amountText(line: PricedLine): string | null {
  const quantity = parseQuantity(line.quantity);
  const price = parseMoney(line.unitPrice);
  if (quantity === null || price === null) return null;
  return displayMoney(formatMoney(price.times(quantity)));
}

function totalText(lines: PricedLine[]): string {
  let total = new Decimal(0);
  for (const line of lines) {
    const quantity = parseQuantity(line.quantity);
    const price = parseMoney(line.unitPrice);
    if (quantity !== null && price !== null) total = total.plus(price.times(quantity));
  }
  return displayMoney(formatMoney(total));
}

function pricedLineFields(lines: PricedLine[]): Record<string, string | null> {
  const fields: Record<string, string | null> = {};
  lines.forEach((line, index) => {
    fields[`lines[${index}].partNo`] = line.partNo;
    fields[`lines[${index}].description`] = line.description;
    fields[`lines[${index}].quantity`] = line.quantity;
    fields[`lines[${index}].unitPrice`] = line.unitPrice;
    fields[`lines[${index}].lineTotal`] = amountText(line);
  });
  return fields;
}

// ---------------------------------------------------------------------------------------- customer PO

export type CustomerPoSpec = {
  layout: "A" | "B";
  /** "AMENDMENT 1" or "CANCELLATION". Leave out for a normal PO. */
  marking?: string;
  /** null leaves the PO number off the page (for the "missing field" case). */
  poNumber: string | null;
  poDate: string;
  customer: { name: string; address: string };
  currency: string;
  paymentTerms: string;
  partialShipment?: string;
  deliveryRequiredBy?: string;
  lines: PricedLine[];
};

export async function renderCustomerPo(spec: CustomerPoSpec): Promise<RenderedPdf> {
  const pdf = await PdfWriter.create({ title: `Purchase order ${spec.poNumber ?? ""}`.trim(), footer: SAMPLE_FOOTER });
  const total = totalText(spec.lines);

  if (spec.layout === "A") {
    pdf.text(pdf.left, 48, spec.customer.name, { size: 14, bold: true });
    pdf.text(pdf.left, 68, spec.customer.address, { size: 9, grey: true });
    pdf.text(330, 48, "PURCHASE ORDER", { size: 16, bold: true });
    if (spec.marking) pdf.text(330, 70, spec.marking, { size: 12, bold: true });

    pdf.labelValue(pdf.left, 100, "To", SELLER_NAME);
    if (spec.poNumber) pdf.labelValue(330, 100, "PO Number", spec.poNumber);
    pdf.labelValue(pdf.left, 116, "Customer", spec.customer.name);
    pdf.labelValue(330, 116, "PO Date", spec.poDate);
    pdf.labelValue(pdf.left, 132, "Address", spec.customer.address);
    pdf.labelValue(pdf.left, 148, "Payment terms", spec.paymentTerms);
    pdf.labelValue(330, 148, "Currency", spec.currency);
    if (spec.partialShipment) pdf.labelValue(pdf.left, 164, "Partial shipment", spec.partialShipment);
    if (spec.deliveryRequiredBy) pdf.labelValue(330, 164, "Delivery required by", spec.deliveryRequiredBy);

    const bottom = pdf.table(
      204,
      [
        { header: "Line", width: 40 },
        { header: "Part No", width: 90 },
        { header: "Description", width: 190 },
        { header: "Qty", width: 50 },
        { header: "Unit Price", width: 65 },
        { header: "Amount", width: 64 },
      ],
      spec.lines.map((line, index) => [
        String(index + 1),
        line.partNo,
        line.description,
        line.quantity,
        line.unitPrice ?? "",
        amountText(line) ?? "",
      ]),
    );
    pdf.labelValue(330, bottom + 6, "Total", total);
    pdf.labelValue(pdf.left, bottom + 40, "Authorised by", "Purchasing department");
  } else {
    pdf.text(pdf.left, 48, "PURCHASE ORDER", { size: 16, bold: true });
    if (spec.marking) pdf.text(pdf.left, 70, spec.marking, { size: 12, bold: true });

    if (spec.poNumber) pdf.labelValue(pdf.left, 100, "Order No.", spec.poNumber);
    pdf.labelValue(330, 100, "Date", spec.poDate);
    pdf.labelValue(pdf.left, 116, "Buyer", spec.customer.name);
    pdf.labelValue(330, 116, "Currency", spec.currency);
    pdf.labelValue(pdf.left, 132, "Buyer address", spec.customer.address);
    pdf.labelValue(pdf.left, 148, "Vendor", SELLER_NAME);
    pdf.labelValue(330, 148, "Terms", spec.paymentTerms);
    if (spec.partialShipment) pdf.labelValue(pdf.left, 164, "Part shipment", spec.partialShipment);
    if (spec.deliveryRequiredBy) pdf.labelValue(330, 164, "Required by", spec.deliveryRequiredBy);

    const bottom = pdf.table(
      204,
      [
        { header: "Item Code", width: 95 },
        { header: "Qty", width: 50 },
        { header: "Details", width: 200 },
        { header: "Price", width: 70 },
        { header: "Line Total", width: 80 },
      ],
      spec.lines.map((line) => [line.partNo, line.quantity, line.description, line.unitPrice ?? "", amountText(line) ?? ""]),
    );
    pdf.labelValue(330, bottom + 6, "Grand Total", total);
  }

  return {
    bytes: await pdf.save(),
    fields: {
      poNumber: spec.poNumber,
      poKind: spec.marking ?? null,
      orderDate: spec.poDate,
      customerName: spec.customer.name,
      customerAddress: spec.customer.address,
      currency: spec.currency,
      paymentTerms: spec.paymentTerms,
      partialShipment: spec.partialShipment ?? null,
      totalAmount: total,
      ...pricedLineFields(spec.lines),
    },
  };
}

// ---------------------------------------------------------------------------------------- proof of payment

export type ProofOfPaymentSpec = {
  layout: "A" | "B";
  payerName: string;
  amount: string; // as printed, for example "2,480.00"
  currency: string;
  paymentDate: string;
  reference: string;
  bankReference: string;
};

export async function renderProofOfPayment(spec: ProofOfPaymentSpec): Promise<RenderedPdf> {
  const pdf = await PdfWriter.create({ title: `Proof of payment ${spec.bankReference}`, footer: SAMPLE_FOOTER });
  if (spec.layout === "A") {
    pdf.text(pdf.left, 48, "Sample Bank (synthetic)", { size: 14, bold: true });
    pdf.text(330, 48, "PAYMENT ADVICE", { size: 16, bold: true });
    pdf.labelValue(pdf.left, 100, "Remitter", spec.payerName);
    pdf.labelValue(330, 100, "Value Date", spec.paymentDate);
    pdf.labelValue(pdf.left, 116, "Beneficiary", SELLER_NAME);
    pdf.labelValue(330, 116, "Transaction ID", spec.bankReference);
    pdf.labelValue(pdf.left, 132, "Currency", spec.currency);
    pdf.labelValue(330, 132, "Amount", spec.amount);
    pdf.labelValue(pdf.left, 148, "Payment Reference", spec.reference);
    pdf.text(pdf.left, 190, "This advice confirms that the transfer above was sent.", { size: 9, grey: true });
  } else {
    pdf.text(pdf.left, 48, spec.payerName, { size: 14, bold: true });
    pdf.text(330, 48, "REMITTANCE ADVICE", { size: 16, bold: true });
    pdf.labelValue(pdf.left, 100, "From", spec.payerName);
    pdf.labelValue(330, 100, "Date Paid", spec.paymentDate);
    pdf.labelValue(pdf.left, 116, "To", SELLER_NAME);
    pdf.labelValue(330, 116, "Bank Ref", spec.bankReference);
    pdf.labelValue(pdf.left, 132, "Invoice Ref", spec.reference);
    // In this layout the currency is written inside the amount, as many remittance advices do.
    pdf.labelValue(pdf.left, 148, "Amount Paid", `${spec.currency} ${spec.amount}`);
  }
  return {
    bytes: await pdf.save(),
    fields: {
      payerName: spec.payerName,
      beneficiaryName: SELLER_NAME,
      amount: spec.amount,
      currency: spec.currency,
      paymentDate: spec.paymentDate,
      reference: spec.reference,
      bankReference: spec.bankReference,
    },
  };
}

// ---------------------------------------------------------------------------------------- invoice

export type InvoiceSpec = {
  title?: "TAX INVOICE" | "COMMERCIAL INVOICE";
  invoiceNumber: string;
  invoiceDate: string;
  /** Who issued the invoice: the vendor (purchases) or Spectra (sales). */
  issuerName: string;
  billTo: string;
  poNumber: string;
  currency: string;
  lines: PricedLine[];
};

export async function renderInvoice(spec: InvoiceSpec): Promise<RenderedPdf> {
  const pdf = await PdfWriter.create({ title: `Invoice ${spec.invoiceNumber}`, footer: SAMPLE_FOOTER });
  const total = totalText(spec.lines);
  pdf.text(pdf.left, 48, spec.issuerName, { size: 14, bold: true });
  pdf.text(330, 48, spec.title ?? "TAX INVOICE", { size: 16, bold: true });
  pdf.labelValue(pdf.left, 100, "Invoice No", spec.invoiceNumber);
  pdf.labelValue(330, 100, "Invoice Date", spec.invoiceDate);
  pdf.labelValue(pdf.left, 116, "Supplier", spec.issuerName);
  pdf.labelValue(330, 116, "PO Number", spec.poNumber);
  pdf.labelValue(pdf.left, 132, "Bill To", spec.billTo);
  pdf.labelValue(330, 132, "Currency", spec.currency);
  const bottom = pdf.table(
    176,
    [
      { header: "Part No", width: 90 },
      { header: "Description", width: 215 },
      { header: "Qty", width: 55 },
      { header: "Unit Price", width: 70 },
      { header: "Amount", width: 69 },
    ],
    spec.lines.map((line) => [line.partNo, line.description, line.quantity, line.unitPrice ?? "", amountText(line) ?? ""]),
  );
  pdf.labelValue(330, bottom + 6, "Total", total);
  return {
    bytes: await pdf.save(),
    fields: {
      invoiceNumber: spec.invoiceNumber,
      invoiceDate: spec.invoiceDate,
      vendorName: spec.issuerName,
      poNumber: spec.poNumber,
      currency: spec.currency,
      totalAmount: total,
      ...pricedLineFields(spec.lines),
    },
  };
}

// ---------------------------------------------------------------------------------------- packing list

export type PackingListSpec = {
  packingListNumber: string;
  packingDate: string;
  shipperName: string;
  consigneeName: string;
  poNumber: string;
  lines: QuantityLine[];
};

export async function renderPackingList(spec: PackingListSpec): Promise<RenderedPdf> {
  const pdf = await PdfWriter.create({ title: `Packing list ${spec.packingListNumber}`, footer: SAMPLE_FOOTER });
  pdf.text(pdf.left, 48, spec.shipperName, { size: 14, bold: true });
  pdf.text(330, 48, "PACKING LIST", { size: 16, bold: true });
  pdf.labelValue(pdf.left, 100, "Packing List No", spec.packingListNumber);
  pdf.labelValue(330, 100, "Date", spec.packingDate);
  pdf.labelValue(pdf.left, 116, "Shipper", spec.shipperName);
  pdf.labelValue(330, 116, "PO Number", spec.poNumber);
  pdf.labelValue(pdf.left, 132, "Consignee", spec.consigneeName);
  pdf.table(
    176,
    [
      { header: "Part No", width: 100 },
      { header: "Description", width: 240 },
      { header: "Qty", width: 70 },
      { header: "Cartons", width: 80 },
    ],
    spec.lines.map((line) => [line.partNo, line.description, line.quantity, line.cartons ?? ""]),
  );
  const fields: Record<string, string | null> = {
    packingListNumber: spec.packingListNumber,
    packingDate: spec.packingDate,
    shipperName: spec.shipperName,
    consigneeName: spec.consigneeName,
    poNumber: spec.poNumber,
  };
  spec.lines.forEach((line, index) => {
    fields[`lines[${index}].partNo`] = line.partNo;
    fields[`lines[${index}].description`] = line.description;
    fields[`lines[${index}].quantity`] = line.quantity;
    fields[`lines[${index}].cartons`] = line.cartons ?? null;
  });
  return { bytes: await pdf.save(), fields };
}

// ---------------------------------------------------------------------------------------- goods receipt note

export type GoodsReceiptSpec = {
  grNumber: string;
  receivedDate: string;
  vendorName: string;
  poNumber: string;
  lines: QuantityLine[];
};

export async function renderGoodsReceipt(spec: GoodsReceiptSpec): Promise<RenderedPdf> {
  const pdf = await PdfWriter.create({ title: `Goods receipt ${spec.grNumber}`, footer: SAMPLE_FOOTER });
  pdf.text(pdf.left, 48, SELLER_NAME, { size: 14, bold: true });
  pdf.text(330, 48, "GOODS RECEIPT NOTE", { size: 16, bold: true });
  pdf.labelValue(pdf.left, 100, "GRN No", spec.grNumber);
  pdf.labelValue(330, 100, "Received Date", spec.receivedDate);
  pdf.labelValue(pdf.left, 116, "Vendor", spec.vendorName);
  pdf.labelValue(330, 116, "PO Number", spec.poNumber);
  pdf.table(
    160,
    [
      { header: "Part No", width: 100 },
      { header: "Description", width: 280 },
      { header: "Qty Received", width: 110 },
    ],
    spec.lines.map((line) => [line.partNo, line.description, line.quantity]),
  );
  const fields: Record<string, string | null> = {
    grNumber: spec.grNumber,
    receivedDate: spec.receivedDate,
    vendorName: spec.vendorName,
    poNumber: spec.poNumber,
  };
  spec.lines.forEach((line, index) => {
    fields[`lines[${index}].partNo`] = line.partNo;
    fields[`lines[${index}].description`] = line.description;
    fields[`lines[${index}].quantity`] = line.quantity;
  });
  return { bytes: await pdf.save(), fields };
}

// ---------------------------------------------------------------------------------------- AWB or BL

export type TransportDocumentSpec = {
  mode: "air" | "sea";
  documentNumber: string;
  shipperName: string;
  consigneeName: string;
  origin: string;
  destination: string;
  pieces: string;
  reference: string;
};

export async function renderTransportDocument(spec: TransportDocumentSpec): Promise<RenderedPdf> {
  const pdf = await PdfWriter.create({ title: `${spec.mode === "air" ? "Air waybill" : "Bill of lading"} ${spec.documentNumber}`, footer: SAMPLE_FOOTER });
  if (spec.mode === "air") {
    pdf.text(pdf.left, 48, "Sample Air Cargo (synthetic)", { size: 14, bold: true });
    pdf.text(330, 48, "AIR WAYBILL", { size: 16, bold: true });
    pdf.labelValue(pdf.left, 100, "AWB No", spec.documentNumber);
    pdf.labelValue(330, 100, "Pieces", spec.pieces);
    pdf.labelValue(pdf.left, 116, "Shipper", spec.shipperName);
    pdf.labelValue(pdf.left, 132, "Consignee", spec.consigneeName);
    pdf.labelValue(pdf.left, 148, "Airport of Departure", spec.origin, 130);
    pdf.labelValue(pdf.left, 164, "Airport of Destination", spec.destination, 130);
    pdf.labelValue(pdf.left, 180, "Shipper's Reference", spec.reference, 130);
  } else {
    pdf.text(pdf.left, 48, "Sample Ocean Line (synthetic)", { size: 14, bold: true });
    pdf.text(330, 48, "BILL OF LADING", { size: 16, bold: true });
    pdf.labelValue(pdf.left, 100, "B/L No", spec.documentNumber);
    pdf.labelValue(330, 100, "Packages", spec.pieces);
    pdf.labelValue(pdf.left, 116, "Shipper", spec.shipperName);
    pdf.labelValue(pdf.left, 132, "Consignee", spec.consigneeName);
    pdf.labelValue(pdf.left, 148, "Port of Loading", spec.origin);
    pdf.labelValue(pdf.left, 164, "Port of Discharge", spec.destination);
    pdf.labelValue(pdf.left, 180, "Reference", spec.reference);
  }
  return {
    bytes: await pdf.save(),
    fields: {
      documentNumber: spec.documentNumber,
      shipperName: spec.shipperName,
      consigneeName: spec.consigneeName,
      origin: spec.origin,
      destination: spec.destination,
      pieces: spec.pieces,
      reference: spec.reference,
    },
  };
}

// ---------------------------------------------------------------------------------------- import permit

export type ImportPermitSpec = {
  permitNumber: string;
  importerName: string;
  issueDate: string;
  validUntil: string;
  reference: string;
  goods: string;
};

export async function renderImportPermit(spec: ImportPermitSpec): Promise<RenderedPdf> {
  const pdf = await PdfWriter.create({ title: `Import permit ${spec.permitNumber}`, footer: SAMPLE_FOOTER });
  pdf.text(pdf.left, 48, "Sample Customs Authority (synthetic)", { size: 14, bold: true });
  pdf.text(330, 48, "IMPORT PERMIT", { size: 16, bold: true });
  pdf.labelValue(pdf.left, 100, "Permit No", spec.permitNumber);
  pdf.labelValue(330, 100, "Issue Date", spec.issueDate);
  pdf.labelValue(pdf.left, 116, "Importer", spec.importerName);
  pdf.labelValue(330, 116, "Valid Until", spec.validUntil);
  pdf.labelValue(pdf.left, 132, "Reference", spec.reference);
  pdf.labelValue(pdf.left, 148, "Goods", spec.goods);
  return {
    bytes: await pdf.save(),
    fields: {
      permitNumber: spec.permitNumber,
      importerName: spec.importerName,
      issueDate: spec.issueDate,
      validUntil: spec.validUntil,
      reference: spec.reference,
    },
  };
}

// ---------------------------------------------------------------------------------------- vendor PO (issued by Spectra)

export type VendorPoSpec = {
  poNumber: string;
  orderDate: string;
  vendorName: string;
  currency: string;
  lines: PricedLine[];
};

export async function renderVendorPo(spec: VendorPoSpec): Promise<RenderedPdf> {
  const pdf = await PdfWriter.create({ title: `Vendor PO ${spec.poNumber}`, footer: SAMPLE_FOOTER });
  const total = totalText(spec.lines);
  pdf.text(pdf.left, 48, SELLER_NAME, { size: 14, bold: true });
  pdf.text(330, 48, "PURCHASE ORDER", { size: 16, bold: true });
  pdf.labelValue(pdf.left, 100, "PO Number", spec.poNumber);
  pdf.labelValue(330, 100, "PO Date", spec.orderDate);
  pdf.labelValue(pdf.left, 116, "Buyer", SELLER_NAME);
  pdf.labelValue(330, 116, "Currency", spec.currency);
  pdf.labelValue(pdf.left, 132, "Vendor", spec.vendorName);
  const bottom = pdf.table(
    176,
    [
      { header: "Part No", width: 90 },
      { header: "Description", width: 215 },
      { header: "Qty", width: 55 },
      { header: "Unit Price", width: 70 },
      { header: "Amount", width: 69 },
    ],
    spec.lines.map((line) => [line.partNo, line.description, line.quantity, line.unitPrice ?? "", amountText(line) ?? ""]),
  );
  pdf.labelValue(330, bottom + 6, "Total", total);
  return {
    bytes: await pdf.save(),
    fields: {
      poNumber: spec.poNumber,
      orderDate: spec.orderDate,
      vendorName: spec.vendorName,
      currency: spec.currency,
      totalAmount: total,
      ...pricedLineFields(spec.lines),
    },
  };
}

// ---------------------------------------------------------------------------------------- proforma invoice

export type ProformaSpec = {
  piNumber: string;
  piDate: string;
  customerName: string;
  poNumber: string;
  currency: string;
  lines: PricedLine[];
};

export async function renderProforma(spec: ProformaSpec): Promise<RenderedPdf> {
  const total = totalText(spec.lines);
  const bytes = await renderProformaInvoice(
    {
      piNumber: spec.piNumber,
      piDate: spec.piDate,
      sellerName: SELLER_NAME,
      customerName: spec.customerName,
      poNumber: spec.poNumber,
      currency: spec.currency,
      paymentTerms: "Advance payment",
      lines: spec.lines.map((line) => ({
        itemNo: line.partNo,
        description: line.description,
        quantity: parseQuantity(line.quantity) ?? 0,
        unitPrice: line.unitPrice ?? "0",
        lineTotal: (amountText(line) ?? "0").replace(/,/g, ""),
      })),
      totalAmount: total.replace(/,/g, ""),
    },
    SAMPLE_FOOTER,
  );
  return {
    bytes,
    fields: {
      piNumber: spec.piNumber,
      piDate: spec.piDate,
      customerName: spec.customerName,
      poNumber: spec.poNumber,
      currency: spec.currency,
      totalAmount: total,
      ...pricedLineFields(spec.lines),
    },
  };
}

// ---------------------------------------------------------------------------------------- a document of no known type

export async function renderUnknownDocument(title: string, paragraphs: string[]): Promise<RenderedPdf> {
  const pdf = await PdfWriter.create({ title, footer: SAMPLE_FOOTER });
  pdf.text(pdf.left, 48, title, { size: 16, bold: true });
  let y = 100;
  for (const paragraph of paragraphs) {
    pdf.text(pdf.left, y, paragraph);
    y += 18;
  }
  return { bytes: await pdf.save(), fields: {} };
}
