// What: the list of document types and, for each type, the fields we expect to read from the PDF.
// Who calls it: extractors (which fields to look for), pages (labels), services (where a confirmed document is routed).
// To extend: add a field to a spec below (see the developer guide recipe), or add a whole new type to DOCUMENT_SPECS.

export const DOCUMENT_TYPES = [
  "customer_po",
  "proforma_invoice",
  "vendor_po",
  "proof_of_payment",
  "vendor_invoice",
  "packing_list",
  "goods_receipt",
  "awb_bl",
  "import_permit",
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];
/** What classify() may return: one of the known types, or "unknown" when nothing matched. */
export type DetectedType = DocumentType | "unknown";

export function isDocumentType(value: string): value is DocumentType {
  return (DOCUMENT_TYPES as readonly string[]).includes(value);
}

/** Where a field sits on the page, as fractions of the page size measured from the top-left corner (the Amazon Textract convention). */
export type BoundingBox = { x: number; y: number; width: number; height: number };

/** One value read from a PDF. `value` is exactly what was read; it is never corrected by the system. */
export type ExtractedField = {
  key: string; // "poNumber" or "lines[0].partNo"
  value: string | null; // null when the field was not found
  page: number | null; // 1-based page number
  bbox: BoundingBox | null;
  confidence: number; // 0 to 1
};

export type FieldKind = "text" | "date" | "money" | "integer";

export type FieldSpec = {
  key: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  /** True for values a staff member types in (not read from the PDF), for example the promised ship date. */
  enteredByStaff?: boolean;
};

export type RouteKind = "order" | "payment" | "shipment" | "filed";

export type DocumentTypeSpec = {
  type: DocumentType;
  label: string;
  /** Which part of the app a confirmed document of this type goes to. "filed" means stored and shown, no workflow yet. */
  routesTo: RouteKind;
  /** The field holding the number that links this document to an order, PI or vendor PO. */
  referenceField: string | null;
  fields: FieldSpec[];
  /** Columns of the line table, if the document has one. Keys become "lines[0].partNo", "lines[1].partNo", ... */
  lineFields: FieldSpec[];
};

const PRICED_LINE_FIELDS: FieldSpec[] = [
  { key: "partNo", label: "Part no.", kind: "text", required: true },
  { key: "description", label: "Description", kind: "text" },
  { key: "quantity", label: "Quantity", kind: "integer", required: true },
  { key: "unitPrice", label: "Unit price", kind: "money", required: true },
  { key: "lineTotal", label: "Line total", kind: "money" },
];

const QUANTITY_LINE_FIELDS: FieldSpec[] = [
  { key: "partNo", label: "Part no.", kind: "text", required: true },
  { key: "description", label: "Description", kind: "text" },
  { key: "quantity", label: "Quantity", kind: "integer", required: true },
];

