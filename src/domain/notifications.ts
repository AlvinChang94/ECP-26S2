// What: the list of notification types and the plain-text templates that build each message.
// Who calls it: services build a message here and hand it to the Notifier adapter (the POC writes it to the Outbox table).
// To extend: add a type to NOTIFICATION_TYPES, write a build...() function below, and call it from a service. See the guide recipe.
import { displayMoney } from "./money";
import { formatDate, formatDateTime } from "./time";

export const NOTIFICATION_TYPES = {
  spr_approval_request: "SPR approval request",
  spr_reminder: "SPR reminder",
  spr_escalation: "SPR sent to stand-in",
  spr_decision: "SPR decision",
  warehouse_payment_confirmed: "Warehouse: payment confirmed",
  customer_payment_reminder: "Customer payment reminder",
  vendor_payment_due: "Vendor payment due",
  document_due_alert: "Document due-date alert",
  document_request: "Document request",
  task_assigned: "Task assigned",
  ship_date_alert: "Ship-date alert",
} as const;

export type NotificationType = keyof typeof NOTIFICATION_TYPES;

/** "email" stands in for Amazon SES, "chat" for an SNS topic (for example a team channel). */
export type NotificationChannel = "email" | "chat";

export type OutgoingMessage = {
  type: NotificationType;
  channel: NotificationChannel;
  toName: string;
  toAddress: string;
  subject: string;
  body: string;
  /** "draft" means a person must review it and click Send. Default is "sent". */
  status?: "sent" | "draft";
  entityType?: string;
  entityId?: string;
  orderNo?: string | null;
  /** Set for reminders: the same key is never written twice, however often the job runs. */
  dedupeKey?: string;
};

type Recipient = { name: string; email: string };

function to(recipient: Recipient): Pick<OutgoingMessage, "toName" | "toAddress"> {
  return { toName: recipient.name, toAddress: recipient.email };
}

// ------------------------------------------------------------------ story 3: SPR

export type SprMessageData = {
  sprNo: string;
  partNo: string;
  description: string;
  vendorName: string;
  quantity: number;
  unitPrice: string;
  currency: string;
  totalAmount: string;
  reason: string;
  requestedBy: string;
  stockQty: number | null;
  approvalUrl: string;
  linkExpiresAt: Date;
};

function sprFacts(data: SprMessageData): string {
  return [
    `SPR: ${data.sprNo}`,
    `Part: ${data.partNo} (${data.description})`,
    `Vendor: ${data.vendorName}`,
    `Quantity: ${data.quantity} at ${data.currency} ${displayMoney(data.unitPrice)} each = ${data.currency} ${displayMoney(data.totalAmount)}`,
    `Stock on hand: ${data.stockQty === null ? "unknown" : data.stockQty}`,
    `Reason: ${data.reason}`,
    `Requested by: ${data.requestedBy}`,
    "",
    `Review the evidence and approve or reject here (no login needed):`,
    data.approvalUrl,
    `This link works once and expires on ${formatDateTime(data.linkExpiresAt)}.`,
  ].join("\n");
}

export function buildSprApprovalRequest(recipient: Recipient, data: SprMessageData, routingNote: string | null): OutgoingMessage {
  const intro = routingNote ? `${routingNote}\n\n` : "";
  return {
    type: "spr_approval_request",
    channel: "email",
    ...to(recipient),
    subject: `${data.sprNo}: approval needed for ${data.quantity} x ${data.partNo}`,
    body: `Hello ${recipient.name},\n\n${intro}An SPR is waiting for your decision.\n\n${sprFacts(data)}`,
    entityType: "spr",
    entityId: data.sprNo,
  };
}

export function buildSprReminder(recipient: Recipient, data: SprMessageData, hoursWaiting: number): OutgoingMessage {
  return {
    type: "spr_reminder",
    channel: "email",
    ...to(recipient),
    subject: `Reminder: ${data.sprNo} has waited ${hoursWaiting} hours for a decision`,
    body: `Hello ${recipient.name},\n\n${data.sprNo} was submitted ${hoursWaiting} hours ago and still needs a decision.\n\n${sprFacts(data)}`,
    entityType: "spr",
    entityId: data.sprNo,
    dedupeKey: `spr-reminder:${data.sprNo}:${hoursWaiting}h`,
  };
}

