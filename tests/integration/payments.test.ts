// What: integration tests for story 4: the payment board, proof matching, Confirm paid, reminders to late payers, vendor payments.
// Who calls it: `npm test`.
// To extend: proofs are built on the fly for the order under test, so amounts and references always fit the scenario.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LlmReader } from "@/adapters/extractor/llm";
import { confirmDocumentType, ingestDocument } from "@/services/intake";
import { runDueJobs } from "@/services/jobs";
import { listOutbox, sendDraft } from "@/services/outbox";
import {
  confirmPaid,
  draftPaymentReminder,
  editProofFields,
  getPaymentBoard,
  getPaymentDetail,
  linkProofToOrder,
  listVendorPayments,
  rewordReminderDraft,
} from "@/services/payments";
import { renderProofOfPayment } from "../../scripts/sample-data/pdfs";
import { exportedOrder } from "../helpers/flows";
import { createWorkspace, FARAH, SAM, type TestWorkspace } from "../helpers/workspace";

let workspace: TestWorkspace;
beforeEach(() => {
  workspace = createWorkspace();
});
afterEach(async () => {
  await workspace.cleanup();
});

/** The clean golden PO exported as ORD-1001: three lines, total USD 2,005.00, PI-1001, customer PO LT-PO-2240. */
const TOTAL = "2,005.00";

/** A proof of payment arrives and Finance confirms its type. Returns the proof id. */
async function proofArrives(options: { amount?: string; reference?: string; currency?: string; bankReference?: string } = {}): Promise<string> {
  const rendered = await renderProofOfPayment({
    layout: "A",
    payerName: "Lanka Tech Pte Ltd",
    amount: options.amount ?? TOTAL,
    currency: options.currency ?? "USD",
    paymentDate: "2026-11-16",
    reference: options.reference ?? "PI-1001",
    bankReference: options.bankReference ?? "TT-TEST-1",
  });
  const { documentId } = await ingestDocument(workspace.deps, FARAH, { bytes: rendered.bytes, fileName: `proof-${options.bankReference ?? "1"}.pdf`, channel: "whatsapp", sender: "Lanka Tech accounts" });
  const route = await confirmDocumentType(workspace.deps, FARAH, documentId, "proof_of_payment");
  return route.routedId as string;
}

describe("payment board", () => {
  it("shows an exported order as Awaiting with days waiting taken from the clock", async () => {
    const orderNo = await exportedOrder(workspace.deps);
    let board = await getPaymentBoard(workspace.deps);
    expect(board.rows.map((row) => [row.order.orderNo, row.state.status, row.state.daysWaiting])).toEqual([[orderNo, "awaiting", 0]]);
    expect(board.tiles).toMatchObject({ awaitingCount: 1, proofReceivedCount: 0, paidTodayCount: 0, lateCount: 0 });
    expect(board.tiles.awaitingTotals).toEqual([{ currency: "USD", amount: "2005.00" }]);

    workspace.clock.advanceHours(3 * 24 + 2);
    board = await getPaymentBoard(workspace.deps);
    expect(board.rows[0].state).toEqual({ status: "awaiting", daysWaiting: 3 });

    workspace.clock.advanceHours(5 * 24);
    board = await getPaymentBoard(workspace.deps);
    expect(board.rows[0].late).toBe(true);
    expect(board.tiles.lateCount).toBe(1);
  });

  it("does not list an order that has not been exported", async () => {
    expect((await getPaymentBoard(workspace.deps)).rows).toEqual([]);
  });
});

