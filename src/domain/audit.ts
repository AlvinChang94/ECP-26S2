// What: who can act (roles, actors) and the list of audit actions the system records.
// Who calls it: services build audit events with these names; pages show role labels and timelines.
// To extend: add an action name to AUDIT_ACTIONS before recording a new kind of event.
import type { StaffRole } from "./navision";

/** The five staff roles from the deck, plus "system" for things the rules did by themselves (never a decision). */
export type ActorRole = StaffRole | "system";

export type Actor = { name: string; role: ActorRole };

export const SYSTEM_ACTOR: Actor = { name: "OrderFlow (system)", role: "system" };

export const ROLE_LABELS: Record<ActorRole, string> = {
  sales: "Sales team member",
  product_manager: "Product manager",
  approver: "Approver (Janet)",
  finance: "Finance",
  purchase: "Purchase team",
  system: "System",
};

export const AUDIT_ACTIONS = [
  // documents
  "document_received",
  "type_confirmed",
  "type_changed",
  "field_edit",
  "field_undo",
  "flag_override",
  "flag_resolution",
  "alias_remembered",
  "alias_removed",
  // orders
  "order_created",
  "customer_card_proposed",
  "export_approved",
  "po_amended",
  "order_cancelled",
  "delivery_recorded",
  "pi_downloaded",
  // SPR
  "spr_created",
  "spr_submitted",
  "spr_reminder_sent",
  "spr_escalated",
  "spr_approved",
  "spr_rejected",
  "spr_link_rejected",
  // payments
  "proof_matched",
  "proof_linked",
  "payment_confirmed",
  "payment_reminder_drafted",
  "payment_reminder_sent",
  "vendor_payment_reminder",
  // shipments
  "shipment_created",
  "shipment_document_added",
  "shipment_checked",
  "document_requested",
  "shipment_assigned",
  "due_date_alert",
  // order dashboard
  "ship_date_alert",
  // system
  "jobs_run",
  "clock_changed",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type AuditEntityType = "document" | "order" | "spr" | "payment" | "shipment" | "alias" | "outbox" | "system";

/** What a service hands to recordAudit(). `at` is filled in from the Clock by the service. */
export type AuditInput = {
  actor: Actor;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string;
  summary: string; // plain sentence for timelines, for example "Sam Tan changed Line 1: Part no. from AB-1234X to AB1234X"
  orderNo?: string | null;
  field?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  reason?: string | null;
};

/** One row of a timeline, already in display form. */
export type TimelineEntry = {
  id: number;
  at: Date;
  actorName: string;
  actorRole: string;
  action: string;
  summary: string;
  reason: string | null;
};
