// What: the DocumentExtractor interface. "AI reads, nothing more": classify a PDF and extract its fields.
// Who calls it: the intake service. Implementations: DefaultExtractor (no keys needed) and LlmExtractor (optional).
// To extend: in AWS this becomes Textract (text and positions) plus Bedrock (fields); see docs/AWS_MAPPING.md.
import type { DetectedType, DocumentType, ExtractedField } from "@/domain/documents";

export type PdfInput = { bytes: Uint8Array; fileName: string };

export type Classification = {
  type: DetectedType;
  /** 0 to 1. Below LOW_CONFIDENCE_THRESHOLD the app asks a person to choose the type. */
  confidence: number;
  /** Short plain-language notes on why this type was chosen, shown to staff. */
  reasons: string[];
};

export type ExtractionResult = {
  type: DocumentType;
  /** One entry per expected field (value null when not found), each with page and bounding box where known. */
  fields: ExtractedField[];
};

export interface DocumentExtractor {
  /** Name stored with each document so we know which implementation read it. */
  readonly name: string;
  classify(pdf: PdfInput): Promise<Classification>;
  extract(pdf: PdfInput, type: DocumentType): Promise<ExtractionResult>;
}
