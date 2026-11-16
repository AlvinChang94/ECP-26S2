// What: one document: the PDF with highlighted fields, the detected type with a way to confirm or change it, and what was read.
// Who calls it: links from the Inbox; the upload route sends people here after an upload.
// To extend: once the type is confirmed the work continues on the routed page (order review, payments or shipment).
import Link from "next/link";
import { notFound } from "next/navigation";
import { readMessages } from "@/app/_lib/forms";
import { oneParam, toHighlights } from "@/app/_lib/highlights";
import { confirmTypeAction } from "@/app/(app)/inbox/actions";
import { Notices } from "@/components/Notices";
import { PageHeader } from "@/components/PageHeader";
import { PdfViewer } from "@/components/PdfViewer";
import { Timeline } from "@/components/Timeline";
import { TypeBadge } from "@/components/TypeBadge";
import { DOCUMENT_SPECS, DOCUMENT_TYPES, LOW_CONFIDENCE_THRESHOLD } from "@/domain/documents";
import { fieldLabel } from "@/domain/fields";
import { formatDateTime } from "@/domain/time";
import { listEntityTimeline } from "@/services/audit";
import { getDeps } from "@/services/deps";
import { loadDocument, type LoadedDocument } from "@/services/documents";
import { UserError } from "@/services/errors";

export default async function DocumentPage(props: PageProps<"/documents/[id]">) {
  const { id } = await props.params;
  const searchParams = await props.searchParams;
  const selectedField = oneParam(searchParams.field);
  const deps = await getDeps();

  let loaded: LoadedDocument;
  try {
    loaded = await loadDocument(deps, id);
  } catch (error) {
    if (error instanceof UserError) notFound();
    throw error;
  }
  const { document, spec, fields, values } = loaded;
  const confirmed = document.typeStatus === "confirmed";
  const sure = document.detectedType !== "unknown" && document.detectedConfidence >= LOW_CONFIDENCE_THRESHOLD * 100;
  const timeline = await listEntityTimeline(deps, "document", document.id);
  const routedHref =
    document.routedKind === "order" && document.routedId
      ? `/orders/${document.routedId}/review`
      : document.routedKind === "shipment" && document.routedId
        ? `/shipments/${document.routedId}`
        : document.routedKind === "payment"
          ? "/payments"
          : null;

  return (
    <>
      <PageHeader title={document.fileName} subtitle={`Received ${formatDateTime(document.receivedAt)} by ${document.channel} from ${document.sender ?? "an unknown sender"}`}>
        <Link className="btn btn-secondary" href="/inbox">
          Back to Inbox
        </Link>
      </PageHeader>
      <Notices messages={readMessages(searchParams)} />

      <div className="split">
        <div className="split-left">
          <PdfViewer fileUrl={`/api/documents/${document.id}/file`} highlights={toHighlights(fields)} selectedKey={selectedField} />
        </div>

        <div>
          <div className="card">
            <h2>Document type</h2>
            <div className="row">
              <TypeBadge document={document} />
              <span className="muted small">Read by: {document.extractorName}</span>
            </div>
            {document.detectedReasons ? (
              <ul className="muted small" style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                {document.detectedReasons.split("\n").map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            ) : null}

            {!confirmed && !sure ? (
              <div className="notice notice-warning" style={{ marginTop: 10 }}>
                The reader is not sure what this document is. Choose the type; nothing happens with the document until you do.
              </div>
            ) : null}
            {!confirmed ? (
              <p className="muted" style={{ marginTop: 10 }}>
                The type is only a proposal. Confirm or change it; until then this document changes nothing else in the system.
              </p>
            ) : (
              <p style={{ marginTop: 10 }}>
                Confirmed by {document.confirmedBy} on {formatDateTime(document.confirmedAt)}.{" "}
                {routedHref ? (
                  <Link href={routedHref}>Continue: {document.routedId ?? "open"}</Link>
                ) : (
                  <span className="muted">Filed: no workflow uses this document type yet.</span>
                )}
              </p>
            )}

            <form action={confirmTypeAction} className="inline-form" style={{ marginTop: 6 }}>
              <input type="hidden" name="documentId" value={document.id} />
              <select name="type" defaultValue={confirmed ? (document.confirmedType ?? "") : sure ? document.detectedType : ""} aria-label="Document type" required>
                <option value="" disabled>
                  Choose the type...
                </option>
                {DOCUMENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {DOCUMENT_SPECS[type].label}
                  </option>
                ))}
              </select>
              <button className={confirmed ? "btn btn-secondary" : "btn"} type="submit">
                {confirmed ? "Change type" : "Confirm type"}
              </button>
            </form>
          </div>

          <div className="card card-tight">
            <div className="card-title">What was read {spec ? `(as ${spec.label})` : ""}</div>
            {fields.length === 0 ? (
              <p className="muted" style={{ padding: 16 }}>
                Nothing was read yet. Choose the type above and the document is read for that type.
              </p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Field</th>
                    <th>Value</th>
                    <th className="right">Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {fields.map((field) => (
                    <tr key={field.key} className={field.key === selectedField ? "table-row-selected" : undefined}>
                      <td>
                        {field.bbox ? (
                          <Link className="field-link" href={`/documents/${document.id}?field=${encodeURIComponent(field.key)}`} scroll={false}>
                            {spec ? fieldLabel(spec, field.key) : field.key}
                          </Link>
                        ) : spec ? (
                          fieldLabel(spec, field.key)
                        ) : (
                          field.key
                        )}
                      </td>
                      <td>{values[field.key] ?? <span className="muted">not found</span>}</td>
                      <td className="right muted">{field.value === null ? "" : `${Math.round(field.confidence * 100)}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="card">
            <h2>History</h2>
            <Timeline entries={timeline} />
          </div>
        </div>
      </div>
    </>
  );
}