export const DOCUMENT_SPECS: Record<DocumentType, DocumentTypeSpec> = {
  customer_po: {
    type: "customer_po",
    label: "Customer PO",
    routesTo: "order",
    referenceField: "poNumber",
    fields: [
      { key: "poNumber", label: "PO number", kind: "text", required: true },
      { key: "poKind", label: "PO marking (amendment or cancellation)", kind: "text" },
      { key: "orderDate", label: "PO date", kind: "date" },
      { key: "customerName", label: "Customer", kind: "text", required: true },
      { key: "customerAddress", label: "Customer address", kind: "text" },
      { key: "currency", label: "Currency", kind: "text" },
      { key: "paymentTerms", label: "Payment terms", kind: "text" },
      { key: "partialShipment", label: "Partial shipment", kind: "text" },
      { key: "totalAmount", label: "Total", kind: "money" },
      { key: "promisedShipDate", label: "Promised ship date", kind: "date", required: true, enteredByStaff: true },
    ],
    lineFields: PRICED_LINE_FIELDS,
  },
  proforma_invoice: {
    type: "proforma_invoice",
    label: "Proforma invoice (PI)",
    routesTo: "filed",
    referenceField: "poNumber",
    fields: [
      { key: "piNumber", label: "PI number", kind: "text", required: true },
      { key: "piDate", label: "PI date", kind: "date" },
      { key: "customerName", label: "Customer", kind: "text" },
      { key: "poNumber", label: "PO reference", kind: "text" },
      { key: "currency", label: "Currency", kind: "text" },
      { key: "totalAmount", label: "Total", kind: "money" },
    ],
    lineFields: PRICED_LINE_FIELDS,
  },
  vendor_po: {
    type: "vendor_po",
    label: "Vendor PO",
    routesTo: "filed",
    referenceField: "poNumber",
    fields: [
      { key: "poNumber", label: "PO number", kind: "text", required: true },
      { key: "orderDate", label: "PO date", kind: "date" },
      { key: "vendorName", label: "Vendor", kind: "text" },
      { key: "currency", label: "Currency", kind: "text" },
      { key: "totalAmount", label: "Total", kind: "money" },
    ],
    lineFields: PRICED_LINE_FIELDS,
  },
  proof_of_payment: {
    type: "proof_of_payment",
    label: "Proof of payment",
    routesTo: "payment",
    referenceField: "reference",
    fields: [
      { key: "payerName", label: "Paid by", kind: "text" },
      { key: "beneficiaryName", label: "Paid to", kind: "text" },
      { key: "amount", label: "Amount", kind: "money", required: true },
      { key: "currency", label: "Currency", kind: "text", required: true },
      { key: "paymentDate", label: "Payment date", kind: "date" },
      { key: "reference", label: "Payment reference", kind: "text", required: true },
      { key: "bankReference", label: "Bank reference", kind: "text" },
    ],
    lineFields: [],
  },
  vendor_invoice: {
    type: "vendor_invoice",
    label: "Invoice",
    routesTo: "shipment",
    referenceField: "poNumber",
    fields: [
      { key: "invoiceNumber", label: "Invoice number", kind: "text", required: true },
      { key: "invoiceDate", label: "Invoice date", kind: "date" },
      { key: "vendorName", label: "Issued by", kind: "text" },
      { key: "poNumber", label: "PO reference", kind: "text", required: true },
      { key: "currency", label: "Currency", kind: "text" },
      { key: "totalAmount", label: "Total", kind: "money" },
    ],
    lineFields: PRICED_LINE_FIELDS,
  },
  packing_list: {
    type: "packing_list",
    label: "Packing list",
    routesTo: "shipment",
    referenceField: "poNumber",
    fields: [
      { key: "packingListNumber", label: "Packing list number", kind: "text" },
      { key: "packingDate", label: "Date", kind: "date" },
      { key: "shipperName", label: "Shipper", kind: "text" },
      { key: "consigneeName", label: "Consignee", kind: "text" },
      { key: "poNumber", label: "PO reference", kind: "text", required: true },
    ],
    lineFields: [...QUANTITY_LINE_FIELDS, { key: "cartons", label: "Cartons", kind: "integer" }],
  },
  goods_receipt: {
    type: "goods_receipt",
    label: "Goods receipt note",
    routesTo: "shipment",
    referenceField: "poNumber",
    fields: [
      { key: "grNumber", label: "Goods receipt number", kind: "text" },
      { key: "receivedDate", label: "Received date", kind: "date" },
      { key: "vendorName", label: "Vendor", kind: "text" },
      { key: "poNumber", label: "PO reference", kind: "text", required: true },
    ],
    lineFields: QUANTITY_LINE_FIELDS,
  },
  awb_bl: {
    type: "awb_bl",
    label: "AWB or BL",
    routesTo: "shipment",
    referenceField: "reference",
    fields: [
      { key: "documentNumber", label: "AWB or BL number", kind: "text", required: true },
      { key: "shipperName", label: "Shipper", kind: "text" },
      { key: "consigneeName", label: "Consignee", kind: "text" },
      { key: "origin", label: "From", kind: "text" },
      { key: "destination", label: "To", kind: "text" },
      { key: "pieces", label: "Pieces", kind: "integer" },
      { key: "reference", label: "Reference", kind: "text", required: true },
    ],
    lineFields: [],
  },
  import_permit: {
    type: "import_permit",
    label: "Import permit",
    routesTo: "shipment",
    referenceField: "reference",
    fields: [
      { key: "permitNumber", label: "Permit number", kind: "text", required: true },
      { key: "importerName", label: "Importer", kind: "text" },
      { key: "issueDate", label: "Issue date", kind: "date" },
      { key: "validUntil", label: "Valid until", kind: "date" },
      { key: "reference", label: "Reference", kind: "text", required: true },
    ],
    lineFields: [],
  },
};

export function documentTypeLabel(type: string): string {
  return isDocumentType(type) ? DOCUMENT_SPECS[type].label : "Unknown type";
}

/** Below this confidence the detected type is shown as "not sure" and a person must pick the type. */
export const LOW_CONFIDENCE_THRESHOLD = 0.6;
