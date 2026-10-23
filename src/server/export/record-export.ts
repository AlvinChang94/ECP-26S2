import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@/generated/prisma/client";
import { sha256Hex } from "@/server/ingest/hash";
import { buildWorkbook, type SheetSpec } from "./excel";

/** Local folder for generated files (git-ignored). Swap for S3 when deploying. */
export const EXPORT_DIR = path.join(process.cwd(), "storage", "exports");

export interface ExportRequest {
  kind: string; // what was generated, e.g. PAYMENT_CONSOLIDATION
  description: string;
  fileName: string; // e.g. payments-2026-09.xlsx
  sheets: SheetSpec[];
  params: Record<string, string | number | boolean | null>;
  createdBy: string;
}

/**
 * Writes an Excel file, then records it in `exports` (with its sha256) and `audit_log`.
 * Run from the worker or a script, not inside a request, for anything large.
 */
export async function exportWorkbook(db: PrismaClient, req: ExportRequest) {
  const bytes = await buildWorkbook(req.sheets, { creator: req.createdBy });
  const fileHash = sha256Hex(bytes);
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
  const storagePath = path.join(EXPORT_DIR, `${stamp}-${req.fileName}`);

  await mkdir(EXPORT_DIR, { recursive: true });
  await writeFile(storagePath, bytes);

  const rowCount = req.sheets.reduce((n, s) => n + s.rows.length, 0);
  const record = await db.export.create({
    data: {
      kind: req.kind,
      description: req.description,
      fileName: req.fileName,
      storagePath: path.relative(process.cwd(), storagePath).replace(/\\/g, "/"),
      fileHash,
      sizeBytes: bytes.length,
      rowCount,
      params: req.params,
      createdBy: req.createdBy,
    },
  });
  await db.auditLog.create({
    data: {
      entityType: "export",
      entityId: String(record.id),
      action: "EXPORT_CREATED",
      actor: req.createdBy,
      after: { kind: req.kind, fileName: req.fileName, fileHash, rowCount },
    },
  });
  return record;
}
