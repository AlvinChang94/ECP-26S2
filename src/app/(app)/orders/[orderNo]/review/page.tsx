// What: the PO review screen (stories 1 and 2): PDF on the left with highlighted fields, PO values and findings on the right.
// Who calls it: after a customer PO's type is confirmed; links from the Inbox and the order dashboard.
// To extend: findings come from src/domain/po/checks.ts through loadPoReview(); this page only shows them.
import Link from "next/link";
import { notFound } from "next/navigation";
import { readMessages } from "@/app/_lib/forms";
import { oneParam, toHighlights } from "@/app/_lib/highlights";
import { FlagCard, SeverityBadge } from "@/components/FlagCard";
import { Notices } from "@/components/Notices";
import { PageHeader } from "@/components/PageHeader";
import { PdfViewer } from "@/components/PdfViewer";
import { fieldLabel, lineKey } from "@/domain/fields";
import type { FlagWithDecision } from "@/domain/flags";
import { displayMoney } from "@/domain/money";
import { getDeps } from "@/services/deps";
import { UserError } from "@/services/errors";
import { loadPoReview, type PoReview } from "@/services/poReview";

const VERSION_STATUS_LABELS: Record<string, string> = {
  draft: "Draft: not yet in Navision",
  exported: "Exported to Navision",
  superseded: "Replaced by a newer version",
  cancelled: "Cancelled",
  void: "Withdrawn",
};

export default async function PoReviewPage(props: PageProps<"/orders/[orderNo]/review">) {
  const { orderNo } = await props.params;
  const searchParams = await props.searchParams;
  const selectedField = oneParam(searchParams.field);
  const versionId = oneParam(searchParams.version) ?? undefined;
  const deps = await getDeps();

  let review: PoReview;
  try {
    review = await loadPoReview(deps, orderNo, versionId);
  } catch (error) {
    if (error instanceof UserError) notFound();
    throw error;
  }
  const { order, version, document, spec, values, po, flags, blocking } = review;
  const base = `/orders/${orderNo}/review${versionId ? `?version=${versionId}&` : "?"}`;
  const fieldHref = (key: string): string => `${base}field=${encodeURIComponent(key)}`;
  const flagsFor = (key: string): FlagWithDecision[] => flags.filter((flag) => flag.field === key);
  const warnings = flags.filter((flag) => flag.severity === "warning" && flag.decision === null);
  const headerFields = spec.fields.filter((field) => field.key !== "poKind" || values.poKind);

  /** A value that jumps to its place on the PDF when clicked, with a small badge for each finding on it. */
  const cell = (key: string, display?: string) => {
    const value = values[key];
    const hasPosition = review.fields.some((field) => field.key === key && field.bbox !== null);
    const text = display ?? value ?? "";
    return (
      <span data-field={key}>
        {value === null || value === undefined || value === "" ? (
          <span className="muted">empty</span>
        ) : hasPosition ? (
          <Link className="field-link" href={fieldHref(key)} scroll={false}>
            {text}
          </Link>
        ) : (
          text
        )}{" "}
        {flagsFor(key).map((flag) => (
          <SeverityBadge key={flag.fingerprint} severity={flag.decision ? "info" : flag.severity} />
        ))}
      </span>
    );
  };

  return (
    <>
      <PageHeader
        title={`${orderNo}: PO ${po.poNumber ?? "(number not read)"}`}
        subtitle={`${po.customerName ?? "Customer not read"} · revision ${version.revision} · ${VERSION_STATUS_LABELS[version.status] ?? version.status}`}
      >
        <Link className="btn btn-secondary" href={`/documents/${document.id}`}>
          Document
        </Link>
      </PageHeader>
      <Notices messages={readMessages(searchParams)} />

      <div className="split">
        <div className="split-left">
          <PdfViewer fileUrl={`/api/documents/${document.id}/file`} highlights={toHighlights(review.fields)} selectedKey={selectedField} />
        </div>

        <div>
          <div className="card">
            <h2>Findings</h2>
            <div className="row" data-testid="findings-summary">
              {blocking.length > 0 ? (
                <span className="badge badge-blocking">
                  {blocking.length} blocking: fix or accept before export
                </span>
              ) : (
                <span className="badge badge-ok">Nothing blocks the export</span>
              )}
              {warnings.length > 0 ? <span className="badge badge-warning">{warnings.length} to review</span> : null}
              <span className="muted small">Checked against Navision just now. Nothing is changed for you.</span>
            </div>
            {flags.length === 0 ? <p className="muted" style={{ marginTop: 8 }}>No differences found between this PO and Navision.</p> : null}
            {flags.map((flag) => (
              <FlagCard key={flag.fingerprint} flag={flag}>
                {review.fields.some((field) => field.key === flag.field && field.bbox !== null) ? (
                  <Link className="small" href={fieldHref(flag.field)} scroll={false}>
                    Show {fieldLabel(spec, flag.field)} on the PDF
                  </Link>
                ) : null}
              </FlagCard>
            ))}
          </div>

          <div className="card card-tight">
            <div className="card-title">Order details</div>
            <table className="table">
              <tbody>
                {headerFields.map((field) => (
                  <tr key={field.key} className={field.key === selectedField ? "table-row-selected" : undefined}>
                    <td className="muted" style={{ width: "38%" }}>
                      {field.label}
                      {field.enteredByStaff ? <div className="small">typed by staff</div> : null}
                    </td>
                    <td>{cell(field.key, field.kind === "money" ? displayMoney(values[field.key]) : undefined)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card card-tight">
            <div className="card-title">PO lines ({po.lines.filter((line) => !line.removed).length})</div>
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Part no.</th>
                  <th>Description</th>
                  <th className="right">Qty</th>
                  <th className="right">Unit price</th>
                  <th className="right">Line total</th>
                </tr>
              </thead>
              <tbody>
                {po.lines.map((line) => (
                  <tr key={line.index} className={line.removed ? "strike" : undefined}>
                    <td>{line.index + 1}</td>
                    <td className="mono">{cell(lineKey(line.index, "partNo"))}</td>
                    <td>{cell(lineKey(line.index, "description"))}</td>
                    <td className="right">{cell(lineKey(line.index, "quantity"))}</td>
                    <td className="right">{cell(lineKey(line.index, "unitPrice"))}</td>
                    <td className="right">{cell(lineKey(line.index, "lineTotal"))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="muted small">
            Order {order.orderNo} was created when the PO type was confirmed. Editing, overrides, the export preview and approval are on this page from
            milestone M2.
          </p>
        </div>
      </div>
    </>
  );
}
