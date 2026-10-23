// Seeds the statement-agnostic core with synthetic data from data/golden/. Safe to re-run:
// it wipes the core tables first. Run with `npm run db:seed`.
import "dotenv/config";
import type { Prisma } from "../src/generated/prisma/client";
import { getDb } from "../src/lib/db";
import { getEnv } from "../src/lib/env";
import { demoFindings } from "../src/server/demo/findings";
import { readGoldenBytes } from "../src/server/golden";
import { toExtractionColumns } from "../src/server/ingest/cache";
import { sha256Hex } from "../src/server/ingest/hash";
import { textReportIngestor } from "../src/server/ingest/text-report";
import { ALL_RULES } from "../src/server/modules";
import { ERP_REPORT_OPTIONS } from "../src/server/modules/commission-check/report-format";
import { loadOrderTrackingGolden } from "../src/server/modules/order-tracking/golden";
import { loadPaymentMatchingGolden } from "../src/server/modules/payment-matching/golden";

const json = (v: unknown) => v as Prisma.InputJsonValue;

async function main() {
  getEnv(); // fail fast with a clear message if .env is incomplete
  const db = getDb();
  const ot = loadOrderTrackingGolden();
  const pm = loadPaymentMatchingGolden();

  // Done outside the transaction: parsing is pure and needs no DB.
  const erpBytes = readGoldenBytes("commission-check", "erp_sales_report.txt");
  const erp = await textReportIngestor.ingest(
    { fileName: "erp_sales_report.txt", bytes: erpBytes },
    ERP_REPORT_OPTIONS,
  );
  const findings = demoFindings();

  await db.$transaction(async (tx) => {
    // Children first (extractions reference documents).
    await tx.extraction.deleteMany();
    await tx.document.deleteMany();
    await tx.finding.deleteMany();
    await tx.approval.deleteMany();
    await tx.party.deleteMany();
    await tx.ruleConfig.deleteMany();
    await tx.export.deleteMany();
    await tx.job.deleteMany();
    await tx.auditLog.deleteMany();

    await tx.party.createMany({
      data: [
        ...pm.input.parties.map((p) => ({
          type: "CUSTOMER" as const,
          code: p.code,
          name: p.name,
          aliases: p.aliases,
        })),
        { type: "VENDOR", code: "V001", name: "Pinnacle Fasteners Pte Ltd", aliases: [] },
        { type: "VENDOR", code: "V002", name: "Lumen Paper Mills", aliases: ["LUMEN PAPER"] },
        { type: "SALESPERSON", code: "SP-01", name: "Sales Rep One", aliases: [] },
        { type: "SALESPERSON", code: "SP-02", name: "Sales Rep Two", aliases: [] },
        { type: "SALESPERSON", code: "SP-03", name: "Sales Rep Three", aliases: [] },
      ],
    });

    // Order-tracking documents, as if already extracted by document-ai (cached).
    for (const d of ot.documents) {
      const records = d.lines.map(({ confidence, source, ...fields }) => ({
        fields: { documentNumber: d.documentRef, ...fields },
        confidence,
        sources: Object.fromEntries(
          Object.keys(confidence).map((f) => [f, { kind: "page", ...source }]),
        ),
      }));
      const cols = toExtractionColumns(records as never);
      await tx.document.create({
        data: {
          type: d.type,
          s3Key: d.s3Key,
          fileHash: d.fileHash,
          originalFilename: d.originalFilename,
          mimeType: "application/pdf",
          originChannel: "SEED",
          status: "EXTRACTED",
          extractions: {
            create: {
              schemaName: "order-line",
              schemaVersion: 1,
              ingestor: "document-ai",
              modelId: d.modelId,
              fromCache: true,
              fields: json(cols.fields),
              fieldConfidence: json(cols.fieldConfidence),
              fieldSources: json(cols.fieldSources),
            },
          },
        },
      });
    }

    // The ERP text report, parsed deterministically by the text-report ingestor.
    const erpCols = toExtractionColumns(erp.records);
    await tx.document.create({
      data: {
        type: "ERP_SALES_REPORT",
        s3Key: "golden/erp/erp_sales_report.txt",
        fileHash: sha256Hex(erpBytes),
        originalFilename: "erp_sales_report.txt",
        mimeType: "text/plain",
        originChannel: "SEED",
        status: "EXTRACTED",
        extractions: {
          create: {
            schemaName: erp.schemaName,
            schemaVersion: erp.schemaVersion,
            ingestor: erp.ingestor,
            fields: json(erpCols.fields),
            fieldConfidence: json(erpCols.fieldConfidence),
            fieldSources: json(erpCols.fieldSources),
          },
        },
      },
    });

    await tx.ruleConfig.createMany({
      data: ALL_RULES.map((r) => ({
        ruleCode: r.code,
        params: json(r.defaultParams),
        description: r.description,
      })),
    });

    await tx.finding.createMany({
      data: findings.map((f) => ({
        subjectType: f.subject.type,
        subjectId: f.subject.id,
        ruleCode: f.ruleCode,
        reasonCode: f.reasonCode,
        severity: f.severity,
        explanation: f.explanation,
        details: json(f.details),
      })),
    });

    await tx.auditLog.create({
      data: { entityType: "system", entityId: "seed", action: "SEED_GOLDEN", actor: "seed-script" },
    });
  });

  console.log(
    `Seeded ${pm.input.parties.length + 5} parties, ${ot.documents.length + 1} documents, ` +
      `${ALL_RULES.length} rule configs and ${findings.length} findings from data/golden/.`,
  );
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => getDb().$disconnect());