describe("proof of payment", () => {
  it("is matched to the PI by its reference and makes the order Proof received, not Paid", async () => {
    const orderNo = await exportedOrder(workspace.deps);
    await proofArrives();
    const detail = await getPaymentDetail(workspace.deps, orderNo);
    expect(detail.state.status).toBe("proof_received");
    expect(detail.proofs).toHaveLength(1);
    expect(detail.proofs[0]).toMatchObject({ summary: "Exact match", flags: [] });
    expect(detail.proofs[0].data).toMatchObject({ amount: TOTAL, currency: "USD", reference: "PI-1001" });
    expect(detail.needsReason).toBe(false);
    expect((await workspace.deps.db.order.findUnique({ where: { orderNo } }))?.paymentConfirmedAt).toBeNull();
  });

  it.each([
    ["short", "1,966.60", "Short by 38.40", "PAYMENT_SHORT"],
    ["over", "2,100.00", "Over by 95.00", "PAYMENT_OVER"],
  ])("a %s payment needs a reason before Finance can confirm", async (_name, amount, summary, code) => {
    const orderNo = await exportedOrder(workspace.deps);
    await proofArrives({ amount });
    const detail = await getPaymentDetail(workspace.deps, orderNo);
    expect(detail.proofs[0].summary).toBe(summary);
    expect(detail.proofs[0].flags.map((flag) => flag.code)).toEqual([code]);
    expect(detail.needsReason).toBe(true);

    await expect(confirmPaid(workspace.deps, FARAH, { orderNo, reason: "" })).rejects.toThrow(/does not match the proforma invoice exactly/);
    await confirmPaid(workspace.deps, FARAH, { orderNo, reason: "Difference agreed with the customer by phone" });
    const after = await getPaymentDetail(workspace.deps, orderNo);
    expect(after.state.status).toBe("paid");
    expect(after.order.paymentConfirmNote).toBe("Difference agreed with the customer by phone");
    // The finding on the proof now shows who accepted it and why.
    expect(after.proofs[0].flags[0].decision).toMatchObject({ kind: "override", byName: "Farah Lim", reason: "Difference agreed with the customer by phone" });
  });

  it("with a reference that names nothing stays unmatched until Finance links it by hand", async () => {
    const orderNo = await exportedOrder(workspace.deps);
    const proofId = await proofArrives({ reference: "OUR-REF-7781" });
    let board = await getPaymentBoard(workspace.deps);
    expect(board.rows[0].state.status).toBe("awaiting");
    expect(board.unmatched.map((proof) => proof.match.flags[0].code)).toEqual(["PAYMENT_REFERENCE_NOT_FOUND"]);

    await expect(linkProofToOrder(workspace.deps, SAM, { proofId, orderNo })).rejects.toThrow(/Only Finance/);
    await linkProofToOrder(workspace.deps, FARAH, { proofId, orderNo });
    board = await getPaymentBoard(workspace.deps);
    expect(board.unmatched).toEqual([]);
    const detail = await getPaymentDetail(workspace.deps, orderNo);
    expect(detail.state.status).toBe("proof_received");
    expect(detail.proofs[0].proof.linkedBy).toBe("Farah Lim");
    // The amount fits, but the reference did not: confirming still needs a reason.
    expect(detail.proofs[0].match.result).toBe("exact");
    expect(detail.needsReason).toBe(true);
  });

  it("is flagged as a duplicate when the same reference and amount arrive a second time", async () => {
    const orderNo = await exportedOrder(workspace.deps);
    await proofArrives({ bankReference: "TT-A" });
    await proofArrives({ bankReference: "TT-B" });
    const detail = await getPaymentDetail(workspace.deps, orderNo);
    expect(detail.proofs.map((proof) => proof.flags.map((flag) => flag.code))).toEqual([[], ["PAYMENT_DUPLICATE"]]);
    // The first proof is clean, so no reason is needed to confirm.
    expect(detail.needsReason).toBe(false);
  });

  it("is matched again after Finance corrects a value, with the correction in the audit log", async () => {
    const orderNo = await exportedOrder(workspace.deps);
    const proofId = await proofArrives({ amount: "2,050.00" });
    expect((await getPaymentDetail(workspace.deps, orderNo)).proofs[0].summary).toBe("Over by 45.00");

    await expect(editProofFields(workspace.deps, SAM, { proofId, changes: [{ field: "amount", value: TOTAL }] })).rejects.toThrow(/Only Finance/);
    expect(await editProofFields(workspace.deps, FARAH, { proofId, changes: [{ field: "amount", value: TOTAL }] })).toBe(1);
    const detail = await getPaymentDetail(workspace.deps, orderNo);
    expect(detail.proofs[0].summary).toBe("Exact match");
    expect(detail.proofs[0].edits[0]).toMatchObject({ field: "amount", oldValue: "2,050.00", newValue: TOTAL, actorName: "Farah Lim" });
  });
});

describe("Confirm paid", () => {
  it("records who confirmed and when, and notifies the warehouse", async () => {
    const orderNo = await exportedOrder(workspace.deps);
    await proofArrives();
    workspace.clock.advanceHours(26);
    await confirmPaid(workspace.deps, FARAH, { orderNo, reason: "" });

    const order = await workspace.deps.db.order.findUnique({ where: { orderNo } });
    expect(order).toMatchObject({ paymentConfirmedBy: "Farah Lim" });
    expect(order?.paymentConfirmedAt?.toISOString()).toBe(workspace.clock.now().toISOString());

    const [message] = await listOutbox(workspace.deps, { type: "warehouse_payment_confirmed" });
    expect(message).toMatchObject({ toName: "Warehouse team", toAddress: "warehouse@spectra.example", orderNo, channel: "chat" });
    expect(message.body).toContain("can be packed");

    const board = await getPaymentBoard(workspace.deps);
    expect(board.rows[0].state).toEqual({ status: "paid", daysWaiting: 1 });
    expect(board.tiles.paidTodayCount).toBe(1);
  });

  it("without any proof needs Finance to say how they know", async () => {
    const orderNo = await exportedOrder(workspace.deps);
    await expect(confirmPaid(workspace.deps, FARAH, { orderNo, reason: "" })).rejects.toThrow(/no proof of payment/);
    await confirmPaid(workspace.deps, FARAH, { orderNo, reason: "Seen on the bank statement of 16 Nov" });
    expect((await getPaymentDetail(workspace.deps, orderNo)).state.status).toBe("paid");
  });

  it("cannot be done twice", async () => {
    const orderNo = await exportedOrder(workspace.deps);
    await proofArrives();
    await confirmPaid(workspace.deps, FARAH, { orderNo, reason: "" });
    await expect(confirmPaid(workspace.deps, FARAH, { orderNo, reason: "" })).rejects.toThrow(/already confirmed as paid/);
    expect(await listOutbox(workspace.deps, { type: "warehouse_payment_confirmed" })).toHaveLength(1);
  });
});

