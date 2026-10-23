import ExcelJS from "exceljs";

/**
 * Builds an .xlsx file in memory. Pure (no DB, no disk) so it can be unit-tested.
 * Decimal strings are converted to Excel numbers only here, at the output boundary, and
 * shown with a fixed number format so values like 830.4 display as 830.40.
 */

export type ColumnType = "text" | "integer" | "money" | "decimal" | "percent" | "date";

export interface SheetColumn<R> {
  header: string;
  key: keyof R & string;
  type?: ColumnType;
  width?: number;
}

export interface SheetSpec<R extends Record<string, unknown> = Record<string, unknown>> {
  name: string;
  columns: SheetColumn<R>[];
  rows: R[];
}

const NUM_FMT: Partial<Record<ColumnType, string>> = {
  integer: "0",
  money: "#,##0.00",
  decimal: "0.####",
  percent: "0.00%",
  date: "yyyy-mm-dd",
};

function cellValue(value: unknown, type: ColumnType): ExcelJS.CellValue {
  if (value === null || value === undefined || value === "") return null;
  switch (type) {
    case "integer":
    case "money":
    case "decimal":
    case "percent":
      return Number(value);
    case "date":
      return new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
    default:
      return String(value);
  }
}

export async function buildWorkbook(
  sheets: SheetSpec[],
  meta: { creator?: string; created?: Date } = {},
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = meta.creator ?? "ECP";
  // Fixed timestamp support keeps output reproducible in tests.
  if (meta.created) {
    workbook.created = meta.created;
    workbook.modified = meta.created;
  }

  for (const spec of sheets) {
    const ws = workbook.addWorksheet(spec.name);
    ws.columns = spec.columns.map((c) => ({
      header: c.header,
      key: c.key,
      width: c.width ?? Math.max(12, c.header.length + 2),
      style: NUM_FMT[c.type ?? "text"] ? { numFmt: NUM_FMT[c.type ?? "text"] } : {},
    }));
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
    for (const row of spec.rows) {
      ws.addRow(
        Object.fromEntries(
          spec.columns.map((c) => [c.key, cellValue(row[c.key], c.type ?? "text")]),
        ),
      );
    }
    if (spec.rows.length > 0) {
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: spec.columns.length } };
    }
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
