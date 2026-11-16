// What: unit tests for the date helpers.
// Who calls it: `npm test`.
// To extend: add a row when a real document writes a date in a format parseDateText should understand.
import { describe, expect, it } from "vitest";
import {
  addDays,
  addHours,
  businessDate,
  describeTimeUntil,
  endOfBusinessDay,
  formatDate,
  formatDateTime,
  hoursBetween,
  parseDateText,
  startOfBusinessDay,
  wholeDaysBetween,
} from "./time";

describe("parseDateText", () => {
  it.each([
    ["2026-11-10", "2026-11-10"],
    ["10 Nov 2026", "2026-11-10"],
    ["10 November 2026", "2026-11-10"],
    ["Nov 10, 2026", "2026-11-10"],
    ["10/11/2026", "2026-11-10"],
    ["2 Dec 2026", "2026-12-02"],
  ])("reads %s as %s", (text, expected) => {
    expect(parseDateText(text)).toBe(expected);
  });

  it.each([["31 Feb 2026"], ["2026-13-01"], ["soon"], [""], [null]])("returns null for %s", (text) => {
    expect(parseDateText(text)).toBeNull();
  });
});

describe("differences", () => {
  const start = new Date("2026-11-16T01:00:00.000Z");

  it("counts hours as a decimal number", () => {
    expect(hoursBetween(start, addHours(start, 24))).toBe(24);
    expect(hoursBetween(start, addHours(start, -1.5))).toBe(-1.5);
  });

  it("counts whole days, rounded down and never negative", () => {
    expect(wholeDaysBetween(start, addHours(start, 47))).toBe(1);
    expect(wholeDaysBetween(start, addDays(start, 3))).toBe(3);
    expect(wholeDaysBetween(start, addDays(start, -2))).toBe(0);
  });
});

describe("business days use Singapore time (UTC+8)", () => {
  it("starts and ends a business day at Singapore midnight", () => {
    expect(startOfBusinessDay("2026-11-18").toISOString()).toBe("2026-11-17T16:00:00.000Z");
    expect(endOfBusinessDay("2026-11-18").toISOString()).toBe("2026-11-18T16:00:00.000Z");
  });

  it("puts 23:30 UTC on the next business day", () => {
    expect(businessDate(new Date("2026-11-16T23:30:00.000Z"))).toBe("2026-11-17");
  });
});

describe("display", () => {
  it("formats dates and times the same way everywhere", () => {
    expect(formatDate("2026-11-16")).toBe("16 Nov 2026");
    expect(formatDateTime(new Date("2026-11-16T01:05:00.000Z"))).toBe("16 Nov 2026, 09:05");
    expect(formatDate(null)).toBe("");
  });

  it("describes how far away a due date is", () => {
    const now = new Date("2026-11-16T01:00:00.000Z");
    expect(describeTimeUntil(addHours(now, 7), now)).toBe("in 7 hours");
    expect(describeTimeUntil(addHours(now, 1), now)).toBe("in 1 hour");
    expect(describeTimeUntil(addDays(now, 4), now)).toBe("in 4 days");
    expect(describeTimeUntil(addHours(now, -5), now)).toBe("5 hours ago");
  });
});
