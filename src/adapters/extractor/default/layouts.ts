// What: for each document type, the words to look for in our sample PDFs: title keywords, field labels and table headers.
// Who calls it: the default extractor's classifier and label parser.
// To extend: when a real document uses a different label ("P.O. Ref" instead of "PO Number"), add it to the list here.
import type { DocumentType } from "@/domain/documents";

export type FieldLayout = {
  /** Labels printed before the value, without the colon. Compared ignoring case and punctuation. */
  labels?: string[];
  /** For values that are not labelled: a pattern searched in the text of the first lines of page 1. */
  pattern?: RegExp;
  /** For a currency code written inside another field's text ("Amount Paid: USD 8,950.00"). */
  currencyInField?: string;
};

export type TypeLayout = {
  /** Words in the document title that point to this type, with a weight (higher = stronger hint). */
  titleKeywords: { text: string; weight: number }[];
  /** Words that must NOT appear for the type to be chosen (for example "PROFORMA" for a tax invoice). */
  excludeKeywords?: string[];
  fields: Record<string, FieldLayout>;
  /** Column headers of the line table, by line-field key. */
  columns?: Record<string, string[]>;
};

const PRICED_COLUMNS: Record<string, string[]> = {
  partNo: ["Part No", "Part Number", "Item Code", "Item No", "Part"],
  description: ["Description", "Details", "Item Description"],
  quantity: ["Qty", "Quantity"],
  unitPrice: ["Unit Price", "Price", "Unit Cost"],
  lineTotal: ["Amount", "Line Total"],
};

