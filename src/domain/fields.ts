// What: turns extracted fields plus recorded edits into current values, and works out what "undo" restores.
// Who calls it: services (to load a document's current values) and pages (history panel, labels).
// To extend: nothing type-specific lives here. New document types work automatically through their spec.
import type { DocumentTypeSpec, ExtractedField, FieldSpec } from "./documents";

/** Current value of every field of a document, by key. null means empty. */
export type FieldValues = Record<string, string | null>;

/** One recorded change to a field. These are stored as AuditEvent rows (actions "field_edit" and "field_undo"). */
export type FieldEdit = {
  id: number; // increasing number: edits are replayed in this order
  field: string;
  oldValue: string | null;
  newValue: string | null;
  action: "field_edit" | "field_undo";
  actorName: string;
  at: Date;
  reason: string | null;
};

/** Trims what a person typed. An empty box means "no value" (null). */
export function normalizeInput(text: string | null | undefined): string | null {
  if (text === null || text === undefined) return null;
  const trimmed = text.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function extractedValues(fields: ExtractedField[]): FieldValues {
  const values: FieldValues = {};
  for (const field of fields) values[field.key] = field.value;
  return values;
}

/**
 * Current values = what was extracted, then every edit applied in order.
 * Extracted values are never rewritten: only a recorded edit (made by a named person) changes what we show.
 */
export function currentValues(fields: ExtractedField[], edits: FieldEdit[]): FieldValues {
  const values = extractedValues(fields);
  for (const edit of [...edits].sort((a, b) => a.id - b.id)) {
    values[edit.field] = edit.newValue;
  }
  return values;
}

/** Edits of one field, oldest first, for the history panel. */
export function fieldHistory(field: string, edits: FieldEdit[]): FieldEdit[] {
  return edits.filter((edit) => edit.field === field).sort((a, b) => a.id - b.id);
}

/**
 * What undo would do for a field: restore the value from before the most recent edit that has not been undone yet.
 * Returns null when there is nothing left to undo. Each undo is itself recorded as a "field_undo" edit.
 */
export function undoTarget(field: string, edits: FieldEdit[]): { restoreTo: string | null } | null {
  const stack: FieldEdit[] = [];
  for (const edit of fieldHistory(field, edits)) {
    if (edit.action === "field_edit") stack.push(edit);
    else stack.pop(); // an undo cancels the latest edit that was still in force
  }
  const latest = stack[stack.length - 1];
  return latest ? { restoreTo: latest.oldValue } : null;
}

const LINE_KEY = /^lines\[(\d+)\]\.([A-Za-z]+)$/;

export function lineKey(index: number, name: string): string {
  return `lines[${index}].${name}`;
}

export function parseLineKey(key: string): { index: number; name: string } | null {
  const match = LINE_KEY.exec(key);
  return match ? { index: Number(match[1]), name: match[2] } : null;
}

/** Line numbers present in the values, in order: [0, 1, 2]. */
export function lineIndexes(values: FieldValues): number[] {
  const indexes = new Set<number>();
  for (const key of Object.keys(values)) {
    const parsed = parseLineKey(key);
    if (parsed) indexes.add(parsed.index);
  }
  return [...indexes].sort((a, b) => a - b);
}

/** A line is removed when a person set its "removed" field to "true". The line stays visible, struck through. */
export function isLineRemoved(values: FieldValues, index: number): boolean {
  return values[lineKey(index, "removed")] === "true";
}

/** Finds the spec of a field key, looking through header fields and line columns. */
export function findFieldSpec(spec: DocumentTypeSpec, key: string): FieldSpec | null {
  const line = parseLineKey(key);
  if (line) return spec.lineFields.find((field) => field.key === line.name) ?? null;
  return spec.fields.find((field) => field.key === key) ?? null;
}

/** Human label of a field key: "PO number", or "Line 2: Unit price". */
export function fieldLabel(spec: DocumentTypeSpec, key: string): string {
  const line = parseLineKey(key);
  if (line) {
    if (line.name === "removed") return `Line ${line.index + 1}: removed`;
    const column = spec.lineFields.find((field) => field.key === line.name);
    return `Line ${line.index + 1}: ${column?.label ?? line.name}`;
  }
  if (key === "lines") return "Lines";
  return spec.fields.find((field) => field.key === key)?.label ?? key;
}

/** One difference between two sets of values, for "what changed" tables. */
export type ValueDifference = { field: string; before: string | null; after: string | null };

/** Fields whose value differs between `before` and `after`, in a stable order (header fields first, then lines). */
export function diffValues(before: FieldValues, after: FieldValues): ValueDifference[] {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  keys.sort((a, b) => {
    const lineA = parseLineKey(a);
    const lineB = parseLineKey(b);
    if (!lineA && !lineB) return 0; // header fields keep their original order
    if (!lineA) return -1;
    if (!lineB) return 1;
    return lineA.index - lineB.index;
  });
  return keys
    .filter((key) => (before[key] ?? null) !== (after[key] ?? null))
    .map((key) => ({ field: key, before: before[key] ?? null, after: after[key] ?? null }));
}
