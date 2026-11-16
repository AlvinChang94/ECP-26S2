// What: unit tests for part-number suggestions and company-name matching.
// Who calls it: `npm test`.
// To extend: add a row when a real mismatch should (or should not) produce a suggestion.
import { describe, expect, it } from "vitest";
import { normalizeCompanyName, normalizePartNo, rankSimilarItems, sameCompany } from "./partMatch";

const catalogue = ["AB1234X", "CD-77", "EF-9", "GH-310", "PC-4402", "KM-2210", "WC-1080", "RT-AX55", "SW-1608", "HS-700", "UPS-650", "NAS-2B"].map(
  (itemNo) => ({ itemNo }),
);

describe("rankSimilarItems", () => {
  it.each([
    ["AB-1234X", "AB1234X"], // the deck's example: hyphen on the PO, none in Navision
    ["ab1234x", "AB1234X"], // different case
    ["CD77", "CD-77"], // hyphen missing
    ["GH 310", "GH-310"], // space instead of hyphen
    ["EF9", "EF-9"], // very short part numbers still match when only punctuation differs
    ["KM-2211", "KM-2210"], // one wrong character
    ["PC-4402A", "PC-4402"], // extra character
  ])("suggests for %s -> %s", (written, expected) => {
    expect(rankSimilarItems(written, catalogue)[0]?.itemNo).toBe(expected);
  });

  it.each([["ZX-9907"], ["QQ-00417"], ["LT-DOCK-01"], ["X"], [""]])("suggests nothing for %s", (written) => {
    expect(rankSimilarItems(written, catalogue)).toEqual([]);
  });

  it("does not suggest the part itself when it is an exact match", () => {
    expect(rankSimilarItems("CD-77", catalogue).map((item) => item.itemNo)).not.toContain("CD-77");
  });

  it("gives the same order on every run", () => {
    const first = rankSimilarItems("KM-221", catalogue).map((item) => item.itemNo);
    const second = rankSimilarItems("KM-221", catalogue).map((item) => item.itemNo);
    expect(second).toEqual(first);
  });

  it("respects the limit", () => {
    expect(rankSimilarItems("AB-1234X", catalogue, 1)).toHaveLength(1);
  });
});

describe("normalizePartNo", () => {
  it("keeps only letters and digits, in upper case", () => {
    expect(normalizePartNo(" ab-1234 x ")).toBe("AB1234X");
  });
});

describe("company names", () => {
  it.each([
    ["Lanka Tech Pte Ltd", "Lanka Tech Pte. Ltd.", true],
    ["Lanka Tech Pte Ltd", "LANKA TECH", true],
    ["Dubai Dist LLC", "Dubai Dist", true],
    ["Smith & Sons Co", "Smith and Sons", true],
    ["Lanka Tech Pte Ltd", "Lanka Technologies", false],
    ["Kathmandu Digital Hub", "Colombo PC House", false],
    ["", "", false],
  ])("%s vs %s -> %s", (a, b, expected) => {
    expect(sameCompany(a, b)).toBe(expected);
  });

  it("never reduces a name to nothing", () => {
    expect(normalizeCompanyName("Ltd")).toBe("ltd");
  });
});
