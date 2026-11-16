// What: story 3. Create an SPR from a part number, send it for approval by a signed link, remind, hand over to the stand-in, record the decision.
// Who calls it: the SPR pages and actions, the public approval page, runDueJobs (reminders), the seed and the KPI replay.
// To extend: the rules (states, schedule, who decides) are in src/domain/spr. This file stores things and sends messages.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { SprRow } from "@/adapters/db";
import type { Actor } from "@/domain/audit";
import { sha256OfText } from "@/domain/hash";
import { formatMoney, parseQuantity, toMoney } from "@/domain/money";
import type { NavItem, NavVendor, StaffDirectory, StaffMember } from "@/domain/navision";
import { buildSprApprovalRequest, buildSprDecision, buildSprEscalation, buildSprReminder, type SprMessageData } from "@/domain/notifications";
import { toCustomerPo } from "@/domain/po/types";
import { createApprovalToken, verifyApprovalToken } from "@/domain/spr/approvalLink";
import { chooseAssignee, nextSprStatus, planReminders, type SprStatus, validateSprDraft } from "@/domain/spr/stateMachine";
import { type DemandLine, type SprSuggestion, suggestSprs } from "@/domain/spr/suggestions";
import { addHours, formatDateTime } from "@/domain/time";
import { recordAudit } from "./audit";
import { nextReference } from "./counters";
import type { Deps } from "./deps";
import { loadDocument } from "./documents";
import { requireThat, UserError } from "./errors";
import { getFulfilment } from "./fulfilment";

/** The part of a scheduled job the SPR handlers need (the full type lives in jobs.ts). */
type SprJob = { entityId: string; payloadJson: string };

// ------------------------------------------------------------------------------------- pre-fill from Navision

export type PartLookup = { item: NavItem; vendor: NavVendor | null; stockQty: number };

/** What Navision knows about a part number. Null when the part is not there: then nothing is filled in. */
export async function lookupPart(deps: Pick<Deps, "navision">, partNo: string): Promise<PartLookup | null> {
  const item = await deps.navision.getItem(partNo.trim());
  if (!item) return null;
  return { item, vendor: await deps.navision.getVendor(item.vendorId), stockQty: item.stockQty };
}

// ------------------------------------------------------------------------------------- evidence shown to the approver

const EvidenceSchema = z.object({
  capturedAt: z.string(),
  stockQty: z.number(),
  lastPurchasePrice: z.string(),
  currency: z.string(),
  demandQty: z.number(),
  openOrders: z.array(z.object({ orderRef: z.string(), customerName: z.string(), quantity: z.number() })),
  sourceOrder: z
    .object({
      orderNo: z.string(),
      poNumber: z.string().nullable(),
      customerName: z.string().nullable(),
      lines: z.array(z.object({ partNo: z.string().nullable(), quantity: z.string().nullable(), unitPrice: z.string().nullable() })),
    })
    .nullable(),
});
export type SprEvidence = z.infer<typeof EvidenceSchema>;

export function parseEvidence(spr: Pick<SprRow, "evidenceJson">): SprEvidence | null {
  if (!spr.evidenceJson) return null;
  const parsed = EvidenceSchema.safeParse(JSON.parse(spr.evidenceJson));
  return parsed.success ? parsed.data : null;
}