describe("payment reminders for late payers", () => {
  it("drafts from the template, lets Finance edit, and only counts as sent after Finance clicks Send", async () => {
    const orderNo = await exportedOrder(workspace.deps);
    workspace.clock.advanceHours(9 * 24);
    const messageId = (await draftPaymentReminder(workspace.deps, FARAH, orderNo)) as number;
    let [draft] = await listOutbox(workspace.deps, { type: "customer_payment_reminder" });
    expect(draft).toMatchObject({ status: "draft", toName: "Lanka Tech Pte Ltd", toAddress: "orders@lankatech.example", sentAt: null });
    expect(draft.body).toContain("USD 2,005.00");
    expect(draft.body).toContain("PI-1001");
    expect(draft.body).toContain("9 days");

    await expect(sendDraft(workspace.deps, FARAH, messageId, { subject: "", body: "x" })).rejects.toThrow(/subject and a text/);
    await sendDraft(workspace.deps, FARAH, messageId, { subject: "Payment reminder for PI-1001", body: `${draft.body}\n\nP.S. Thank you.` });
    [draft] = await listOutbox(workspace.deps, { type: "customer_payment_reminder" });
    expect(draft).toMatchObject({ status: "sent", sentBy: "Farah Lim" });
    expect(draft.body).toContain("P.S. Thank you.");
    await expect(sendDraft(workspace.deps, FARAH, messageId, { subject: "again", body: "again" })).rejects.toThrow(/already sent/);
  });

  it("is drafted automatically once when an order becomes late, and never sent automatically", async () => {
    const orderNo = await exportedOrder(workspace.deps);
    // The unpaid order also gets a ship-date alert as its promised date comes near (story 6, tested in orderDashboard.test.ts).
    const reminderLines = async (): Promise<string[]> => (await runDueJobs(workspace.deps)).lines.filter((line) => line.includes("payment reminder"));
    workspace.clock.advanceHours(6 * 24);
    expect(await reminderLines()).toEqual([]);
    workspace.clock.advanceHours(2 * 24);
    expect(await reminderLines()).toEqual([`${orderNo}: payment reminder drafted for Finance to review (8 days waiting).`]);
    workspace.clock.advanceHours(24);
    expect(await reminderLines()).toEqual([]);
    const drafts = await listOutbox(workspace.deps, { type: "customer_payment_reminder" });
    expect(drafts.map((draft) => draft.status)).toEqual(["draft"]);
  });

  it("can only be drafted by Finance, and not for a paid order", async () => {
    const orderNo = await exportedOrder(workspace.deps);
    await expect(draftPaymentReminder(workspace.deps, SAM, orderNo)).rejects.toThrow(/Only Finance/);
    await confirmPaid(workspace.deps, FARAH, { orderNo, reason: "Seen on the bank statement" });
    await expect(draftPaymentReminder(workspace.deps, FARAH, orderNo)).rejects.toThrow(/already paid/);
  });

  describe("rewording by an LLM (optional)", () => {
    function withLlm(answer: unknown) {
      const llm: LlmReader = { readStructured: async <T>() => answer as T | null };
      return { ...workspace.deps, llm };
    }

    it("is refused when no LLM is configured", async () => {
      const orderNo = await exportedOrder(workspace.deps);
      const messageId = (await draftPaymentReminder(workspace.deps, FARAH, orderNo)) as number;
      await expect(rewordReminderDraft(workspace.deps, FARAH, messageId)).rejects.toThrow(/EXTRACTOR=llm/);
    });

    it("accepts new wording that keeps every fact, and it stays a draft", async () => {
      const orderNo = await exportedOrder(workspace.deps);
      const messageId = (await draftPaymentReminder(workspace.deps, FARAH, orderNo)) as number;
      const reworded =
        "Dear Lanka Tech Pte Ltd,\n\nWe hope you are well. Our records show that USD 2,005.00 for proforma invoice PI-1001 (your PO LT-PO-2240) has been open for 0 days. " +
        "We will pack and ship as soon as payment is confirmed. If you have paid already, kindly send us the proof of payment.\n\nWith thanks,\nFarah Lim\nSpectra Innovations";
      await rewordReminderDraft(withLlm({ text: reworded }), FARAH, messageId);
      const [draft] = await listOutbox(workspace.deps, { type: "customer_payment_reminder" });
      expect(draft.body).toBe(reworded);
      expect(draft.status).toBe("draft");
    });

    it.each([
      ["changes the amount", { text: "Dear Lanka Tech Pte Ltd, please pay USD 2,500.00 for PI-1001 today. It has been outstanding and we must insist. Regards, Farah Lim, Spectra Innovations. Thank you for your prompt attention to this." }],
      ["drops the PI number", { text: "Dear Lanka Tech Pte Ltd, please pay USD 2,005.00 for your invoice. It has been outstanding and we kindly ask you to settle it. Regards, Farah Lim, Spectra Innovations. Thank you very much." }],
      ["returns nothing", null],
      ["returns the wrong shape", { message: "hello" }],
    ])("keeps the template when the model %s", async (_name, answer) => {
      const orderNo = await exportedOrder(workspace.deps);
      const messageId = (await draftPaymentReminder(workspace.deps, FARAH, orderNo)) as number;
      const [before] = await listOutbox(workspace.deps, { type: "customer_payment_reminder" });
      await expect(rewordReminderDraft(withLlm(answer), FARAH, messageId)).rejects.toThrow(/reworded text was not used/);
      const [after] = await listOutbox(workspace.deps, { type: "customer_payment_reminder" });
      expect(after.body).toBe(before.body);
    });
  });
});

