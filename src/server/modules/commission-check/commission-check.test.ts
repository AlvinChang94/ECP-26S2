import { describe, expect, it } from "vitest";
import { runRules } from "@/server/engine";
import { readGoldenBytes } from "@/server/golden";
import { textReportIngestor } from "@/server/ingest/text-report";
import { labelZeroCommission, recalculateCommission } from "./commission";
import { loadCommissionGolden } from "./golden";
import { ERP_REPORT_OPTIONS } from "./report-format";
import { creditNoteRecalcRule, zeroCommissionRule } from "./rules";

const golden = loadCommissionGolden();

describe("zero-commission labels against data/golden/commission-check", () => {
  const findings = runRules([zeroCommissionRule], { lines: golden.lines }).findings;

  it("has an expectation for every sales line", () => {
    const key = (x: { invoiceNo: string; lineNo: number }) => `${x.invoiceNo}#${x.lineNo}`;
    expect(golden.labelExpectations.map(key).sort()).toEqual(golden.lines.map(key).sort());
  });

  it.each(golden.labelExpectations)("$invoiceNo line $lineNo: $note", (exp) => {
    const line = golden.lines.find(
      (l) => l.invoiceNo === exp.invoiceNo && l.lineNo === exp.lineNo,
    )!;
    const result = labelZeroCommission(line);
    expect({ label: result.label, gpPct: result.gpPct }).toEqual({
      label: exp.label,
      gpPct: exp.gpPct,
    });
    const codes = findings
      .filter((f) => f.subject.id === `${exp.invoiceNo}#${exp.lineNo}`)
      .map((f) => f.reasonCode);
    expect(codes.sort()).toEqual([...exp.reasonCodes].sort());
  });
});

describe("credit-note recalculation against data/golden/commission-check", () => {
  const findings = runRules([creditNoteRecalcRule], { invoices: golden.invoices }).findings;

  it.each(golden.recalcExpectations)("$invoiceNo: $note", (exp) => {
    const { reasonCodes, ...expected } = exp;
    delete (expected as Partial<typeof exp>).note;
    const inv = golden.invoices.find((i) => i.invoiceNo === exp.invoiceNo)!;
    expect(recalculateCommission(inv)).toMatchObject(expected);
    const codes = findings.filter((f) => f.subject.id === exp.invoiceNo).map((f) => f.reasonCode);
    expect(codes.sort()).toEqual([...reasonCodes].sort());
  });

  it("can apply the rate to revenue instead of gross profit", () => {
    const inv = golden.invoices.find((i) => i.invoiceNo === "INV-9104")!;
    expect(recalculateCommission(inv, { minGpPct: "0.06", basis: "REVENUE" }).fullCommission).toBe(
      "50.00",
    );
  });

  it("caps the paid ratio at 1 when the customer overpays", () => {
    const inv = { ...golden.invoices[0], customerPaid: "5000.00" };
    expect(recalculateCommission(inv).paidRatio).toBe("1.0000");
  });
});

describe("ERP text report", () => {
  it("parses erp_sales_report.txt into the same lines as sales_lines.json", async () => {
    const result = await textReportIngestor.ingest(
      {
        fileName: "erp_sales_report.txt",
        bytes: readGoldenBytes("commission-check", "erp_sales_report.txt"),
      },
      ERP_REPORT_OPTIONS,
    );
    expect(result.records.map((r) => r.fields)).toEqual(golden.lines);
    expect(result.records[0].sources.revenue).toEqual({
      kind: "line",
      line: 6,
      start: 44,
      end: 56,
    });
  });
});
