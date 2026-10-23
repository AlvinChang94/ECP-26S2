import type { IngestFile, IngestorName } from "./types";

export * from "./types";
export { sha256Hex } from "./hash";
export {
  createDocumentAiIngestor,
  createDefaultDocumentAiIngestor,
  ReplayCacheMissError,
} from "./document-ai";
export type { DocumentAiDeps, DocumentAiOptions } from "./document-ai";
export { spreadsheetIngestor } from "./spreadsheet";
export type { SpreadsheetOptions, SpreadsheetColumn } from "./spreadsheet";
export { textReportIngestor, parseFixedWidth } from "./text-report";
export type { TextReportOptions, TextColumn } from "./text-report";
export { EXTRACTION_SCHEMAS, defineExtractionSchema } from "./schemas";
export type { ExtractionSchema } from "./schemas";
export { MemoryExtractionCache, PrismaExtractionCache } from "./cache";
export type { ExtractionCache } from "./cache";

/** Picks an ingestor from the file extension / MIME type. */
export function ingestorFor(file: Pick<IngestFile, "fileName" | "mimeType">): IngestorName {
  const ext = file.fileName.toLowerCase().split(".").pop() ?? "";
  if (ext === "xlsx" || file.mimeType?.includes("spreadsheetml")) return "spreadsheet";
  if (ext === "txt" || ext === "prn" || file.mimeType === "text/plain") return "text-report";
  return "document-ai"; // pdf, png, jpg, tiff, ...
}
