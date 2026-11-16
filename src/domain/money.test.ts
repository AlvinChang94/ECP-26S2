// What: unit tests for the money helpers.
// Who calls it: `npm test`.
// To extend: add a row to a table when you find an amount format the helpers should (or should not) accept.
import { describe, expect, it } from "vitest";
import {
  displayMoney,
  formatMoney,
  lineTotal,
  marginPercent,
  moneyEquals,
  parseMoney,
  parseQuantity,
  percentDifference,
  sumMoney,
  toMoney,
} from "./money";

describe("parseMoney", () => {
  it.each([
    ["12.40", "12.4"],
    ["2,480.00", "2480"],
    ["USD 12.40", "12.4"],
    ["$1,000", "1000"],
    ["  33.50 ", "33.5"],
    ["0", "0"],
  ])("reads %s", (text, expected) => {
    expect(parseMoney(text)?.toString()).toBe(expected);
  });

  it.each([[""], ["abc"], ["12.4.0"], ["twelve"], ["1 2"], [null], [undefined]])("returns null for %s", (text) => {
    expect(parseMoney(text)).toBeNull();
  });

  it("refuses a JavaScript number, so a float can never sneak in", () => {
    expect(() => parseMoney(12.4 as unknown as string)).toThrow(TypeError);
  });
});

describe("money arithmetic is exact", () => {
  it("adds 0.10 and 0.20 to exactly 0.30 (floats would give 0.30000000000000004)", () => {
    expect(formatMoney(sumMoney([toMoney("0.10"), toMoney("0.20")]))).toBe("0.30");
  });

  it("multiplies a unit price by a quantity without rounding errors", () => {
    expect(formatMoney(lineTotal(toMoney("12.40"), 200))).toBe("2480.00");
    expect(formatMoney(lineTotal(toMoney("0.07"), 3))).toBe("0.21");
  });

  it("rejects a quantity that is not a whole number", () => {
    expect(() => lineTotal(toMoney("1.00"), 1.5)).toThrow();
  });
});

describe("moneyEquals", () => {
  it.each([
    ["12.40", "12.4", true],
    ["2,480.00", "2480", true],
    ["12.40", "12.41", false],
    ["12.40", null, false],
    ["abc", "abc", false],
  ])("%s equals %s -> %s", (a, b, expected) => {
    expect(moneyEquals(a, b)).toBe(expected);
  });
});

describe("display and percentages", () => {
  it("adds thousands separators for display", () => {
    expect(displayMoney("2480")).toBe("2,480.00");
    expect(displayMoney("1234567.5")).toBe("1,234,567.50");
    expect(displayMoney("-1500")).toBe("-1,500.00");
    expect(displayMoney("not money")).toBe("not money");
  });

  it("gives the difference from the expected price in percent", () => {
    expect(percentDifference("11.90", "12.40")).toBe("-4.0");
    expect(percentDifference("13.14", "12.40")).toBe("6.0");
    expect(percentDifference("x", "12.40")).toBeNull();
    expect(percentDifference("1", "0")).toBeNull();
  });

  it("computes margin as a share of the sell price (the deck's example: cost 10.10, sell 12.40, margin 18.5%)", () => {
    expect(marginPercent("12.40", "10.10")).toBe("18.5");
    expect(marginPercent(null, "10.10")).toBeNull();
  });
});

describe("parseQuantity", () => {
  it.each([
    ["200", 200],
    ["1,000", 1000],
    [" 5 ", 5],
  ])("reads %s", (text, expected) => {
    expect(parseQuantity(text)).toBe(expected);
  });

  it.each([["2.5"], ["-3"], ["ten"], [""], [null]])("returns null for %s", (text) => {
    expect(parseQuantity(text)).toBeNull();
  });
});
