// What: runs every golden case through classify, extract and validate, and compares the result with what cases.json expects.
// Who calls it: scripts/run-golden.ts (prints the table for `npm run test:golden`) and tests/golden/golden.test.ts (`npm test`).
// To extend: when a new kind of case is added to the golden dataset, add a branch to validateCase().
import { readFileSync } from "node:fs";
import path from "node:path";
import type { DocumentExtractor } from "../src/adapters/extractor/types";
import { FileNavisionGateway } from "../src/adapters/navision/fileGateway";
import { isDocumentType } from "../src/domain/documents";
import { extractedValues, type FieldValues } from "../src/domain/fields";
import type { Flag, Severity } from "../src/domain/flags";
import { matchProof, toProofData } from "../src/domain/payment/matching";
import { checkCustomerPo } from "../src/domain/po/checks";
import { aliasKey, sameCompany } from "../src/domain/po/partMatch";
import { toCustomerPo } from "../src/domain/po/types";
import { lookupPoLines } from "../src/services/poReview";
import { type ExpectedFlag, type GoldenCase, GoldenCasesFileSchema, type GoldenContext, GoldenContextSchema } from "./sample-data/goldenTypes";

export type ActualFlag = { code: string; field: string; severity: Severity };

export type GoldenCaseResult = {
  id: string;
  title: string;
  kind: GoldenCase["kind"];
  // ---- extraction (what the reader did) ----
  documents: number;
  typesCorrect: number;
  fieldsTotal: number;
  fieldsCorrect: number;
  extractionProblems: string[];
  // ---- rules (what the deterministic checks did with what was read) ----
  /** False while the rules for this kind of case are not built yet; such a case is reported but cannot fail on flags. */
  rulesChecked: boolean;
  expectedFlags: ExpectedFlag[];
  actualFlags: ActualFlag[];
  missingFlags: ExpectedFlag[];
  unexpectedBlocking: ActualFlag[];
  unexpectedOther: ActualFlag[];
  pass: boolean;
};

export type GoldenReport = {
  extractorName: string;
  results: GoldenCaseResult[];
  /** Extraction accuracy per document type. */
  byType: Record<string, { documents: number; typesCorrect: number; fields: number; fieldsCorrect: number }>;
  /** Rule correctness per flag code. */
  byFlag: Record<string, { expected: number; found: number; missing: number; unexpected: number }>;
  pass: boolean;
};

type ReadDocument = { expectedType: string; detectedType: string; values: FieldValues };

/** Runs the rules that belong to the kind of case. Returns null when those rules do not exist yet. */
async function validateCase(
  goldenCase: GoldenCase,
  documents: ReadDocument[],
  navision: FileNavisionGateway,
  context: GoldenContext,
): Promise<Flag[] | null> {
  if (goldenCase.kind === "classify_only") return [];

  if (goldenCase.kind === "customer_po") {
    const po = toCustomerPo(documents[0].values);
    const customer = po.customerName ? await navision.getCustomerByName(po.customerName) : null;
    const { lines } = await lookupPoLines(navision, po, async (partNo) => {
      return context.aliases.find((alias) => aliasKey(alias.fromPartNo) === aliasKey(partNo))?.toItemNo ?? null;
    });
    const earlier = context.existingOrders.filter(
      (order) => order.status === "open" && order.poNumber === po.poNumber && (!po.customerName || sameCompany(order.customerName, po.customerName)),
    );
    return checkCustomerPo(po, {
      customer,
      customerCardProposed: false,
      lines,
      sameNumberOrders: po.poKind === "new" ? earlier.map((order) => ({ orderNo: order.orderNo })) : [],
      previousVersion: po.poKind !== "new" && earlier[0] ? { orderNo: earlier[0].orderNo, revision: 1 } : null,
    });
  }

  if (goldenCase.kind === "proof_of_payment") {
    // The open PIs and the earlier proofs come from context.json; the rules are the ones the payments page uses.
    return matchProof(toProofData(documents[0].values), context.openInvoices, context.priorProofs).flags;
  }

  // Shipment checks arrive with story 5.
  return null;
}

