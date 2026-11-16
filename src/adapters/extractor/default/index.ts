// What: the default DocumentExtractor: pdf.js text with positions, a keyword classifier and label-based field reading.
// Who calls it: getDeps() when EXTRACTOR is "default" (the normal case); the LLM extractor also falls back to it.
// To extend: it is written for our generated sample layouts. New layouts need new labels in layouts.ts, or a different extractor.
import type { DocumentType } from "@/domain/documents";
import { type PdfText, readPdfText } from "../pdfText";
import type { Classification, DocumentExtractor, ExtractionResult, PdfInput } from "../types";
import { classifyText } from "./classifier";
import { parseByLayout } from "./labelParser";

export class DefaultExtractor implements DocumentExtractor {
  readonly name = "default (pdf.js text and label rules)";

  /** classify() and extract() are usually called one after the other for the same bytes, so the text is read once. */
  private readonly textCache = new WeakMap<Uint8Array, Promise<PdfText>>();

  async classify(pdf: PdfInput): Promise<Classification> {
    return classifyText(await this.read(pdf));
  }

  async extract(pdf: PdfInput, type: DocumentType): Promise<ExtractionResult> {
    return { type, fields: parseByLayout(await this.read(pdf), type) };
  }

  /** Also used by the LLM extractor, which sends this text (with positions) to the model. */
  read(pdf: PdfInput): Promise<PdfText> {
    let text = this.textCache.get(pdf.bytes);
    if (!text) {
      text = readPdfText(pdf.bytes);
      this.textCache.set(pdf.bytes, text);
    }
    return text;
  }
}
