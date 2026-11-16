// What: the optional LLM extractor (EXTRACTOR=llm). It asks Claude to classify and to point at where each field is in the text.
// Who calls it: createExtractor() in ../index.ts. Without the setting, or when anything goes wrong, the default extractor is used.
// To extend: for Amazon Bedrock, build the client with AnthropicBedrockMantle from @anthropic-ai/bedrock-sdk (docs/AWS_MAPPING.md).
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { DOCUMENT_SPECS, DOCUMENT_TYPES, type DocumentType, type ExtractedField } from "@/domain/documents";
import { parseLineKey } from "@/domain/fields";
import type { AppConfig } from "../../config";
import type { DefaultExtractor } from "../default";
import type { PdfText } from "../pdfText";
import type { Classification, DocumentExtractor, ExtractionResult, PdfInput } from "../types";

/**
 * The only thing we ask of a language model: read text and answer in a fixed JSON shape.
 * Returns null when there is no usable answer (no credentials, refusal, error, wrong shape).
 * Tests pass a fake reader, so no test ever calls the real API.
 */
export interface LlmReader {
  readStructured<T>(request: { system: string; user: string; schema: z.ZodType<T> }): Promise<T | null>;
}

export const ClassificationAnswerSchema = z.object({
  type: z.enum([...DOCUMENT_TYPES, "unknown"]),
  confidence: z.number(),
  reason: z.string(),
});

export const ExtractionAnswerSchema = z.object({
  fields: z.array(
    z.object({
      key: z.string(),
      value: z.string().nullable(),
      /** The number in square brackets of the text item the value was read from. */
      sourceItem: z.number().int().nullable(),
    }),
  ),
});

const LLM_CONFIDENCE = 0.9;

/** The text of the PDF as numbered lines, so the model can say exactly where it read each value. */
function numberedText(text: PdfText): string {
  return text.lines.map((line) => line.items.map((item) => `[${item.id}] ${item.text}`).join("   ")).join("\n");
}

function squash(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
}

export class LlmExtractor implements DocumentExtractor {
  readonly name = "llm (Claude reads pdf.js text; checked by Zod; default reader as fallback)";

  constructor(
    private readonly reader: LlmReader,
    private readonly fallback: DefaultExtractor,
  ) {}

  async classify(pdf: PdfInput): Promise<Classification> {
    const text = await this.fallback.read(pdf);
    if (text.items.length === 0) return this.fallback.classify(pdf);

    const answer = await this.reader.readStructured({
      system:
        "You sort business documents for Spectra Innovations, a distributor. Decide which type the document is. " +
        "A purchase order sent TO Spectra by a customer is customer_po; one issued BY Spectra to a vendor is vendor_po. " +
        "Answer unknown when it is none of the listed types. Only read; do not correct anything.",
      user: `Document types: ${DOCUMENT_TYPES.join(", ")}, unknown.\n\nDocument text:\n${numberedText(text)}`,
      schema: ClassificationAnswerSchema,
    });
    const checked = ClassificationAnswerSchema.safeParse(answer);
    if (!checked.success) return this.fallback.classify(pdf);
    return {
      type: checked.data.type,
      confidence: Math.min(0.99, Math.max(0, checked.data.confidence)),
      reasons: [checked.data.reason],
    };
  }

  async extract(pdf: PdfInput, type: DocumentType): Promise<ExtractionResult> {
    const baseline = await this.fallback.extract(pdf, type);
    const text = await this.fallback.read(pdf);
    if (text.items.length === 0) return baseline;

    const spec = DOCUMENT_SPECS[type];
    const headerKeys = spec.fields.filter((field) => !field.enteredByStaff).map((field) => `${field.key} (${field.label})`);
    const lineKeys = spec.lineFields.map((field) => `${field.key} (${field.label})`);
    const answer = await this.reader.readStructured({
      system:
        "You read fields from one business document. Copy each value exactly as it is written; never fix, reformat or guess. " +
        "For every value give the number in square brackets of the text item you copied it from. " +
        "Use null when a field is not in the document.",
      user:
        `Document type: ${spec.label}.\n` +
        `Header fields (use these keys): ${headerKeys.join(", ")}.\n` +
        (lineKeys.length > 0
          ? `Line table columns: ${lineKeys.join(", ")}. Key each cell as lines[ROW].COLUMN with ROW starting at 0, for example lines[0].partNo.\n`
          : "") +
        `\nDocument text:\n${numberedText(text)}`,
      schema: ExtractionAnswerSchema,
    });
    const checked = ExtractionAnswerSchema.safeParse(answer);
    if (!checked.success) return baseline; // missing or invalid answer: keep the default reader's result

    const itemsById = new Map(text.items.map((item) => [item.id, item]));
    const headerNames = new Set(spec.fields.filter((field) => !field.enteredByStaff).map((field) => field.key));
    const lineNames = new Set(spec.lineFields.map((field) => field.key));
    const merged = new Map<string, ExtractedField>(baseline.fields.map((field) => [field.key, field]));

    for (const candidate of checked.data.fields) {
      const line = parseLineKey(candidate.key);
      const knownKey = line ? lineNames.has(line.name) : headerNames.has(candidate.key);
      if (!knownKey || candidate.value === null || candidate.sourceItem === null) continue;
      const source = itemsById.get(candidate.sourceItem);
      // Grounding check: the value must really be in the text item the model pointed at.
      // Anything else is treated as a guess and dropped, so the default reader's value stays.
      if (!source || !squash(source.text).includes(squash(candidate.value))) continue;
      merged.set(candidate.key, {
        key: candidate.key,
        value: candidate.value.trim(),
        page: source.page,
        bbox: source.box,
        confidence: LLM_CONFIDENCE,
      });
    }
    return { type, fields: [...merged.values()] };
  }
}

/**
 * LlmReader backed by the Anthropic API. Credentials come from the environment (ANTHROPIC_API_KEY or an `ant auth login` profile).
 * Server-side refusal fallback is switched on, so a policy decline is retried on the model's default fallback.
 */
export function createAnthropicReader(config: Pick<AppConfig, "llmModel">): LlmReader {
  let client: Anthropic | null = null;
  return {
    async readStructured<T>(request: { system: string; user: string; schema: z.ZodType<T> }): Promise<T | null> {
      try {
        client ??= new Anthropic();
        const response = await client.beta.messages.parse({
          model: config.llmModel,
          max_tokens: 16000,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          system: request.system,
          messages: [{ role: "user", content: request.user }],
          // Reading labelled values from clean text is routine work, so low effort is enough. Raise it for messy scans.
          output_config: { effort: "low", format: betaZodOutputFormat(request.schema) },
        });
        if (response.stop_reason === "refusal") return null;
        return response.parsed_output ?? null;
      } catch (error) {
        if (error instanceof Anthropic.AuthenticationError) {
          console.warn("LLM extractor: no valid Anthropic credentials. Using the default reader instead.");
        } else if (error instanceof Anthropic.RateLimitError) {
          console.warn("LLM extractor: rate limited. Using the default reader instead.");
        } else if (error instanceof Anthropic.APIError) {
          console.warn(`LLM extractor: API error ${error.status}. Using the default reader instead.`);
        } else {
          console.warn(`LLM extractor: ${(error as Error).message}. Using the default reader instead.`);
        }
        return null;
      }
    },
  };
}