export const TYPE_LAYOUTS: Record<DocumentType, TypeLayout> = {
  customer_po: {
    titleKeywords: [{ text: "PURCHASE ORDER", weight: 3 }],
    fields: {
      poNumber: { labels: ["PO Number", "PO No", "Order No", "Purchase Order No"] },
      poKind: { pattern: /\b(AMENDMENT(?:\s+(?:NO\.?\s*)?\d+)?|AMENDED|REVISED|REVISION\s+\w+|CANCELLATION|CANCELLED)\b/i },
      orderDate: { labels: ["PO Date", "Date", "Order Date"] },
      customerName: { labels: ["Customer", "Buyer", "Bill To"] },
      customerAddress: { labels: ["Address", "Buyer address", "Customer address"] },
      currency: { labels: ["Currency"] },
      paymentTerms: { labels: ["Payment terms", "Terms"] },
      partialShipment: { labels: ["Partial shipment", "Part shipment"] },
      totalAmount: { labels: ["Total", "Grand Total", "Total Amount"] },
    },
    columns: PRICED_COLUMNS,
  },
  vendor_po: {
    titleKeywords: [{ text: "PURCHASE ORDER", weight: 3 }],
    fields: {
      poNumber: { labels: ["PO Number", "PO No", "Order No"] },
      orderDate: { labels: ["PO Date", "Date", "Order Date"] },
      vendorName: { labels: ["Vendor", "Supplier"] },
      currency: { labels: ["Currency"] },
      totalAmount: { labels: ["Total", "Grand Total"] },
    },
    columns: PRICED_COLUMNS,
  },
  proforma_invoice: {
    titleKeywords: [
      { text: "PROFORMA INVOICE", weight: 5 },
      { text: "PRO FORMA INVOICE", weight: 5 },
    ],
    fields: {
      piNumber: { labels: ["PI Number", "PI No", "Proforma No"] },
      piDate: { labels: ["PI Date", "Date"] },
      customerName: { labels: ["Customer", "Bill To"] },
      poNumber: { labels: ["PO Reference", "PO Number", "Customer PO"] },
      currency: { labels: ["Currency"] },
      totalAmount: { labels: ["Total", "Grand Total"] },
    },
    columns: PRICED_COLUMNS,
  },
  proof_of_payment: {
    titleKeywords: [
      { text: "PAYMENT ADVICE", weight: 5 },
      { text: "REMITTANCE ADVICE", weight: 5 },
      { text: "TELEGRAPHIC TRANSFER", weight: 4 },
      { text: "PAYMENT CONFIRMATION", weight: 4 },
    ],
    fields: {
      payerName: { labels: ["Remitter", "From", "Paid By", "Payer"] },
      beneficiaryName: { labels: ["Beneficiary", "To", "Paid To"] },
      amount: { labels: ["Amount", "Amount Paid"] },
      currency: { labels: ["Currency"], currencyInField: "amount" },
      paymentDate: { labels: ["Value Date", "Date Paid", "Payment Date"] },
      reference: { labels: ["Payment Reference", "Invoice Ref", "Reference"] },
      bankReference: { labels: ["Transaction ID", "Bank Ref", "Bank Reference"] },
    },
  },
  vendor_invoice: {
    titleKeywords: [
      { text: "TAX INVOICE", weight: 5 },
      { text: "COMMERCIAL INVOICE", weight: 5 },
      { text: "INVOICE", weight: 2 },
    ],
    excludeKeywords: ["PROFORMA", "PRO FORMA"],
    fields: {
      invoiceNumber: { labels: ["Invoice No", "Invoice Number"] },
      invoiceDate: { labels: ["Invoice Date", "Date"] },
      vendorName: { labels: ["Supplier", "Vendor", "Seller"] },
      poNumber: { labels: ["PO Number", "PO No", "PO Reference", "Customer PO"] },
      currency: { labels: ["Currency"] },
      totalAmount: { labels: ["Total", "Grand Total"] },
    },
    columns: PRICED_COLUMNS,
  },
  packing_list: {
    titleKeywords: [{ text: "PACKING LIST", weight: 5 }],
    fields: {
      packingListNumber: { labels: ["Packing List No", "Packing List Number"] },
      packingDate: { labels: ["Date"] },
      shipperName: { labels: ["Shipper"] },
      consigneeName: { labels: ["Consignee"] },
      poNumber: { labels: ["PO Number", "PO No", "PO Reference"] },
    },
    columns: {
      partNo: PRICED_COLUMNS.partNo,
      description: PRICED_COLUMNS.description,
      quantity: PRICED_COLUMNS.quantity,
      cartons: ["Cartons", "Ctns"],
    },
  },
  goods_receipt: {
    titleKeywords: [
      { text: "GOODS RECEIPT NOTE", weight: 5 },
      { text: "GOODS RECEIVED NOTE", weight: 5 },
      { text: "GOODS RECEIPT", weight: 4 },
    ],
    fields: {
      grNumber: { labels: ["GRN No", "GR No", "Goods Receipt No"] },
      receivedDate: { labels: ["Received Date", "Date Received"] },
      vendorName: { labels: ["Vendor", "Supplier"] },
      poNumber: { labels: ["PO Number", "PO No"] },
    },
    columns: {
      partNo: PRICED_COLUMNS.partNo,
      description: PRICED_COLUMNS.description,
      quantity: ["Qty Received", "Quantity Received", "Qty"],
    },
  },
  awb_bl: {
    titleKeywords: [
      { text: "AIR WAYBILL", weight: 5 },
      { text: "BILL OF LADING", weight: 5 },
    ],
    fields: {
      documentNumber: { labels: ["AWB No", "B/L No", "BL No", "Waybill No"] },
      shipperName: { labels: ["Shipper"] },
      consigneeName: { labels: ["Consignee"] },
      origin: { labels: ["Airport of Departure", "Port of Loading"] },
      destination: { labels: ["Airport of Destination", "Port of Discharge"] },
      pieces: { labels: ["Pieces", "Packages"] },
      reference: { labels: ["Shipper's Reference", "Reference"] },
    },
  },
  import_permit: {
    titleKeywords: [
      { text: "IMPORT PERMIT", weight: 5 },
      { text: "CARGO CLEARANCE PERMIT", weight: 5 },
    ],
    fields: {
      permitNumber: { labels: ["Permit No", "Permit Number"] },
      importerName: { labels: ["Importer"] },
      issueDate: { labels: ["Issue Date", "Date of Issue"] },
      validUntil: { labels: ["Valid Until", "Expiry Date"] },
      reference: { labels: ["Reference"] },
    },
  },
};

/** The company whose point of view the documents are read from. A PO addressed TO this name is a customer PO. */
export const OWN_COMPANY_KEYWORD = "spectra";
