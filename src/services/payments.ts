// What: story 4. Proofs of payment matched to PIs, the payment board, Confirm paid (Finance only), reminders for late payers and vendor payments.
// Who calls it: the payments pages and actions, the intake router (a confirmed proof of payment), runDueJobs, the seed and the replay.
// To extend: matching rules are in src/domain/payment/matching.ts. Nothing in this file ever marks an order paid except confirmPaid().
import { z } from "zod";
import type { DocumentRow, OrderRow, OutboxMessageRow, PaymentProofRow } from "@/adapters/db";
import type { Actor } from "@/domain/audit";
import type { ExtractedField } from "@/domain/documents";
import type { FieldEdit, FieldValues } from "@/domain/fields";
import { attachDecisions, type FlagWithDecision, unresolvedBlocking, validateDecisionInput } from "@/domain/flags";
import { displayMoney, formatMoney, parseMoney, sumMoney } from "@/domain/money";
import { buildCustomerPaymentReminder, buildVendorPaymentDue, buildWarehousePaymentConfirmed } from "@/domain/notifications";
import { describeMatch, matchProof, type MatchResult, type OpenInvoice, type PriorProof, type ProofData, toProofData } from "@/domain/payment/matching";
import { derivePaymentState, isLatePayer, type PaymentState, type VendorPaymentDue, vendorPaymentsDue, vendorReminderDue } from "@/domain/payment/status";
import { businessDate } from "@/domain/time";
import { recordAudit } from "./audit";
import type { Deps } from "./deps";
import { editDocumentField } from "./documentEdit";
import { loadDocument } from "./documents";
import { requireThat, UserError } from "./errors";
import { getOrder } from "./orders";
import { listFlagDecisions } from "./poReview";

const SYSTEM: Actor = { name: "OrderFlow (system)", role: "system" };

/** Finance means a person with the Finance role. The system actor is deliberately not accepted. */
function requireFinance(actor: Actor): void {
  if (actor.role !== "finance") {
    throw new UserError("Only Finance can do this. Switch persona to continue.");
  }
}

// ------------------------------------------------------------------------------------- invoices and proofs

function invoiceOf(order: OrderRow): OpenInvoice | null {
  if (!order.piNumber || !order.totalAmount) return null;
  return {
    orderNo: order.orderNo,
    piNumber: order.piNumber,
    poNumber: order.poNumber,
    customerName: order.customerName ?? "",
    currency: order.currency ?? "USD",
    amount: order.totalAmount,
  };
}

/** PIs that were issued and are not yet confirmed paid. */
export async function listOpenInvoices(deps: Pick<Deps, "db">): Promise<OpenInvoice[]> {
  const orders = await deps.db.order.findMany({ where: { status: "open", piNumber: { not: null }, paymentConfirmedAt: null }, orderBy: { orderNo: "asc" } });
  return orders.map(invoiceOf).filter((invoice): invoice is OpenInvoice => invoice !== null);
}

export type EvaluatedProof = {
  proof: PaymentProofRow;
  document: DocumentRow;
  fields: ExtractedField[];
  values: FieldValues;
  edits: FieldEdit[];
  data: ProofData;
  match: MatchResult;
  flags: FlagWithDecision[];
  /** "Exact match", "Short by 80.00", ... */
  summary: string;
};