export function buildSprEscalation(standIn: Recipient, data: SprMessageData, hoursWaiting: number, approverName: string): OutgoingMessage {
  return {
    type: "spr_escalation",
    channel: "email",
    ...to(standIn),
    subject: `${data.sprNo} needs your decision as stand-in for ${approverName}`,
    body:
      `Hello ${standIn.name},\n\n${data.sprNo} has waited ${hoursWaiting} hours without a decision from ${approverName}, ` +
      `so it now comes to you as the stand-in.\n\n${sprFacts(data)}`,
    entityType: "spr",
    entityId: data.sprNo,
    dedupeKey: `spr-escalation:${data.sprNo}:${hoursWaiting}h`,
  };
}

export function buildSprDecision(
  requester: Recipient,
  data: { sprNo: string; partNo: string; quantity: number; decision: "Approved" | "Rejected"; decidedBy: string; remarks: string | null },
): OutgoingMessage {
  return {
    type: "spr_decision",
    channel: "email",
    ...to(requester),
    subject: `${data.sprNo} was ${data.decision.toLowerCase()} by ${data.decidedBy}`,
    body:
      `Hello ${requester.name},\n\n${data.sprNo} (${data.quantity} x ${data.partNo}) was ${data.decision.toLowerCase()} by ${data.decidedBy}.\n` +
      `Remarks: ${data.remarks && data.remarks.trim() ? data.remarks : "(none)"}\n\n` +
      (data.decision === "Approved"
        ? "Next step: the purchase team prepares the vendor PO. Nothing has been sent to the vendor or to Navision automatically."
        : "No purchase will be made for this SPR."),
    entityType: "spr",
    entityId: data.sprNo,
  };
}

// ------------------------------------------------------------------ story 4: payments

export function buildWarehousePaymentConfirmed(
  warehouse: Recipient,
  data: { orderNo: string; customerName: string; piNumber: string; confirmedBy: string; promisedShipDate: string | null },
): OutgoingMessage {
  return {
    type: "warehouse_payment_confirmed",
    channel: "chat",
    ...to(warehouse),
    subject: `${data.orderNo}: payment confirmed, ready to pack`,
    body:
      `Payment for ${data.orderNo} (${data.customerName}, ${data.piNumber}) was confirmed by ${data.confirmedBy} in Finance.\n` +
      `The order can be packed.` +
      (data.promisedShipDate ? ` Promised ship date: ${formatDate(data.promisedShipDate)}.` : ""),
    entityType: "order",
    entityId: data.orderNo,
    orderNo: data.orderNo,
    dedupeKey: `warehouse-paid:${data.orderNo}`,
  };
}

/**
 * The reminder text for a late payer. This template is the source of the wording; an LLM may only reword it,
 * and Finance always reviews the draft before clicking Send.
 */
export function buildCustomerPaymentReminder(
  customer: Recipient,
  data: { orderNo: string; piNumber: string; poNumber: string | null; currency: string; amount: string; daysWaiting: number; senderName: string },
): OutgoingMessage {
  return {
    type: "customer_payment_reminder",
    channel: "email",
    ...to(customer),
    subject: `Payment reminder for ${data.piNumber}`,
    body:
      `Dear ${customer.name},\n\n` +
      `This is a friendly reminder that payment of ${data.currency} ${displayMoney(data.amount)} for proforma invoice ${data.piNumber}` +
      (data.poNumber ? ` (your PO ${data.poNumber})` : "") +
      ` is still outstanding after ${data.daysWaiting} days.\n\n` +
      `Your order will be packed and shipped as soon as payment is confirmed. ` +
      `If you have already paid, please send us the proof of payment so we can match it.\n\n` +
      `Thank you,\n${data.senderName}\nSpectra Innovations`,
    status: "draft",
    entityType: "order",
    entityId: data.orderNo,
    orderNo: data.orderNo,
  };
}

