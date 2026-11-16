// What: reads the text of a PDF with pdf.js, keeping where each piece of text sits on its page.
// Who calls it: the default extractor (classifier and layout parser) and the optional LLM extractor.
// To extend: scanned PDFs have no text layer and come back empty; in AWS, Amazon Textract replaces this file (docs/AWS_MAPPING.md).
import type { BoundingBox } from "@/domain/documents";

/** One run of text as pdf.js reports it. The box uses page fractions from the top-left corner. */
export type PdfTextItem = {
  id: number; // position in reading order, unique within the document
  text: string;
  page: number; // 1-based
  box: BoundingBox;
};

/** Text items that sit on the same visual line, left to right. */
export type PdfLine = { page: number; y: number; items: PdfTextItem[] };

export type PdfText = {
  pageCount: number;
  items: PdfTextItem[];
  lines: PdfLine[];
  /** All text joined line by line, for keyword checks. */
  fullText: string;
};

type PdfJsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let pdfJsModule: Promise<PdfJsModule> | null = null;

/** pdf.js is an ES module that expects a browser; the "legacy" build also runs in Node. Loaded once, on first use. */
function loadPdfJs(): Promise<PdfJsModule> {
  pdfJsModule ??= import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfJsModule;
}

/** Two items are on the same line when their tops differ by less than this fraction of the page height. */
const SAME_LINE_TOLERANCE = 0.004;

export async function readPdfText(bytes: Uint8Array): Promise<PdfText> {
  const pdfjs = await loadPdfJs();
  // pdf.js takes ownership of the array it is given, so it gets a copy.
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0, useSystemFonts: false });
  const pdf = await loadingTask.promise;
  const items: PdfTextItem[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      for (const item of content.items) {
        if (!("str" in item) || item.str.trim().length === 0) continue;
        // transform = [a, b, c, d, x, y]: x and y are the start of the text baseline, measured from the bottom-left.
        const left = Number(item.transform[4]);
        const baseline = Number(item.transform[5]);
        const height = item.height > 0 ? item.height : Math.abs(Number(item.transform[3]));
        items.push({
          id: 0,
          text: item.str.trim(),
          page: pageNumber,
          box: {
            x: left / viewport.width,
            y: (viewport.height - baseline - height) / viewport.height,
            width: item.width / viewport.width,
            height: (height * 1.3) / viewport.height, // a little extra so letters that hang below the line are covered
          },
        });
      }
    }
  } finally {
    await loadingTask.destroy();
  }

  items.sort((a, b) => a.page - b.page || a.box.y - b.box.y || a.box.x - b.box.x);
  const lines: PdfLine[] = [];
  for (const item of items) {
    const current = lines[lines.length - 1];
    if (current && current.page === item.page && Math.abs(current.y - item.box.y) <= SAME_LINE_TOLERANCE) {
      current.items.push(item);
    } else {
      lines.push({ page: item.page, y: item.box.y, items: [item] });
    }
  }
  let nextId = 0;
  for (const line of lines) {
    line.items.sort((a, b) => a.box.x - b.box.x);
    for (const item of line.items) item.id = nextId++;
  }
  const ordered = lines.flatMap((line) => line.items);
  return {
    pageCount: pdf.numPages,
    items: ordered,
    lines,
    fullText: lines.map((line) => line.items.map((item) => item.text).join("  ")).join("\n"),
  };
}
