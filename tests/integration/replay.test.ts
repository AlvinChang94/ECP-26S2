// What: tests for the KPI replay: the simulated-staff rules, and a short replay (the first orders and receipts) through the real services.
// Who calls it: `npm test`. The full six months run with `npm run replay`.
// To extend: keep the short replay small so the test stays fast; check the report's structure here, not exact KPI figures.
import path from "node:path";
import { describe, expect, it } from "vitest";
import { approverDecisionHours, DEFAULT_REPLAY_SETTINGS, formatReplayReport, REPLAY_SETTING_NOTES, runReplay, workingTime } from "../../scripts/replay-runner";
import { DATA_DIR } from "../helpers/workspace";

const REPLAY_DIR = path.join(DATA_DIR, "replay");

describe("simulated staff rules", () => {
  it.each([
    // name, UTC time in, UTC time out (Singapore is UTC+8)
    ["inside working hours: unchanged", "2026-06-01T03:00:00.000Z", "2026-06-01T03:00:00.000Z"], // Monday 11:00
    ["exactly 18:00: unchanged", "2026-06-01T10:00:00.000Z", "2026-06-01T10:00:00.000Z"],
    ["Monday evening: Tuesday 09:30", "2026-06-01T10:01:00.000Z", "2026-06-02T01:30:00.000Z"],
    ["before 09:00: the same day 09:30", "2026-06-02T00:10:00.000Z", "2026-06-02T01:30:00.000Z"],
    ["Friday evening: Monday 09:30", "2026-06-05T11:00:00.000Z", "2026-06-08T01:30:00.000Z"],
    ["Saturday: Monday 09:30", "2026-06-06T04:00:00.000Z", "2026-06-08T01:30:00.000Z"],
    ["Sunday: Monday 09:30", "2026-06-07T04:00:00.000Z", "2026-06-08T01:30:00.000Z"],
  ])("workingTime: %s", (_name, input, expected) => {
    expect(workingTime(new Date(input)).toISOString()).toBe(expected);
  });

  it.each([
    // name, hours in the sample, random numbers for the two reminders, expected hours
    ["decided before any reminder: as in the sample", 12, [0.1, 0.1], 12],
    ["decided just after the first reminder anyway: as in the sample", 27, [0.9, 0.9], 27],
    ["responds to the first reminder", 90, [0.1, 0.9], 28],
    ["ignores the first, decides before the second reminder would act", 50, [0.9, 0.1], 50],
    ["ignores the first, responds to the second", 90, [0.9, 0.1], 52],
    ["ignores both: the stand-in decides after the hand-over", 110, [0.9, 0.9], 76],
    ["ignores both but decided at 74 hours in the sample", 74, [0.9, 0.9], 74],
  ] as const)("approverDecisionHours: %s", (_name, baseline, rolls, expected) => {
    expect(approverDecisionHours(baseline, [...rolls], DEFAULT_REPLAY_SETTINGS)).toBe(expected);
  });

  it("never makes the approver slower than she was in the sample", () => {
    for (const baseline of [5, 24, 28, 29, 47, 52, 53, 71, 76, 77, 130]) {
      for (const rolls of [[0, 0], [0.99, 0], [0, 0.99], [0.99, 0.99]]) {
        expect(approverDecisionHours(baseline, rolls, DEFAULT_REPLAY_SETTINGS)).toBeLessThanOrEqual(baseline);
      }
    }
  });

  it("explains every setting in the report", () => {
    expect(Object.keys(REPLAY_SETTING_NOTES).sort()).toEqual(Object.keys(DEFAULT_REPLAY_SETTINGS).sort());
  });
});

describe("a short replay through the real services", () => {
  it("exports every order after approval, flags every seeded error, and says plainly what is simulated", async () => {
    const options = { replayDir: REPLAY_DIR, limitOrders: 12, limitReceipts: 5 };
    const report = await runReplay(options);

    expect(report.ordersTotal).toBe(12);
    expect(report.processing.exported).toBe(12);
    expect(report.processing.notExported).toEqual([]);
    expect(report.processing.baseline.count).toBe(12);
    expect(report.processing.solution.count).toBe(12);
    // Every seeded error was flagged, and nothing blocking was raised that the sample did not contain.
    expect(report.errors.po.seeded).toBeGreaterThan(0);
    expect(report.errors.po.flagged).toBe(report.errors.po.seeded);
    expect(report.errors.receipts.flagged).toBe(report.errors.receipts.seeded);
    expect(report.errors.unexpected).toEqual([]);
    expect(report.errors.typesDetected).toBe(report.errors.documentsTotal);
    // Shipping follows the sample, so the solution has exactly as many overdue orders as the baseline.
    expect(report.overdue.solutionLate).toBe(report.overdue.baselineLate);
    expect(report.overdue.alertedBefore).toBeLessThanOrEqual(report.overdue.solutionLate);
    expect(report.approval.solution.count).toBe(report.approval.baseline.count);

    const text = formatReplayReport(report);
    for (const phrase of ["SYNTHETIC", "SIMULATED", "ORDER-PROCESSING TIME", "ERROR RATE", "APPROVAL TURNAROUND", "OVERDUE ORDERS", "not a prevention", "does not claim faster shipping"]) {
      expect(text, phrase).toContain(phrase);
    }

    // The same sample and settings always give the same report.
    expect(await runReplay(options)).toEqual(report);
  }, 180_000);
});