/** Every open order line that still needs units: Navision's own open orders plus the orders captured in OrderFlow. */
async function gatherDemand(deps: Pick<Deps, "db" | "navision">): Promise<DemandLine[]> {
  const demand: DemandLine[] = [];
  const orders = await deps.db.order.findMany({ where: { status: "open" }, orderBy: { orderNo: "asc" } });
  const capturedPoNumbers = new Set(orders.map((order) => order.poNumber).filter((poNumber): poNumber is string => poNumber !== null));

  for (const open of await deps.navision.listOpenOrders()) {
    // Once Navision has imported one of our exports it would list the order too; count it once.
    if (capturedPoNumbers.has(open.poNumber)) continue;
    for (const line of open.lines) {
      demand.push({ partNo: line.itemNo, quantity: line.quantity - line.shippedQty, orderRef: open.orderNo, customerName: open.customerName });
    }
  }

  for (const order of orders) {
    const customerName = order.customerName ?? "customer not read";
    const fulfilment = await getFulfilment(deps, order.orderNo);
    if (fulfilment) {
      for (const line of fulfilment.lines) demand.push({ partNo: line.itemNo, quantity: line.remaining, orderRef: order.orderNo, customerName });
      continue;
    }
    // Still a draft: count the lines whose part number is a Navision item.
    const version = order.currentPoVersionId ? await deps.db.poVersion.findUnique({ where: { id: order.currentPoVersionId } }) : null;
    if (!version || version.kind === "cancellation" || version.status !== "draft") continue;
    const po = toCustomerPo((await loadDocument(deps, version.documentId)).values);
    for (const line of po.lines) {
      const quantity = parseQuantity(line.quantity);
      if (line.removed || !line.partNo || quantity === null) continue;
      if (await deps.navision.getItem(line.partNo)) demand.push({ partNo: line.partNo, quantity, orderRef: order.orderNo, customerName });
    }
  }
  return demand.filter((line) => line.quantity > 0);
}

/** The list for "Suggested SPRs": parts where open orders need more than the stock on hand. */
export async function listSuggestedSprs(deps: Pick<Deps, "db" | "navision">): Promise<SprSuggestion[]> {
  const demand = await gatherDemand(deps);
  const stock: Record<string, number> = {};
  for (const partNo of new Set(demand.map((line) => line.partNo))) {
    const quantity = await deps.navision.getStock(partNo);
    if (quantity !== null) stock[partNo] = quantity;
  }
  const sprs = await deps.db.spr.findMany({ where: { status: { not: "Rejected" } } });
  return suggestSprs(
    demand,
    stock,
    sprs.map((spr) => ({ sprNo: spr.sprNo, partNo: spr.partNo, quantity: spr.quantity, status: spr.status })),
  );
}

async function buildEvidence(deps: Pick<Deps, "db" | "navision" | "clock">, spr: SprRow): Promise<SprEvidence> {
  const part = await lookupPart(deps, spr.partNo);
  const demand = (await gatherDemand(deps)).filter((line) => line.partNo === spr.partNo);
  let sourceOrder: SprEvidence["sourceOrder"] = null;
  if (spr.sourceOrderNo) {
    const order = await deps.db.order.findUnique({ where: { orderNo: spr.sourceOrderNo } });
    const version = order?.currentPoVersionId ? await deps.db.poVersion.findUnique({ where: { id: order.currentPoVersionId } }) : null;
    if (order && version) {
      const po = toCustomerPo((await loadDocument(deps, version.documentId)).values);
      sourceOrder = {
        orderNo: order.orderNo,
        poNumber: order.poNumber,
        customerName: order.customerName,
        lines: po.lines.filter((line) => !line.removed).map((line) => ({ partNo: line.partNo, quantity: line.quantity, unitPrice: line.unitPrice })),
      };
    }
  }
  return {
    capturedAt: deps.clock.now().toISOString(),
    stockQty: part?.stockQty ?? 0,
    lastPurchasePrice: part?.item.purchasePrice ?? spr.unitPrice,
    currency: spr.currency,
    demandQty: demand.reduce((sum, line) => sum + line.quantity, 0),
    openOrders: demand.map((line) => ({ orderRef: line.orderRef, customerName: line.customerName, quantity: line.quantity })),
    sourceOrder,
  };
}

// ------------------------------------------------------------------------------------- create and submit

function requireProductManager(actor: Actor): void {
  if (actor.role !== "product_manager" && actor.role !== "system") {
    throw new UserError("Only a product manager can raise or submit an SPR. Switch persona to continue.");
  }
}

export async function getSpr(deps: Pick<Deps, "db">, sprNo: string): Promise<SprRow> {
  const spr = await deps.db.spr.findUnique({ where: { sprNo } });
  if (!spr) throw new UserError(`${sprNo} does not exist.`);
  return spr;
}

