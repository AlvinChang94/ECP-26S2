// What: small badges for story 5: a shipment's status and the status of one required document (Present, Missing, Pending check).
// Who calls it: the shipments pages and the order page.
// To extend: statuses and their labels live in src/domain/shipment/assess.ts; this file only picks a colour.
import { CHECKLIST_STATUS_LABELS, type ChecklistStatus, SHIPMENT_STATUS_LABELS, type ShipmentStatus } from "@/domain/shipment/assess";

const STATUS_CLASS: Record<ShipmentStatus, string> = {
  needs_review: "badge badge-blocking",
  waiting: "badge badge-warning",
  resolved: "badge badge-ok",
  verified: "badge badge-ok",
};

export function ShipmentStatusBadge({ status }: { status: ShipmentStatus }) {
  return (
    <span className={STATUS_CLASS[status]} data-testid="shipment-status">
      {SHIPMENT_STATUS_LABELS[status]}
    </span>
  );
}

const CHECKLIST_CLASS: Record<ChecklistStatus, string> = {
  present: "badge badge-ok",
  missing: "badge badge-blocking",
  pending_check: "badge badge-warning",
};

export function ChecklistBadge({ status }: { status: ChecklistStatus }) {
  return <span className={CHECKLIST_CLASS[status]}>{CHECKLIST_STATUS_LABELS[status]}</span>;
}
