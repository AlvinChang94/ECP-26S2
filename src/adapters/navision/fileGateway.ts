// What: "our form of Navision": a NavisionGateway that reads plain JSON files in data/navision on every call.
// Who calls it: getDeps() builds one; tests build one over a temporary copy of the folder.
// To extend: this is the POC stand-in. The real one is an ApiNavisionGateway with the same methods (docs/NAVISION_ADAPTER.md).
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { sha256OfText } from "@/domain/hash";
import type {
  NavCustomer,
  NavGoodsReceipt,
  NavItem,
  NavOpenOrder,
  NavPurchaseOrder,
  NavVendor,
  StaffDirectory,
} from "@/domain/navision";
import {
  type CustomerCardExport,
  customerCardFileName,
  type SalesOrderExport,
  salesOrderFileName,
  serializeExportFile,
} from "@/domain/po/exportFile";
import { rankSimilarItems, sameCompany } from "@/domain/po/partMatch";
import {
  type ExportApproval,
  ExportConflictError,
  ExportNotApprovedError,
  type ExportResult,
  type NavisionGateway,
} from "./gateway";
import {
  CustomerCardFileSchema,
  CustomerOrdersFileSchema,
  CustomersFileSchema,
  GoodsReceiptsFileSchema,
  ItemsFileSchema,
  PurchaseOrdersFileSchema,
  StaffFileSchema,
  VendorsFileSchema,
} from "./schemas";

export class FileNavisionGateway implements NavisionGateway {
  constructor(private readonly dir: string) {}

  // ---------------------------------------------------------------- reads

  async getItem(itemNo: string): Promise<NavItem | null> {
    const { items } = await this.read("items.json", ItemsFileSchema);
    // Exact match only. "AB-1234X" is not "AB1234X": a person decides whether they are the same part.
    return items.find((item) => item.itemNo === itemNo.trim()) ?? null;
  }

  async searchItems(query: string, limit = 3): Promise<NavItem[]> {
    const { items } = await this.read("items.json", ItemsFileSchema);
    return rankSimilarItems(query, items, limit);
  }

  async getCustomerByName(name: string): Promise<NavCustomer | null> {
    const { customers } = await this.read("customers.json", CustomersFileSchema);
    const known = customers.find((customer) => sameCompany(customer.name, name));
    if (known) return known;
    // POC simplification: a customer card we exported counts as an existing customer,
    // as if Navision had already imported it. It has no customer number yet.
    for (const card of await this.readExportedCustomerCards()) {
      if (sameCompany(card.name, name)) {
        return {
          customerNo: "(pending import)",
          name: card.name,
          address: card.address ?? "",
          country: card.country ?? "",
          email: card.email ?? "",
          paymentTerms: card.paymentTerms,
          currency: card.currency,
        };
      }
    }
    return null;
  }

  async getStock(itemNo: string): Promise<number | null> {
    const item = await this.getItem(itemNo);
    return item ? item.stockQty : null;
  }

  async getVendor(vendorId: string): Promise<NavVendor | null> {
    const { vendors } = await this.read("vendors.json", VendorsFileSchema);
    return vendors.find((vendor) => vendor.vendorId === vendorId) ?? null;
  }

  async getGoodsReceipt(poNumber: string): Promise<NavGoodsReceipt | null> {
    const { goodsReceipts } = await this.read("goodsReceipts.json", GoodsReceiptsFileSchema);
    return goodsReceipts.find((receipt) => receipt.poNumber === poNumber) ?? null;
  }

  async listOpenOrders(): Promise<NavOpenOrder[]> {
    const { customerOrders } = await this.read("customerOrders.json", CustomerOrdersFileSchema);
    return customerOrders;
  }

  async listPurchaseOrders(): Promise<NavPurchaseOrder[]> {
    const { purchaseOrders } = await this.read("purchaseOrders.json", PurchaseOrdersFileSchema);
    return purchaseOrders;
  }

  async getPurchaseOrder(poNumber: string): Promise<NavPurchaseOrder | null> {
    const purchaseOrders = await this.listPurchaseOrders();
    return purchaseOrders.find((order) => order.poNumber === poNumber) ?? null;
  }

  async getStaffDirectory(): Promise<StaffDirectory> {
    const file = await this.read("staff.json", StaffFileSchema);
    return {
      staff: file.staff,
      approverId: file.approverId,
      standInId: file.standInId,
      plannedLeave: file.plannedLeave,
      warehouseContact: file.warehouseContact,
    };
  }

