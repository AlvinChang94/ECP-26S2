// What: server actions for SPRs: create (and optionally submit), submit a draft, send a new approval link.
// Who calls it: the forms on /spr/new and /spr/[sprNo].
// To extend: approval itself does not happen here; it comes through the signed link (src/app/approve/[token]).
"use server";

import { formNumber, formText, runAction } from "@/app/_lib/forms";
import { actorOf, requirePersona } from "@/app/_lib/session";
import { getDeps } from "@/services/deps";
import { createSpr, resendApprovalLink, submitSpr } from "@/services/spr";

export async function createSprAction(formData: FormData): Promise<void> {
  const persona = await requirePersona();
  const partNo = formText(formData, "partNo");
  const orderNo = formText(formData, "orderNo");
  const quantityText = formText(formData, "quantity");
  // On a mistake the person comes back to the same pre-filled form.
  const back = `/spr/new?partNo=${encodeURIComponent(partNo)}&quantity=${encodeURIComponent(quantityText)}${orderNo ? `&orderNo=${encodeURIComponent(orderNo)}` : ""}`;
  await runAction(back, async () => {
    const deps = await getDeps();
    const actor = actorOf(persona);
    const sprNo = await createSpr(deps, actor, { partNo, quantity: formNumber(formData, "quantity"), reason: formText(formData, "reason"), sourceOrderNo: orderNo || null });
    if (formText(formData, "intent") === "submit") {
      await submitSpr(deps, actor, sprNo);
      return { goTo: `/spr/${sprNo}`, notice: `${sprNo} was submitted. The approval link is in the Outbox.` };
    }
    return { goTo: `/spr/${sprNo}`, notice: `${sprNo} was saved as a draft.` };
  });
}

export async function submitSprAction(formData: FormData): Promise<void> {
  const persona = await requirePersona();
  const sprNo = formText(formData, "sprNo");
  await runAction(`/spr/${sprNo}`, async () => {
    await submitSpr(await getDeps(), actorOf(persona), sprNo);
    return { notice: `${sprNo} was submitted. The approval link is in the Outbox.` };
  });
}

export async function resendLinkAction(formData: FormData): Promise<void> {
  const persona = await requirePersona();
  const sprNo = formText(formData, "sprNo");
  await runAction(`/spr/${sprNo}`, async () => {
    await resendApprovalLink(await getDeps(), actorOf(persona), sprNo);
    return { notice: "A new approval link was written to the Outbox." };
  });
}
