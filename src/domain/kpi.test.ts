// What: unit tests for the KPI arithmetic used by the replay report.
// Who calls it: `npm test`.
// To extend: one table row per edge case (empty input, a single value, an even number of values).
import { describe, expect, it } from "vitest";
import { changePercent, durationsInHours, formatChange, formatHours, formatShare, share, summarizeHours } from "./kpi";

describe("summarizeHours", () => {
  it.each([
    ["nothing to measure", [], { count: 0, mean: null, median: null, max: null }],
    ["one value", [4], { count: 1, mean: 4, median: 4, max: 4 }],
    ["an odd number of values", [10, 2, 6], { count: 3, mean: 6, median: 6, max: 10 }],
    ["an even number of values: the median is the middle of the two", [1, 2, 3, 10], { count: 4, mean: 4, median: 2.5, max: 10 }],
    ["rounds to one decimal place", [1, 1, 2], { count: 3, mean: 1.3, median: 1, max: 2 }],
  ])("%s", (_name, hours, expected) => {
    expect(summarizeHours(hours)).toEqual(expected);
  });

  it("does not reorder the list it was given", () => {
    const hours = [3, 1, 2];
    summarizeHours(hours);
    expect(hours).toEqual([3, 1, 2]);
  });
});

describe("durationsInHours", () => {
  it("measures each pair and skips pairs with a missing side", () => {
    const from = new Date("2026-06-01T01:00:00.000Z");
    expect(
      durationsInHours([
        { from, to: new Date("2026-06-01T13:00:00.000Z") },
        { from, to: null },
        { from: null, to: from },
        { from, to: new Date("2026-06-02T01:30:00.000Z") },
      ]),
    ).toEqual([12, 24.5]);
  });
});

describe("share and changePercent", () => {
  it.each([
    [28, 128, 21.9],
    [8, 8, 100],
    [0, 20, 0],
    [3, 0, null],
  ])("share(%s, %s) = %s", (part, whole, expected) => {
    expect(share(part, whole)).toBe(expected);
  });

  it.each([
    [24.9, 1.5, -94],
    [10, 10, 0],
    [10, 12.5, 25],
    [0, 5, null],
    [null, 5, null],
    [5, null, null],
  ])("changePercent(%s, %s) = %s", (baseline, solution, expected) => {
    expect(changePercent(baseline, solution)).toBe(expected);
  });
});

describe("formatting", () => {
  it("prints hours, shares and changes, and n/a when there is no value", () => {
    expect(formatHours(1.5)).toBe("1.5 h");
    expect(formatHours(null)).toBe("n/a");
    expect(formatShare(21.9)).toBe("21.9%");
    expect(formatShare(null)).toBe("n/a");
    expect(formatChange(-94)).toBe("-94.0%");
    expect(formatChange(25)).toBe("+25.0%");
    expect(formatChange(0)).toBe("0.0%");
    expect(formatChange(null)).toBe("n/a");
  });
});
