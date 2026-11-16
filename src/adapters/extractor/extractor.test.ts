// What: unit tests for the default extractor's parts (classifier, label parser) and for the LLM extractor's safety net.
// Who calls it: `npm test`. No test calls a real LLM: a fake reader stands in for it.
// To extend: when you add a label or a document type, add a small case here; the golden test covers whole documents.
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { readDataFile } from "../../../tests/helpers/workspace";
import { DefaultExtractor } from "./default";
import { classifyText } from "./default/classifier";
import { normalizeLabel, parseByLayout, splitLabel } from "./default/labelParser";
import { type LlmReader, LlmExtractor } from "./llm";
import type { PdfText, PdfTextItem } from "./pdfText";

/** Builds PdfText from rows of [x, text] pairs; each row is one line, 2% of the page apart. */
function textOf(rows: [number, string][][]): PdfText {
  let id = 0;
  const lines = rows.map((row, rowIndex) => {
    const y = 0.05 + rowIndex * 0.02;
    const items: PdfTextItem[] = row.map(([x, text]) => ({ id: id++, text, page: 1, box: { x, y, width: text.length * 0.008, height: 0.012 } }));
    return { page: 1, y, items };
  });
  return {
    pageCount: 1,
    items: lines.flatMap((line) => line.items),
    lines,
    fullText: lines.map((line) => line.items.map((item) => item.text).join("  ")).join("\n"),
  };
}

describe("label helpers", () => {
  it.each([
    ["Shipper's Reference", "shippers reference"],
    ["B/L No", "b l no"],
    ["Order No.", "order no"],
    ["  PO   Number ", "po number"],
  ])("normalises %s to %s", (label, expected) => {
    expect(normalizeLabel(label)).toBe(expected);
  });

  it("splits a label from its value at the first colon only", () => {
    expect(splitLabel("PO Number: LT-PO-1")).toEqual({ label: "PO Number", rest: "LT-PO-1" });
    expect(splitLabel("Time: 09:30")).toEqual({ label: "Time", rest: "09:30" });
    expect(splitLabel("no colon here")).toBeNull();
  });
});

