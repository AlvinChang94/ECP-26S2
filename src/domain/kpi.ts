// What: the arithmetic behind the four KPI measures of the replay: averages, shares and the change against a baseline.
// Who calls it: scripts/replay-runner.ts (and its test). Durations are plain numbers of hours; money is never handled here.
// To extend: add a measure as a small pure function with a test; keep reading files and running services out of this file.
import { hoursBetween } from "./time";

export type DurationSummary = {
  count: number;
  /** Mean, median and maximum in hours, rounded to one decimal place. Null when there is nothing to measure. */
  mean: number | null;
  median: number | null;
  max: number | null;
};

export function roundTo1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function summarizeHours(hours: number[]): DurationSummary {
  if (hours.length === 0) return { count: 0, mean: null, median: null, max: null };
  const sorted = [...hours].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  return { count: sorted.length, mean: roundTo1(mean), median: roundTo1(median), max: roundTo1(sorted[sorted.length - 1]) };
}

/** Hours between pairs of timestamps, skipping pairs where either side is missing. */
export function durationsInHours(pairs: { from: Date | null; to: Date | null }[]): number[] {
  return pairs.filter((pair): pair is { from: Date; to: Date } => pair.from !== null && pair.to !== null).map((pair) => hoursBetween(pair.from, pair.to));
}

/** part / whole as a percentage with one decimal place. Null when the whole is zero. */
export function share(part: number, whole: number): number | null {
  return whole === 0 ? null : roundTo1((part / whole) * 100);
}

/** The change from baseline to solution in percent (negative means lower). Null when it cannot be worked out. */
export function changePercent(baseline: number | null, solution: number | null): number | null {
  if (baseline === null || solution === null || baseline === 0) return null;
  return roundTo1(((solution - baseline) / baseline) * 100);
}

export function formatHours(value: number | null): string {
  return value === null ? "n/a" : `${value.toFixed(1)} h`;
}

export function formatShare(value: number | null): string {
  return value === null ? "n/a" : `${value.toFixed(1)}%`;
}

/** "-93.2%" or "+4.0%": how the solution compares with the baseline. */
export function formatChange(value: number | null): string {
  if (value === null) return "n/a";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}
