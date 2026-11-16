// What: turns extracted fields into the highlight boxes the PDF viewer draws.
// Who calls it: pages that show a PDF next to its fields.
// To extend: nothing; a field without a position (not found, or typed by staff) simply has no highlight.
import type { PdfHighlight } from "@/components/PdfViewer";
import type { ExtractedField } from "@/domain/documents";

export function toHighlights(fields: ExtractedField[]): PdfHighlight[] {
  const highlights: PdfHighlight[] = [];
  for (const field of fields) {
    if (field.page === null || field.bbox === null) continue;
    highlights.push({ key: field.key, page: field.page, x: field.bbox.x, y: field.bbox.y, width: field.bbox.width, height: field.bbox.height });
  }
  return highlights;
}

/** The value of one search parameter as a single string, or null. */
export function oneParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