  // ---------------------------------------------------------------- writes

  async createCustomerCard(card: CustomerCardExport, approval: ExportApproval): Promise<ExportResult> {
    return this.writeApproved(`export/customerCards/${customerCardFileName(card.name)}`, serializeExportFile(card), approval);
  }

  async exportSalesOrder(order: SalesOrderExport, approval: ExportApproval): Promise<ExportResult> {
    const fileName = salesOrderFileName(order.orderNo, order.revision);
    return this.writeApproved(`export/salesOrders/${fileName}`, serializeExportFile(order), approval);
  }

  /**
   * The single place that writes into data/navision/export. It refuses to write unless the approval's hash
   * matches the text, so no code path can post something a person did not see in a preview.
   */
  private async writeApproved(relativePath: string, text: string, approval: ExportApproval): Promise<ExportResult> {
    const hash = sha256OfText(text);
    if (!approval || !approval.approvedBy || approval.previewHash !== hash) {
      throw new ExportNotApprovedError(
        `Refusing to write ${relativePath}: the content does not match the preview that was approved.`,
      );
    }
    const target = path.join(this.dir, ...relativePath.split("/"));
    const existing = await readTextIfExists(target);
    if (existing !== null) {
      if (existing === text) return { path: relativePath, sha256: hash, alreadyExisted: true };
      throw new ExportConflictError(`${relativePath} already exists with different content. Exports never overwrite a file.`);
    }
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, text, "utf8");
    return { path: relativePath, sha256: hash, alreadyExisted: false };
  }

  // ---------------------------------------------------------------- extras for the "Mock Navision" page (not part of the interface)

  /** Whole master files, for the page that shows what is in mock Navision. A real Navision would not be listed like this. */
  async listEverything() {
    return {
      items: (await this.read("items.json", ItemsFileSchema)).items,
      customers: (await this.read("customers.json", CustomersFileSchema)).customers,
      vendors: (await this.read("vendors.json", VendorsFileSchema)).vendors,
      goodsReceipts: (await this.read("goodsReceipts.json", GoodsReceiptsFileSchema)).goodsReceipts,
    };
  }

  /** The files the app has written into export/, newest name last, with their content. */
  async listExportFiles(): Promise<{ path: string; text: string }[]> {
    const files: { path: string; text: string }[] = [];
    for (const folder of ["customerCards", "salesOrders"]) {
      let names: string[] = [];
      try {
        names = (await readdir(path.join(this.dir, "export", folder))).filter((name) => name.endsWith(".json")).sort();
      } catch {
        continue; // nothing exported into this folder yet
      }
      for (const name of names) {
        const text = await readTextIfExists(path.join(this.dir, "export", folder, name));
        if (text !== null) files.push({ path: `export/${folder}/${name}`, text });
      }
    }
    return files;
  }

  // ---------------------------------------------------------------- helpers

  /** Reads and checks one JSON file. Read on every call, so editing a file changes the app's answers at once. */
  private async read<T>(fileName: string, schema: z.ZodType<T>): Promise<T> {
    const filePath = path.join(this.dir, fileName);
    const text = await readTextIfExists(filePath);
    if (text === null) {
      throw new Error(`Navision file not found: ${filePath}. Run "npm run seed" to create the sample data.`);
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (error) {
      throw new Error(`${fileName} is not valid JSON: ${(error as Error).message}`);
    }
    const result = schema.safeParse(json);
    if (!result.success) {
      throw new Error(`${fileName} does not have the expected shape:\n${z.prettifyError(result.error)}`);
    }
    return result.data;
  }

  private async readExportedCustomerCards(): Promise<CustomerCardExport[]> {
    const folder = path.join(this.dir, "export", "customerCards");
    let names: string[];
    try {
      names = (await readdir(folder)).filter((name) => name.endsWith(".json")).sort();
    } catch {
      return []; // folder does not exist yet: nothing has been exported
    }
    const cards: CustomerCardExport[] = [];
    for (const name of names) {
      const text = await readTextIfExists(path.join(folder, name));
      if (text === null) continue;
      const parsed = CustomerCardFileSchema.safeParse(JSON.parse(text));
      if (parsed.success) cards.push(parsed.data);
    }
    return cards;
  }
}

async function readTextIfExists(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
