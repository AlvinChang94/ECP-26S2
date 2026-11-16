// What: document intake. Stores a PDF, lets the extractor classify and read it, and routes it once a person confirms the type.
// Who calls it: the Inbox page actions, the upload route handler, the seed script and the KPI replay.
// To extend: to route a new document type, set its `routesTo` in src/domain/documents.ts and add a router to ROUTERS below.
import type { DocumentRow } from "@/adapters/db";
import type { InboxMessage } from "@/adapters/inbox";
import type { Actor } from "@/domain/audit";
import { DOCUMENT_SPECS, type DocumentType, documentTypeLabel, type ExtractedField, type RouteKind } from "@/domain/documents";
import { sha256OfBytes } from "@/domain/hash";
import { recordAudit } from "./audit";
import type { Deps } from "./deps";
import { getDocument, workingType } from "./documents";
import { requireThat, UserError } from "./errors";
import { attachPoDocument, detachPoDocument } from "./orders";
import { detachProof, registerProof } from "./payments";

const MAX_PDF_BYTES = 15 * 1024 * 1024;

export type IntakeInput = {
  bytes: Uint8Array;
  fileName: string;
  channel: "upload" | "email" | "whatsapp";
  sender: string | null;
  /** When the document arrived. Defaults to now (from the Clock). */
  receivedAt?: Date;
  /** Set when the person uploading already chose the type. That is a human decision, so the type counts as confirmed. */
  chosenType?: DocumentType | null;
};

export type IntakeResult = {
  documentId: string;
  /** Id of an earlier document with exactly the same bytes, if there is one. */
  sameFileAs: string | null;
  /** Where the document went, when its type was confirmed during intake (the uploader chose the type). */
  route: RouteResult | null;
};

function referenceOf(type: DocumentType | null, fields: ExtractedField[]): string | null {
  const key = type ? DOCUMENT_SPECS[type].referenceField : null;
  return key ? (fields.find((field) => field.key === key)?.value ?? null) : null;
}

/**
 * Takes in one PDF: store the bytes, classify, extract. The result is only a proposal:
 * nothing else in the system changes until a person confirms the type (confirmDocumentType).
 */
export async function ingestDocument(deps: Deps, actor: Actor, input: IntakeInput): Promise<IntakeResult> {
  requireThat(input.bytes.length > 0, "The file is empty.");
  requireThat(input.bytes.length <= MAX_PDF_BYTES, "The file is larger than 15 MB.");
  const header = Buffer.from(input.bytes.slice(0, 5)).toString("latin1");
  requireThat(header === "%PDF-", "Only PDF files can be taken in.");

  const sha256 = sha256OfBytes(input.bytes);
  const earlier = await deps.db.document.findFirst({ where: { sha256 }, orderBy: { createdAt: "asc" } });
  const fileKey = `documents/${sha256}.pdf`;
  await deps.files.put(fileKey, input.bytes);

  const pdf = { bytes: input.bytes, fileName: input.fileName };
  const classification = await deps.extractor.classify(pdf);
  const readAs = input.chosenType ?? (classification.type === "unknown" ? null : classification.type);
  const fields = readAs ? (await deps.extractor.extract(pdf, readAs)).fields : [];
  const now = deps.clock.now();

  const document = await deps.db.document.create({
    data: {
      fileKey,
      fileName: input.fileName,
      sha256,
      channel: input.channel,
      sender: input.sender,
      receivedAt: input.receivedAt ?? now,
      receivedBy: actor.name,
      detectedType: classification.type,
      detectedConfidence: Math.round(classification.confidence * 100),
      detectedReasons: classification.reasons.join("\n"),
      typeStatus: "detected",
      extractorName: deps.extractor.name,
      fieldsJson: JSON.stringify(fields),
      reference: referenceOf(readAs, fields),
      createdAt: now,
    },
  });
  await recordAudit(deps, {
    actor,
    action: "document_received",
    entityType: "document",
    entityId: document.id,
    summary:
      `${input.fileName} was received by ${input.channel}` +
      (classification.type === "unknown"
        ? "; the type could not be detected."
        : `; detected as ${documentTypeLabel(classification.type)} (${document.detectedConfidence}% sure).`),
  });

  const route = input.chosenType ? await confirmDocumentType(deps, actor, document.id, input.chosenType) : null;
  return { documentId: document.id, sameFileAs: earlier?.id ?? null, route };
}

// ---------------------------------------------------------------------------------------- Inbox (simulated email and WhatsApp)

export type InboxEntry = InboxMessage & { importedDocumentId: string | null };

/** Messages waiting in the inbox, each marked with the document it became if it was already imported. */
export async function listInbox(deps: Pick<Deps, "db" | "inbox">): Promise<InboxEntry[]> {
  const messages = await deps.inbox.list();
  const entries: InboxEntry[] = [];
  for (const message of messages) {
    const sha256 = sha256OfBytes(await deps.inbox.read(message.id));
    const imported = await deps.db.document.findFirst({ where: { sha256, channel: { in: ["email", "whatsapp"] } } });
    entries.push({ ...message, importedDocumentId: imported?.id ?? null });
  }
  return entries;
}

export async function importInboxMessage(deps: Deps, actor: Actor, messageId: string): Promise<IntakeResult> {
  const message = (await deps.inbox.list()).find((candidate) => candidate.id === messageId);
  requireThat(message, "That message is no longer in the inbox.");
  return ingestDocument(deps, actor, {
    bytes: await deps.inbox.read(message.id),
    fileName: message.fileName,
    channel: message.channel,
    sender: message.sender,
    receivedAt: message.receivedAt ?? undefined,
  });
}

