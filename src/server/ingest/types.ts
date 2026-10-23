/** A file to ingest. Bytes in memory; callers fetch from S3 or disk first. */
export interface IngestFile {
  fileName: string;
  mimeType?: string;
  bytes: Uint8Array;
}

export type IngestorName = "document-ai" | "spreadsheet" | "text-report";

/** Where a value came from, so reviewers can jump to it. */
export type SourceLocation =
  | { kind: "page"; page: number; bbox: [number, number, number, number] | null; lineId?: string }
  | { kind: "cell"; sheet: string; row: number; column: string }
  | { kind: "line"; line: number; start: number; end: number };

/** Field values are strings for decimals and text (never floats), numbers only for integers. */
export type FieldValue = string | number | boolean | null;

export interface NormalisedRecord {
  fields: Record<string, FieldValue>;
  /** 0..1 per field. Deterministic ingestors report 1. */
  confidence: Record<string, number>;
  sources: Record<string, SourceLocation>;
}

export interface IngestResult {
  ingestor: IngestorName;
  schemaName: string;
  schemaVersion: number;
  fileHash: string;
  modelId: string | null;
  fromCache: boolean;
  records: NormalisedRecord[];
}

/** File in, normalised records out. Only the document-ai ingestor may call AWS. */
export interface Ingestor<O> {
  readonly name: IngestorName;
  ingest(file: IngestFile, options: O): Promise<IngestResult>;
}