/** Reads a proof's current values and matches it again. Always computed fresh, so a corrected value shows at once. */
export async function evaluateProof(deps: Pick<Deps, "db">, proof: PaymentProofRow): Promise<EvaluatedProof> {
  const loaded = await loadDocument(deps, proof.documentId);
  const data = toProofData(loaded.values);

  const invoices = await listOpenInvoices(deps);
  // The proof's own order stays comparable after it was paid, so the evidence can still be shown.
  const ownOrder = proof.orderNo ? await deps.db.order.findUnique({ where: { orderNo: proof.orderNo } }) : null;
  const ownInvoice = ownOrder ? invoiceOf(ownOrder) : null;
  if (ownInvoice && !invoices.some((invoice) => invoice.orderNo === ownInvoice.orderNo)) invoices.push(ownInvoice);

  // Earlier proofs only: the first copy of a payment is never the duplicate.
  // Proofs are put in one fixed order (time, then id) so two that arrive in the same instant still have a first and a second.
  const allProofs = await deps.db.paymentProof.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const earlierRows = allProofs.slice(0, Math.max(0, allProofs.findIndex((candidate) => candidate.id === proof.id)));
  const priorProofs: PriorProof[] = [];
  for (const earlier of earlierRows) {
    const earlierData = toProofData((await loadDocument(deps, earlier.documentId)).values);
    priorProofs.push({ reference: earlierData.reference, amount: earlierData.amount, currency: earlierData.currency, payerName: earlierData.payerName });
  }

  const match = matchProof(data, invoices, priorProofs, proof.linkedBy ? ownInvoice : null);
  const decisions = await listFlagDecisions(deps, "document", proof.documentId);
  return {
    proof,
    document: loaded.document,
    fields: loaded.fields,
    values: loaded.values,
    edits: loaded.edits,
    data,
    match,
    flags: attachDecisions(match.flags, decisions),
    summary: describeMatch(match),
  };
}

/** Stores what the current values match to. Called after a proof is registered, corrected or linked. */
export async function refreshProofMatch(deps: Pick<Deps, "db">, proofId: string): Promise<EvaluatedProof> {
  const proof = await deps.db.paymentProof.findUnique({ where: { id: proofId } });
  requireThat(proof, "That proof of payment no longer exists.");
  const evaluated = await evaluateProof(deps, proof);
  const orderNo = proof.linkedBy ? proof.orderNo : (evaluated.match.invoice?.orderNo ?? null);
  const updated = await deps.db.paymentProof.update({ where: { id: proofId }, data: { orderNo, matchResult: evaluated.match.result } });
  return { ...evaluated, proof: updated };
}

/** Routes a confirmed proof-of-payment document: match it to a PI by its reference. It is evidence only; nothing is marked paid. */
export async function registerProof(deps: Pick<Deps, "db" | "clock">, actor: Actor, document: DocumentRow): Promise<{ proofId: string; orderNo: string | null }> {
  const created = await deps.db.paymentProof.create({ data: { documentId: document.id, matchResult: "no_match", createdAt: deps.clock.now() } });
  const evaluated = await refreshProofMatch(deps, created.id);
  const invoice = evaluated.match.invoice;
  await recordAudit(deps, {
    actor,
    action: "proof_matched",
    entityType: "payment",
    entityId: created.id,
    orderNo: invoice?.orderNo ?? null,
    summary: invoice
      ? `Proof of payment ${document.fileName} was matched to ${invoice.piNumber} (${invoice.orderNo}): ${evaluated.summary}. Finance still has to confirm that the money arrived.`
      : `Proof of payment ${document.fileName} could not be matched to an order: ${evaluated.match.flags[0]?.reason ?? "no reference"}`,
  });
  return { proofId: created.id, orderNo: evaluated.proof.orderNo };
}

/** Undoes registerProof when a person changes the document's type. Not possible once the order was confirmed paid. */
export async function detachProof(deps: Pick<Deps, "db">, _actor: Actor, document: DocumentRow): Promise<void> {
  const proof = await deps.db.paymentProof.findUnique({ where: { documentId: document.id } });
  if (!proof) return;
  const order = proof.orderNo ? await deps.db.order.findUnique({ where: { orderNo: proof.orderNo } }) : null;
  requireThat(!order?.paymentConfirmedAt, "This proof belongs to an order that Finance already confirmed as paid, so its type can no longer be changed.");
  await deps.db.paymentProof.delete({ where: { id: proof.id } });
}