describe("vendor payment calendar", () => {
  /** Replaces the purchase orders in the workspace's Navision folder with one unpaid PO due on the given date. */
  function onePurchaseOrderDue(paymentDueDate: string, paid = false): void {
    const file = path.join(workspace.navisionDir, "purchaseOrders.json");
    const data = JSON.parse(readFileSync(file, "utf8"));
    data.purchaseOrders = [{ ...data.purchaseOrders[0], poNumber: "PO-5001", vendorName: "Alpha Supply", paymentDueDate, paid, totalAmount: "20200.00" }];
    writeFileSync(file, JSON.stringify(data));
  }

  it("lists payments due within seven days, from the purchase orders in Navision", async () => {
    onePurchaseOrderDue("2026-11-20"); // the test's "now" is Monday 16 Nov
    expect((await listVendorPayments(workspace.deps)).map((payment) => [payment.poNumber, payment.vendorName, payment.amount, payment.daysUntilDue])).toEqual([
      ["PO-5001", "Alpha Supply", "20200.00", 4],
    ]);
    onePurchaseOrderDue("2026-11-30");
    expect(await listVendorPayments(workspace.deps)).toEqual([]);
  });

  it("writes a reminder three days before and one day before the due date, each only once", async () => {
    onePurchaseOrderDue("2026-11-20");
    expect((await runDueJobs(workspace.deps)).lines).toEqual([]); // four days out: nothing yet

    workspace.clock.advanceHours(24); // Tuesday: three days out
    expect((await runDueJobs(workspace.deps)).lines).toEqual(["PO-5001: vendor payment reminder written (Alpha Supply, due in 3 days)."]);
    expect((await runDueJobs(workspace.deps)).lines).toEqual([]);

    workspace.clock.advanceHours(24); // Wednesday: two days out, the three-day reminder already went
    expect((await runDueJobs(workspace.deps)).lines).toEqual([]);

    workspace.clock.advanceHours(24); // Thursday: one day out
    expect((await runDueJobs(workspace.deps)).lines).toEqual(["PO-5001: vendor payment reminder written (Alpha Supply, due in 1 day)."]);

    const reminders = await listOutbox(workspace.deps, { type: "vendor_payment_due" });
    expect(reminders).toHaveLength(2);
    expect(reminders[0]).toMatchObject({ toName: "Farah Lim" });
    expect(reminders[0].body).toContain("USD 20,200.00 to Alpha Supply for PO-5001 is due on 20 Nov 2026 (in 1 day)");
    expect((await listVendorPayments(workspace.deps))[0].remindersWritten.map((reminder) => reminder.daysBefore)).toEqual([3, 1]);
  });

  it("writes no reminder for a purchase order that is already paid", async () => {
    onePurchaseOrderDue("2026-11-17", true);
    expect((await runDueJobs(workspace.deps)).lines).toEqual([]);
    expect(await listVendorPayments(workspace.deps)).toEqual([]);
  });
});
