// INVARIANT: extraction and validation never change a field value (no auto-correct).
// What: takes in every golden customer PO, runs all checks, and proves that what is stored is still exactly what was read.
// Who calls it: `npm test`. Design principle 2 in CLAUDE.md.
// To extend: if you add a step between reading a document and a person's first edit, it must keep these tests green.
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractedValues } from "@/domain/fields";
import { loadDocument } from "@/services/documents";
import { confirmDocumentType, ingestDocument } from "@/services/intake";
import { loadPoReview } from "@/services/poReview";
import { GoldenCasesFileSchema } from "../../scripts/sample-data/goldenTypes";
import { createWorkspace, DATA_DIR, readDataFile, SAM, type TestWorkspace } from "../helpers/workspace";

let workspace: TestWorkspace;
beforeEach(() => {
  workspace = createWorkspace();
});
afterEach(async () => {
  await workspace.cleanup();
});

const golden = GoldenCasesFileSchema.parse(JSON.parse(readFileSync(path.join(DATA_DIR, "golden", "cases.json"), "utf8")));
const poCases = golden.cases.filter((goldenCase) => goldenCase.kind === "customer_po");

describe("INVARIANT: no auto-correct", () => {
  it("keeps every value exactly as read, even when a check has a suggestion ready", async () => {
    // AB-1234X is not in Navision and AB1234X is suggested. The stored value must stay AB-1234X.
    const { documentId } = await ingestDocument(workspace.deps, SAM, {
      bytes: readDataFile("golden/files/po-alias-hyphen.pdf"),
      fileName: "po-alias-hyphen.pdf",
      channel: "email",
      sender: null,
    });
    const route = await confirmDocumentType(workspace.deps, SAM, documentId, "customer_po");
    const review = await loadPoReview(workspace.deps, route.routedId as string);

    const flag = review.flags.find((candidate) => candidate.code === "PART_ALIAS_SUGGESTED");
    expect(flag?.suggestion?.value).toBe("AB1234X");
    expect(review.values["lines[0].partNo"]).toBe("AB-1234X");
    expect(review.edits).toEqual([]);
  });

  it("stores for every golden PO exactly the values the golden file says are on the page", async () => {
    expect(poCases.length).toBeGreaterThan(15);
    for (const goldenCase of poCases) {
      const [document] = goldenCase.documents;
      const { documentId } = await ingestDocument(workspace.deps, SAM, {
        bytes: readDataFile(`golden/${document.file}`),
        fileName: path.basename(document.file),
        channel: "upload",
        sender: null,
      });
      const before = (await loadDocument(workspace.deps, documentId)).document.fieldsJson;

      // Confirming the type and running every check must not touch the stored fields.
      const route = await confirmDocumentType(workspace.deps, SAM, documentId, "customer_po");
      await loadPoReview(workspace.deps, route.routedId as string);
      await loadPoReview(workspace.deps, route.routedId as string);

      const after = await loadDocument(workspace.deps, documentId);
      expect(after.document.fieldsJson, goldenCase.id).toBe(before);
      expect(after.values, goldenCase.id).toEqual(extractedValues(after.fields));
      for (const [key, expected] of Object.entries(document.expectedFields)) {
        expect(after.values[key] ?? null, `${goldenCase.id} ${key}`).toBe(expected);
      }
    }
    // The only way a value changes is an audit event of type field_edit or field_undo, made by a named person.
    const edits = await workspace.deps.db.auditEvent.count({ where: { action: { in: ["field_edit", "field_undo"] } } });
    expect(edits).toBe(0);
  }, 120_000);
});