describe("classifier", () => {
  it("tells a customer PO from a vendor PO by who sells and who buys", () => {
    const customerPo = classifyText(textOf([[[0.5, "PURCHASE ORDER"]], [[0.1, "To:"], [0.3, "Spectra Innovations"]], [[0.1, "Customer:"], [0.3, "Lanka Tech"]]]));
    const vendorPo = classifyText(textOf([[[0.5, "PURCHASE ORDER"]], [[0.1, "Buyer:"], [0.3, "Spectra Innovations"]], [[0.1, "Vendor:"], [0.3, "Alpha Supply"]]]));
    expect(customerPo.type).toBe("customer_po");
    expect(vendorPo.type).toBe("vendor_po");
    expect(customerPo.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("is not sure when a purchase order names neither party, so a person must choose", () => {
    const unclear = classifyText(textOf([[[0.5, "PURCHASE ORDER"]], [[0.1, "PO Number:"], [0.3, "X-1"]]]));
    expect(unclear.confidence).toBeLessThan(0.6);
    expect(unclear.reasons.join(" ")).toContain("Please choose the type");
  });

  it("does not take a proforma invoice for an ordinary invoice", () => {
    expect(classifyText(textOf([[[0.5, "PROFORMA INVOICE"]]])).type).toBe("proforma_invoice");
    expect(classifyText(textOf([[[0.5, "TAX INVOICE"]]])).type).toBe("vendor_invoice");
  });

  it("answers unknown for a document with no known title, and for a PDF with no text", () => {
    expect(classifyText(textOf([[[0.1, "NOTICE OF OFFICE CLOSURE"]]]))).toMatchObject({ type: "unknown", confidence: 0 });
    const scan = classifyText({ pageCount: 1, items: [], lines: [], fullText: "" });
    expect(scan.type).toBe("unknown");
    expect(scan.reasons[0]).toContain("no readable text");
  });
});

describe("label parser", () => {
  const po = textOf([
    [[0.5, "PURCHASE ORDER"]],
    [[0.1, "PO Number: X-77"], [0.5, "Customer:"], [0.7, "Lanka Tech"]],
    [[0.1, "Currency:"], [0.5, "PO Date:"], [0.7, "not a date"]],
    [[0.1, "Part No"], [0.3, "Description"], [0.6, "Qty"], [0.7, "Unit Price"], [0.85, "Amount"]],
    [[0.1, "AB-1234X"], [0.3, "Docking station"], [0.6, "100"], [0.7, "12.40"], [0.85, "1,240.00"]],
    [[0.1, "CD-77"], [0.3, "HDMI cable"], [0.6, "50"]],
    [[0.5, "Total:"], [0.7, "1,240.00"]],
  ]);
  const fields = new Map(parseByLayout(po, "customer_po").map((field) => [field.key, field]));

  it("reads a value that shares its text run with the label, and one that follows it", () => {
    expect(fields.get("poNumber")?.value).toBe("X-77");
    expect(fields.get("customerName")?.value).toBe("Lanka Tech");
  });

  it("returns null when a label has no value, instead of taking the next label as the value", () => {
    expect(fields.get("currency")?.value).toBeNull();
  });

  it("keeps a doubtful value as it is written but with lower confidence", () => {
    expect(fields.get("orderDate")).toMatchObject({ value: "not a date", confidence: 0.6 });
  });

  it("reads table rows by column and stops at the total line", () => {
    expect(fields.get("lines[0].partNo")?.value).toBe("AB-1234X");
    expect(fields.get("lines[1].quantity")?.value).toBe("50");
    expect(fields.get("lines[1].unitPrice")?.value).toBeNull();
    expect(fields.has("lines[2].partNo")).toBe(false);
    expect(fields.get("totalAmount")?.value).toBe("1,240.00");
  });

  it("never returns a staff-entered field as if it had been read", () => {
    expect(fields.has("promisedShipDate")).toBe(false);
  });
});

describe("LLM extractor: the model's answer is checked, and the default reader is the fallback", () => {
  const pdf = () => ({ bytes: readDataFile("golden/files/po-alias-hyphen.pdf"), fileName: "po-alias-hyphen.pdf" });

  /** A stand-in for the LLM that returns whatever the test prepared. */
  function fakeReader(answer: unknown): LlmReader & { calls: number } {
    const reader = {
      calls: 0,
      async readStructured<T>(request: { system: string; user: string; schema: z.ZodType<T> }): Promise<T | null> {
        reader.calls++;
        expect(request.user).toContain("Document text:");
        return answer as T | null;
      },
    };
    return reader;
  }

  async function defaultFields() {
    return new Map((await new DefaultExtractor().extract(pdf(), "customer_po")).fields.map((field) => [field.key, field.value]));
  }

  it("falls back to the default classifier when the model gives no answer or an invalid one", async () => {
    for (const answer of [null, { type: "love_letter", confidence: 1, reason: "x" }, { nonsense: true }]) {
      const result = await new LlmExtractor(fakeReader(answer), new DefaultExtractor()).classify(pdf());
      expect(result.type).toBe("customer_po");
    }
  });

  it("uses the model's classification when it is valid", async () => {
    const result = await new LlmExtractor(fakeReader({ type: "vendor_po", confidence: 0.4, reason: "Looks issued by the buyer." }), new DefaultExtractor()).classify(pdf());
    expect(result).toEqual({ type: "vendor_po", confidence: 0.4, reasons: ["Looks issued by the buyer."] });
  });

  it("keeps the default reader's fields when the model gives no answer or an invalid one", async () => {
    const expected = await defaultFields();
    for (const answer of [null, { fields: "none" }, { fields: [{ key: 1 }] }]) {
      const result = await new LlmExtractor(fakeReader(answer), new DefaultExtractor()).extract(pdf(), "customer_po");
      expect(new Map(result.fields.map((field) => [field.key, field.value]))).toEqual(expected);
    }
  });

  it("drops a value that is not in the text item the model pointed at (a guess or a 'correction')", async () => {
    const text = await new DefaultExtractor().read(pdf());
    const partItem = text.items.find((item) => item.text === "AB-1234X");
    const answer = {
      fields: [
        // The model "helpfully" corrected the part number. It is not what the page says, so it must be dropped.
        { key: "lines[0].partNo", value: "AB1234X", sourceItem: partItem?.id ?? 0 },
        // An invented field key is ignored.
        { key: "lines[0].colour", value: "blue", sourceItem: partItem?.id ?? 0 },
      ],
    };
    const result = await new LlmExtractor(fakeReader(answer), new DefaultExtractor()).extract(pdf(), "customer_po");
    const values = new Map(result.fields.map((field) => [field.key, field.value]));
    expect(values.get("lines[0].partNo")).toBe("AB-1234X");
    expect(values.has("lines[0].colour")).toBe(false);
  });

  it("accepts a value that really is in the text item it points at, with that item's position", async () => {
    const text = await new DefaultExtractor().read(pdf());
    const poNumberItem = text.items.find((item) => item.text === "LT-PO-2241");
    const answer = { fields: [{ key: "poNumber", value: "LT-PO-2241", sourceItem: poNumberItem?.id ?? -1 }] };
    const result = await new LlmExtractor(fakeReader(answer), new DefaultExtractor()).extract(pdf(), "customer_po");
    const poNumber = result.fields.find((field) => field.key === "poNumber");
    expect(poNumber).toMatchObject({ value: "LT-PO-2241", page: 1, confidence: 0.9 });
    expect(poNumber?.bbox).toEqual(poNumberItem?.box);
  });
});
