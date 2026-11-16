// What: a small helper around pdf-lib for drawing simple business documents (labels, values, one table, a footer).
// Who calls it: the sample-data generator (all synthetic PDFs) and the PI download (story 2).
// To extend: add a drawing method here. Keep output deterministic: no current date, no random values.
import { PDFDocument, type PDFFont, type PDFPage, StandardFonts, rgb } from "pdf-lib";

const PAGE_WIDTH = 595.28; // A4 in PDF points
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;
/** pdf-lib would stamp "now" into the file. A fixed date keeps generated files identical on every run. */
const FIXED_DATE = new Date("2026-01-01T00:00:00Z");

export type TableColumn = { header: string; width: number };

export class PdfWriter {
  /** Distance from the top of the page to the next free line, in points. */
  y = MARGIN;

  private constructor(
    private readonly doc: PDFDocument,
    private page: PDFPage,
    private readonly regular: PDFFont,
    private readonly bold: PDFFont,
    private readonly footer: string,
  ) {}

  static async create(options: { title: string; footer: string }): Promise<PdfWriter> {
    const doc = await PDFDocument.create();
    doc.setTitle(options.title);
    doc.setProducer("Spectra OrderFlow POC");
    doc.setCreator("Spectra OrderFlow POC");
    doc.setCreationDate(FIXED_DATE);
    doc.setModificationDate(FIXED_DATE);
    const regular = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const writer = new PdfWriter(doc, doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]), regular, bold, options.footer);
    writer.drawFooter();
    return writer;
  }

  get left(): number {
    return MARGIN;
  }

  get right(): number {
    return PAGE_WIDTH - MARGIN;
  }

  /** Draws one run of text. `x` and `y` are measured from the top-left corner of the page. */
  text(x: number, y: number, value: string, options: { size?: number; bold?: boolean; grey?: boolean } = {}): void {
    const size = options.size ?? 10;
    this.page.drawText(value, {
      x,
      y: PAGE_HEIGHT - y - size,
      size,
      font: options.bold ? this.bold : this.regular,
      color: options.grey ? rgb(0.4, 0.4, 0.4) : rgb(0.1, 0.1, 0.1),
    });
  }

  /** Draws "Label:" and its value on one line. The value starts `gap` points right of x. */
  labelValue(x: number, y: number, label: string, value: string, gap = 110): void {
    this.text(x, y, `${label}:`, { bold: true });
    this.text(x + gap, y, value);
  }

  rule(y: number): void {
    this.page.drawLine({
      start: { x: MARGIN, y: PAGE_HEIGHT - y },
      end: { x: PAGE_WIDTH - MARGIN, y: PAGE_HEIGHT - y },
      thickness: 0.7,
      color: rgb(0.6, 0.6, 0.6),
    });
  }

  /**
   * Draws a table with a header row. Every cell is left-aligned at its column's x position,
   * which keeps the layout easy to read back. Returns the y position below the last row.
   */
  table(yTop: number, columns: TableColumn[], rows: string[][], rowHeight = 18): number {
    let x = MARGIN;
    const starts: number[] = [];
    for (const column of columns) {
      starts.push(x);
      this.text(x, yTop, column.header, { bold: true, size: 9 });
      x += column.width;
    }
    this.rule(yTop + 14);
    let y = yTop + 20;
    for (const row of rows) {
      row.forEach((cell, index) => this.text(starts[index], y, cell, { size: 9 }));
      y += rowHeight;
    }
    this.rule(y - 2);
    return y + 6;
  }

  private drawFooter(): void {
    this.text(MARGIN, PAGE_HEIGHT - 40, this.footer, { size: 8, grey: true });
  }

  async save(): Promise<Uint8Array> {
    // Object streams are compressed with settings that may differ between library versions; plain objects are stable.
    return this.doc.save({ useObjectStreams: false });
  }
}