export async function listSprs(deps: Pick<Deps, "db">): Promise<SprRow[]> {
  return deps.db.spr.findMany({ orderBy: { createdAt: "desc" } });
}

export type CreateSprInput = { partNo: string; quantity: number | null; reason: string; sourceOrderNo?: string | null };

/**
 * Creates a Draft SPR. Vendor and price come from Navision by part number; quantity and reason are what the
 * product manager typed. Nothing else is guessed, and a part that is not in Navision is refused.
 */
export async function createSpr(deps: Pick<Deps, "db" | "clock" | "navision" | "config">, actor: Actor, input: CreateSprInput): Promise<string> {
  requireProductManager(actor);
  const problem = validateSprDraft(input);
  if (problem) throw new UserError(problem);
  const part = await lookupPart(deps, input.partNo);
  requireThat(part, `Part ${input.partNo.trim()} is not in Navision, so vendor and price cannot be filled in. Check the part number.`);

  const sprNo = await nextReference(deps, "spr");
  await deps.db.spr.create({
    data: {
      sprNo,
      status: "Draft",
      partNo: part.item.itemNo,
      description: part.item.description,
      vendorId: part.item.vendorId,
      vendorName: part.vendor?.name ?? part.item.vendorId,
      unitPrice: part.item.purchasePrice,
      currency: part.item.currency,
      quantity: input.quantity as number,
      reason: input.reason.trim(),
      // Sell price and margin are optional extras; they are only kept when the feature flag is on.
      sellPrice: deps.config.showMargin ? part.item.price : null,
      sourceOrderNo: input.sourceOrderNo || null,
      requestedBy: actor.name,
      createdAt: deps.clock.now(),
    },
  });
  await recordAudit(deps, {
    actor,
    action: "spr_created",
    entityType: "spr",
    entityId: sprNo,
    orderNo: input.sourceOrderNo || null,
    summary: `${actor.name} raised ${sprNo}: ${input.quantity} x ${part.item.itemNo} from ${part.vendor?.name ?? part.item.vendorId} at ${part.item.currency} ${part.item.purchasePrice} (vendor and price filled from Navision).`,
  });
  return sprNo;
}

function staffByName(directory: StaffDirectory, name: string | null): StaffMember | null {
  return directory.staff.find((member) => member.name === name) ?? null;
}

/** Creates a fresh single-use link for one recipient and stores only its hash. */
async function issueApprovalLink(deps: Pick<Deps, "db" | "clock" | "config">, sprNo: string, recipient: StaffMember): Promise<{ url: string; expiresAt: Date }> {
  const now = deps.clock.now();
  const expiresAt = addHours(now, deps.config.approvalLinkTtlHours);
  const token = createApprovalToken({ sprNo, recipient: recipient.name, expiresAt: expiresAt.toISOString(), nonce: randomUUID() }, deps.config.approvalLinkSecret);
  await deps.db.approvalToken.create({ data: { sprNo, recipient: recipient.name, tokenHash: sha256OfText(token), issuedAt: now, expiresAt } });
  return { url: `${deps.config.appBaseUrl}/approve/${token}`, expiresAt };
}

async function messageData(deps: Pick<Deps, "db" | "clock" | "config">, spr: SprRow, recipient: StaffMember): Promise<SprMessageData> {
  const link = await issueApprovalLink(deps, spr.sprNo, recipient);
  const evidence = parseEvidence(spr);
  return {
    sprNo: spr.sprNo,
    partNo: spr.partNo,
    description: spr.description,
    vendorName: spr.vendorName,
    quantity: spr.quantity,
    unitPrice: spr.unitPrice,
    currency: spr.currency,
    totalAmount: formatMoney(toMoney(spr.unitPrice).times(spr.quantity)),
    reason: spr.reason,
    requestedBy: spr.requestedBy,
    stockQty: evidence?.stockQty ?? null,
    approvalUrl: link.url,
    linkExpiresAt: link.expiresAt,
  };
}