/** Imports every waiting message that has not been imported yet. Returns how many were imported. */
export async function importAllInbox(deps: Deps, actor: Actor): Promise<number> {
  let imported = 0;
  for (const entry of await listInbox(deps)) {
    if (entry.importedDocumentId) continue;
    await importInboxMessage(deps, actor, entry.id);
    imported++;
  }
  return imported;
}

// ---------------------------------------------------------------------------------------- type confirmation and routing

export type RouteResult = {
  kind: RouteKind;
  /** Order number, payment proof id or shipment number the document now belongs to. Null when it was only filed. */
  routedId: string | null;
  /** The page where work on this document continues. Null means its own document page. */
  path: string | null;
};

type Routed = { routedId: string | null; path: string | null };

type Router = {
  attach(deps: Deps, actor: Actor, document: DocumentRow): Promise<Routed>;
  detach(deps: Deps, actor: Actor, document: DocumentRow): Promise<void>;
};

/** Document types whose workflow is not built yet are filed: stored, shown, and nothing else. */
const FILE_ONLY: Router = { attach: async () => ({ routedId: null, path: null }), detach: async () => undefined };

/** One router per destination. The shipment router is added by story 5. */
const ROUTERS: Record<RouteKind, Router> = {
  order: {
    attach: async (deps, actor, document) => {
      const { orderNo } = await attachPoDocument(deps, actor, document);
      return { routedId: orderNo, path: `/orders/${orderNo}/review` };
    },
    detach: detachPoDocument,
  },
  payment: {
    attach: async (deps, actor, document) => {
      const { proofId, orderNo } = await registerProof(deps, actor, document);
      return { routedId: proofId, path: orderNo ? `/payments/${orderNo}` : "/payments" };
    },
    detach: detachProof,
  },
  shipment: FILE_ONLY,
  filed: FILE_ONLY,
};

/**
 * A person confirms (or corrects) the type. Only now does the document affect anything else:
 * it is routed to an order, a payment or a shipment. A wrong detected type therefore never routes silently.
 */
export async function confirmDocumentType(deps: Deps, actor: Actor, documentId: string, type: DocumentType): Promise<RouteResult> {
  let document = await getDocument(deps, documentId);
  const spec = DOCUMENT_SPECS[type];
  requireThat(spec, "Choose one of the known document types.");

  if (document.typeStatus === "confirmed" && document.confirmedType === type) {
    return { kind: spec.routesTo, routedId: document.routedId, path: null };
  }

  // Changing an already confirmed type: first take the document back from wherever it was routed.
  const previousType = document.typeStatus === "confirmed" ? document.confirmedType : null;
  if (previousType && document.routedKind) {
    await ROUTERS[document.routedKind as RouteKind].detach(deps, actor, document);
  }

  // The stored fields were read for one type. A different type means reading the PDF again for that type.
  const readAs = workingType(document);
  let fieldsJson = document.fieldsJson;
  let lastEventId = document.editsFromEventId;
  if (readAs !== type) {
    const bytes = await deps.files.get(document.fileKey);
    const extraction = await deps.extractor.extract({ bytes, fileName: document.fileName }, type);
    fieldsJson = JSON.stringify(extraction.fields);
    // Edits made under the old type no longer apply to the new reading.
    const newest = await deps.db.auditEvent.findFirst({ orderBy: { id: "desc" } });
    lastEventId = newest?.id ?? 0;
    document = await deps.db.document.update({
      where: { id: document.id },
      data: { fieldsJson, editsFromEventId: lastEventId, reference: referenceOf(type, extraction.fields) },
    });
  }

  const now = deps.clock.now();
  document = await deps.db.document.update({
    where: { id: document.id },
    data: { typeStatus: "confirmed", confirmedType: type, confirmedBy: actor.name, confirmedAt: now, routedKind: null, routedId: null },
  });
  const changed = previousType !== null || (document.detectedType !== type && document.detectedType !== "unknown");
  await recordAudit(deps, {
    actor,
    action: changed ? "type_changed" : "type_confirmed",
    entityType: "document",
    entityId: document.id,
    field: "documentType",
    oldValue: previousType ?? document.detectedType,
    newValue: type,
    summary: changed
      ? `${actor.name} changed the type of ${document.fileName} from ${documentTypeLabel(previousType ?? document.detectedType)} to ${spec.label}.`
      : `${actor.name} confirmed ${document.fileName} as ${spec.label}.`,
  });

  const routed = await ROUTERS[spec.routesTo].attach(deps, actor, document);
  await deps.db.document.update({ where: { id: document.id }, data: { routedKind: spec.routesTo, routedId: routed.routedId } });
  return { kind: spec.routesTo, routedId: routed.routedId, path: routed.path };
}

export async function listDocuments(deps: Pick<Deps, "db">, limit = 100): Promise<DocumentRow[]> {
  return deps.db.document.findMany({ orderBy: [{ receivedAt: "desc" }, { createdAt: "desc" }], take: limit });
}

/** Where to send the person after a document was routed. */
export function pathForRoute(documentId: string, route: RouteResult | null): string {
  return route?.path ?? `/documents/${documentId}`;
}

export function parseDocumentType(value: string): DocumentType {
  if (!(value in DOCUMENT_SPECS)) throw new UserError("Choose one of the known document types.");
  return value as DocumentType;
}
