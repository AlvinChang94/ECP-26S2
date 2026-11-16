// INVARIANT: the same input gives the same output when run twice.
// What: classification, extraction and the rule checks are run twice on the same documents and must agree exactly.
// Who calls it: `npm test`. This is what makes results explainable and the golden test meaningful.
// To extend: keep randomness and the current time out of extractors and domain rules (time comes in as a parameter).
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DefaultExtractor } from "@/adapters/extractor/default";
import { runGolden } from "../../scripts/golden-runner";
import { DATA_DIR, readDataFile } from "../helpers/workspace";

describe("INVARIANT: same input, same output", () => {
  it("classifies and extracts a document identically on every run, even with a fresh extractor", async () => {
    for (const file of ["po-combined.pdf", "pop-exact-po-reference.pdf", "ship-receipt-short-invoice.pdf", "doc-unknown.pdf"]) {
      const first = new DefaultExtractor();
      const second = new DefaultExtractor();
      const pdfA = { bytes: readDataFile(`golden/files/${file}`), fileName: file };
      const pdfB = { bytes: readDataFile(`golden/files/${file}`), fileName: file };
      const classificationA = await first.classify(pdfA);
      const classificationB = await second.classify(pdfB);
      expect(classificationB, file).toEqual(classificationA);
      if (classificationA.type !== "unknown") {
        expect(await second.extract(pdfB, classificationA.type), file).toEqual(await first.extract(pdfA, classificationA.type));
      }
    }
  });

  it("produces the same golden report twice: same types, same fields, same flags in the same order", async () => {
    const goldenDir = path.join(DATA_DIR, "golden");
    const first = await runGolden({ goldenDir, extractor: new DefaultExtractor() });
    const second = await runGolden({ goldenDir, extractor: new DefaultExtractor() });
    expect(second).toEqual(first);
  }, 120_000);
});
