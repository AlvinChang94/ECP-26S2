// What: reads fields from PDF text by looking for known labels ("PO Number:") and one table with known column headers.
// Who calls it: DefaultExtractor.extract(). It only copies text found on the page; it never guesses or corrects a value.
// To extend: most changes are data in layouts.ts. Change this file only for a layout the label-and-table approach cannot read.
import { type BoundingBox, DOCUMENT_SPECS, type DocumentType, type ExtractedField, type FieldKind } from "@/domain/documents";
import { lineKey } from "@/domain/fields";
import { parseMoney, parseQuantity } from "@/domain/money";
import { parseDateText } from "@/domain/time";
import type { PdfLine, PdfText, PdfTextItem } from "../pdfText";
import { TYPE_LAYOUTS } from "./layouts";

/** "Shipper's Reference" -> "shippers reference", "B/L No" -> "b l no", "Order No." -> "order no". */
export function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Splits "PO Number: LT-PO-2241" at the first colon. Returns null when the text has no colon. */
export function splitLabel(text: string): { label: string; rest: string } | null {
  const colon = text.indexOf(":");
  if (colon === -1) return null;
  return { label: text.slice(0, colon), rest: text.slice(colon + 1).trim() };
}

const CURRENCY_CODE = /\b(USD|SGD|EUR|GBP|AED|LKR|BDT|PKR|INR|NPR|OMR|MYR)\b/;
const TABLE_END = /^(sub\s*total|grand\s*total|total)\b/i;
/** Rows of one table sit close together. A jump of more than 5% of the page height means the table is over. */
const MAX_ROW_GAP = 0.05;
const FOUND_CONFIDENCE = 0.98;
const DOUBTFUL_CONFIDENCE = 0.6;

/** Does the text look like what the field should hold? A doubtful value keeps its text but gets lower confidence. */
function looksValid(kind: FieldKind, value: string): boolean {
  if (kind === "money") return parseMoney(value) !== null;
  if (kind === "integer") return parseQuantity(value) !== null;
  if (kind === "date") return parseDateText(value) !== null;
  return value.length > 0;
}

/** The box of the last `valueLength` characters of an item, for a value that shares its text run with a label. */
function trailingBox(item: PdfTextItem, valueLength: number): BoundingBox {
  const fraction = Math.min(1, valueLength / Math.max(1, item.text.length));
  return { ...item.box, x: item.box.x + item.box.width * (1 - fraction), width: item.box.width * fraction };
}

type Found = { value: string; item: PdfTextItem; box: BoundingBox };

/** Finds the value printed after one of the labels: in the same text run, or in the next run on the same line. */
function findLabelled(text: PdfText, labels: string[]): Found | null {
  const wanted = labels.map(normalizeLabel);
  for (const line of text.lines) {
    for (let index = 0; index < line.items.length; index++) {
      const item = line.items[index];
      const parts = splitLabel(item.text);
      if (!parts || !wanted.includes(normalizeLabel(parts.label))) continue;
      if (parts.rest.length > 0) return { value: parts.rest, item, box: trailingBox(item, parts.rest.length) };
      const next = line.items[index + 1];
      // The next run is the value unless it is itself another label ("Customer:" directly followed by "PO Number:").
      if (next && !next.text.endsWith(":")) return { value: next.text, item: next, box: next.box };
      return null;
    }
  }
  return null;
}

function findPattern(text: PdfText, pattern: RegExp): Found | null {
  for (const line of text.lines) {
    if (line.page !== 1 || line.y > 0.15) continue;
    for (const item of line.items) {
      const match = pattern.exec(item.text);
      if (match) return { value: match[0], item, box: item.box };
    }
  }
  return null;
}

function field(key: string, kind: FieldKind, found: Found | null): ExtractedField {
  if (!found) return { key, value: null, page: null, bbox: null, confidence: 0 };
  return {
    key,
    value: found.value,
    page: found.item.page,
    bbox: found.box,
    confidence: looksValid(kind, found.value) ? FOUND_CONFIDENCE : DOUBTFUL_CONFIDENCE,
  };
}

