// What: integration tests for document intake (story 1): Inbox, upload, classification, type confirmation and routing.
// Who calls it: `npm test`.
// To extend: each test builds its own temporary workspace, so tests never affect each other.
import { copyFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listEntityTimeline } from "@/services/audit";
import { loadDocument } from "@/services/documents";
import { UserError } from "@/services/errors";
import { confirmDocumentType, importAllInbox, ingestDocument, listInbox } from "@/services/intake";
import { loadPoReview } from "@/services/poReview";
import { createWorkspace, DATA_DIR, readDataFile, SAM, type TestWorkspace } from "../helpers/workspace";

let workspace: TestWorkspace;
beforeEach(() => {
  workspace = createWorkspace();
});
afterEach(async () => {
  await workspace.cleanup();
});

function upload(file: string) {
  return ingestDocument(workspace.deps, SAM, { bytes: readDataFile(`golden/files/${file}`), fileName: file, channel: "upload", sender: "Sam Tan" });
}

describe("taking in a PDF", () => {
  it("classifies and extracts at once, but routes nothing until a person confirms the type", async () => {
    const { documentId } = await upload("po-clean-a.pdf");
    const { document, fields } = await loadDocument(workspace.deps, documentId);
    expect(document.detectedType).toBe("customer_po");
    expect(document.detectedConfidence).toBeGreaterThanOrEqual(60);
    expect(document.typeStatus).toBe("detected");
    expect(document.routedKind).toBeNull();
    expect(fields.find((field) => field.key === "poNumber")?.value).toBe("LT-PO-2240");
    // Each field carries where it was found, so the page can jump to it.
    const partNo = fields.find((field) => field.key === "lines[0].partNo");
    expect(partNo?.page).toBe(1);
    expect(partNo?.bbox?.x).toBeGreaterThan(0);
    expect(await workspace.deps.db.order.count()).toBe(0);
  });

  it("creates the order only when the type is confirmed, and records who confirmed it", async () => {
    const { documentId } = await upload("po-clean-a.pdf");
    const route = await confirmDocumentType(workspace.deps, SAM, documentId, "customer_po");
    expect(route).toEqual({ kind: "order", routedId: "ORD-1001", path: "/orders/ORD-1001/review" });
    const { document } = await loadDocument(workspace.deps, documentId);
    expect(document).toMatchObject({ typeStatus: "confirmed", confirmedType: "customer_po", confirmedBy: "Sam Tan", routedId: "ORD-1001" });
    const timeline = await listEntityTimeline(workspace.deps, "document", documentId);
    expect(timeline.map((entry) => entry.action)).toEqual(["document_received", "type_confirmed"]);
  });

  it("leaves an unrecognised document for a person to decide", async () => {
    const { documentId } = await upload("doc-unknown.pdf");
    const { document, fields } = await loadDocument(workspace.deps, documentId);
    expect(document.detectedType).toBe("unknown");
    expect(document.detectedConfidence).toBe(0);
    expect(fields).toEqual([]);
  });

  it("reads the document again when a person picks a different type than detected", async () => {
    const { documentId } = await upload("doc-vendor-po.pdf");
    expect((await loadDocument(workspace.deps, documentId)).document.detectedType).toBe("vendor_po");
    // A person decides it should be handled as a customer PO after all.
    const route = await confirmDocumentType(workspace.deps, SAM, documentId, "customer_po");
    expect(route.kind).toBe("order");
    const loaded = await loadDocument(workspace.deps, documentId);
    expect(loaded.type).toBe("customer_po");
    expect(loaded.fields.some((field) => field.key === "customerName")).toBe(true);
    const timeline = await listEntityTimeline(workspace.deps, "document", documentId);
    expect(timeline.at(-1)?.action).toBe("type_changed");
  });

  it("withdraws the PO draft when the type is changed after confirmation", async () => {
    const { documentId } = await upload("po-clean-a.pdf");
    await confirmDocumentType(workspace.deps, SAM, documentId, "customer_po");
    const route = await confirmDocumentType(workspace.deps, SAM, documentId, "proforma_invoice");
    expect(route.kind).toBe("filed");
    const order = await workspace.deps.db.order.findUnique({ where: { orderNo: "ORD-1001" } });
    expect(order?.status).toBe("cancelled");
    expect((await workspace.deps.db.poVersion.findFirst({ where: { orderNo: "ORD-1001" } }))?.status).toBe("void");
  });

  it("notes when exactly the same file arrives twice", async () => {
    const first = await upload("po-clean-a.pdf");
    const second = await upload("po-clean-a.pdf");
    expect(first.sameFileAs).toBeNull();
    expect(second.sameFileAs).toBe(first.documentId);
  });

  it("confirms the type straight away when the uploader chose it", async () => {
    const { documentId } = await ingestDocument(workspace.deps, SAM, {
      bytes: readDataFile("golden/files/po-clean-b.pdf"),
      fileName: "po-clean-b.pdf",
      channel: "upload",
      sender: "Sam Tan",
      chosenType: "customer_po",
    });
    expect((await loadDocument(workspace.deps, documentId)).document.typeStatus).toBe("confirmed");
  });

  it.each([
    ["an empty file", new Uint8Array([]), /empty/],
    ["a file that is not a PDF", new TextEncoder().encode("hello world"), /Only PDF/],
  ])("refuses %s", async (_name, bytes, message) => {
    await expect(ingestDocument(workspace.deps, SAM, { bytes, fileName: "x.pdf", channel: "upload", sender: null })).rejects.toThrow(message);
    await expect(ingestDocument(workspace.deps, SAM, { bytes, fileName: "x.pdf", channel: "upload", sender: null })).rejects.toThrow(UserError);
  });
});

