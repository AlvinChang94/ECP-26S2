import type { TextColumn, TextReportOptions } from "@/server/ingest/text-report";

/**
 * Layout of the synthetic ERP "Sales & Commission" text report in
 * data/golden/commission-check/erp_sales_report.txt. Replace with the real layout once known.
 */
export const ERP_REPORT_COLUMNS: readonly TextColumn[] = [
  { field: "invoiceNo", start: 0, end: 10, type: "text" },
  { field: "lineNo", start: 10, end: 14, type: "integer" },
  { field: "salesperson", start: 15, end: 22, type: "text" },
  { field: "sku", start: 22, end: 36, type: "text" },
  { field: "quantity", start: 36, end: 44, type: "decimal" },
  { field: "revenue", start: 44, end: 56, type: "decimal" },
  { field: "cost", start: 56, end: 68, type: "decimal" },
  { field: "commissionRate", start: 68, end: 75, type: "decimal" },
  { field: "commissionAmount", start: 75, end: 87, type: "decimal" },
];

export const ERP_REPORT_OPTIONS: TextReportOptions = {
  schemaName: "erp-sales-commission",
  schemaVersion: 1,
  columns: ERP_REPORT_COLUMNS,
  dataLine: /^INV-\d+/,
};
