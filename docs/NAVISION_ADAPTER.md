# Connecting to the real Navision later

Spectra has not yet confirmed how Navision may be accessed (see ASSUMPTIONS A3). The proof of concept therefore talks to "our form of Navision": plain JSON files in `data/navision`, read through `FileNavisionGateway`.

Everything the app needs from Navision goes through one interface, `NavisionGateway` in [`src/adapters/navision/gateway.ts`](../src/adapters/navision/gateway.ts). To connect the real system you write a second class with the same methods. Nothing else changes.

## The contract

| Method | Returns | Used by |
|---|---|---|
| `getItem(itemNo)` | The item with exactly this number, or null | PO check (part exists, price), SPR pre-fill |
| `searchItems(query, limit)` | Up to `limit` items whose number looks like `query`, best first | Part-number suggestions only |
| `getCustomerByName(name)` | The customer, or null | PO check, export |
| `getStock(itemNo)` | Quantity on hand, or null | PO check, SPR evidence |
| `getVendor(vendorId)` | The vendor, or null | SPR pre-fill |
| `getGoodsReceipt(poNumber)` | Received quantity per part for a vendor PO, or null | Story 5 reconciliation |
| `listOpenOrders()` | Open customer orders with promised ship dates | Suggested SPRs |
| `listPurchaseOrders()`, `getPurchaseOrder(poNumber)` | Vendor POs with lines, payment due date, documents due date | Vendor payment calendar, story 5 |
| `getStaffDirectory()` | Staff, the approver, the stand-in, planned leave | Persona picker, SPR routing |
| `createCustomerCard(card, approval)` | Where it was written | Export, only after a person approved the preview |
| `exportSalesOrder(order, approval)` | Where it was written | Export, only after a person approved the preview |

Rules every implementation must keep:

1. **Reads never change anything.**
2. **Writes need an approval.** `approval.previewHash` is the SHA-256 of the exact text the person saw. Recompute the hash of what you are about to send (`sha256OfText(serializeExportFile(order))`) and throw `ExportNotApprovedError` when it differs.
3. **`exportSalesOrder` is idempotent.** The same order number and revision with the same content must not create a second order. Different content for an existing order and revision must fail (`ExportConflictError`), never overwrite.
4. **Money is a decimal string** such as `"12.40"`. Convert numbers from the API to strings before returning them, and check every response with the Zod schemas in `src/adapters/navision/schemas.ts`.
5. **`getItem` is exact.** Do not let the API's case-insensitive or wildcard matching leak in; a near match belongs in `searchItems`.

## Likely ways in (to confirm with Spectra's IT)

| Option | When it applies | Notes |
|---|---|---|
| OData or SOAP web services | Dynamics NAV 2013 and later can publish pages and codeunits as web services | Reads map to OData queries on Item, Customer, Vendor, Sales Header and Purchase Header pages. Writes go through a page or codeunit published for the purpose. |
| Business Central API | If Spectra has moved to Business Central | REST API with standard entities (items, customers, salesOrders). |
| File import and export | If no web services are allowed | Keep `FileNavisionGateway`'s idea: Navision exports master data on a schedule; our export folder becomes a drop folder that a Navision import job (XMLport or RapidStart) picks up. |

## Skeleton

```ts
// src/adapters/navision/apiGateway.ts
// What: NavisionGateway backed by Navision web services.
// Who calls it: getDeps() when NAVISION_MODE is "api".
// To extend: add one private call per Navision endpoint; keep every response behind a Zod schema.
import { sha256OfText } from "@/domain/hash";
import { serializeExportFile, type SalesOrderExport } from "@/domain/po/exportFile";
import { ItemSchema } from "./schemas";
import { type ExportApproval, ExportNotApprovedError, type ExportResult, type NavisionGateway } from "./gateway";

export class ApiNavisionGateway implements NavisionGateway {
  constructor(private readonly baseUrl: string, private readonly credentials: { user: string; key: string }) {}

  async getItem(itemNo: string) {
    const response = await this.get(`/Item?$filter=No eq '${encodeURIComponent(itemNo)}'`);
    const row = response.value[0];
    if (!row) return null;
    // Map Navision's field names to ours, then validate. Prices become strings here.
    return ItemSchema.parse({
      itemNo: row.No,
      description: row.Description,
      vendorId: row.Vendor_No,
      price: String(row.Unit_Price),
      purchasePrice: String(row.Last_Direct_Cost),
      currency: "USD",
      stockQty: row.Inventory,
    });
  }

  async exportSalesOrder(order: SalesOrderExport, approval: ExportApproval): Promise<ExportResult> {
    const text = serializeExportFile(order);
    if (approval.previewHash !== sha256OfText(text)) {
      throw new ExportNotApprovedError("The content does not match the approved preview.");
    }
    // 1. Look for an existing order with External Document No. = `${order.orderNo}-r${order.revision}` (idempotency).
    // 2. If none exists, create the sales header and lines.
    // 3. Return where it ended up.
    throw new Error("Not implemented yet");
  }

  // ...the other methods...
}
```

The field names above (`Unit_Price`, `Last_Direct_Cost`, `Inventory`) are typical for a published Item page but must be checked against Spectra's system.

## How to test a new gateway

`tests/integration/fileNavisionGateway.test.ts` describes the expected behaviour. Run the same expectations against the new class with a Navision sandbox company, then switch `getDeps()`.
