// Job handlers, keyed by jobs.type. Register new job types here.
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { z } from "zod";
import { getS3Client } from "../src/lib/aws";
import { getDb } from "../src/lib/db";
import { getEnv } from "../src/lib/env";
import { exportWorkbook } from "../src/server/export";
import {
  createDefaultDocumentAiIngestor,
  EXTRACTION_SCHEMAS,
  ingestorFor,
  PrismaExtractionCache,
  textReportIngestor,
  type IngestResult,
} from "../src/server/ingest";
import { ERP_REPORT_OPTIONS } from "../src/server/modules/commission-check/report-format";
import { paymentConsolidationSheets } from "../src/server/modules/payment-matching/consolidation";
import { loadPaymentMatchingGolden } from "../src/server/modules/payment-matching/golden";

export type JobHandler = (payload: unknown) => Promise<void>;

const extractPayload = z.object({
  documentId: z.coerce.bigint(),
  /** Extraction schema key, e.g. "payment-proof@1" or "erp-sales-commission@1". */
  schema: z.string(),
});

/** Reads a registered document from S3 and extracts it with the matching ingestor. */
async function extractDocument(payload: unknown) {
  const { documentId, schema } = extractPayload.parse(payload);
  const db = getDb();
  const doc = await db.document.findUniqueOrThrow({ where: { id: documentId } });
  await db.document.update({ where: { id: doc.id }, data: { status: "EXTRACTING" } });

  try {
    const obj = await getS3Client().send(
      new GetObjectCommand({ Bucket: getEnv().S3_BUCKET, Key: doc.s3Key }),
    );
    const bytes = await obj.Body!.transformToByteArray();
    const file = { fileName: doc.originalFilename, mimeType: doc.mimeType ?? undefined, bytes };

    let result: IngestResult;
    switch (ingestorFor(file)) {
      case "document-ai": {
        const extractionSchema = EXTRACTION_SCHEMAS[schema];
        if (!extractionSchema) throw new Error(`Unknown extraction schema "${schema}"`);
        // Caches into the extractions table itself (and honours REPLAY_MODE).
        result = await (
          await createDefaultDocumentAiIngestor()
        ).ingest(file, { schema: extractionSchema });
        break;
      }
      case "text-report": {
        if (schema !== "erp-sales-commission@1") throw new Error(`No text layout for "${schema}"`);
        result = await textReportIngestor.ingest(file, ERP_REPORT_OPTIONS);
        await new PrismaExtractionCache(db).set(result);
        break;
      }
      case "spreadsheet":
        throw new Error(`No spreadsheet column mapping registered for "${schema}" yet`);
    }

    await db.document.update({ where: { id: doc.id }, data: { status: "EXTRACTED" } });
    console.log(
      `[worker] document ${doc.id}: ${result.records.length} records (${result.ingestor}${result.fromCache ? ", cached" : ""})`,
    );
  } catch (err) {
    await db.document.update({ where: { id: doc.id }, data: { status: "FAILED" } });
    throw err;
  }
}

export const handlers: Record<string, JobHandler> = {
  // Example: `npm run job:enqueue -- noop hello=world`
  noop: async (payload) => {
    console.log("[worker] noop job payload:", JSON.stringify(payload));
  },

  // `npm run job:enqueue -- extract-document documentId=1 schema=payment-proof@1`
  "extract-document": extractDocument,

  // PLACEHOLDER: consolidates the golden payment data into an Excel file under storage/exports/.
  "export-payment-consolidation": async () => {
    const { input } = loadPaymentMatchingGolden();
    const record = await exportWorkbook(getDb(), {
      kind: "PAYMENT_CONSOLIDATION",
      description: "Payments matched to invoices (synthetic golden data)",
      fileName: "payment-consolidation.xlsx",
      sheets: paymentConsolidationSheets(input),
      params: { source: "data/golden/payment-matching" },
      createdBy: "worker",
    });
    console.log(`[worker] wrote ${record.storagePath} (sha256 ${record.fileHash.slice(0, 12)}…)`);
  },
};
