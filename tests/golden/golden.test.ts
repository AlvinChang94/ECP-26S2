// What: runs the whole golden dataset with the default extractor as part of `npm test`.
// Who calls it: `npm test`. For the readable table use `npm run test:golden`.
// To extend: add cases in scripts/sample-data/golden.ts and run `npm run generate-data`.
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DefaultExtractor } from "@/adapters/extractor/default";
import { formatGoldenReport, runGolden } from "../../scripts/golden-runner";
import { DATA_DIR } from "../helpers/workspace";

describe("golden dataset", () => {
  it("every case passes: right document type, every expected flag, no unexpected blocking flag", async () => {
    const report = await runGolden({ goldenDir: path.join(DATA_DIR, "golden"), extractor: new DefaultExtractor() });
    // On failure the full table is printed, which says exactly which case and why.
    expect(report.pass, formatGoldenReport(report)).toBe(true);
    expect(report.results.length).toBeGreaterThanOrEqual(40);
  }, 120_000);

  it("the default extractor reads every expected field of our own sample layouts", async () => {
    const report = await runGolden({ goldenDir: path.join(DATA_DIR, "golden"), extractor: new DefaultExtractor() });
    for (const result of report.results) {
      expect(result.extractionProblems, result.id).toEqual([]);
    }
  }, 120_000);
});
