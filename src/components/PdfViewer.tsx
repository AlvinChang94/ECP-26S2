// What: shows a PDF with pdf.js and draws a highlight over each extracted field; the selected field is scrolled into view.
// Who calls it: the document page and the PO review page (PDF on the left, fields on the right).
// To extend: this must be a client component because pdf.js draws on a <canvas> in the browser. Keep data loading in the page.
"use client";

import { useEffect, useRef, useState } from "react";

export type PdfHighlight = {
  key: string;
  page: number; // 1-based
  /** Position as fractions of the page, measured from the top-left corner. */
  x: number;
  y: number;
  width: number;
  height: number;
};

type PageSize = { width: number; height: number };

/** Pages are drawn this many pixels wide, then scaled by CSS to fit the column. */
const RENDER_WIDTH = 1100;

export function PdfViewer({ fileUrl, highlights, selectedKey }: { fileUrl: string; highlights: PdfHighlight[]; selectedKey: string | null }) {
  const [pages, setPages] = useState<PageSize[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const canvases = useRef<(HTMLCanvasElement | null)[]>([]);
  const selected = useRef<HTMLDivElement | null>(null);

  // Load the PDF and draw every page. Runs again only when the file changes.
  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    async function draw(): Promise<void> {
      // pdf.js needs browser features, so it is imported here (in the browser) and not at the top of the file.
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs"; // copied to public/ by `npm install`
      const loadingTask = pdfjs.getDocument({ url: fileUrl });
      cleanup = () => void loadingTask.destroy();
      const pdf = await loadingTask.promise;
      if (cancelled) return;

      const loadedPages = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        const page = await pdf.getPage(pageNumber);
        const scale = RENDER_WIDTH / page.getViewport({ scale: 1 }).width;
        loadedPages.push({ page, viewport: page.getViewport({ scale }) });
      }
      if (cancelled) return;
      // First tell React how many pages there are, so the <canvas> elements exist; then draw into them.
      setPages(loadedPages.map(({ viewport }) => ({ width: viewport.width, height: viewport.height })));
      await new Promise((resolve) => requestAnimationFrame(resolve));
      for (let index = 0; index < loadedPages.length; index++) {
        const canvas = canvases.current[index];
        if (cancelled || !canvas) return;
        const { page, viewport } = loadedPages[index];
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvas, viewport }).promise;
      }
      if (!cancelled) setStatus("ready");
    }

    draw().catch((error) => {
      // A cancelled render (leaving the page while it draws) is not an error worth showing.
      if (!cancelled) {
        console.error("Could not show the PDF", error);
        setStatus("error");
      }
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [fileUrl]);

  // Bring the selected field into view whenever the selection changes.
  useEffect(() => {
    if (status === "ready" && selected.current) {
      selected.current.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [selectedKey, status]);

  return (
    <div className="pdf-viewer" data-testid="pdf-viewer" data-status={status}>
      {status === "loading" ? <div className="pdf-status">Loading the PDF...</div> : null}
      {status === "error" ? <div className="pdf-status">The PDF could not be shown. The extracted fields on the right are still available.</div> : null}
      {pages.map((size, index) => (
        <div key={index} className="pdf-page" style={{ aspectRatio: `${size.width} / ${size.height}` }}>
          <canvas
            ref={(element) => {
              canvases.current[index] = element;
            }}
          />
          {highlights
            .filter((highlight) => highlight.page === index + 1)
            .map((highlight) => {
              const isSelected = highlight.key === selectedKey;
              return (
                <div
                  key={highlight.key}
                  ref={isSelected ? selected : undefined}
                  className={isSelected ? "pdf-highlight pdf-highlight-selected" : "pdf-highlight"}
                  data-field={highlight.key}
                  style={{
                    left: `${highlight.x * 100}%`,
                    top: `${highlight.y * 100}%`,
                    width: `${highlight.width * 100}%`,
                    height: `${highlight.height * 100}%`,
                  }}
                />
              );
            })}
        </div>
      ))}
    </div>
  );
}
