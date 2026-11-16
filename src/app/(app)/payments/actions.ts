// What: server actions for Finance: confirm a payment, link or correct a proof, draft, reword and send a payment reminder.
// Who calls it: the forms on /payments and /payments/[orderNo].
// To extend: "Confirm paid" must stay a deliberate click by Finance. Never call confirmPaid from a job or from matching.
"use server";

import { formNumber, formText, runAction } from "@/app/_lib/forms";
import { actorOf, requirePersona } from "@/app/_lib/session";
import { getDeps } from "@/services/deps";
import { UserError } from "@/services/errors";
import { sendDraft } from "@/services/outbox";
import { confirmPaid, draftPaymentReminder, editProofFields, linkProofToOrder, rewordReminderDraft } from "@/services/payments";

export async function confirmPaidAction(formData: FormData): Promise<void> {
  const persona = await requirePersona();
  const orderNo = formText(formData, "orderNo");
  await runAction(`/payments/${orderNo}`, async () => {
    await confirmPaid(await getDeps(), actorOf(persona), { orderNo, reason: formText(formData, "reason") });
    return { notice: `Payment for ${orderNo} confirmed. The warehouse has been notified (see the Outbox).` };
  });
}

export async function linkProofAction(formData: FormData): Promise<void> {
  const persona = await requirePersona();
  await runAction("/payments", async () => {
    const orderNo = formText(formData, "orderNo");
    if (!orderNo) throw new UserError("Choose the order this proof pays.");
    await linkProofToOrder(await getDeps(), actorOf(persona), { proofId: formText(formData, "proofId"), orderNo });
    return { goTo: `/payments/${orderNo}`, notice: "Proof linked. Check the amounts, then confirm with a reason." };
  });
}

/** Saves every input named "field:<key>" for one proof. */
export async function editProofAction(formData: FormData): Promise<void> {
  const persona = await requirePersona();
  const orderNo = formText(formData, "orderNo");
  await runAction(orderNo ? `/payments/${orderNo}` : "/payments", async () => {
    const changes: { field: string; value: string | null }[] = [];
    for (const [name, value] of formData.entries()) {
      if (name.startsWith("field:") && typeof value === "string") changes.push({ field: name.slice("field:".length), value });
    }
    const changed = await editProofFields(await getDeps(), actorOf(persona), { proofId: formText(formData, "proofId"), changes });
    return { notice: changed === 0 ? "Nothing was changed." : `Saved ${changed} correction${changed === 1 ? "" : "s"} and matched the proof again.` };
  });
}

export async function draftReminderAction(formData: FormData): Promise<void> {
  const persona = await requirePersona();
  const orderNo = formText(formData, "orderNo");
  await runAction(`/payments/${orderNo}`, async () => {
    await draftPaymentReminder(await getDeps(), actorOf(persona), orderNo);
    return { notice: "Reminder drafted from the template. Review it below, then click Send." };
  });
}

export async function rewordReminderAction(formData: FormData): Promise<void> {
  const persona = await requirePersona();
  const orderNo = formText(formData, "orderNo");
  await runAction(`/payments/${orderNo}`, async () => {
    await rewordReminderDraft(await getDeps(), actorOf(persona), formNumber(formData, "messageId") ?? -1);
    return { notice: "The draft was reworded. Review it before sending." };
  });
}

export async function sendReminderAction(formData: FormData): Promise<void> {
  const persona = await requirePersona();
  const orderNo = formText(formData, "orderNo");
  await runAction(`/payments/${orderNo}`, async () => {
    if (persona.role !== "finance") throw new UserError("Only Finance can send a payment reminder.");
    await sendDraft(await getDeps(), actorOf(persona), formNumber(formData, "messageId") ?? -1, {
      subject: formText(formData, "subject"),
      body: formText(formData, "body"),
    });
    return { notice: "Reminder sent (written to the Outbox)." };
  });
}
