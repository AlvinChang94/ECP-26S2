// What: shows one flag: severity badge, title, plain-language reason, and the decision a person recorded (if any).
// Who calls it: the PO review, payment and shipment pages. Forms for acting on the flag are passed in as children.
// To extend: flags are data (src/domain/flags.ts); this component only decides how they look.
import type { ReactNode } from "react";
import { flagTitle, type FlagWithDecision, type Severity } from "@/domain/flags";
import { formatDateTime } from "@/domain/time";

const SEVERITY_LABELS: Record<Severity, string> = { blocking: "Blocking", warning: "Warning", info: "Note" };

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <span className={`badge badge-${severity}`}>{SEVERITY_LABELS[severity]}</span>;
}

export function FlagCard({ flag, children }: { flag: FlagWithDecision; children?: ReactNode }) {
  const decided = flag.decision !== null;
  return (
    <div className={decided ? "flag flag-decided" : `flag flag-${flag.severity}`} data-testid={`flag-${flag.code}`} data-decided={decided}>
      <div className="row">
        {decided ? <span className="badge badge-ok">{flag.decision?.kind === "override" ? "Accepted" : "Resolved"}</span> : <SeverityBadge severity={flag.severity} />}
        <strong>{flagTitle(flag.code)}</strong>
        <span className="muted mono small">{flag.code}</span>
      </div>
      <div style={{ marginTop: 4 }}>{flag.reason}</div>
      {flag.decision ? (
        <div className="muted small" style={{ marginTop: 4 }}>
          {flag.decision.kind === "override" ? "Accepted" : "Resolved"} by {flag.decision.byName} on {formatDateTime(flag.decision.at)}. Reason: {flag.decision.reason}
        </div>
      ) : null}
      {children ? <div style={{ marginTop: 8 }}>{children}</div> : null}
    </div>
  );
}
