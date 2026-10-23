import ExcelJS from "exceljs";
import { sha256Hex } from "./hash";
import type { FieldValue, Ingestor, IngestResult, NormalisedRecord } from "./types";

/** Reads one sheet of an .xlsx file into records, one per data row, using a header row. */

export interface SpreadsheetColumn {
  /** Header text in the sheet, matched case-insensitively ignoring surrounding spaces. */
  header: string;
  field: string;
  type: "text" | "integer" | "decimal" | "date";
}

export interface SpreadsheetOptions {
  schemaName: string;
  schemaVersion: number;
  /** Sheet name; defaults to the first sheet. */
  sheet?: string;
  /** 1-based row number of the header row. */
  headerRow?: number;
  columns: readonly SpreadsheetColumn[];
}

export class SpreadsheetParseError extends Error {}

type Raw = ExcelJS.CellValue;

function unwrap(v: Raw): Exclude<Raw, object> | Date {
  if (v === null || v === undefined) return null;
  if (v instanceof Date || typeof v !== "object") return v;
  if ("result" in v)
    return v.result instanceof Date || typeof v.result !== "object" ? (v.result ?? null) : null;
  if ("richText" in v) return v.richText.map((r) => r.text).join("");
  if ("text" in v) return v.text;
  return null; // error values like #N/A
}

function convert(v: Raw, col: SpreadsheetColumn, where: string): FieldValue {
  const value = unwrap(v);
  if (value === null || value === "") return null;
  switch (col.type) {
    case "text":
      return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).trim();
    case "date":
      if (value instanceof Date) return value.toISOString().slice(0, 10);
      if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
      throw new SpreadsheetParseError(`${where}: ${col.field} "${String(value)}" is not a date`);
    case "integer": {
      const n = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
      if (!Number.isInteger(n))
        throw new SpreadsheetParseError(
          `${where}: ${col.field} "${String(value)}" is not an integer`,
        );
      return n;
    }
    case "decimal": {
      // Excel stores numbers as doubles; String() gives the shortest exact representation
      // (e.g. 1234.5), which we keep as a decimal string from here on.
      const s = typeof value === "number" ? String(value) : String(value).trim().replace(/,/g, "");
      if (!/^-?\d+(\.\d+)?(e-?\d+)?$/i.test(s)) {
        throw new SpreadsheetParseError(
          `${where}: ${col.field} "${String(value)}" is not a decimal`,
        );
      }
      return s;
    }
  }
}

export async function parseWorkbook(bytes: Uint8Array, options: SpreadsheetOptions) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(bytes) as unknown as ExcelJS.Buffer);
  const sheet = options.sheet ? workbook.getWorksheet(options.sheet) : workbook.worksheets[0];
  if (!sheet) throw new SpreadsheetParseError(`Sheet "${options.sheet ?? "(first)"}" not found`);

  const headerRowNo = options.headerRow ?? 1;
  const headerRow = sheet.getRow(headerRowNo);
  const columnIndex = new Map<string, number>();
  headerRow.eachCell((cell, colNumber) => {
    columnIndex.set(
      String(unwrap(cell.value) ?? "")
        .trim()
        .toLowerCase(),
      colNumber,
    );
  });
  const missing = options.columns.filter((c) => !columnIndex.has(c.header.trim().toLowerCase()));
  if (missing.length > 0) {
    throw new SpreadsheetParseError(`Missing columns: ${missing.map((c) => c.header).join(", ")}`);
  }

  const records: NormalisedRecord[] = [];
  for (let r = headerRowNo + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    if (!row.hasValues) continue;
    const record: NormalisedRecord = { fields: {}, confidence: {}, sources: {} };
    for (const col of options.columns) {
      const c = columnIndex.get(col.header.trim().toLowerCase())!;
      const cell = row.getCell(c);
      record.fields[col.field] = convert(cell.value, col, `${sheet.name}!${cell.address}`);
      record.confidence[col.field] = 1;
      record.sources[col.field] = {
        kind: "cell",
        sheet: sheet.name,
        row: r,
        column: cell.address.replace(/\d+$/, ""),
      };
    }
    records.push(record);
  }
  return records;
}

export const spreadsheetIngestor: Ingestor<SpreadsheetOptions> = {
  name: "spreadsheet",
  async ingest(file, options): Promise<IngestResult> {
    return {
      ingestor: "spreadsheet",
      schemaName: options.schemaName,
      schemaVersion: options.schemaVersion,
      fileHash: sha256Hex(file.bytes),
      modelId: null,
      fromCache: false,
      records: await parseWorkbook(file.bytes, options),
    };
  },
};