function readHeaderFields(text: PdfText, type: DocumentType): ExtractedField[] {
  const layout = TYPE_LAYOUTS[type];
  const fields: ExtractedField[] = [];
  const foundByKey = new Map<string, Found>();

  for (const spec of DOCUMENT_SPECS[type].fields) {
    if (spec.enteredByStaff) continue; // typed by a person later, never read from the PDF
    const how = layout.fields[spec.key];
    let found: Found | null = null;
    if (how?.labels) found = findLabelled(text, how.labels);
    if (!found && how?.pattern) found = findPattern(text, how.pattern);

    if (found && spec.kind === "money") {
      // "USD 8,950.00": the amount is the number; the currency code is read into the currency field below.
      const withoutCurrency = found.value.replace(CURRENCY_CODE, "").trim();
      if (withoutCurrency !== found.value) found = { ...found, value: withoutCurrency, box: trailingBox(found.item, withoutCurrency.length) };
    }
    if (!found && how?.currencyInField) {
      const source = foundByKey.get(how.currencyInField);
      const code = source ? CURRENCY_CODE.exec(source.item.text) : null;
      if (source && code) found = { value: code[0], item: source.item, box: source.item.box };
    }
    if (found) foundByKey.set(spec.key, found);
    fields.push(field(spec.key, spec.kind, found));
  }
  return fields;
}

type Column = { key: string | null; x: number };

/** The first line on which at least two of the type's column headers appear, including the part-number column. */
function findTableHeader(lines: PdfLine[], columnLabels: Record<string, string[]>): { lineIndex: number; columns: Column[] } | null {
  const keyByHeader = new Map<string, string>();
  for (const [key, headers] of Object.entries(columnLabels)) {
    for (const header of headers) keyByHeader.set(normalizeLabel(header), key);
  }
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const columns: Column[] = lines[lineIndex].items.map((item) => ({
      key: keyByHeader.get(normalizeLabel(item.text)) ?? null,
      x: item.box.x,
    }));
    const known = columns.filter((column) => column.key !== null);
    if (known.length >= 2 && known.some((column) => column.key === "partNo")) return { lineIndex, columns };
  }
  return null;
}

function readLineFields(text: PdfText, type: DocumentType): ExtractedField[] {
  const spec = DOCUMENT_SPECS[type];
  const columnLabels = TYPE_LAYOUTS[type].columns;
  if (spec.lineFields.length === 0 || !columnLabels) return [];
  const header = findTableHeader(text.lines, columnLabels);
  if (!header) return [];

  const fields: ExtractedField[] = [];
  let row = 0;
  let previous = text.lines[header.lineIndex];
  for (let lineIndex = header.lineIndex + 1; lineIndex < text.lines.length; lineIndex++) {
    const line = text.lines[lineIndex];
    const first = line.items[0];
    // The table ends at the totals line, at the next labelled field, or at a large empty gap (for example before a footer).
    if (!first || TABLE_END.test(first.text) || line.items.some((item) => item.text.includes(":"))) break;
    if (line.page === previous.page && line.y - previous.y > MAX_ROW_GAP) break;
    previous = line;

    const cells = new Map<string, PdfTextItem>();
    for (const item of line.items) {
      // Each cell belongs to the column whose header starts closest to it (cells are left-aligned under their header).
      let nearest = header.columns[0];
      for (const column of header.columns) {
        if (Math.abs(column.x - item.box.x) < Math.abs(nearest.x - item.box.x)) nearest = column;
      }
      if (nearest.key && !cells.has(nearest.key)) cells.set(nearest.key, item);
    }
    if (!cells.has("partNo") && !cells.has("quantity")) continue; // not a data row (for example a wrapped description)

    for (const lineField of spec.lineFields) {
      const cell = cells.get(lineField.key);
      fields.push(field(lineKey(row, lineField.key), lineField.kind, cell ? { value: cell.text, item: cell, box: cell.box } : null));
    }
    row++;
  }
  return fields;
}

/** Every expected field of the type: header fields first, then one group per table row. Missing values are null. */
export function parseByLayout(text: PdfText, type: DocumentType): ExtractedField[] {
  return [...readHeaderFields(text, type), ...readLineFields(text, type)];
}
