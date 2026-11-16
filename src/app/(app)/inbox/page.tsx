// What: the Inbox page (story 1 intake): PDFs waiting in the simulated email and WhatsApp inbox, manual upload, and all documents.
// Who calls it: the "Inbox and upload" link in the sidebar.
// To extend: real email or WhatsApp intake is another InboxSource adapter (src/adapters/inbox.ts); this page does not change.
import Link from "next/link";
import { readMessages } from "@/app/_lib/forms";
import { Notices } from "@/components/Notices";
import { PageHeader } from "@/components/PageHeader";
import { TypeBadge } from "@/components/TypeBadge";
import { DOCUMENT_SPECS, DOCUMENT_TYPES, LOW_CONFIDENCE_THRESHOLD } from "@/domain/documents";
import { formatDateTime } from "@/domain/time";
import { getDeps } from "@/services/deps";
import { listDocuments, listInbox } from "@/services/intake";
import { confirmTypeAction, importAllAction, importMessageAction } from "./actions";

const CHANNEL_LABELS: Record<string, string> = { email: "Email", whatsapp: "WhatsApp", upload: "Upload" };

function routeLink(document: { id: string; routedKind: string | null; routedId: string | null }): { href: string; label: string } {
  if (document.routedKind === "order" && document.routedId) return { href: `/orders/${document.routedId}/review`, label: document.routedId };
  if (document.routedKind === "shipment" && document.routedId) return { href: `/shipments/${document.routedId}`, label: document.routedId };
  if (document.routedKind === "payment") return { href: "/payments", label: "Payments" };
  return { href: `/documents/${document.id}`, label: "Filed" };
}

export default async function InboxPage(props: PageProps<"/inbox">) {
  const searchParams = await props.searchParams;
  const deps = await getDeps();
  const waiting = (await listInbox(deps)).filter((entry) => entry.importedDocumentId === null);
  const documents = await listDocuments(deps);

  return (
    <>
      <PageHeader title="Inbox and upload" subtitle="PDFs arrive by email, WhatsApp or upload. The system reads them and proposes a type; a person confirms it." />
      <Notices messages={readMessages(searchParams)} />

      <div className="grid-2">
        <div className="card card-tight">
          <div className="card-title row" style={{ justifyContent: "space-between" }}>
            <span>Waiting in the inbox ({waiting.length})</span>
            <form action={importAllAction}>
              <button className="btn btn-small" type="submit" disabled={waiting.length === 0}>
                Import all
              </button>
            </form>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Received</th>
                <th>Channel and sender</th>
                <th>File</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {waiting.length === 0 ? (
                <tr>
                  <td colSpan={4} className="muted">
                    Nothing is waiting. Drop a PDF into {deps.config.inboxDir} to simulate a new message.
                  </td>
                </tr>
              ) : null}
              {waiting.map((entry) => (
                <tr key={entry.id}>
                  <td className="nowrap">{entry.receivedAt ? formatDateTime(entry.receivedAt) : "just now"}</td>
                  <td>
                    <span className="badge badge-neutral">{CHANNEL_LABELS[entry.channel]}</span>
                    <div className="muted small">{entry.sender ?? "Unknown sender"}</div>
                  </td>
                  <td className="mono">{entry.fileName}</td>
                  <td>
                    <form action={importMessageAction}>
                      <input type="hidden" name="messageId" value={entry.id} />
                      <button className="btn btn-secondary btn-small" type="submit">
                        Import
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h2>Upload a PDF</h2>
          {/* A plain HTML form post to a route handler: the one place (with downloads) where this project uses route handlers. */}
          <form action="/api/documents/upload" method="post" encType="multipart/form-data" className="stack">
            <div className="field">
              <label htmlFor="file">PDF file</label>
              <input id="file" name="file" type="file" accept="application/pdf,.pdf" required />
            </div>
            <div className="field">
              <label htmlFor="type">Document type</label>
              <select id="type" name="type" defaultValue="">
                <option value="">Detect automatically (you confirm it afterwards)</option>
                {DOCUMENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {DOCUMENT_SPECS[type].label}
                  </option>
                ))}
              </select>
            </div>
            <button className="btn" type="submit">
              Upload and read
            </button>
          </form>
        </div>
      </div>

      <div className="card card-tight">
        <div className="card-title">Documents ({documents.length})</div>
        <table className="table">
          <thead>
            <tr>
              <th>Received</th>
              <th>From</th>
              <th>File</th>
              <th>Type</th>
              <th>Goes to</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {documents.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
                  No documents yet. Import the inbox or upload a PDF.
                </td>
              </tr>
            ) : null}
            {documents.map((document) => {
              const confirmed = document.typeStatus === "confirmed";
              const sure = document.detectedType !== "unknown" && document.detectedConfidence >= LOW_CONFIDENCE_THRESHOLD * 100;
              const route = routeLink(document);
              return (
                <tr key={document.id}>
                  <td className="nowrap">{formatDateTime(document.receivedAt)}</td>
                  <td>
                    <span className="badge badge-neutral">{CHANNEL_LABELS[document.channel] ?? document.channel}</span>
                    <div className="muted small">{document.sender ?? "Unknown sender"}</div>
                  </td>
                  <td className="mono">
                    <Link href={`/documents/${document.id}`}>{document.fileName}</Link>
                  </td>
                  <td>
                    <TypeBadge document={document} />
                  </td>
                  <td>{confirmed ? <Link href={route.href}>{route.label}</Link> : <span className="muted">Waits for type confirmation</span>}</td>
                  <td className="nowrap">
                    {!confirmed && sure ? (
                      <form action={confirmTypeAction} className="inline-form">
                        <input type="hidden" name="documentId" value={document.id} />
                        <input type="hidden" name="type" value={document.detectedType} />
                        <button className="btn btn-small" type="submit">
                          Confirm type
                        </button>
                      </form>
                    ) : null}
                    {!confirmed && !sure ? (
                      <Link className="btn btn-secondary btn-small" href={`/documents/${document.id}`}>
                        Choose type
                      </Link>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