/** Finance links a proof to an order by hand, when its reference did not identify one. */
export async function linkProofToOrder(deps: Pick<Deps, "db" | "clock">, actor: Actor, input: { proofId: string; orderNo: string }): Promise<void> {
  requireFinance(actor);
  const order = await getOrder(deps, input.orderNo);
  requireThat(order.piNumber, `${input.orderNo} has no proforma invoice yet, so a payment cannot be linked to it.`);
  requireThat(!order.paymentConfirmedAt, `${input.orderNo} is already confirmed as paid.`);
  const proof = await deps.db.paymentProof.findUnique({ where: { id: input.proofId } });
  requireThat(proof, "That proof of payment no longer exists.");
  await deps.db.paymentProof.update({ where: { id: proof.id }, data: { orderNo: order.orderNo, linkedBy: actor.name } });
  const evaluated = await refreshProofMatch(deps, proof.id);
  await recordAudit(deps, {
    actor,
    action: "proof_linked",
    entityType: "payment",
    entityId: proof.id,
    orderNo: order.orderNo,
    summary: `${actor.name} linked proof ${evaluated.document.fileName} to ${order.piNumber} (${order.orderNo}) by hand: ${evaluated.summary}.`,
  });
}

/** Finance corrects values the reader got wrong on a proof. Each change is an audit event; the match is worked out again. */
export async function editProofFields(
  deps: Pick<Deps, "db" | "clock">,
  actor: Actor,
  input: { proofId: string; changes: { field: string; value: string | null }[] },
): Promise<number> {
  requireFinance(actor);
  const proof = await deps.db.paymentProof.findUnique({ where: { id: input.proofId } });
  requireThat(proof, "That proof of payment no longer exists.");
  let changed = 0;
  for (const change of input.changes) {
    if ((await editDocumentField(deps, actor, { documentId: proof.documentId, field: change.field, value: change.value, orderNo: proof.orderNo })).changed) changed++;
  }
  if (changed > 0) await refreshProofMatch(deps, proof.id);
  return changed;
}

// ------------------------------------------------------------------------------------- the payment board

export type PaymentRow = {
  order: OrderRow;
  state: PaymentState;
  late: boolean;
  proofs: EvaluatedProof[];
};

export type PaymentBoard = {
  rows: PaymentRow[];
  /** Proofs whose reference identified no order. */
  unmatched: EvaluatedProof[];
  tiles: { awaitingCount: number; awaitingTotals: { currency: string; amount: string }[]; proofReceivedCount: number; paidTodayCount: number; lateCount: number };
};

async function paymentRow(deps: Pick<Deps, "db" | "clock" | "config">, order: OrderRow): Promise<PaymentRow> {
  const proofRows = await deps.db.paymentProof.findMany({ where: { orderNo: order.orderNo }, orderBy: { createdAt: "asc" } });
  const proofs: EvaluatedProof[] = [];
  for (const proof of proofRows) proofs.push(await evaluateProof(deps, proof));
  const state = derivePaymentState({ piIssuedAt: order.piIssuedAt, paymentConfirmedAt: order.paymentConfirmedAt, hasProof: proofs.length > 0 }, deps.clock.now());
  return { order, state, late: isLatePayer(state, deps.config.latePaymentAfterDays), proofs };
}

const BOARD_ORDER: Record<string, number> = { proof_received: 0, awaiting: 1, paid: 2, not_invoiced: 3 };

/** Every exported, open order with its payment status and days waiting. Proofs waiting for Finance come first. */
export async function getPaymentBoard(deps: Pick<Deps, "db" | "clock" | "config">): Promise<PaymentBoard> {
  const orders = await deps.db.order.findMany({ where: { status: "open", piNumber: { not: null } }, orderBy: { orderNo: "asc" } });
  const rows: PaymentRow[] = [];
  for (const order of orders) rows.push(await paymentRow(deps, order));
  rows.sort((a, b) => BOARD_ORDER[a.state.status] - BOARD_ORDER[b.state.status] || (b.state.daysWaiting ?? 0) - (a.state.daysWaiting ?? 0));

  const unmatchedRows = await deps.db.paymentProof.findMany({ where: { orderNo: null }, orderBy: { createdAt: "asc" } });
  const unmatched: EvaluatedProof[] = [];
  for (const proof of unmatchedRows) unmatched.push(await evaluateProof(deps, proof));

  const awaiting = rows.filter((row) => row.state.status === "awaiting" || row.state.status === "proof_received");
  const totals = new Map<string, ReturnType<typeof sumMoney>>();
  for (const row of awaiting) {
    const amount = parseMoney(row.order.totalAmount);
    if (!amount) continue;
    const currency = row.order.currency ?? "USD";
    totals.set(currency, sumMoney([totals.get(currency) ?? sumMoney([]), amount]));
  }
  const today = businessDate(deps.clock.now());
  return {
    rows,
    unmatched,
    tiles: {
      awaitingCount: rows.filter((row) => row.state.status === "awaiting").length,
      awaitingTotals: [...totals.entries()].map(([currency, amount]) => ({ currency, amount: formatMoney(amount) })),
      proofReceivedCount: rows.filter((row) => row.state.status === "proof_received").length,
      paidTodayCount: rows.filter((row) => row.order.paymentConfirmedAt && businessDate(row.order.paymentConfirmedAt) === today).length,
      lateCount: rows.filter((row) => row.late).length,
    },
  };
}

