import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { loadPaymentMatchingGolden } from "@/server/modules/payment-matching/golden";
import { paymentConsolidationSheets } from "@/server/modules/payment-matching/consolidation";
import { buildWorkbook } from "./excel";

describe("buildWorkbook", () => {
  it("writes the payment consolidation with typed, formatted cells", async () => {
    const { input } = loadPaymentMatchingGolden();
    const bytes = await buildWorkbook(paymentConsolidationSheets(input));

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes as unknown as ExcelJS.Buffer);
    const ws = wb.getWorksheet("Payments")!;
    expect(ws.rowCount).toBe(1 + input.payments.length);
    expect(ws.getRow(1).getCell(1).value).toBe("Payment");

    const p02 = ws.getRow(3); // rows are in value-date order: P-01, P-02, ...
    expect(p02.getCell(1).value).toBe("P-02");
    expect(p02.getCell(5).value).toBe(2828.4);
    expect(p02.getCell(5).numFmt).toBe("#,##0.00");
    expect(p02.getCell(9).value).toBe("MATCHED");
    expect(p02.getCell(11).value).toBe("INV-2002 (830.40), INV-2003 (2000.00)");
  });
});