/** Draft to Submitted: decide who must approve, send them a signed link, and schedule the reminders. */
export async function submitSpr(deps: Deps, actor: Actor, sprNo: string): Promise<void> {
  requireProductManager(actor);
  const draft = await getSpr(deps, sprNo);
  const transition = nextSprStatus(draft.status as SprStatus, "submit");
  if (!transition.ok) throw new UserError(transition.error);

  const now = deps.clock.now();
  const directory = await deps.navision.getStaffDirectory();
  const assignment = chooseAssignee(directory, now);
  const evidence = await buildEvidence(deps, draft);
  const spr = await deps.db.spr.update({
    where: { sprNo },
    data: { status: transition.status, submittedAt: now, assignedTo: assignment.assignee.name, routingNote: assignment.note, evidenceJson: JSON.stringify(evidence) },
  });

  for (const step of planReminders(now)) {
    await deps.db.scheduledJob.create({
      data: {
        type: step.kind === "reminder" ? "spr_reminder" : "spr_escalation",
        dueAt: step.dueAt,
        status: "pending",
        entityType: "spr",
        entityId: sprNo,
        payloadJson: JSON.stringify({ afterHours: step.afterHours }),
        createdAt: now,
      },
    });
  }
  await deps.notifier.send(buildSprApprovalRequest(assignment.assignee, await messageData(deps, spr, assignment.assignee), assignment.note));
  await recordAudit(deps, {
    actor,
    action: "spr_submitted",
    entityType: "spr",
    entityId: sprNo,
    orderNo: spr.sourceOrderNo,
    summary: `${actor.name} submitted ${sprNo}. An approval link went to ${assignment.assignee.name}${assignment.toStandIn ? " (stand-in)" : ""}; reminders are set for 24, 48 and 72 hours.`,
    reason: assignment.note,
  });
}

/** Sends a new link to whoever must decide (for example when the earlier one expired). */
export async function resendApprovalLink(deps: Deps, actor: Actor, sprNo: string): Promise<void> {
  requireProductManager(actor);
  const spr = await getSpr(deps, sprNo);
  requireThat(spr.status === "Submitted", `${sprNo} is ${spr.status}; a link is only sent while an SPR waits for a decision.`);
  const directory = await deps.navision.getStaffDirectory();
  const assignee = staffByName(directory, spr.assignedTo);
  requireThat(assignee, `${spr.assignedTo} is no longer in the staff file.`);
  await deps.notifier.send(buildSprApprovalRequest(assignee, await messageData(deps, spr, assignee), spr.routingNote));
  await recordAudit(deps, {
    actor,
    action: "spr_reminder_sent",
    entityType: "spr",
    entityId: sprNo,
    orderNo: spr.sourceOrderNo,
    summary: `${actor.name} sent a new approval link for ${sprNo} to ${assignee.name}.`,
  });
}

// ------------------------------------------------------------------------------------- reminders (run by runDueJobs)

const SYSTEM: Actor = { name: "OrderFlow (system)", role: "system" };

function hoursFromPayload(job: SprJob): number {
  const payload = z.object({ afterHours: z.number() }).safeParse(JSON.parse(job.payloadJson));
  return payload.success ? payload.data.afterHours : 0;
}

/** 24 and 48 hours after submission: remind whoever must decide. If the approver has gone on leave, the stand-in takes over now. */
export async function sprReminderJob(deps: Deps, job: SprJob): Promise<string> {
  const spr = await getSpr(deps, job.entityId);
  if (spr.status !== "Submitted") return `${spr.sprNo}: no reminder, it is already ${spr.status}.`;
  const hours = hoursFromPayload(job);
  const directory = await deps.navision.getStaffDirectory();
  let assignee = staffByName(directory, spr.assignedTo);
  let current = spr;

  const assignment = chooseAssignee(directory, deps.clock.now());
  if (assignment.toStandIn && assignee?.id !== assignment.assignee.id) {
    assignee = assignment.assignee;
    current = await deps.db.spr.update({ where: { sprNo: spr.sprNo }, data: { assignedTo: assignee.name, routingNote: assignment.note } });
  }
  if (!assignee) return `${spr.sprNo}: no reminder, ${spr.assignedTo} is not in the staff file.`;

  await deps.notifier.send(buildSprReminder(assignee, await messageData(deps, current, assignee), hours));
  await recordAudit(deps, {
    actor: SYSTEM,
    action: "spr_reminder_sent",
    entityType: "spr",
    entityId: spr.sprNo,
    orderNo: spr.sourceOrderNo,
    summary: `Reminder sent to ${assignee.name}: ${spr.sprNo} has waited ${hours} hours for a decision.`,
  });
  return `${spr.sprNo}: ${hours}-hour reminder sent to ${assignee.name}.`;
}

