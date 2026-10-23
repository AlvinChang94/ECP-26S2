import type { PrismaClient } from "@/generated/prisma/client";
import type { IngestResult, NormalisedRecord } from "./types";

/** Extraction cache keyed by file hash + schema name + version. */
export interface CacheKey {
  fileHash: string;
  schemaName: string;
  schemaVersion: number;
}

export interface ExtractionCache {
  get(key: CacheKey): Promise<IngestResult | null>;
  set(result: IngestResult): Promise<void>;
}

/** For tests and scripts. */
export class MemoryExtractionCache implements ExtractionCache {
  private readonly store = new Map<string, IngestResult>();
  private static k(key: CacheKey) {
    return `${key.fileHash}:${key.schemaName}@${key.schemaVersion}`;
  }
  async get(key: CacheKey) {
    return this.store.get(MemoryExtractionCache.k(key)) ?? null;
  }
  async set(result: IngestResult) {
    this.store.set(MemoryExtractionCache.k(result), result);
  }
}

/** Splits records into the extractions table's three JSON columns, keyed by field path. */
export function toExtractionColumns(records: readonly NormalisedRecord[]) {
  const fieldConfidence: Record<string, number> = {};
  const fieldSources: Record<string, unknown> = {};
  records.forEach((r, i) => {
    for (const [field, c] of Object.entries(r.confidence))
      fieldConfidence[`records.${i}.${field}`] = c;
    for (const [field, s] of Object.entries(r.sources)) fieldSources[`records.${i}.${field}`] = s;
  });
  return { fields: { records: records.map((r) => r.fields) }, fieldConfidence, fieldSources };
}

function fromExtractionColumns(
  fields: unknown,
  conf: unknown,
  sources: unknown,
): NormalisedRecord[] {
  const rows = ((fields as { records?: NormalisedRecord["fields"][] })?.records ??
    []) as NormalisedRecord["fields"][];
  const c = (conf ?? {}) as Record<string, number>;
  const s = (sources ?? {}) as Record<string, NormalisedRecord["sources"][string]>;
  return rows.map((row, i) => {
    const prefix = `records.${i}.`;
    const pick = <T>(m: Record<string, T>) =>
      Object.fromEntries(
        Object.entries(m)
          .filter(([k]) => k.startsWith(prefix))
          .map(([k, v]) => [k.slice(prefix.length), v]),
      );
    return { fields: row, confidence: pick(c), sources: pick(s) };
  });
}

/**
 * Uses the extractions table as the cache. A documents row with the same file hash must
 * already exist (documents are registered on upload, before extraction runs).
 */
export class PrismaExtractionCache implements ExtractionCache {
  constructor(private readonly db: PrismaClient) {}

  async get(key: CacheKey): Promise<IngestResult | null> {
    const row = await this.db.extraction.findFirst({
      where: {
        schemaName: key.schemaName,
        schemaVersion: key.schemaVersion,
        document: { fileHash: key.fileHash },
      },
      orderBy: { id: "desc" },
    });
    if (!row) return null;
    return {
      ingestor: row.ingestor as IngestResult["ingestor"],
      schemaName: row.schemaName,
      schemaVersion: row.schemaVersion,
      fileHash: key.fileHash,
      modelId: row.modelId,
      fromCache: true,
      records: fromExtractionColumns(row.fields, row.fieldConfidence, row.fieldSources),
    };
  }

  async set(result: IngestResult): Promise<void> {
    const doc = await this.db.document.findUnique({ where: { fileHash: result.fileHash } });
    if (!doc)
      throw new Error(`No document with file hash ${result.fileHash}; register the document first`);
    await this.db.extraction.create({
      data: {
        documentId: doc.id,
        schemaName: result.schemaName,
        schemaVersion: result.schemaVersion,
        ingestor: result.ingestor,
        modelId: result.modelId,
        fromCache: false,
        ...(toExtractionColumns(result.records) as {
          fields: object;
          fieldConfidence: object;
          fieldSources: object;
        }),
      },
    });
  }
}
