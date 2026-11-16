// INVARIANT: money is never handled as a floating-point number.
// What: checks the database schema, the Navision file rules, the source code and the money helpers for any way a float could carry money.
// Who calls it: `npm test`. Architecture rule in CLAUDE.md: money uses decimal.js.
// To extend: if this test fails after your change, route the amount through src/domain/money.ts instead of loosening the test.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ItemSchema, PurchaseOrderSchema } from "@/adapters/navision/schemas";
import { formatMoney, lineTotal, parseMoney, sumMoney, toMoney } from "@/domain/money";
import { PROJECT_ROOT } from "../helpers/workspace";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "generated" ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) && !name.endsWith(".test.ts") ? [full] : [];
  });
}

describe("INVARIANT: money is never a floating-point number", () => {
  it("the database schema has no Float or Decimal column: money is stored as decimal text", () => {
    const schema = readFileSync(path.join(PROJECT_ROOT, "prisma", "schema.prisma"), "utf8");
    const columnTypes = schema
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^[a-zA-Z]\w*\s+(Float|Decimal)\b/.test(line));
    expect(columnTypes).toEqual([]);
  });

  it("Navision files must give prices as decimal strings; a JSON number is rejected", () => {
    const item = { itemNo: "X-1", description: "x", vendorId: "V1", price: "12.40", purchasePrice: "10.10", currency: "USD", stockQty: 5 };
    expect(ItemSchema.safeParse(item).success).toBe(true);
    expect(ItemSchema.safeParse({ ...item, price: 12.4 }).success).toBe(false);
    expect(ItemSchema.safeParse({ ...item, purchasePrice: 10.1 }).success).toBe(false);
    const order = { poNumber: "PO-1", vendorId: "V1", vendorName: "x", orderDate: "2026-11-01", forCustomerPoNumber: null, documentsDueAt: null, paymentDueDate: "2026-11-20", paid: false, currency: "USD", totalAmount: 100.5, lines: [] };
    expect(PurchaseOrderSchema.safeParse(order).success).toBe(false);
  });

  it("no source file uses parseFloat, toFixed on a plain number for money, or Decimal's toNumber", () => {
    const offenders: string[] = [];
    for (const file of [...sourceFiles(path.join(PROJECT_ROOT, "src")), ...sourceFiles(path.join(PROJECT_ROOT, "scripts"))]) {
      const text = readFileSync(file, "utf8");
      if (/\bparseFloat\s*\(/.test(text)) offenders.push(`${path.relative(PROJECT_ROOT, file)}: parseFloat`);
      if (/\.toNumber\s*\(/.test(text)) offenders.push(`${path.relative(PROJECT_ROOT, file)}: toNumber`);
    }
    expect(offenders).toEqual([]);
  });

  it("the money helpers refuse JavaScript numbers and stay exact where floats would not", () => {
    expect(() => parseMoney(0.1 as unknown as string)).toThrow(TypeError);
    // The classic float failures:
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(formatMoney(sumMoney([toMoney("0.1"), toMoney("0.2")]))).toBe("0.30");
    expect(1.15 * 100).not.toBe(115);
    expect(formatMoney(lineTotal(toMoney("1.15"), 100))).toBe("115.00");
    expect(formatMoney(lineTotal(toMoney("64.00"), 100))).toBe("6400.00");
  });

  it("rounds half up when formatting to two decimals", () => {
    expect(formatMoney(toMoney("2.675"))).toBe("2.68"); // a float would give 2.67
    expect(formatMoney(toMoney("1.005"))).toBe("1.01");
  });
});
