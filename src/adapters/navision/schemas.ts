// What: Zod checks for every JSON file in data/navision, so a typo in a file gives a clear error instead of a crash later.
// Who calls it: FileNavisionGateway (on every read) and the sample-data generator (to check what it writes).
// To extend: add the property here and in src/domain/navision.ts. Prices are decimal STRINGS, never numbers.
import { z } from "zod";

/** "12.40": digits with an optional decimal part. A JSON number such as 12.4 is rejected on purpose. */
const moneyText = z.string().regex(/^\d+(\.\d+)?$/, "must be a decimal string such as \"12.40\"");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be a date such as 2026-11-16");
const quantity = z.number().int().nonnegative();
/** Every file starts with a note saying the data is synthetic. */
const note = z.string().optional();

export const ItemSchema = z.object({
  itemNo: z.string().min(1),
  description: z.string(),
  vendorId: z.string().min(1),
  price: moneyText,
  purchasePrice: moneyText,
  currency: z.string().length(3),
  stockQty: quantity,
});
export const ItemsFileSchema = z.object({ _note: note, items: z.array(ItemSchema) });

export const CustomerSchema = z.object({
  customerNo: z.string().min(1),
  name: z.string().min(1),
  address: z.string(),
  country: z.string(),
  email: z.string(),
  paymentTerms: z.enum(["advance", "credit"]),
  currency: z.string().length(3),
});
export const CustomersFileSchema = z.object({ _note: note, customers: z.array(CustomerSchema) });

export const VendorSchema = z.object({
  vendorId: z.string().min(1),
  name: z.string().min(1),
  email: z.string(),
  currency: z.string().length(3),
});
export const VendorsFileSchema = z.object({ _note: note, vendors: z.array(VendorSchema) });

export const OpenOrderSchema = z.object({
  orderNo: z.string().min(1),
  customerNo: z.string(),
  customerName: z.string(),
  poNumber: z.string(),
  promisedShipDate: isoDate,
  lines: z.array(z.object({ itemNo: z.string(), quantity, shippedQty: quantity })),
});
export const CustomerOrdersFileSchema = z.object({ _note: note, customerOrders: z.array(OpenOrderSchema) });

export const PurchaseOrderSchema = z.object({
  poNumber: z.string().min(1),
  vendorId: z.string(),
  vendorName: z.string(),
  orderDate: isoDate,
  forCustomerPoNumber: z.string().nullable(),
  documentsDueAt: z.string().nullable(),
  paymentDueDate: isoDate,
  paid: z.boolean(),
  currency: z.string().length(3),
  totalAmount: moneyText,
  lines: z.array(z.object({ itemNo: z.string(), quantity, unitPrice: moneyText })),
});
export const PurchaseOrdersFileSchema = z.object({ _note: note, purchaseOrders: z.array(PurchaseOrderSchema) });

export const GoodsReceiptSchema = z.object({
  grNo: z.string().min(1),
  poNumber: z.string().min(1),
  receivedAt: z.string(),
  lines: z.array(z.object({ itemNo: z.string(), receivedQty: quantity })),
});
export const GoodsReceiptsFileSchema = z.object({ _note: note, goodsReceipts: z.array(GoodsReceiptSchema) });

export const StaffMemberSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  role: z.enum(["sales", "product_manager", "approver", "finance", "purchase"]),
  email: z.string(),
});
export const StaffFileSchema = z.object({
  _note: note,
  staff: z.array(StaffMemberSchema),
  approverId: z.string(),
  standInId: z.string(),
  plannedLeave: z.array(z.object({ staffId: z.string(), from: isoDate, to: isoDate })),
  warehouseContact: z.object({ name: z.string(), email: z.string() }),
});

/** Files the app itself wrote into export/. Read back only to treat an exported customer card as an existing customer. */
export const CustomerCardFileSchema = z.object({
  schema: z.literal("orderflow.customerCard.v1"),
  name: z.string(),
  address: z.string().nullable(),
  country: z.string().nullable(),
  email: z.string().nullable(),
  paymentTerms: z.enum(["advance", "credit"]),
  currency: z.string(),
  requestedForOrder: z.string(),
});
