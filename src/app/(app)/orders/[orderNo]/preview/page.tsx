// What: the export preview (story 2): the exact files that will be written for Navision, what changed, and the approval button.
// Who calls it: "Preview the export" on the review page; "Cancel order" on the order page (with ?mode=cancel).
// To extend: the preview is built by buildExportPreview() in src/services/poExport.ts; this page only shows it.
import Link from "next/link";
import { notFound } from "next/navigation";
import { readMessages } from "@/app/_lib/forms";
import { oneParam } from "@/app/_lib/highlights";
import { requirePersona } from "@/app/_lib/session";
import { Notices } from "@/components/Notices";
import { PageHeader } from "@/components/PageHeader";
import { getDeps } from "@/services/deps";
import { UserError } from "@/services/errors";
import { buildCancellationPreview, buildExportPreview, type ExportPreview } from "@/services/poExport";
import { approveCancellationAction, approveExportAction } from "../actions";

export default async function PreviewPage(props: PageProps<"/orders/[orderNo]/preview">) {
  const { orderNo } = await props.params;
  const searchParams = await props.searchParams;
  const persona = await requirePersona();
  const deps = await getDeps();

  let preview: ExportPreview;
  try {
    preview = oneParam(searchParams.mode) === "cancel" ? await buildCancellationPreview(deps, orderNo) : await buildExportPreview(deps, orderNo);
  } catch (error) {
    if (error instanceof UserError) notFound();
    throw error;
  }
  const isSales = persona.role === "sales";
  const cancelling = preview.mode === "cancellation";

  return (
    <>
      <PageHeader
        title={cancelling ? `Cancel ${orderNo}` : `Export preview: ${orderNo}, revision ${preview.revision}`}
        subtitle={
          cancelling
            ? "Review what cancelling will do. Nothing happens until you confirm."
            : "This is exactly what will be written for Navision. Nothing is written until you approve."
        }
      >
        <Link className="btn btn-secondary" href={cancelling ? `/orders/${orderNo}` : `/orders/${orderNo}/review`}>
          Back
        </Link>
      </PageHeader>
      <Notices messages={readMessages(searchParams)} />

      {preview.problems.length > 0 ? (
        <div className="notice notice-error" data-testid="preview-problems">
          <strong>{cancelling ? "This order cannot be cancelled:" : "The export cannot be approved yet:"}</strong>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {preview.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
          {!cancelling ? <Link href={`/orders/${orderNo}/review`}>Go back to the review to fix or accept them</Link> : null}
        </div>
      ) : null}

      <div className="grid-2">
        <div>
          <div className="card">
            <h2>{preview.files.length === 1 ? "File to be written" : `Files to be written (${preview.files.length})`}</h2>
            {preview.files.length === 0 ? (
              <p className="muted">
                {cancelling
                  ? "This order was never exported, so nothing is written to Navision. Confirming closes the draft."
                  : "The file cannot be built until the blocking findings are dealt with."}
              </p>
            ) : null}
            {preview.files.map((file) => (
              <div key={file.path} style={{ marginBottom: 12 }}>
                <div className="mono" style={{ marginBottom: 4 }} data-testid="preview-path">
                  data/navision/{file.path}
                </div>
                <pre className="file-preview" data-testid={`preview-${file.kind}`}>
                  {file.text}
                </pre>
              </div>
            ))}
          </div>
        </div>

        <div>
          {!cancelling ? (
            <div className="card card-tight">
              <div className="card-title">Changes from the PO as it was received ({preview.changes.length})</div>
              {preview.changes.length === 0 ? (
                <p className="muted" style={{ padding: 16 }}>
                  No value was changed: the order is exported as it was read from the PDF.
                </p>
              ) : (
                <table className="table" data-testid="preview-changes">
                  <thead>
                    <tr>
                      <th>Field</th>
                      <th>On the PDF</th>
                      <th>Now</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.changes.map((change) => (
                      <tr key={change.field}>
                        <td>{change.label}</td>
                        <td className="mono">{change.before ?? "(empty)"}</td>
                        <td className="mono">{change.after ?? "(empty)"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ) : null}

          {preview.acceptedDifferences.length > 0 ? (
            <div className="card">
              <h2>Accepted differences</h2>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {preview.acceptedDifferences.map((difference) => (
                  <li key={`${difference.flag}-${difference.field}`}>
                    <span className="mono">{difference.flag}</span> accepted by {difference.acceptedBy}: {difference.reason}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {preview.amendment ? (
            <div className="card card-tight">
              <div className="card-title">Changes from the previous revision</div>
              {preview.amendment.identical ? (
                <p className="muted" style={{ padding: 16 }}>
                  Same details and lines as the previous revision.
                </p>
              ) : (
                <table className="table">
                  <tbody>
                    {preview.amendment.header.map((change) => (
                      <tr key={change.label}>
                        <td>{change.label}</td>
                        <td>{change.before ?? "(empty)"}</td>
                        <td>{change.after ?? "(empty)"}</td>
                      </tr>
                    ))}
                    {preview.amendment.lines.map((change, index) => (
                      <tr key={`${change.partNo}-${index}`}>
                        <td>
                          <span className="mono">{change.partNo}</span> <span className="badge badge-neutral">{change.change}</span>
                        </td>
                        <td>{change.before ? `${change.before.quantity ?? "?"} at ${change.before.unitPrice ?? "?"}` : "(not on the order)"}</td>
                        <td>{change.after ? `${change.after.quantity ?? "?"} at ${change.after.unitPrice ?? "?"}` : "(removed)"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ) : null}

          <div className="card">
            <h2>{cancelling ? "Confirm the cancellation" : "Approval"}</h2>
            {!isSales ? <div className="notice notice-info">Only a sales team member can approve. You are signed in as {persona.name}.</div> : null}
            <form action={cancelling ? approveCancellationAction : approveExportAction} className="stack">
              <input type="hidden" name="orderNo" value={orderNo} />
              <input type="hidden" name="previewHash" value={preview.previewHash} />
              {cancelling ? (
                <div className="field">
                  <label htmlFor="reason">Reason for cancelling (required)</label>
                  <textarea id="reason" name="reason" placeholder="For example: customer sent a cancellation for this PO on 16 Nov" />
                </div>
              ) : null}
              <button className={cancelling ? "btn btn-danger" : "btn"} type="submit" disabled={!preview.ready || !isSales} data-testid="approve-button">
                {cancelling ? `Confirm cancellation as ${persona.name}` : `Approve and export as ${persona.name}`}
              </button>
              <p className="muted small">
                {cancelling
                  ? "Your name, the time and the reason are recorded in the audit log."
                  : "Approval writes exactly the file shown here. Your name and the time are recorded in the audit log. If the order changes after this page was opened, approval is refused and you are asked to look again."}
              </p>
            </form>
          </div>
        </div>
      </div>
    </>
  );
}
