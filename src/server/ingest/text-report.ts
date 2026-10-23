import { sha256Hex } from "./hash";
import type { FieldValue, Ingestor, IngestResult, NormalisedRecord } from "./types";

/**
 * Fixed-width text report parser (stub): enough for ERP "print to text" reports with one
 * record per line. Multi-line records, page totals and report-level headers are not handled
 * yet; extend once the real report format is known.
 */

export interface TextColumn {
  field: string;
  /** 0-based start column, inclusive. */
  start: number;
  /** 0-based end column, exclusive. */
  end: number;
  type: "text" | "integer" | "decimal";
}

export interface TextReportOptions {
  schemaName: string;
  schemaVersion: number;
  columns: readonly TextColumn[];
  /** Only lines matching this are data lines (headers, rules and totals are skipped). */
  dataLine: RegExp;
}

export class TextReportParseError extends Error {}

function parseValue(raw: string, col: TextColumn, lineNo: number): FieldValue {
  const v = raw.trim();
  if (v === "") return null;
  if (col.type === "text") return v;
  const n = v.replace(/,/g, "");
  if (col.type === "integer") {
    if (!/^-?\d+$/.test(n))
      throw new TextReportParseError(`Line ${lineNo}: ${col.field} "${v}" is not an integer`);
    return Number(n);
  }
  // Decimals stay strings. Trailing minus ("12.50-") is common in ERP reports.
  const m = /^(-)?(\d+(?:\.\d+)?)(-)?$/.exec(n);
  if (!m) throw new TextReportParseError(`Line ${lineNo}: ${col.field} "${v}" is not a decimal`);
  return (m[1] || m[3] ? "-" : "") + m[2];
}

export function parseFixedWidth(text: string, options: TextReportOptions): NormalisedRecord[] {
  const records: NormalisedRecord[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const lineNo = i + 1;
    if (!options.dataLine.test(line)) return;
    const record: NormalisedRecord = { fields: {}, confidence: {}, sources: {} };
    for (const col of options.columns) {
      record.fields[col.field] = parseValue(line.slice(col.start, col.end), col, lineNo);
      record.confidence[col.field] = 1;
      record.sources[col.field] = { kind: "line", line: lineNo, start: col.start, end: col.end };
    }
    records.push(record);
  });
  return records;
}

export const textReportIngestor: Ingestor<TextReportOptions> = {
  name: "text-report",
  async ingest(file, options): Promise<IngestResult> {
    const text = new TextDecoder("utf-8").decode(file.bytes);
    return {
      ingestor: "text-report",
      schemaName: options.schemaName,
      schemaVersion: options.schemaVersion,
      fileHash: sha256Hex(file.bytes),
      modelId: null,
      fromCache: false,
      records: parseFixedWidth(text, options),
    };
  },
};
