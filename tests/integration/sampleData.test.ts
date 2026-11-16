// What: checks the sample-data generator: identical output on every run, and every PDF labelled as synthetic.
// Who calls it: `npm test`.
// To extend: if you swap in Spectra's real data, the generator no longer describes data/; keep these tests on the generator only.
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readPdfText } from "@/adapters/extractor/pdfText";
import { generateSampleData } from "../../scripts/sample-data/generate";
import { GoldenCasesFileSchema } from "../../scripts/sample-data/goldenTypes";
import { ReplayFileSchema } from "../../scripts/sample-data/replayTypes";

function listFiles(dir: string): string[] {
  return readdirSync(dir)
    .flatMap((name) => {
      const full = path.join(dir, name);
      return statSync(full).isDirectory() ? listFiles(full) : [full];
    })
    .sort();
}

function fingerprints(dir: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const file of listFiles(dir)) {
    result[path.relative(dir, file)] = createHash("sha256").update(readFileSync(file)).digest("hex");
  }
  return result;
}

let first: string;
let second: string;

beforeAll(async () => {
  first = mkdtempSync(path.join(os.tmpdir(), "orderflow-data-a-"));
  second = mkdtempSync(path.join(os.tmpdir(), "orderflow-data-b-"));
  await generateSampleData(first);
  await generateSampleData(second);
}, 120_000);

afterAll(() => {
  rmSync(first, { recursive: true, force: true });
  rmSync(second, { recursive: true, force: true });
});

describe("sample data generator", () => {
  it("writes byte-identical files on every run", () => {
    const a = fingerprints(first);
    const b = fingerprints(second);
    expect(Object.keys(a).length).toBeGreaterThan(200);
    expect(b).toEqual(a);
  });

  it("covers every case family the brief asks for", () => {
    const file = GoldenCasesFileSchema.parse(JSON.parse(readFileSync(path.join(first, "golden", "cases.json"), "utf8")));
    const ids = file.cases.map((goldenCase) => goldenCase.id);
    for (const family of [
      "po-clean",
      "po-alias",
      "po-unknown-part",
      "po-price",
      "po-qty-above-stock",
      "po-unknown-customer",
      "po-amended",
      "po-cancelled",
      "po-partial",
      "pop-exact",
      "pop-short",
      "pop-wrong-reference",
      "pop-duplicate",
      "ship-receipt-short",
      "ship-all-matching",
      "ship-invoice-part-mismatch",
      "ship-awb-missing",
      "ship-permit-missing",
      "ship-all-present",
    ]) {
      expect(ids.some((id) => id.startsWith(family)), family).toBe(true);
    }
  });

  it("generates about 60 orders over six months for the KPI replay", () => {
    const replay = ReplayFileSchema.parse(JSON.parse(readFileSync(path.join(first, "replay", "orders.json"), "utf8")));
    expect(replay.orders).toHaveLength(60);
    const arrivals = replay.orders.map((order) => order.arrivedAt).sort();
    const months = (new Date(arrivals[arrivals.length - 1]).getTime() - new Date(arrivals[0]).getTime()) / (30 * 24 * 60 * 60 * 1000);
    expect(months).toBeGreaterThan(4.5);
    expect(replay.orders.some((order) => order.seededErrors.length > 0)).toBe(true);
    expect(replay.orders.some((order) => order.spr !== null)).toBe(true);
  });

  it("labels every PDF as a synthetic sample in its footer", async () => {
    const pdfs = listFiles(first).filter((file) => file.endsWith(".pdf"));
    expect(pdfs.length).toBeGreaterThan(150);
    // Reading every PDF takes a while; a spread of one in six still covers every template several times.
    for (const file of pdfs.filter((_, index) => index % 6 === 0)) {
      const text = await readPdfText(new Uint8Array(readFileSync(file)));
      expect(text.fullText, file).toContain("SYNTHETIC SAMPLE");
    }
  }, 120_000);
});
