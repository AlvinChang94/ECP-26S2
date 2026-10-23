import {
  ConverseCommand,
  type ConverseCommandInput,
  type ConverseCommandOutput,
} from "@aws-sdk/client-bedrock-runtime";
import { DetectDocumentTextCommand, type Block } from "@aws-sdk/client-textract";
import { z } from "zod";
import type { ExtractionCache } from "./cache";
import { sha256Hex } from "./hash";
import type { ExtractionSchema } from "./schemas";
import type { Ingestor, IngestResult, NormalisedRecord, SourceLocation } from "./types";

/**
 * Textract (OCR with positions) + Bedrock (structure the text into the given JSON schema).
 * The AI only extracts: it never matches, validates or decides anything.
 *
 * - Cached by file hash + schema name/version; a cache hit never calls AWS.
 * - REPLAY_MODE=true: cache only, a miss throws ReplayCacheMissError (offline demo).
 * - Bedrock: pinned model ID, temperature 0, output forced through a JSON-schema tool.
 * - Textract's synchronous API handles images and single-page PDFs. Multi-page PDFs need the
 *   async S3-based API (StartDocumentTextDetection); add it when a candidate needs it.
 */

export interface DocumentAiOptions {
  schema: ExtractionSchema;
  /** Extra guidance for this document type, e.g. "Bank slips from DBS put the payer in 'From'". */
  instructions?: string;
}

/** Narrow seams so tests can fake AWS without network access. */
export interface DocumentAiDeps {
  detectText(bytes: Uint8Array): Promise<Block[]>;
  converse(input: ConverseCommandInput): Promise<ConverseCommandOutput>;
  modelId: string;
  replayMode: boolean;
  cache: ExtractionCache;
}

export class ReplayCacheMissError extends Error {
  constructor(fileHash: string, schema: ExtractionSchema) {
    super(
      `REPLAY_MODE is on and there is no cached extraction for file ${fileHash} with schema ${schema.name}@${schema.version}. Run once with REPLAY_MODE=false to populate the cache.`,
    );
  }
}

export class ExtractionOutputError extends Error {}

const TOOL_NAME = "record_extraction";

const SYSTEM_PROMPT = [
  "You extract data from business documents. You only copy what is written.",
  "Never calculate, infer, correct or reconcile values. If a value is not on the document, use null.",
  "Write numbers as plain decimal strings exactly as printed, without thousands separators or currency symbols.",
  "Write dates as YYYY-MM-DD.",
  "For each field give a confidence between 0 and 1 and the id of the OCR line it came from.",
].join(" ");

const toolOutput = z.object({
  records: z.array(
    z.object({
      fields: z.unknown(),
      confidence: z.record(z.string(), z.number()).default({}),
      sourceLineIds: z.record(z.string(), z.string()).default({}),
    }),
  ),
});

function toolSchema(schema: ExtractionSchema) {
  return {
    type: "object",
    required: ["records"],
    properties: {
      records: {
        type: "array",
        description: `Every ${schema.description.toLowerCase()} found in the document`,
        items: {
          type: "object",
          required: ["fields", "confidence", "sourceLineIds"],
          properties: {
            fields: schema.jsonSchema,
            confidence: {
              type: "object",
              description: "Per field name: 0..1",
              additionalProperties: { type: "number", minimum: 0, maximum: 1 },
            },
            sourceLineIds: {
              type: "object",
              description: "Per field name: the OCR line id, e.g. L12",
              additionalProperties: { type: "string" },
            },
          },
        },
      },
    },
  };
}

export function buildConverseInput(
  modelId: string,
  lines: { id: string; page: number; text: string }[],
  options: DocumentAiOptions,
): ConverseCommandInput {
  const ocr = lines.map((l) => `${l.id} [p${l.page}] ${l.text}`).join("\n");
  return {
    modelId,
    system: [{ text: SYSTEM_PROMPT + (options.instructions ? `\n${options.instructions}` : "") }],
    messages: [{ role: "user", content: [{ text: `OCR lines:\n${ocr}` }] }],
    inferenceConfig: { temperature: 0, maxTokens: 4096 },
    toolConfig: {
      tools: [
        {
          toolSpec: {
            name: TOOL_NAME,
            description: `Record the extracted ${options.schema.name} records`,
            inputSchema: { json: toolSchema(options.schema) as never },
          },
        },
      ],
      toolChoice: { tool: { name: TOOL_NAME } },
    },
  };
}

