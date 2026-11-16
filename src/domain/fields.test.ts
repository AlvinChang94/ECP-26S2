// What: unit tests for current values, field history and undo.
// Who calls it: `npm test`.
// To extend: undo is a stack per field. Add a case here before changing how undo behaves.
import { describe, expect, it } from "vitest";
import { DOCUMENT_SPECS, type ExtractedField } from "./documents";
import {
  currentValues,
  diffValues,
  extractedValues,
  type FieldEdit,
  fieldHistory,
  fieldLabel,
  isLineRemoved,
  lineIndexes,
  normalizeInput,
  parseLineKey,
  undoTarget,
} from "./fields";

const extracted: ExtractedField[] = [
  { key: "poNumber", value: "LT-PO-2241", page: 1, bbox: null, confidence: 0.98 },
  { key: "lines[0].partNo", value: "AB-1234X", page: 1, bbox: null, confidence: 0.98 },
  { key: "lines[0].quantity", value: "100", page: 1, bbox: null, confidence: 0.98 },
  { key: "lines[1].partNo", value: "CD-77", page: 1, bbox: null, confidence: 0.98 },
];

let nextId = 1;
function edit(field: string, oldValue: string | null, newValue: string | null, action: FieldEdit["action"] = "field_edit"): FieldEdit {
  return { id: nextId++, field, oldValue, newValue, action, actorName: "Sam Tan", at: new Date("2026-11-16T01:00:00.000Z"), reason: null };
}

describe("currentValues", () => {
  it("is the extracted values when nobody has edited anything", () => {
    expect(currentValues(extracted, [])).toEqual(extractedValues(extracted));
  });

  it("applies edits in order and never touches the extracted list", () => {
    const edits = [edit("lines[0].partNo", "AB-1234X", "AB1234"), edit("lines[0].partNo", "AB1234", "AB1234X")];
    expect(currentValues(extracted, edits)["lines[0].partNo"]).toBe("AB1234X");
    expect(extracted[1].value).toBe("AB-1234X");
  });

  it("lets a person add a field that was not on the document", () => {
    expect(currentValues(extracted, [edit("promisedShipDate", null, "2026-11-23")]).promisedShipDate).toBe("2026-11-23");
  });
});

describe("undo", () => {
  it("has nothing to undo before the first edit", () => {
    expect(undoTarget("lines[0].partNo", [])).toBeNull();
  });

  it("restores the value from before the latest edit", () => {
    const edits = [edit("lines[0].partNo", "AB-1234X", "AB1234X")];
    expect(undoTarget("lines[0].partNo", edits)).toEqual({ restoreTo: "AB-1234X" });
  });

  it("walks back one edit at a time and stops at the extracted value", () => {
    const first = edit("lines[0].quantity", "100", "150");
    const second = edit("lines[0].quantity", "150", "200");
    expect(undoTarget("lines[0].quantity", [first, second])).toEqual({ restoreTo: "150" });
    const undoSecond = edit("lines[0].quantity", "200", "150", "field_undo");
    expect(undoTarget("lines[0].quantity", [first, second, undoSecond])).toEqual({ restoreTo: "100" });
    const undoFirst = edit("lines[0].quantity", "150", "100", "field_undo");
    expect(undoTarget("lines[0].quantity", [first, second, undoSecond, undoFirst])).toBeNull();
  });

  it("keeps each undo in the history, so the trail shows it happened", () => {
    const edits = [edit("poNumber", "LT-PO-2241", "LT-PO-2242"), edit("poNumber", "LT-PO-2242", "LT-PO-2241", "field_undo")];
    expect(fieldHistory("poNumber", edits).map((entry) => entry.action)).toEqual(["field_edit", "field_undo"]);
    expect(currentValues(extracted, edits).poNumber).toBe("LT-PO-2241");
  });

  it("ignores edits of other fields", () => {
    expect(undoTarget("poNumber", [edit("lines[0].partNo", "AB-1234X", "AB1234X")])).toBeNull();
  });
});

describe("lines", () => {
  it("finds the line numbers in the values", () => {
    expect(lineIndexes(extractedValues(extracted))).toEqual([0, 1]);
  });

  it("parses line keys and rejects other keys", () => {
    expect(parseLineKey("lines[12].unitPrice")).toEqual({ index: 12, name: "unitPrice" });
    expect(parseLineKey("poNumber")).toBeNull();
  });

  it("treats a line as removed only when a person set it so", () => {
    const values = currentValues(extracted, [edit("lines[1].removed", null, "true")]);
    expect(isLineRemoved(values, 1)).toBe(true);
    expect(isLineRemoved(values, 0)).toBe(false);
  });
});

describe("labels, input and differences", () => {
  it("labels header fields and line fields", () => {
    const spec = DOCUMENT_SPECS.customer_po;
    expect(fieldLabel(spec, "poNumber")).toBe("PO number");
    expect(fieldLabel(spec, "lines[1].unitPrice")).toBe("Line 2: Unit price");
  });

  it("turns an empty box into null", () => {
    expect(normalizeInput("  ")).toBeNull();
    expect(normalizeInput(" AB1234X ")).toBe("AB1234X");
  });

  it("lists only the fields that changed", () => {
    const before = extractedValues(extracted);
    const after = currentValues(extracted, [edit("lines[0].partNo", "AB-1234X", "AB1234X"), edit("promisedShipDate", null, "2026-11-23")]);
    expect(diffValues(before, after)).toEqual([
      { field: "promisedShipDate", before: null, after: "2026-11-23" },
      { field: "lines[0].partNo", before: "AB-1234X", after: "AB1234X" },
    ]);
  });
});