export type PaymentDetail = PaymentRow & {
  invoice: OpenInvoice | null;
  /** True when Finance must give a reason to confirm: no proof, or no proof that matches exactly without open findings. */
  needsReason: boolean;
  reminders: OutboxMessageRow[];
};

function hasCleanProof(proofs: EvaluatedProof[]): boolean {
  return proofs.some((proof) => proof.match.result === "exact" && unresolvedBlocking(proof.flags).length === 0);
}

export async function getPaymentDetail(deps: Pick<Deps, "db" | "clock" | "config">, orderNo: string): Promise<PaymentDetail> {
  const order = await getOrder(deps, orderNo);
  const row = await paymentRow(deps, order);
  const reminders = await deps.db.outboxMessage.findMany({ where: { orderNo, type: "customer_payment_reminder" }, orderBy: { id: "desc" } });
  return { ...row, invoice: invoiceOf(order), needsReason: !hasCleanProof(row.proofs), reminders };
}

// ------------------------------------------------------------------------------------- Confirm paid

/**
 * Finance confirms that the money arrived. This is the ONLY place an order becomes Paid, and only Finance can call it.
 * Without a proof that matches exactly, a reason is required and stored. The warehouse is notified afterwards.
 * Invariant test: tests/invariants/paid-needs-finance.test.ts
 */
export async function confirmPaid(deps: Deps, actor: Actor, input: { orderNo: string; reason: string }): Promise<void> {
  requireFinance(actor);
  const detail = await getPaymentDetail(deps, input.orderNo);
  const { order } = detail;
  requireThat(order.status === "open", `${order.orderNo} is cancelled, so no payment can be confirmed for it.`);
  requireThat(order.piNumber, `${order.orderNo} has not been exported yet, so there is no proforma invoice to pay.`);
  requireThat(!order.paymentConfirmedAt, `${order.orderNo} was already confirmed as paid by ${order.paymentConfirmedBy}.`);

  const reason = input.reason.trim();
  if (detail.needsReason) {
    const problem = validateDecisionInput({ code: "PAYMENT_SHORT", canOverride: true }, { reason, byName: actor.name }, "override");
    if (problem) {
      throw new UserError(
        detail.proofs.length === 0
          ? "There is no proof of payment for this order. To confirm anyway, say how you know the money arrived (for example the bank statement date)."
          : `The proof does not match the proforma invoice exactly. ${problem}`,
      );
    }
  }

  const now = deps.clock.now();
  // Open findings on the proofs are accepted by this confirmation, with the same reason and name.
  for (const proof of detail.proofs) {
    for (const flag of unresolvedBlocking(proof.flags)) {
      if (!flag.canOverride) throw new UserError(`${flag.reason} Correct the proof's values first.`);
      await deps.db.flagDecision.create({
        data: { entityType: "document", entityId: proof.document.id, kind: "override", flagCode: flag.code, field: flag.field, fingerprint: flag.fingerprint, reason, byName: actor.name, byRole: actor.role, at: now },
      });
    }
  }
  await deps.db.order.update({
    where: { orderNo: order.orderNo },
    data: { paymentConfirmedAt: now, paymentConfirmedBy: actor.name, paymentConfirmNote: detail.needsReason ? reason : reason || null },
  });
  await recordAudit(deps, {
    actor,
    action: "payment_confirmed",
    entityType: "order",
    entityId: order.orderNo,
    orderNo: order.orderNo,
    reason: reason || null,
    summary:
      `${actor.name} confirmed that payment for ${order.piNumber} (${order.currency ?? "USD"} ${displayMoney(order.totalAmount)}) arrived` +
      (detail.proofs.length > 0 ? `. Evidence: ${detail.proofs.map((proof) => `${proof.document.fileName} (${proof.summary})`).join(", ")}.` : " without a proof document."),
  });

  // The warehouse is told once payment is confirmed. It is informed, not blocked: this message is the whole mechanism.
  const directory = await deps.navision.getStaffDirectory();
  await deps.notifier.send(
    buildWarehousePaymentConfirmed(directory.warehouseContact, {
      orderNo: order.orderNo,
      customerName: order.customerName ?? "",
      piNumber: order.piNumber,
      confirmedBy: actor.name,
      promisedShipDate: order.promisedShipDate,
    }),
  );
}