export function createDocumentAiIngestor(deps: DocumentAiDeps): Ingestor<DocumentAiOptions> {
  return {
    name: "document-ai",
    async ingest(file, options): Promise<IngestResult> {
      const fileHash = sha256Hex(file.bytes);
      const key = {
        fileHash,
        schemaName: options.schema.name,
        schemaVersion: options.schema.version,
      };

      const cached = await deps.cache.get(key);
      if (cached) return { ...cached, fromCache: true };
      if (deps.replayMode) throw new ReplayCacheMissError(fileHash, options.schema);

      // 1. OCR with positions.
      const blocks = await deps.detectText(file.bytes);
      const lines = blocks
        .filter((b) => b.BlockType === "LINE" && b.Text)
        .map((b, i) => ({
          id: `L${i + 1}`,
          page: b.Page ?? 1,
          text: b.Text!,
          bbox: b.Geometry?.BoundingBox
            ? ([
                b.Geometry.BoundingBox.Left ?? 0,
                b.Geometry.BoundingBox.Top ?? 0,
                b.Geometry.BoundingBox.Width ?? 0,
                b.Geometry.BoundingBox.Height ?? 0,
              ] as [number, number, number, number])
            : null,
        }));
      const lineById = new Map(lines.map((l) => [l.id, l]));

      // 2. Structure into the schema.
      const response = await deps.converse(buildConverseInput(deps.modelId, lines, options));
      const toolUse = response.output?.message?.content?.find((c) => c.toolUse)?.toolUse;
      if (!toolUse) throw new ExtractionOutputError("Bedrock returned no structured output");
      const parsed = toolOutput.safeParse(toolUse.input);
      if (!parsed.success)
        throw new ExtractionOutputError(`Bad extraction output: ${parsed.error.message}`);

      const records: NormalisedRecord[] = parsed.data.records.map((r, i) => {
        let fields: Record<string, unknown>;
        try {
          fields = options.schema.parse(r.fields);
        } catch (err) {
          throw new ExtractionOutputError(
            `Record ${i} does not match ${options.schema.name}: ${String(err)}`,
          );
        }
        const sources: Record<string, SourceLocation> = {};
        for (const [field, lineId] of Object.entries(r.sourceLineIds)) {
          const line = lineById.get(lineId);
          if (line) sources[field] = { kind: "page", page: line.page, bbox: line.bbox, lineId };
        }
        const confidence = Object.fromEntries(
          Object.keys(fields).map((f) => [f, Math.min(1, Math.max(0, r.confidence[f] ?? 0))]),
        );
        return { fields: fields as NormalisedRecord["fields"], confidence, sources };
      });

      const result: IngestResult = {
        ingestor: "document-ai",
        schemaName: options.schema.name,
        schemaVersion: options.schema.version,
        fileHash,
        modelId: deps.modelId,
        fromCache: false,
        records,
      };
      await deps.cache.set(result);
      return result;
    },
  };
}

/** Wires the ingestor to the real AWS clients, env and the extractions-table cache. */
export async function createDefaultDocumentAiIngestor(): Promise<Ingestor<DocumentAiOptions>> {
  const [
    { getEnv },
    { getDb },
    { getBedrockClient, getTextractClient },
    { PrismaExtractionCache },
  ] = await Promise.all([
    import("@/lib/env"),
    import("@/lib/db"),
    import("@/lib/aws"),
    import("./cache"),
  ]);
  const env = getEnv();
  return createDocumentAiIngestor({
    detectText: async (bytes) =>
      (
        await getTextractClient().send(
          new DetectDocumentTextCommand({ Document: { Bytes: bytes } }),
        )
      ).Blocks ?? [],
    converse: (input) => getBedrockClient().send(new ConverseCommand(input)),
    modelId: env.BEDROCK_MODEL_ID,
    replayMode: env.REPLAY_MODE,
    cache: new PrismaExtractionCache(getDb()),
  });
}
