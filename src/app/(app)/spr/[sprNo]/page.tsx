// What: the page of one SPR: its facts, who must decide, the reminder schedule, the evidence, messages and history.
// Who calls it: links from the SPR list, the Outbox and order pages.
// To extend: the vendor PO step after approval is a labelled STUB (see docs/ASSUMPTIONS.md, A2).
import Link from "next/link";
import { notFound } from "next/navigation";
import { readMessages } from "@/app/_lib/forms";
import { requirePersona } from "@/app/_lib/session";
import { MessageBody } from "@/components/MessageBody";
import { Notices } from "@/components/Notices";
import { PageHeader } from "@/components/PageHeader";
import { SprEvidencePanel, SprFacts, SprStatusBadge } from "@/components/spr/SprFacts";
import { Stub } from "@/components/Stub";
import { Timeline } from "@/components/Timeline";
import { formatDateTime, hoursBetween } from "@/domain/time";
import { listEntityTimeline } from "@/services/audit";
import { getDeps } from "@/services/deps";
import { UserError } from "@/services/errors";
import { listOutbox, notificationLabel } from "@/services/outbox";
import { getSpr, listSprJobs, parseEvidence } from "@/services/spr";
import { resendLinkAction, submitSprAction } from "../actions";

const JOB_LABELS: Record<string, string> = { spr_reminder: "Reminder", spr_escalation: "Hand over to the stand-in" };
const JOB_STATUS: Record<string, { label: string; badge: string }> = {
  pending: { label: "Scheduled", badge: "badge-info" },
  done: { label: "Sent", badge: "badge-ok" },
  cancelled: { label: "Cancelled by the decision", badge: "badge-neutral" },
};

export default async function SprPage(props: PageProps<"/spr/[sprNo]">) {
  const { sprNo } = await props.params;
  const searchParams = await props.searchParams;
  const persona = await requirePersona();
  const deps = await getDeps();

  let spr;
  try {
    spr = await getSpr(deps, sprNo);
  } catch (error) {
    if (error instanceof UserError) notFound();
    throw error;
  }
  const jobs = await listSprJobs(deps, sprNo);
  const messages = await listOutbox(deps, { entityType: "spr", entityId: sprNo });
  const timeline = await listEntityTimeline(deps, "spr", sprNo);
  const now = deps.clock.now();
  const isProductManager = persona.role === "product_manager";

  return (
    <>
      <PageHeader title={`${sprNo}: ${spr.quantity} x ${spr.partNo}`} subtitle={`Raised by ${spr.requestedBy}${spr.sourceOrderNo ? ` for customer order ${spr.sourceOrderNo}` : ""}`}>
        <SprStatusBadge status={spr.status} />
        <Link className="btn btn-secondary" href="/spr">
          Back to SPRs
        </Link>
      </PageHeader>
      <Notices messages={readMessages(searchParams)} />

      <div className="grid-2">
        <div>
          <div className="card card-tight">
            <div className="card-title">Request</div>
            <SprFacts spr={spr} />
            {spr.status === "Draft" ? (
              <div style={{ padding: 16 }}>
                <form action={submitSprAction}>
                  <input type="hidden" name="sprNo" value={sprNo} />
                  <button className="btn" type="submit" disabled={!isProductManager}>
                    Submit for approval
                  </button>
                </form>
              </div>
            ) : null}
          </div>

          <div className="card">
            <h2>Decision</h2>
            {spr.status === "Draft" ? <p className="muted">Not submitted yet.</p> : null}
            {spr.status === "Submitted" && spr.submittedAt ? (
              <div className="stack">
                <p>
                  Waiting for <strong data-testid="spr-assignee">{spr.assignedTo}</strong> since {formatDateTime(spr.submittedAt)} (
                  {Math.floor(hoursBetween(spr.submittedAt, now))} hours).
                </p>
                {spr.routingNote ? <div className="notice notice-info">{spr.routingNote}</div> : null}
                <form action={resendLinkAction}>
                  <input type="hidden" name="sprNo" value={sprNo} />
                  <button className="btn btn-secondary btn-small" type="submit" disabled={!isProductManager}>
                    Send a new approval link
                  </button>
                </form>
              </div>
            ) : null}
            {spr.decidedAt ? (
              <div className="stack">
                <p>
                  <strong>{spr.status}</strong> by {spr.decidedBy} on {formatDateTime(spr.decidedAt)}
                  {spr.submittedAt ? `, ${Math.round(hoursBetween(spr.submittedAt, spr.decidedAt))} hours after submission` : ""}.
                </p>
                <p>Remarks: {spr.decisionRemarks ?? "(none)"}</p>
              </div>
            ) : null}
            {spr.status === "Approved" ? (
              <Stub>
                Vendor PO: not created. After approval the SPR is only an approved SPR. Preparing a vendor PO draft for a person to approve before it is
                exported to Navision is a next step, not part of this proof of concept.
              </Stub>
            ) : null}
          </div>

          {jobs.length > 0 ? (
            <div className="card card-tight">
              <div className="card-title">Reminder schedule</div>
              <table className="table" data-testid="spr-jobs">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>What</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => (
                    <tr key={job.id}>
                      <td className="nowrap">{formatDateTime(job.dueAt)}</td>
                      <td>{JOB_LABELS[job.type] ?? job.type}</td>
                      <td>
                        <span className={`badge ${JOB_STATUS[job.status]?.badge ?? "badge-neutral"}`}>{JOB_STATUS[job.status]?.label ?? job.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted small" style={{ padding: "0 16px 12px" }}>
                Reminders run when someone presses &quot;Run due jobs&quot; or moves the demo clock. In AWS a schedule does this.
              </p>
            </div>
          ) : null}
        </div>

        <div>
          <div className="card">
            <h2>Evidence shown to the approver</h2>
            <SprEvidencePanel spr={spr} evidence={parseEvidence(spr)} />
          </div>

          <div className="card">
            <h2>Messages ({messages.length})</h2>
            {messages.length === 0 ? <p className="muted">No messages yet.</p> : null}
            {messages.map((message) => (
              <details key={message.id} style={{ marginBottom: 8 }}>
                <summary>
                  <span className="badge badge-info">{notificationLabel(message.type)}</span> to {message.toName}, {formatDateTime(message.createdAt)}
                </summary>
                <div className="card" style={{ marginTop: 8 }}>
                  <strong>{message.subject}</strong>
                  <MessageBody text={message.body} />
                </div>
              </details>
            ))}
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
