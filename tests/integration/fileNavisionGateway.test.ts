// What: integration tests for FileNavisionGateway over a temporary copy of the Navision files.
// Who calls it: `npm test`.
// To extend: an ApiNavisionGateway should pass the same expectations (see docs/NAVISION_ADAPTER.md).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ExportConflictError, ExportNotApprovedError, type ExportApproval } from "@/adapters/navision/gateway";
import { sha256OfText } from "@/domain/hash";
import { type CustomerCardExport, type SalesOrderExport, serializeExportFile } from "@/domain/po/exportFile";
import { createWorkspace, type TestWorkspace } from "../helpers/workspace";

let workspace: TestWorkspace;
beforeEach(() => {
  workspace = createWorkspace();
});
afterEach(async () => {
  await workspace.cleanup();
});

const order: SalesOrderExport = {
  schema: "orderflow.salesOrder.v1",
  orderNo: "ORD-2001",
  revision: 1,
  status: "open",
  customer: { customerNo: "C0001", name: "Lanka Tech Pte Ltd", newCustomerCardFile: null },
  customerPoNumber: "LT-PO-1",
  orderDate: "2026-11-12",
  promisedShipDate: "2026-11-23",
  currency: "USD",
  paymentTerms: "advance",
  lines: [{ lineNo: 1, itemNo: "CD-77", description: "HDMI cable 2 m", quantity: 50, unitPrice: "8.10", lineTotal: "405.00" }],
  totalAmount: "405.00",
  acceptedDifferences: [],
  source: { fileName: "po.pdf", sha256: "abc" },
};

function approvalFor(file: SalesOrderExport | CustomerCardExport): ExportApproval {
  return { approvedBy: "Sam Tan", approvedAt: new Date("2026-11-16T01:00:00.000Z"), previewHash: sha256OfText(serializeExportFile(file)) };
}

describe("reads", () => {
  it("finds an item by its exact number only", async () => {
    const { navision } = workspace.deps;
    expect((await navision.getItem("AB1234X"))?.description).toBe("USB-C docking station 11-in-1");
    expect(await navision.getItem("AB-1234X")).toBeNull();
    expect(await navision.getItem("ab1234x")).toBeNull();
  });

  it("suggests similar items without changing anything", async () => {
    const similar = await workspace.deps.navision.searchItems("AB-1234X");
    expect(similar[0]?.itemNo).toBe("AB1234X");
  });

  it("matches a customer whatever the punctuation or legal suffix", async () => {
    const { navision } = workspace.deps;
    expect((await navision.getCustomerByName("LANKA TECH PTE. LTD."))?.customerNo).toBe("C0001");
    expect(await navision.getCustomerByName("Kathmandu Digital Hub")).toBeNull();
  });

  it("returns stock, vendors, goods receipts and staff", async () => {
    const { navision } = workspace.deps;
    expect(await navision.getStock("AB1234X")).toBe(160);
    expect(await navision.getStock("NOPE")).toBeNull();
    expect((await navision.getVendor("V003"))?.name).toBe("Pacific Components");
    expect((await navision.getGoodsReceipt("PO-9101"))?.lines[0].receivedQty).toBe(95);
    expect(await navision.getGoodsReceipt("PO-9109")).toBeNull();
    const directory = await navision.getStaffDirectory();
    expect(directory.staff.find((member) => member.id === directory.approverId)?.name).toBe("Janet");
  });

  it("reads the files on every call, so an edit is seen at once", async () => {
    const itemsPath = path.join(workspace.navisionDir, "items.json");
    const file = JSON.parse(readFileSync(itemsPath, "utf8"));
    file.items.find((item: { itemNo: string }) => item.itemNo === "AB1234X").stockQty = 7;
    writeFileSync(itemsPath, JSON.stringify(file));
    expect(await workspace.deps.navision.getStock("AB1234X")).toBe(7);
  });

  it("explains what is wrong when a file has a number where money text is expected", async () => {
    const itemsPath = path.join(workspace.navisionDir, "items.json");
    const file = JSON.parse(readFileSync(itemsPath, "utf8"));
    file.items[0].price = 12.4; // a JSON number: money must be a decimal string
    writeFileSync(itemsPath, JSON.stringify(file));
    await expect(workspace.deps.navision.getItem("AB1234X")).rejects.toThrow(/items\.json does not have the expected shape/);
  });
});

describe("writes", () => {
  const exportPath = () => path.join(workspace.navisionDir, "export", "salesOrders", "ORD-2001-r1.json");

  it("writes the sales order exactly as previewed", async () => {
    const result = await workspace.deps.navision.exportSalesOrder(order, approvalFor(order));
    expect(result).toMatchObject({ path: "export/salesOrders/ORD-2001-r1.json", alreadyExisted: false });
    expect(readFileSync(exportPath(), "utf8")).toBe(serializeExportFile(order));
  });

  it("is idempotent: exporting the same order twice leaves one identical file", async () => {
    await workspace.deps.navision.exportSalesOrder(order, approvalFor(order));
    const second = await workspace.deps.navision.exportSalesOrder(order, approvalFor(order));
    expect(second.alreadyExisted).toBe(true);
    expect(readFileSync(exportPath(), "utf8")).toBe(serializeExportFile(order));
  });

  it("refuses to write when the approval is for different content", async () => {
    const approvalForSomethingElse = approvalFor({ ...order, totalAmount: "1.00" });
    await expect(workspace.deps.navision.exportSalesOrder(order, approvalForSomethingElse)).rejects.toThrow(ExportNotApprovedError);
    expect(existsSync(exportPath())).toBe(false);
  });

  it("refuses to write without the approver's name", async () => {
    const unnamed = { ...approvalFor(order), approvedBy: "" };
    await expect(workspace.deps.navision.exportSalesOrder(order, unnamed)).rejects.toThrow(ExportNotApprovedError);
  });

  it("never overwrites an existing export with different content", async () => {
    await workspace.deps.navision.exportSalesOrder(order, approvalFor(order));
    const changed = { ...order, promisedShipDate: "2026-12-01" };
    await expect(workspace.deps.navision.exportSalesOrder(changed, approvalFor(changed))).rejects.toThrow(ExportConflictError);
  });

  it("treats an exported customer card as an existing customer afterwards", async () => {
    const card: CustomerCardExport = {
      schema: "orderflow.customerCard.v1",
      name: "Kathmandu Digital Hub",
      address: "2nd Floor, 40 Sample Chowk, Kathmandu, Nepal",
      country: null,
      email: null,
      paymentTerms: "advance",
      currency: "USD",
      requestedForOrder: "ORD-2002",
    };
    expect(await workspace.deps.navision.getCustomerByName("Kathmandu Digital Hub")).toBeNull();
    const result = await workspace.deps.navision.createCustomerCard(card, approvalFor(card));
    expect(result.path).toBe("export/customerCards/kathmandu-digital-hub.json");
    expect((await workspace.deps.navision.getCustomerByName("Kathmandu Digital Hub"))?.customerNo).toBe("(pending import)");
  });
});