describe("amendments and cancellations", () => {
  it("attaches an amended PO to the earlier order as the next revision", async () => {
    // First the original PO LT-PO-2201 (the clean case has a different number, so build the earlier order from the amendment's sibling).
    const original = await ingestDocument(workspace.deps, SAM, {
      bytes: readDataFile("seed/po-ord-1032-dubai-dist.pdf"),
      fileName: "po-ord-1032-dubai-dist.pdf",
      channel: "email",
      sender: null,
    });
    await confirmDocumentType(workspace.deps, SAM, original.documentId, "customer_po");
    const amendment = await ingestDocument(workspace.deps, SAM, {
      bytes: readDataFile("inbox/po-dubai-dist-dd-7802-amendment-1.pdf"),
      fileName: "po-dubai-dist-dd-7802-amendment-1.pdf",
      channel: "email",
      sender: null,
    });
    const route = await confirmDocumentType(workspace.deps, SAM, amendment.documentId, "customer_po");
    expect(route.routedId).toBe("ORD-1001");
    const versions = await workspace.deps.db.poVersion.findMany({ where: { orderNo: "ORD-1001" }, orderBy: { revision: "asc" } });
    expect(versions.map((version) => [version.revision, version.kind, version.status])).toEqual([
      [1, "new", "superseded"],
      [2, "amendment", "draft"],
    ]);
    const review = await loadPoReview(workspace.deps, "ORD-1001");
    expect(review.flags.map((flag) => flag.code)).toContain("PO_AMENDMENT");
    expect(review.flags.map((flag) => flag.code)).not.toContain("DUPLICATE_PO");
  });

  it("flags the same PO number arriving again without an amendment marking", async () => {
    const first = await upload("po-clean-a.pdf");
    await confirmDocumentType(workspace.deps, SAM, first.documentId, "customer_po");
    // The same PO number in a different file (one byte appended, so it is not the identical file).
    const bytes = readDataFile("golden/files/po-clean-a.pdf");
    const again = await ingestDocument(workspace.deps, SAM, { bytes: new Uint8Array([...bytes, 10]), fileName: "po-again.pdf", channel: "email", sender: null });
    const route = await confirmDocumentType(workspace.deps, SAM, again.documentId, "customer_po");
    expect(route.routedId).toBe("ORD-1002");
    const review = await loadPoReview(workspace.deps, "ORD-1002");
    const duplicate = review.flags.find((flag) => flag.code === "DUPLICATE_PO");
    expect(duplicate?.reason).toContain("ORD-1001");
  });
});

describe("Inbox (simulated email and WhatsApp)", () => {
  it("lists waiting PDFs with their channel and sender, and imports each one once", async () => {
    const inboxDir = workspace.deps.config.inboxDir;
    copyFileSync(path.join(DATA_DIR, "golden/files/po-clean-a.pdf"), path.join(inboxDir, "po-clean-a.pdf"));
    copyFileSync(path.join(DATA_DIR, "golden/files/pop-exact.pdf"), path.join(inboxDir, "pop-exact.pdf"));
    writeFileSync(
      path.join(inboxDir, "manifest.json"),
      JSON.stringify({ messages: [{ file: "pop-exact.pdf", channel: "whatsapp", sender: "Lanka Tech accounts", receivedAt: "2026-11-16T00:30:00.000Z" }] }),
    );

    const waiting = await listInbox(workspace.deps);
    expect(waiting.map((entry) => [entry.fileName, entry.channel, entry.importedDocumentId])).toEqual([
      ["po-clean-a.pdf", "email", null], // not in the manifest: counts as an email from an unknown sender
      ["pop-exact.pdf", "whatsapp", null],
    ]);

    expect(await importAllInbox(workspace.deps, SAM)).toBe(2);
    expect(await importAllInbox(workspace.deps, SAM)).toBe(0);
    const documents = await workspace.deps.db.document.findMany({ orderBy: { fileName: "asc" } });
    expect(documents.map((document) => [document.fileName, document.channel, document.detectedType, document.typeStatus])).toEqual([
      ["po-clean-a.pdf", "email", "customer_po", "detected"],
      ["pop-exact.pdf", "whatsapp", "proof_of_payment", "detected"],
    ]);
    expect(documents[1].receivedAt.toISOString()).toBe("2026-11-16T00:30:00.000Z");
  });
});