export function buildVendorPaymentDue(
  finance: Recipient,
  data: {
    poNumber: string;
    vendorName: string;
    currency: string;
    amount: string;
    dueDate: string;
    /** Days from today to the due date (0 = today). Used in the wording. */
    daysUntilDue: number;
    /** Which reminder this is (3 = the "three days before" one). The same reminder is never written twice. */
    reminderDaysBefore: number;
  },
): OutgoingMessage {
  return {
    type: "vendor_payment_due",
    channel: "email",
    ...to(finance),
    subject: `Vendor payment due ${formatDate(data.dueDate)}: ${data.vendorName} ${data.currency} ${displayMoney(data.amount)}`,
    body:
      `Payment of ${data.currency} ${displayMoney(data.amount)} to ${data.vendorName} for ${data.poNumber} is due on ${formatDate(data.dueDate)} ` +
      `(${data.daysUntilDue === 0 ? "today" : `in ${data.daysUntilDue} day${data.daysUntilDue === 1 ? "" : "s"}`}).`,
    entityType: "payment",
    entityId: data.poNumber,
    dedupeKey: `vendor-payment:${data.poNumber}:${data.reminderDaysBefore}d`,
  };
}

// ------------------------------------------------------------------ story 5: shipments

export function buildDocumentDueAlert(
  owner: Recipient,
  data: { shipmentNo: string; reference: string; partyName: string; documentLabel: string; dueAt: Date; overdue: boolean; orderNo: string | null },
): OutgoingMessage {
  return {
    type: "document_due_alert",
    channel: "email",
    ...to(owner),
    subject: `${data.documentLabel} ${data.overdue ? "overdue" : "due soon"} for ${data.reference} (${data.partyName})`,
    body:
      `${data.documentLabel} is still missing for ${data.reference} (${data.partyName}, shipment ${data.shipmentNo}).\n` +
      `It ${data.overdue ? "was" : "is"} due on ${formatDateTime(data.dueAt)}.\n` +
      `Please request the document and record the outcome on the shipment page.`,
    entityType: "shipment",
    entityId: data.shipmentNo,
    orderNo: data.orderNo,
    dedupeKey: `doc-due:${data.shipmentNo}:${data.documentLabel}:${data.overdue ? "overdue" : "soon"}`,
  };
}

export function buildDocumentRequest(
  party: Recipient,
  data: { shipmentNo: string; reference: string; documentLabel: string; requestedBy: string; orderNo: string | null },
): OutgoingMessage {
  return {
    type: "document_request",
    channel: "email",
    ...to(party),
    subject: `Request: ${data.documentLabel} for ${data.reference}`,
    body:
      `Hello ${party.name},\n\nWe have not yet received the ${data.documentLabel} for ${data.reference}. ` +
      `Please send it as a PDF by reply.\n\nThank you,\n${data.requestedBy}\nSpectra Innovations`,
    entityType: "shipment",
    entityId: data.shipmentNo,
    orderNo: data.orderNo,
  };
}

export function buildTaskAssigned(
  assignee: Recipient,
  data: { shipmentNo: string; reference: string; assignedBy: string; summary: string; orderNo: string | null },
): OutgoingMessage {
  return {
    type: "task_assigned",
    channel: "email",
    ...to(assignee),
    subject: `Assigned to you: ${data.reference} (${data.shipmentNo})`,
    body: `Hello ${assignee.name},\n\n${data.assignedBy} assigned shipment ${data.shipmentNo} (${data.reference}) to you.\n${data.summary}`,
    entityType: "shipment",
    entityId: data.shipmentNo,
    orderNo: data.orderNo,
  };
}

// ------------------------------------------------------------------ story 6: order dashboard

export function buildShipDateAlert(
  owner: Recipient,
  data: { orderNo: string; customerName: string; promisedShipDate: string; statusLabel: string; blockerReason: string | null; nextAction: string },
): OutgoingMessage {
  return {
    type: "ship_date_alert",
    channel: "email",
    ...to(owner),
    subject: `${data.orderNo} may miss its promised ship date (${formatDate(data.promisedShipDate)})`,
    body:
      `${data.orderNo} for ${data.customerName} is promised to ship on ${formatDate(data.promisedShipDate)} and is still "${data.statusLabel}".\n` +
      (data.blockerReason ? `Reason: ${data.blockerReason}\n` : "") +
      `Next action: ${data.nextAction}`,
    entityType: "order",
    entityId: data.orderNo,
    orderNo: data.orderNo,
    dedupeKey: `ship-date:${data.orderNo}:${data.promisedShipDate}`,
  };
}
