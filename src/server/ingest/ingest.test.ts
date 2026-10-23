import type { ConverseCommandOutput } from "@aws-sdk/client-bedrock-runtime";
import type { Block } from "@aws-sdk/client-textract";
import { describe, expect, it, vi } from "vitest";
import { buildWorkbook } from "@/server/export/excel";
import { MemoryExtractionCache } from "./cache";
import { createDocumentAiIngestor, ReplayCacheMissError, type DocumentAiDeps } from "./document-ai";
import { ingestorFor } from "./index";
import { paymentProofSchemaV1 } from "./schemas";
import { spreadsheetIngestor, SpreadsheetParseError } from "./spreadsheet";
import { parseFixedWidth } from "./text-report";

const file = (bytes: Uint8Array, fileName = "slip.png") => ({ fileName, bytes });

describe("ingestorFor", () => {
  it("routes by extension", () => {
    expect(ingestorFor({ fileName: "report.XLSX" })).toBe("spreadsheet");
    expect(ingestorFor({ fileName: "erp.txt" })).toBe("text-report");
    expect(ingestorFor({ fileName: "slip.jpg" })).toBe("document-ai");
    expect(ingestorFor({ fileName: "invoice.pdf" })).toBe("document-ai");
  });
});

describe("spreadsheet ingestor", () => {
  const options = {
    schemaName: "erp-sales",
    schemaVersion: 1,
    columns: [
      { header: "Invoice", field: "invoiceNo", type: "text" },
      { header: "Line", field: "lineNo", type: "integer" },
      { header: "Revenue", field: "revenue", type: "decimal" },
      { header: "Date", field: "date", type: "date" },
    ],
  } as const;

  it("reads rows by header into decimal strings with cell sources", async () => {
    const bytes = await buildWorkbook([
      {
        name: "Sales",
        columns: [
          { header: "INVOICE ", key: "inv" },
          { header: "Line", key: "line", type: "integer" },
          { header: "Revenue", key: "rev", type: "money" },
          { header: "Date", key: "date", type: "date" },
        ],
        rows: [
          { inv: "INV-1", line: 1, rev: "1250.50", date: "2026-09-01" },
          { inv: "INV-1", line: 2, rev: "0.10", date: "2026-09-02" },
        ],
      },
    ]);
    const result = await spreadsheetIngestor.ingest(file(new Uint8Array(bytes), "s.xlsx"), options);
    expect(result.records.map((r) => r.fields)).toEqual([
      { invoiceNo: "INV-1", lineNo: 1, revenue: "1250.5", date: "2026-09-01" },
      { invoiceNo: "INV-1", lineNo: 2, revenue: "0.1", date: "2026-09-02" },
    ]);
    expect(result.records[1].sources.revenue).toEqual({
      kind: "cell",
      sheet: "Sales",
      row: 3,
      column: "C",
    });
    expect(result.fileHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("fails clearly when a required column is missing", async () => {
    const bytes = await buildWorkbook([
      { name: "S", columns: [{ header: "Invoice", key: "a" }], rows: [{ a: "x" }] },
    ]);
    await expect(spreadsheetIngestor.ingest(file(new Uint8Array(bytes)), options)).rejects.toThrow(
      SpreadsheetParseError,
    );
  });
});

describe("text-report parser", () => {
  it("skips non-data lines and rejects malformed numbers", () => {
    const cols = [
      { field: "id", start: 0, end: 4, type: "text" as const },
      { field: "amt", start: 4, end: 12, type: "decimal" as const },
    ];
    expect(
      parseFixedWidth("HEADER\nA001 1,234.5\nTOTAL", {
        schemaName: "t",
        schemaVersion: 1,
        columns: cols,
        dataLine: /^A\d/,
      }).map((r) => r.fields),
    ).toEqual([{ id: "A001", amt: "1234.5" }]);
    expect(() =>
      parseFixedWidth("A001    12x4", {
        schemaName: "t",
        schemaVersion: 1,
        columns: cols,
        dataLine: /^A\d/,
      }),
    ).toThrow(/not a decimal/);
  });
});

describe("document-ai ingestor (AWS faked)", () => {
  const blocks: Block[] = [
    { BlockType: "PAGE", Id: "p" },
    {
      BlockType: "LINE",
      Text: "From: HARBOURLINE TRDG PTE LTD",
      Page: 1,
      Geometry: { BoundingBox: { Left: 0.1, Top: 0.2, Width: 0.5, Height: 0.02 } },
    },
    {
      BlockType: "LINE",
      Text: "SGD 2,828.40  02 Sep 2026",
      Page: 1,
      Geometry: { BoundingBox: { Left: 0.1, Top: 0.3, Width: 0.4, Height: 0.02 } },
    },
  ];
  const toolOutput = {
    records: [
      {
        fields: {
          payerName: "HARBOURLINE TRDG PTE LTD",
          amount: "2828.40",
          currency: "SGD",
          valueDate: "2026-09-02",
          reference: null,
          bankReference: null,
        },
        confidence: { payerName: 0.97, amount: 0.99, currency: 0.99, valueDate: 0.95 },
        sourceLineIds: { payerName: "L1", amount: "L2" },
      },
    ],
  };
  const respond = (input: unknown) =>
    ({
      output: {
        message: {
          role: "assistant",
          content: [{ toolUse: { toolUseId: "t", name: "record_extraction", input } }],
        },
      },
    }) as unknown as ConverseCommandOutput;
  const converseOk = async (): Promise<ConverseCommandOutput> => respond(toolOutput);

  const makeDeps = (
    overrides: { replayMode?: boolean; converse?: () => Promise<ConverseCommandOutput> } = {},
  ) => {
    const deps = {
      detectText: vi.fn<DocumentAiDeps["detectText"]>(async () => blocks),
      converse: vi.fn<DocumentAiDeps["converse"]>(overrides.converse ?? converseOk),
      modelId: "test-model",
      replayMode: overrides.replayMode ?? false,
      cache: new MemoryExtractionCache(),
    };
    return deps satisfies DocumentAiDeps;
  };
  const bytes = new TextEncoder().encode("fake image bytes");

  it("calls Textract then Bedrock with temperature 0, the pinned model and a forced JSON-schema tool", async () => {
    const deps = makeDeps();
    const result = await createDocumentAiIngestor(deps).ingest(file(bytes), {
      schema: paymentProofSchemaV1,
    });

    const input = deps.converse.mock.calls[0][0];
    expect(input.modelId).toBe("test-model");
    expect(input.inferenceConfig?.temperature).toBe(0);
    expect(input.toolConfig?.toolChoice).toEqual({ tool: { name: "record_extraction" } });
    expect(JSON.stringify(input.toolConfig?.tools?.[0].toolSpec?.inputSchema)).toContain(
      "payerName",
    );
    expect(JSON.stringify(input.messages)).toContain("L2 [p1] SGD 2,828.40");

    expect(result.fromCache).toBe(false);
    expect(result.records[0].fields.amount).toBe("2828.40");
    expect(result.records[0].confidence.reference).toBe(0); // not reported -> 0
    expect(result.records[0].sources.amount).toEqual({
      kind: "page",
      page: 1,
      bbox: [0.1, 0.3, 0.4, 0.02],
      lineId: "L2",
    });
  });

  it("serves the second call for the same file from cache without calling AWS", async () => {
    const deps = makeDeps();
    const ingestor = createDocumentAiIngestor(deps);
    await ingestor.ingest(file(bytes), { schema: paymentProofSchemaV1 });
    const again = await ingestor.ingest(file(bytes, "renamed.png"), {
      schema: paymentProofSchemaV1,
    });
    expect(again.fromCache).toBe(true);
    expect(deps.detectText).toHaveBeenCalledTimes(1);
    expect(deps.converse).toHaveBeenCalledTimes(1);
  });

  it("in REPLAY_MODE never calls AWS and fails clearly on a cache miss", async () => {
    const deps = makeDeps({ replayMode: true });
    await expect(
      createDocumentAiIngestor(deps).ingest(file(bytes), { schema: paymentProofSchemaV1 }),
    ).rejects.toThrow(ReplayCacheMissError);
    expect(deps.detectText).not.toHaveBeenCalled();
    expect(deps.converse).not.toHaveBeenCalled();
  });

  it("rejects model output that does not match the schema", async () => {
    const bad = structuredClone(toolOutput);
    bad.records[0].fields.amount = "2,828.40"; // thousands separator not allowed
    const deps = makeDeps({
      converse: async () => respond(bad),
    });
    await expect(
      createDocumentAiIngestor(deps).ingest(file(bytes), { schema: paymentProofSchemaV1 }),
    ).rejects.toThrow(/does not match payment-proof/);
  });
});