// ------------------------------------------------------------------------------------- reminders for late payers

/** Drafts a payment reminder from the template. It is only a draft: Finance reviews it and clicks Send. */
export async function draftPaymentReminder(deps: Deps, actor: Actor, orderNo: string, options: { automatic?: boolean } = {}): Promise<number | null> {
  if (!options.automatic) requireFinance(actor);
  const order = await getOrder(deps, orderNo);
  requireThat(order.piNumber && order.totalAmount, `${orderNo} has no proforma invoice yet.`);
  requireThat(!order.paymentConfirmedAt, `${orderNo} is already paid, so no reminder is needed.`);
  const state = derivePaymentState({ piIssuedAt: order.piIssuedAt, paymentConfirmedAt: null, hasProof: false }, deps.clock.now());
  const customer = order.customerName ? await deps.navision.getCustomerByName(order.customerName) : null;
  const directory = await deps.navision.getStaffDirectory();
  const sender = options.automatic ? (directory.staff.find((member) => member.role === "finance")?.name ?? "Finance") : actor.name;

  const message = buildCustomerPaymentReminder(
    { name: order.customerName ?? "Customer", email: customer?.email || "(no email address on the customer card)" },
    { orderNo, piNumber: order.piNumber, poNumber: order.poNumber, currency: order.currency ?? "USD", amount: order.totalAmount, daysWaiting: state.daysWaiting ?? 0, senderName: sender },
  );
  // The automatic draft is made once per order; drafts a person asks for are always made.
  const result = await deps.notifier.send(options.automatic ? { ...message, dedupeKey: `payment-nudge:${orderNo}` } : message);
  if (result.duplicate) return null;
  await recordAudit(deps, {
    actor,
    action: "payment_reminder_drafted",
    entityType: "outbox",
    entityId: String(result.id),
    orderNo,
    summary: `A payment reminder for ${order.piNumber} (${state.daysWaiting} days waiting) was drafted from the template. It waits for Finance to review and send.`,
  });
  return result.id;
}

const RewordSchema = z.object({ text: z.string() });

/**
 * Asks the LLM to reword a reminder draft. The model may only change the wording: the PI number, the amount and the
 * customer's name must still be in the text, otherwise the template text is kept. The result stays a draft.
 */
