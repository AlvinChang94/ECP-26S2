import { readGoldenJson } from "@/server/golden";
import type { NumberedLine, OrderDocumentsInput, OrderTrackingReasonCode } from "./types";

// Shapes of data/golden/order-tracking/*.json and a loader that turns them into rule input.

export interface GoldenOrder {
  orderNumber: string;
  customerName: string;
  orderDate: string;
  currency: string;
  lines: (NumberedLine & { unitPrice: string; weightKg: string })[];
}

export interface GoldenDocument {
  orderNumber: string;
  documentRef: string;
  type: string;
  originalFilename: string;
  s3Key: string;
  fileHash: string;
  modelId: string;
  lines: (NumberedLine & {
    confidence: Record<string, number>;
    source: { page: number; bbox: [number, number, number, number] };
  })[];
}

export interface GoldenExpectation {
  orderNumber: string;
  lineNo: number;
  codes: OrderTrackingReasonCode[];
  note: string;
}

export function loadOrderTrackingGolden() {
  const orders = readGoldenJson<GoldenOrder[]>("order-tracking", "orders.json");
  const documents = readGoldenJson<GoldenDocument[]>("order-tracking", "documents.json");
  const expectations = readGoldenJson<GoldenExpectation[]>(
    "order-tracking",
    "expected_mismatches.json",
  );
  const inputs: OrderDocumentsInput[] = orders.map((o) => ({
    orderNumber: o.orderNumber,
    orderLines: o.lines,
    documents: documents
      .filter((d) => d.orderNumber === o.orderNumber)
      .map((d) => ({ documentRef: d.documentRef, documentType: d.type, lines: d.lines })),
  }));
  return { orders, documents, expectations, inputs };
}
