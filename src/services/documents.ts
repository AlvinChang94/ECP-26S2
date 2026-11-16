// What: loads a stored document together with its extracted fields, the edits people made, and the resulting current values.
// Who calls it: every service and page that works with a document (PO review, payments, shipments).
// To extend: nothing type-specific lives here; typed views (a customer PO, a proof of payment) are built from `values` in src/domain.
import { z } from "zod";
import type { DocumentRow } from "@/adapters/db";
import { DOCUMENT_SPECS, type DocumentType, type DocumentTypeSpec, type ExtractedField, isDocumentType } from "@/domain/documents";
import { currentValues, type FieldEdit, type FieldValues } from "@/domain/fields";
import { listFieldEdits } from "./audit";
import type { Deps } from "./deps";
import { UserError } from "./errors";

const ExtractedFieldsSchema = z.array(
  z.object({
    key: z.string(),
    value: z.string().nullable(),
    page: z.number().nullable(),
    bbox: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).nullable(),
    confidence: z.number(),
  }),
);

/** The extracted fields exactly as they were read from the PDF. */
export function parseExtractedFields(document: Pick<DocumentRow, "fieldsJson">): ExtractedField[] {
  return ExtractedFieldsSchema.parse(JSON.parse(document.fieldsJson));
}

/** The type a person confirmed, or else the type the extractor detected. Null when neither is a known type. */
export function workingType(document: Pick<DocumentRow, "confirmedType" | "detectedType">): DocumentType | null {
  const type = document.confirmedType ?? document.detectedType;
  return isDocumentType(type) ? type : null;
}

export type LoadedDocument = {
  document: DocumentRow;
  type: DocumentType | null;
  spec: DocumentTypeSpec | null;
  /** As read from the PDF (with page and bounding box). Never changed. */
  fields: ExtractedField[];
  /** Changes made by people since the type was confirmed, oldest first. */
  edits: FieldEdit[];
  /** Extracted values with the edits applied. */
  values: FieldValues;
};

export async function getDocument(deps: Pick<Deps, "db">, documentId: string): Promise<DocumentRow> {
  const document = await deps.db.document.findUnique({ where: { id: documentId } });
  if (!document) throw new UserError("That document does not exist (it may have been removed by a reset).");
  return document;
}

export async function loadDocument(deps: Pick<Deps, "db">, documentId: string): Promise<LoadedDocument> {
  return loadDocumentRow(deps, await getDocument(deps, documentId));
}

export async function loadDocumentRow(deps: Pick<Deps, "db">, document: DocumentRow): Promise<LoadedDocument> {
  const type = workingType(document);
  const fields = parseExtractedFields(document);
  // Edits made before the type was (re)confirmed belonged to a different reading of the document.
  const edits = (await listFieldEdits(deps, document.id)).filter((edit) => edit.id > document.editsFromEventId);
  return { document, type, spec: type ? DOCUMENT_SPECS[type] : null, fields, edits, values: currentValues(fields, edits) };
}