export async function rewordReminderDraft(deps: Pick<Deps, "db" | "clock" | "llm">, actor: Actor, messageId: number): Promise<void> {
  requireFinance(actor);
  requireThat(deps.llm, "Rewording needs the LLM to be switched on (EXTRACTOR=llm). The template text is used as it is.");
  const message = await deps.db.outboxMessage.findUnique({ where: { id: messageId } });
  requireThat(message && message.status === "draft" && message.orderNo, "Only a draft reminder can be reworded.");
  const order = await getOrder(deps, message.orderNo);
  const mustKeep = [order.piNumber ?? "", displayMoney(order.totalAmount), order.customerName ?? ""].filter((fact) => fact.length > 0);

  const answer = await deps.llm.readStructured({
    system:
      "You reword a payment reminder email so it reads politely and clearly. Keep every fact exactly as given: " +
      "names, invoice and PO numbers, the amount, the currency and the number of days. Do not add promises, deadlines, penalties or new facts.",
    user: `Reword this email. Return only the new text.\n\n${message.body}`,
    schema: RewordSchema,
  });
  const parsed = RewordSchema.safeParse(answer);
  const text = parsed.success ? parsed.data.text.trim() : "";
  const factsKept = mustKeep.every((fact) => text.includes(fact));
  const sensibleLength = text.length >= message.body.length * 0.5 && text.length <= message.body.length * 2;
  requireThat(text.length > 0 && factsKept && sensibleLength, "The reworded text was not used: it was missing or it changed a fact (PI number, amount or customer name). The template text is kept.");

  await deps.db.outboxMessage.update({ where: { id: messageId }, data: { body: text } });
  await recordAudit(deps, {
    actor,
    action: "payment_reminder_drafted",
    entityType: "outbox",
    entityId: String(messageId),
    orderNo: message.orderNo,
    oldValue: message.body,
    newValue: text,
    summary: `${actor.name} had the reminder draft for ${order.piNumber} reworded by the LLM. It is still a draft for Finance to review.`,
  });
}

/** Run by runDueJobs: drafts one reminder for each order that has become a late payer. A person still has to send it. */
export async function latePayerDraftSweep(deps: Deps): Promise<string[]> {
  const lines: string[] = [];
  const board = await getPaymentBoard(deps);
  for (const row of board.rows.filter((candidate) => candidate.late)) {
    const id = await draftPaymentReminder(deps, SYSTEM, row.order.orderNo, { automatic: true });
    if (id !== null) lines.push(`${row.order.orderNo}: payment reminder drafted for Finance to review (${row.state.daysWaiting} days waiting).`);
  }
  return lines;
}

// ------------------------------------------------------------------------------------- vendor payment calendar

export type VendorPaymentRow = VendorPaymentDue & { remindersWritten: { daysBefore: number; at: Date }[] };

/** Vendor payments due in the next seven days (from Navision purchase orders), with the reminders already written. */
export async function listVendorPayments(deps: Pick<Deps, "db" | "navision" | "clock" | "config">): Promise<VendorPaymentRow[]> {
  const due = vendorPaymentsDue(await deps.navision.listPurchaseOrders(), deps.clock.now());
  const rows: VendorPaymentRow[] = [];
  for (const payment of due) {
    const written = await deps.db.outboxMessage.findMany({ where: { type: "vendor_payment_due", entityId: payment.poNumber }, orderBy: { id: "asc" } });
    rows.push({
      ...payment,
      remindersWritten: written.map((message) => ({ daysBefore: Number(/:(\d+)d$/.exec(message.dedupeKey ?? "")?.[1] ?? 0), at: message.createdAt })),
    });
  }
  return rows;
}

/** Run by runDueJobs: writes the "3 days before" and "1 day before" reminders for vendor payments. Each is written once. */
export async function vendorPaymentReminderSweep(deps: Deps): Promise<string[]> {
  const lines: string[] = [];
  const directory = await deps.navision.getStaffDirectory();
  const finance = directory.staff.find((member) => member.role === "finance");
  if (!finance) return lines;
  for (const payment of vendorPaymentsDue(await deps.navision.listPurchaseOrders(), deps.clock.now())) {
    const reminderDaysBefore = vendorReminderDue(payment, deps.config.vendorPaymentReminderDays);
    if (reminderDaysBefore === null) continue;
    const result = await deps.notifier.send(
      buildVendorPaymentDue(finance, {
        poNumber: payment.poNumber,
        vendorName: payment.vendorName,
        currency: payment.currency,
        amount: payment.amount,
        dueDate: payment.dueDate,
        daysUntilDue: payment.daysUntilDue,
        reminderDaysBefore,
      }),
    );
    if (result.duplicate) continue;
    const line = `${payment.poNumber}: vendor payment reminder written (${payment.vendorName}, due in ${payment.daysUntilDue} day${payment.daysUntilDue === 1 ? "" : "s"}).`;
    lines.push(line);
    await recordAudit(deps, { actor: SYSTEM, action: "vendor_payment_reminder", entityType: "payment", entityId: payment.poNumber, summary: line });
  }
  return lines;
}
