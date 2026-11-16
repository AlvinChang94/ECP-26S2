// What: the shapes of the records we read from Navision (types only, no file or network access).
// Who calls it: domain rules take these as input; the NavisionGateway adapters produce them.
// To extend: add a field here AND in src/adapters/navision/schemas.ts (the Zod check), then in the sample-data generator.

export type NavItem = {
  itemNo: string;
  description: string;
  vendorId: string;
  /** Sales price per unit (what customers pay). Compared with the unit price on a customer PO. Decimal string. */
  price: string;
  /** Last purchase price per unit (what the vendor charges). Pre-fills the SPR. Decimal string. */
  purchasePrice: string;
  currency: string;
  stockQty: number;
};

export type NavCustomer = {
  customerNo: string;
  name: string;
  address: string;
  country: string;
  email: string;
  paymentTerms: "advance" | "credit";
  currency: string;
};

export type NavVendor = {
  vendorId: string;
  name: string;
  email: string;
  currency: string;
};

export type NavOrderLine = { itemNo: string; quantity: number; shippedQty: number };

/** An open customer order that already exists in Navision. */
export type NavOpenOrder = {
  orderNo: string;
  customerNo: string;
  customerName: string;
  poNumber: string;
  promisedShipDate: string; // YYYY-MM-DD
  lines: NavOrderLine[];
};

export type NavPurchaseLine = { itemNo: string; quantity: number; unitPrice: string };

/** A vendor PO in Navision. Stories 4 and 5 read payment due dates, document due dates and ordered quantities from it. */
export type NavPurchaseOrder = {
  poNumber: string;
  vendorId: string;
  vendorName: string;
  orderDate: string; // YYYY-MM-DD
  /** The customer PO this purchase was raised for, when there is one. Links an inbound shipment to a customer order. */
  forCustomerPoNumber: string | null;
  /** When the shipping documents for this purchase are due (ISO date-time). */
  documentsDueAt: string | null;
  paymentDueDate: string; // YYYY-MM-DD
  paid: boolean;
  currency: string;
  totalAmount: string;
  lines: NavPurchaseLine[];
};

/** Received quantity per part, as recorded in Navision (assumed to be how warehouse counts reach us). */
export type NavGoodsReceipt = {
  grNo: string;
  poNumber: string;
  receivedAt: string; // ISO date-time
  lines: { itemNo: string; receivedQty: number }[];
};

export type StaffRole = "sales" | "product_manager" | "approver" | "finance" | "purchase";

export type StaffMember = {
  id: string;
  name: string;
  role: StaffRole;
  email: string;
};

/** Planned leave of a staff member. Dates are YYYY-MM-DD and inclusive. */
export type LeavePeriod = { staffId: string; from: string; to: string };

/** The approvedStaff / hierarchy file: who may use the system, who approves SPRs and who stands in. */
export type StaffDirectory = {
  staff: StaffMember[];
  approverId: string; // Janet
  standInId: string; // Janet's stand-in
  plannedLeave: LeavePeriod[];
  /** Where warehouse notifications are sent. The warehouse is notified; it is not a user of this system. */
  warehouseContact: { name: string; email: string };
};
