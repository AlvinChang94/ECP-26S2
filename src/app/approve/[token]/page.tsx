// What: the page behind an SPR approval link (story 3). No login: it shows the evidence and takes approve or reject with remarks.
// Who calls it: Janet or her stand-in, by opening the link from the email (in the POC: from the Outbox).
// To extend: this page sits outside the (app) folder on purpose, so it has no sidebar and needs no persona.
import { readMessages } from "@/app/_lib/forms";
import { Notices } from "@/components/Notices";
import { SprEvidencePanel, SprFacts, SprStatusBadge } from "@/components/spr/SprFacts";
import { formatDateTime } from "@/domain/time";
import { getDeps } from "@/services/deps";
import { openApprovalLink } from "@/services/spr";
import { decideSprAction } from "./actions";

export default async function ApprovePage(props: PageProps<"/approve/[token]">) {
  const { token } = await props.params;
  const searchParams = await props.searchParams;
  const messages = readMessages(searchParams);
  const view = await openApprovalLink(await getDeps(), decodeURIComponent(token));

  if (view.state === "closed") {
    return (
      <div className="centered-page">
        <h1>SPR approval</h1>
        <Notices messages={messages} />
        {/* After a decision the person lands here again: the green notice above says thank you, this box says the link is spent. */}
        <div className={messages.notice ? "notice notice-info" : "notice notice-error"} data-testid="link-closed">
          {view.message}
        </div>
        {view.spr ? (
          <div className="card card-tight">
            <div className="card-title row" style={{ justifyContent: "space-between" }}>
              <span>{view.spr.sprNo}</span>
              <SprStatusBadge status={view.spr.status} />
            </div>
            <SprFacts spr={view.spr} />
          </div>
        ) : null}
      </div>
    );
  }

  const { spr, evidence, recipient, expiresAt } = view;
  return (
    <div className="centered-page">
      <h1>
        {spr.sprNo}: your decision, {recipient}
      </h1>
      <p className="subtitle">
        {spr.requestedBy} asks to buy {spr.quantity} x {spr.partNo}. This link works once and expires on {formatDateTime(expiresAt)}.
      </p>
      <Notices messages={messages} />

      <div className="card card-tight" style={{ marginTop: 16 }}>
        <div className="card-title">Request</div>
        <SprFacts spr={spr} />
      </div>

      <div className="card">
        <h2>Evidence</h2>
        <SprEvidencePanel spr={spr} evidence={evidence} />
      </div>

      <div className="card">
        <h2>Decision</h2>
        <form action={decideSprAction} className="stack">
          <input type="hidden" name="token" value={decodeURIComponent(token)} />
          <div className="field">
            <label htmlFor="remarks">Remarks (required when rejecting)</label>
            <textarea id="remarks" name="remarks" placeholder="For example: approved, please confirm the delivery date with the vendor" />
          </div>
          <div className="row">
            <button className="btn" type="submit" name="decision" value="approve" data-testid="approve-spr">
              Approve
            </button>
            <button className="btn btn-danger" type="submit" name="decision" value="reject" data-testid="reject-spr">
              Reject
            </button>
          </div>
          <p className="muted small">Your decision is recorded under the name {recipient}, with the time and your remarks. Nothing is ordered from the vendor automatically.</p>
        </form>
      </div>
    </div>
  );
}