/** 72 hours after submission: the SPR goes to the stand-in. */
export async function sprEscalationJob(deps: Deps, job: SprJob): Promise<string> {
  const spr = await getSpr(deps, job.entityId);
  if (spr.status !== "Submitted") return `${spr.sprNo}: no hand-over, it is already ${spr.status}.`;
  const hours = hoursFromPayload(job);
  const directory = await deps.navision.getStaffDirectory();
  const standIn = directory.staff.find((member) => member.id === directory.standInId);
  const approver = directory.staff.find((member) => member.id === directory.approverId);
  if (!standIn || !approver) return `${spr.sprNo}: no hand-over, the staff file names no stand-in.`;

  if (spr.assignedTo === standIn.name) {
    // It was already with the stand-in (planned leave): this is one more reminder.
    await deps.notifier.send(buildSprReminder(standIn, await messageData(deps, spr, standIn), hours));
    return `${spr.sprNo}: ${hours}-hour reminder sent to ${standIn.name}.`;
  }
  const note = `No decision from ${approver.name} after ${hours} hours, so ${spr.sprNo} went to ${standIn.name} as the stand-in.`;
  const updated = await deps.db.spr.update({ where: { sprNo: spr.sprNo }, data: { assignedTo: standIn.name, routingNote: note, escalatedAt: deps.clock.now() } });
  await deps.notifier.send(buildSprEscalation(standIn, await messageData(deps, updated, standIn), hours, approver.name));
  await recordAudit(deps, {
    actor: SYSTEM,
    action: "spr_escalated",
    entityType: "spr",
    entityId: spr.sprNo,
    orderNo: spr.sourceOrderNo,
    summary: note,
  });
  return `${spr.sprNo}: handed to the stand-in ${standIn.name} after ${hours} hours.`;
}

// ------------------------------------------------------------------------------------- the approval link

export type ApprovalView =
  | { state: "open"; spr: SprRow; evidence: SprEvidence | null; recipient: string; expiresAt: Date }
  | { state: "closed"; message: string; spr: SprRow | null };

const LINK_PROBLEMS = {
  malformed: "This approval link is not valid. Please use the link exactly as it was sent to you.",
  tampered: "This approval link is not valid. Please use the link exactly as it was sent to you.",
  expired: "This approval link has expired. Ask the product manager to send a new one.",
};

/** Checks a link without using it up. Returns what the approval page should show. */
export async function openApprovalLink(deps: Pick<Deps, "db" | "clock" | "config">, token: string): Promise<ApprovalView> {
  const check = verifyApprovalToken(token, deps.config.approvalLinkSecret, deps.clock.now());
  if (!check.ok) return { state: "closed", message: LINK_PROBLEMS[check.reason], spr: null };

  const row = await deps.db.approvalToken.findUnique({ where: { tokenHash: sha256OfText(token) } });
  const spr = await deps.db.spr.findUnique({ where: { sprNo: check.payload.sprNo } });
  if (!row || !spr) return { state: "closed", message: LINK_PROBLEMS.tampered, spr: null };
  if (spr.status !== "Submitted") {
    return {
      state: "closed",
      message: `${spr.sprNo} was already ${spr.status.toLowerCase()} by ${spr.decidedBy} on ${formatDateTime(spr.decidedAt)}. This link can no longer be used.`,
      spr,
    };
  }
  if (row.usedAt || row.revokedAt) return { state: "closed", message: "This approval link was already used and cannot be used again.", spr };
  return { state: "open", spr, evidence: parseEvidence(spr), recipient: row.recipient, expiresAt: row.expiresAt };
}