function matchFlags(expected: ExpectedFlag[], actual: ActualFlag[]): { missing: ExpectedFlag[]; unexpected: ActualFlag[] } {
  const remaining = [...actual];
  const missing: ExpectedFlag[] = [];
  for (const wanted of expected) {
    const index = remaining.findIndex((flag) => flag.code === wanted.code && (wanted.field === undefined || wanted.field === flag.field));
    if (index === -1) missing.push(wanted);
    else remaining.splice(index, 1);
  }
  return { missing, unexpected: remaining };
}

export async function runGolden(options: { goldenDir: string; extractor: DocumentExtractor; only?: string }): Promise<GoldenReport> {
  const { goldenDir, extractor } = options;
  const file = GoldenCasesFileSchema.parse(JSON.parse(readFileSync(path.join(goldenDir, "cases.json"), "utf8")));
  const context = GoldenContextSchema.parse(JSON.parse(readFileSync(path.join(goldenDir, "context.json"), "utf8")));
  const navision = new FileNavisionGateway(path.join(goldenDir, "navision"));

  const results: GoldenCaseResult[] = [];
  const byType: GoldenReport["byType"] = {};
  const byFlag: GoldenReport["byFlag"] = {};
  const flagStats = (code: string) => (byFlag[code] ??= { expected: 0, found: 0, missing: 0, unexpected: 0 });

  for (const goldenCase of file.cases) {
    if (options.only && !goldenCase.id.includes(options.only)) continue;
    const read: ReadDocument[] = [];
    const extractionProblems: string[] = [];
    let typesCorrect = 0;
    let fieldsTotal = 0;
    let fieldsCorrect = 0;

    for (const document of goldenCase.documents) {
      const pdf = { bytes: new Uint8Array(readFileSync(path.join(goldenDir, document.file))), fileName: path.basename(document.file) };
      const classification = await extractor.classify(pdf);
      const stats = (byType[document.expectedType] ??= { documents: 0, typesCorrect: 0, fields: 0, fieldsCorrect: 0 });
      stats.documents++;
      if (classification.type === document.expectedType) {
        typesCorrect++;
        stats.typesCorrect++;
      } else {
        extractionProblems.push(`${document.file}: type ${classification.type}, expected ${document.expectedType}`);
      }
      // Fields are read for the detected type, exactly as the app would do before a person steps in.
      const values = isDocumentType(classification.type) ? extractedValues((await extractor.extract(pdf, classification.type)).fields) : {};
      for (const [key, expected] of Object.entries(document.expectedFields)) {
        fieldsTotal++;
        stats.fields++;
        const actual = values[key] ?? null;
        if (actual === expected) {
          fieldsCorrect++;
          stats.fieldsCorrect++;
        } else {
          extractionProblems.push(`${document.file}: ${key} read as ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
        }
      }
      read.push({ expectedType: document.expectedType, detectedType: classification.type, values });
    }

    const flags = await validateCase(goldenCase, read, navision, context);
    const actualFlags: ActualFlag[] = (flags ?? []).map((flag) => ({ code: flag.code, field: flag.field, severity: flag.severity }));
    const { missing, unexpected } = flags === null ? { missing: [], unexpected: [] } : matchFlags(goldenCase.expectedFlags, actualFlags);
    const unexpectedBlocking = unexpected.filter((flag) => flag.severity === "blocking");
    const unexpectedOther = unexpected.filter((flag) => flag.severity !== "blocking");

    if (flags !== null) {
      for (const wanted of goldenCase.expectedFlags) {
        const stats = flagStats(wanted.code);
        stats.expected++;
        if (missing.includes(wanted)) stats.missing++;
        else stats.found++;
      }
      for (const extra of unexpected) flagStats(extra.code).unexpected++;
    }

    results.push({
      id: goldenCase.id,
      title: goldenCase.title,
      kind: goldenCase.kind,
      documents: goldenCase.documents.length,
      typesCorrect,
      fieldsTotal,
      fieldsCorrect,
      extractionProblems,
      rulesChecked: flags !== null,
      expectedFlags: goldenCase.expectedFlags,
      actualFlags,
      missingFlags: missing,
      unexpectedBlocking,
      unexpectedOther,
      // A case fails when a document type is wrong, an expected flag is missing, or an unexpected blocking flag appears.
      pass: typesCorrect === goldenCase.documents.length && missing.length === 0 && unexpectedBlocking.length === 0,
    });
  }

  return { extractorName: extractor.name, results, byType, byFlag, pass: results.every((result) => result.pass) };
}

function flagText(flag: { code: string; field?: string }): string {
  return flag.field ? `${flag.code}@${flag.field}` : flag.code;
}

function percent(part: number, whole: number): string {
  return whole === 0 ? "n/a" : `${((part / whole) * 100).toFixed(1)}%`;
}

function table(rows: string[][]): string {
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)));
  return rows.map((row, index) => row.map((cell, column) => cell.padEnd(widths[column])).join("  ") + (index === 0 ? `\n${widths.map((width) => "-".repeat(width)).join("  ")}` : "")).join("\n");
}

/** The report as plain text: one row per case, then extraction accuracy and rule correctness in separate tables. */
export function formatGoldenReport(report: GoldenReport): string {
  const lines: string[] = [];
  lines.push(`Golden test. Extractor: ${report.extractorName}`, "");
  lines.push(
    table([
      ["Case", "Docs", "Type", "Fields", "Expected flags", "Flags found", "Result"],
      ...report.results.map((result) => [
        result.id,
        String(result.documents),
        `${result.typesCorrect}/${result.documents}`,
        `${result.fieldsCorrect}/${result.fieldsTotal}`,
        result.expectedFlags.map(flagText).join(", ") || "(none)",
        result.rulesChecked ? result.actualFlags.map(flagText).join(", ") || "(none)" : "(rules not built yet)",
        result.pass ? (result.rulesChecked ? "pass" : "pass (extraction only)") : "FAIL",
      ]),
    ]),
  );

  const failures = report.results.filter((result) => !result.pass || result.extractionProblems.length > 0 || result.unexpectedOther.length > 0);
  if (failures.length > 0) {
    lines.push("", "Details:");
    for (const result of failures) {
      for (const problem of result.extractionProblems) lines.push(`  ${result.id}: extraction: ${problem}`);
      for (const flag of result.missingFlags) lines.push(`  ${result.id}: rules: expected flag missing: ${flagText(flag)}`);
      for (const flag of result.unexpectedBlocking) lines.push(`  ${result.id}: rules: unexpected BLOCKING flag: ${flagText(flag)}`);
      for (const flag of result.unexpectedOther) lines.push(`  ${result.id}: rules: extra ${flag.severity} flag (does not fail the case): ${flagText(flag)}`);
    }
  }

  lines.push("", "Extraction accuracy by document type (what the reader got right):");
  lines.push(
    table([
      ["Document type", "Documents", "Type correct", "Fields correct"],
      ...Object.entries(report.byType).map(([type, stats]) => [
        type,
        String(stats.documents),
        `${stats.typesCorrect}/${stats.documents} (${percent(stats.typesCorrect, stats.documents)})`,
        `${stats.fieldsCorrect}/${stats.fields} (${percent(stats.fieldsCorrect, stats.fields)})`,
      ]),
    ]),
  );

  lines.push("", "Rule correctness by flag code (what the deterministic checks did with what was read):");
  lines.push(
    table([
      ["Flag code", "Expected", "Found", "Missing", "Unexpected"],
      ...Object.entries(report.byFlag)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([code, stats]) => [code, String(stats.expected), String(stats.found), String(stats.missing), String(stats.unexpected)]),
    ]),
  );

  const passed = report.results.filter((result) => result.pass).length;
  const pending = report.results.filter((result) => !result.rulesChecked).length;
  const documents = report.results.reduce((sum, result) => sum + result.documents, 0);
  const types = report.results.reduce((sum, result) => sum + result.typesCorrect, 0);
  const fields = report.results.reduce((sum, result) => sum + result.fieldsTotal, 0);
  const fieldsCorrect = report.results.reduce((sum, result) => sum + result.fieldsCorrect, 0);
  lines.push(
    "",
    `Cases: ${passed}/${report.results.length} passed${pending > 0 ? ` (${pending} checked for extraction only: their rules are not built yet)` : ""}.`,
    `Extraction: document type ${types}/${documents} (${percent(types, documents)}), fields ${fieldsCorrect}/${fields} (${percent(fieldsCorrect, fields)}).`,
    report.pass ? "RESULT: PASS" : "RESULT: FAIL (a document type was wrong, an expected flag was missing, or an unexpected blocking flag appeared)",
  );
  return lines.join("\n");
}
