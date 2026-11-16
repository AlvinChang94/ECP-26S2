// What: the PO review screen (stories 1 and 2): PDF on the left with highlighted fields; values, findings, edits and history on the right.
// Who calls it: after a customer PO's type is confirmed; links from the Inbox, the order page and the order dashboard.
// To extend: findings come from src/domain/po/checks.ts through loadPoReview(); edits go through the actions in ../actions.ts.
import Link from "next/link";
import { notFound } from "next/navigation";
import { readMessages } from "@/app/_lib/forms";
import { oneParam, toHighlights } from "@/app/_lib/highlights";
import { actorOf, requirePersona } from "@/app/_lib/session";
import { FlagCard, SeverityBadge } from "@/components/FlagCard";
import { Notices } from "@/components/Notices";
import { PageHeader } from "@/components/PageHeader";
import { PdfViewer } from "@/components/PdfViewer";
import { FieldHistory } from "@/components/po/FieldHistory";
import { FlagActions } from "@/components/po/FlagActions";
import { fieldLabel, lineKey } from "@/domain/fields";
import type { FlagWithDecision } from "@/domain/flags";
import { diffPoVersions } from "@/domain/po/amend";
import { toCustomerPo } from "@/domain/po/types";
import { displayMoney } from "@/domain/money";
import { getDeps } from "@/services/deps";
import { loadDocument } from "@/services/documents";
import { UserError } from "@/services/errors";
import { loadPoReview, type PoReview } from "@/services/poReview";
import { addLineAction, removeLineAction, saveFieldsAction } from "../actions";

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
  const persona = await requirePersona();
  const deps = await getDeps();

  let review: PoReview;
  try {
    review = await loadPoReview(deps, orderNo, versionId);
  } catch (error) {
    if (error instanceof UserError) notFound();
    throw error;
  }
  const { version, document, spec, values, po, flags, blocking } = review;
  // Only a sales team member working on the order's current draft gets edit forms.
  const canEdit = review.canEdit && version.id === review.order.currentPoVersionId && actorOf(persona).role === "sales";
  const base = `/orders/${orderNo}/review${versionId ? `?version=${versionId}&` : "?"}`;
  const fieldHref = (key: string): string => `${base}field=${encodeURIComponent(key)}`;
  const flagsFor = (key: string): FlagWithDecision[] => flags.filter((flag) => flag.field === key);
  const hasPosition = (key: string): boolean => review.fields.some((field) => field.key === key && field.bbox !== null);
  const warnings = flags.filter((flag) => flag.severity === "warning" && flag.decision === null);
  const headerFields = spec.fields.filter((field) => field.key !== "poKind" || values.poKind);
  const isCancellation = version.kind === "cancellation";

  // For an amendment or cancellation: what differs from the version before it.
  const previousVersion = version.previousId ? review.versions.find((candidate) => candidate.id === version.previousId) : undefined;
  const previousDiff = previousVersion ? diffPoVersions(toCustomerPo((await loadDocument(deps, previousVersion.documentId)).values), po) : null;

  /** A value that jumps to its place on the PDF when clicked, with a small badge for each finding on it. */
  const cell = (key: string, display?: string) => {
    const value = values[key];
    const text = display ?? value ?? "";
    const edited = review.original[key] !== undefined && (review.original[key] ?? null) !== (value ?? null);
    return (
      <span data-field={key}>
        {value === null || value === undefined || value === "" ? (
          <span className="muted">empty</span>
        ) : hasPosition(key) ? (
          <Link className="field-link" href={fieldHref(key)} scroll={false}>
            {text}
          </Link>
        ) : (
          text
        )}{" "}
        {edited ? <span className="badge badge-neutral" title={`Read from the PDF as: ${review.original[key] ?? "(empty)"}`}>edited</span> : null}{" "}
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
        <Link className="btn btn-secondary" href={`/orders/${orderNo}`}>
          Order page
        </Link>
        {version.status === "draft" && review.order.status === "open" ? (
          <Link className="btn" href={`/orders/${orderNo}/preview`} data-testid="open-preview">
            {isCancellation ? "Review the cancellation" : "Preview the export"}
          </Link>
        ) : null}
      </PageHeader>
      <Notices messages={readMessages(searchParams)} />
      {review.canEdit && !canEdit ? (
        <div className="notice notice-info">You are viewing this PO as {persona.name}. Only a sales team member can change or approve it.</div>
      ) : null}

      <div className="split">
        <div className="split-left">
          <PdfViewer fileUrl={`/api/documents/${document.id}/file`} highlights={toHighlights(review.fields)} selectedKey={selectedField} />
        </div>

        <div>
          <div className="card">
            <h2>Findings</h2>
            <div className="row" data-testid="findings-summary">
              {blocking.length > 0 ? (
                <span className="badge badge-blocking">{blocking.length} blocking: fix or accept before export</span>
              ) : (
                <span className="badge badge-ok">Nothing blocks the export</span>
              )}
              {warnings.length > 0 ? <span className="badge badge-warning">{warnings.length} to review</span> : null}
              <span className="muted small">Checked against Navision just now. Nothing is changed for you.</span>
            </div>
            {flags.length === 0 ? (
              <p className="muted" style={{ marginTop: 8 }}>
                No differences found between this PO and Navision.
              </p>
            ) : null}
            {flags.map((flag) => (
              <FlagCard key={flag.fingerprint} flag={flag}>
                {hasPosition(flag.field) ? (
                  <div style={{ marginBottom: 6 }}>
                    <Link className="small" href={fieldHref(flag.field)} scroll={false}>
                      Show {fieldLabel(spec, flag.field)} on the PDF
                    </Link>
                  </div>
                ) : null}
                <FlagActions
                  orderNo={orderNo}
                  flag={flag}
                  canEdit={canEdit}
                  suggestedShipDate={review.suggestedShipDate}
                  suggestedShipLeadDays={deps.config.suggestedShipLeadDays}
                  customerAddress={po.customerAddress}
                  actorName={persona.name}
                />
              </FlagCard>
            ))}
          </div>

          {previousDiff && previousVersion ? (
            <div className="card" data-testid="version-diff">
              <h2>
                Changes from revision {previousVersion.revision} ({VERSION_STATUS_LABELS[previousVersion.status] ?? previousVersion.status})
              </h2>
              {previousDiff.identical ? (
                <p className="muted">This version has the same details and lines as the one before it.</p>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>What</th>
                      <th>Before</th>
                      <th>Now</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previousDiff.header.map((change) => (
                      <tr key={change.label}>
                        <td>{change.label}</td>
                        <td>{change.before ?? "(empty)"}</td>
                        <td>{change.after ?? "(empty)"}</td>
                      </tr>
                    ))}
                    {previousDiff.lines.map((change, index) => (
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
              <Link className="small" href={`/orders/${orderNo}/review?version=${previousVersion.id}`}>
                Open revision {previousVersion.revision}
              </Link>
            </div>
          ) : null}

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
            {canEdit ? (
              <details style={{ padding: "10px 16px" }}>
                <summary>Edit order details</summary>
                <form action={saveFieldsAction} className="stack" style={{ marginTop: 8 }}>
                  <input type="hidden" name="orderNo" value={orderNo} />
                  {spec.fields.map((field) => (
                    <div className="field" key={field.key}>
                      <label htmlFor={`edit-${field.key}`}>{field.label}</label>
                      <input id={`edit-${field.key}`} type="text" name={`field:${field.key}`} defaultValue={values[field.key] ?? ""} style={{ width: "100%" }} />
                    </div>
                  ))}
                  <button className="btn btn-small" type="submit">
                    Save order details
                  </button>
                </form>
              </details>
            ) : null}
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
                  <tr key={line.index} className={line.removed ? "strike" : undefined} data-testid={`line-${line.index}`}>
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
            {canEdit ? (
              <div style={{ padding: "10px 16px" }} className="stack">
                {po.lines
                  .filter((line) => !line.removed)
                  .map((line) => (
                    <details key={line.index} data-testid={`edit-line-${line.index}`}>
                      <summary>Edit line {line.index + 1}</summary>
                      <form action={saveFieldsAction} className="row" style={{ marginTop: 8, alignItems: "flex-end" }}>
                        <input type="hidden" name="orderNo" value={orderNo} />
                        <div className="field">
                          <label htmlFor={`partNo-${line.index}`}>Part no.</label>
                          <input id={`partNo-${line.index}`} type="text" name={`field:${lineKey(line.index, "partNo")}`} defaultValue={line.partNo ?? ""} size={14} />
                        </div>
                        <div className="field">
                          <label htmlFor={`quantity-${line.index}`}>Qty</label>
                          <input id={`quantity-${line.index}`} type="text" name={`field:${lineKey(line.index, "quantity")}`} defaultValue={line.quantity ?? ""} size={6} />
                        </div>
                        <div className="field">
                          <label htmlFor={`unitPrice-${line.index}`}>Unit price</label>
                          <input id={`unitPrice-${line.index}`} type="text" name={`field:${lineKey(line.index, "unitPrice")}`} defaultValue={line.unitPrice ?? ""} size={8} />
                        </div>
                        <div className="field">
                          <label style={{ fontWeight: 400 }}>
                            <input type="checkbox" name="rememberAlias" /> Remember a part number fix
                          </label>
                        </div>
                        <div className="field">
                          <button className="btn btn-small" type="submit">
                            Save line {line.index + 1}
                          </button>
                        </div>
                      </form>
                      <form action={removeLineAction} className="inline-form">
                        <input type="hidden" name="orderNo" value={orderNo} />
                        <input type="hidden" name="lineIndex" value={line.index} />
                        <button className="btn btn-danger btn-small" type="submit">
                          Remove line {line.index + 1}
                        </button>
                        <span className="muted small">A removed line stays visible, struck through, and can be restored with Undo.</span>
                      </form>
                    </details>
                  ))}
                <form action={addLineAction} className="inline-form">
                  <input type="hidden" name="orderNo" value={orderNo} />
                  <input type="text" name="partNo" placeholder="Part no. of a new line" aria-label="Part number of a new line" size={22} />
                  <button className="btn btn-secondary btn-small" type="submit">
                    Add line
                  </button>
                </form>
              </div>
            ) : null}
          </div>

          <div className="card">
            <h2>History of changes</h2>
            <FieldHistory orderNo={orderNo} spec={spec} edits={review.edits} canEdit={canEdit} />
          </div>
        </div>
      </div>
    </>
  );
}