/**
 * Records the decision made through a link. The link must be genuine, unexpired and unused, and the SPR must still be waiting.
 * A decision uses up the link, revokes every other link for the SPR and cancels all pending reminders.
 */
export async function decideSpr(deps: Deps, token: string, input: { decision: "approve" | "reject"; remarks: string }): Promise<SprRow> {
  const view = await openApprovalLink(deps, token);
  if (view.state !== "open") {
    await recordAudit(deps, {
      actor: SYSTEM,
      action: "spr_link_rejected",
      entityType: "spr",
      entityId: view.spr?.sprNo ?? "unknown",
      summary: `An approval link was refused: ${view.message}`,
    });
    throw new UserError(view.message);
  }
  const remarks = input.remarks.trim();
  requireThat(input.decision === "approve" || remarks.length >= 3, "Please give a reason when rejecting, so the product manager knows what to change.");
  const transition = nextSprStatus(view.spr.status as SprStatus, input.decision);
  if (!transition.ok) throw new UserError(transition.error);

  const now = deps.clock.now();
  const spr = await deps.db.spr.update({
    where: { sprNo: view.spr.sprNo },
    data: { status: transition.status, decidedAt: now, decidedBy: view.recipient, decisionRemarks: remarks || null },
  });
  const tokenHash = sha256OfText(token);
  await deps.db.approvalToken.update({ where: { tokenHash }, data: { usedAt: now } });
  await deps.db.approvalToken.updateMany({ where: { sprNo: spr.sprNo, usedAt: null, revokedAt: null }, data: { revokedAt: now } });
  // A decision stops every reminder that has not run yet.
  await deps.db.scheduledJob.updateMany({ where: { entityType: "spr", entityId: spr.sprNo, status: "pending" }, data: { status: "cancelled" } });

  const directory = await deps.navision.getStaffDirectory();
  const requester = staffByName(directory, spr.requestedBy);
  if (requester) {
    await deps.notifier.send(
      buildSprDecision(requester, {
        sprNo: spr.sprNo,
        partNo: spr.partNo,
        quantity: spr.quantity,
        decision: transition.status === "Approved" ? "Approved" : "Rejected",
        decidedBy: view.recipient,
        remarks: remarks || null,
      }),
    );
  }
  await recordAudit(deps, {
    actor: { name: view.recipient, role: "approver" },
    action: transition.status === "Approved" ? "spr_approved" : "spr_rejected",
    entityType: "spr",
    entityId: spr.sprNo,
    orderNo: spr.sourceOrderNo,
    reason: remarks || null,
    summary: `${view.recipient} ${transition.status.toLowerCase()} ${spr.sprNo} (${spr.quantity} x ${spr.partNo}) through the approval link. Pending reminders were cancelled.`,
  });
  return spr;
}

/** The reminder jobs of an SPR, for showing the schedule on its page. */
export async function listSprJobs(deps: Pick<Deps, "db">, sprNo: string) {
  return deps.db.scheduledJob.findMany({ where: { entityType: "spr", entityId: sprNo }, orderBy: { dueAt: "asc" } });
}

/**
 * Reads the newest approval link for an SPR out of the Outbox, the way the recipient would open their email.
 * Used by the seed, the KPI replay and tests to play the approver; the app itself never needs it.
 */
export async function latestApprovalTokenFromOutbox(deps: Pick<Deps, "db">, sprNo: string): Promise<string | null> {
  const messages = await deps.db.outboxMessage.findMany({ where: { entityType: "spr", entityId: sprNo }, orderBy: { id: "desc" } });
  for (const message of messages) {
    const match = /\/approve\/([A-Za-z0-9_\-.]+)/.exec(message.body);
    if (match) return match[1];
  }
  return null;
}
