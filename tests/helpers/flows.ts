// What: shortcuts for integration tests: take in a sample PDF as a customer PO, and get an order all the way to exported.
// Who calls it: tests in tests/integration and tests/invariants.
// To extend: keep these as thin as the real clicks they stand for; they call the same services the pages call.
import path from "node:path";
import type { Deps } from "@/services/deps";
import { confirmDocumentType, ingestDocument } from "@/services/intake";
import { editField } from "@/services/poEdit";
import { approveAndExport, buildExportPreview } from "@/services/poExport";
import { readDataFile, SAM } from "./workspace";

/** Takes in a PDF from the data folder and confirms it as a customer PO. Returns the order number it became. */
export async function captureCustomerPo(deps: Deps, dataFile: string): Promise<{ orderNo: string; documentId: string }> {
  const { documentId } = await ingestDocument(deps, SAM, { bytes: readDataFile(dataFile), fileName: path.basename(dataFile), channel: "email", sender: null });
  const route = await confirmDocumentType(deps, SAM, documentId, "customer_po");
  return { orderNo: route.routedId as string, documentId };
}

/** Sets the promised ship date, as a sales team member would. */
export async function setShipDate(deps: Deps, orderNo: string, date = "2026-11-23"): Promise<void> {
  await editField(deps, SAM, { orderNo, field: "promisedShipDate", value: date });
}

/** Opens the preview and approves it, as a sales team member would. Fails if anything is still blocking. */
export async function approveExport(deps: Deps, orderNo: string) {
  const preview = await buildExportPreview(deps, orderNo);
  return approveAndExport(deps, SAM, { orderNo, previewHash: preview.previewHash });
}

/** A clean golden PO captured, given a ship date and exported. */
export async function exportedOrder(deps: Deps, dataFile = "golden/files/po-clean-a.pdf"): Promise<string> {
  const { orderNo } = await captureCustomerPo(deps, dataFile);
  await setShipDate(deps, orderNo);
  await approveExport(deps, orderNo);
  return orderNo;
}
