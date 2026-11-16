// What: the NavisionGateway interface, the only door between OrderFlow and Navision.
// Who calls it: services. The POC implementation is FileNavisionGateway (JSON files in data/navision).
// To extend: write ApiNavisionGateway with the same methods (see docs/NAVISION_ADAPTER.md) and return it from getDeps().
import type { CustomerCardExport, SalesOrderExport } from "@/domain/po/exportFile";
import type {
  NavCustomer,
  NavGoodsReceipt,
  NavItem,
  NavOpenOrder,
  NavPurchaseOrder,
  NavVendor,
  StaffDirectory,
} from "@/domain/navision";

/**
 * Proof that a person approved a preview. `previewHash` is the SHA-256 of the exact text they saw.
 * The gateway recomputes the hash of what it is about to write and refuses when they differ.
 */
export type ExportApproval = { approvedBy: string; approvedAt: Date; previewHash: string };

export type ExportResult = {
  /** Path of the written file, relative to the Navision folder, with forward slashes. */
  path: string;
  sha256: string;
  /** True when the identical file was already there (the call changed nothing). */
  alreadyExisted: boolean;
};

/** Thrown when a write is attempted without an approval that matches the content. */
export class ExportNotApprovedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportNotApprovedError";
  }
}

/** Thrown when a different file already exists at the target path. Exports never overwrite. */
export class ExportConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportConflictError";
  }
}

export interface NavisionGateway {
  // ---- reads (safe to call any time) ----
  getItem(itemNo: string): Promise<NavItem | null>;
  /** Up to `limit` items whose number looks like `query`, best match first. Used only to suggest part numbers. */
  searchItems(query: string, limit?: number): Promise<NavItem[]>;
  getCustomerByName(name: string): Promise<NavCustomer | null>;
  getStock(itemNo: string): Promise<number | null>;
  getVendor(vendorId: string): Promise<NavVendor | null>;
  getGoodsReceipt(poNumber: string): Promise<NavGoodsReceipt | null>;
  listOpenOrders(): Promise<NavOpenOrder[]>;
  // Three reads beyond the brief's list, needed by stories 3 to 5 (recorded in docs/DECISIONS.md):
  listPurchaseOrders(): Promise<NavPurchaseOrder[]>;
  getPurchaseOrder(poNumber: string): Promise<NavPurchaseOrder | null>;
  getStaffDirectory(): Promise<StaffDirectory>;

  // ---- writes (only after a person approved a preview) ----
  createCustomerCard(card: CustomerCardExport, approval: ExportApproval): Promise<ExportResult>;
  /** Idempotent: exporting the same order revision with the same content twice writes one file. */
  exportSalesOrder(order: SalesOrderExport, approval: ExportApproval): Promise<ExportResult>;
}
