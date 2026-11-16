// What: server actions for one order: edit PO values, undo, accept suggestions, override flags, approve the export, cancel, record deliveries.
// Who calls it: the forms on the review, preview and order pages.
// To extend: keep each action to "read the form, call one service inside runAction()". Rules live in src/domain, work in src/services.
"use server";

import { formNumber, formText, runAction } from "@/app/_lib/forms";
import { actorOf, requirePersona } from "@/app/_lib/session";
import { lineKey, parseLineKey } from "@/domain/fields";
import { getDeps } from "@/services/deps";
import { recordDelivery } from "@/services/fulfilment";
import {
  acceptSuggestion,
  addLine,
  editField,
  editFields,
  overrideFlag,
  proposeCustomerCard,
  undoField,
  withdrawCustomerCard,
  withdrawOverride,
} from "@/services/poEdit";
import { approveAndExport, approveCancellation } from "@/services/poExport";

function reviewPath(orderNo: string): string {
  return `/orders/${orderNo}/review`;
}

/** Saves every input named "field:<key>" of the submitted form. Only values that really changed are recorded. */
export async function saveFieldsAction(formData: FormData): Promise<void> {
  const persona = await requirePersona();
  const orderNo = formText(formData, "orderNo");
  await runAction(reviewPath(orderNo), async () => {
    const remember = formData.get("rememberAlias") === "on";
    const changes: { field: string; value: string | null; rememberAlias?: boolean }[] = [];
    for (const [name, value] of formData.entries()) {
      if (!name.startsWith("field:") || typeof value !== "string") continue;
      const field = name.slice("field:".length);
      changes.push({ field, value, rememberAlias: remember && parseLineKey(field)?.name === "partNo" });
    }
    const changed = await editFields(await getDeps(), actorOf(persona), orderNo, changes);
    return { notice: changed === 0 ? "Nothing was changed." : `Saved ${changed} change${changed === 1 ? "" : "s"}. Each one is in the history below.` };
  });
}

export async function undoFieldAction(formData: FormData): Promise<void> {
  const persona = await requirePersona();
  const orderNo = formText(formData, "orderNo");
  await runAction(reviewPath(orderNo), async () => {
    await undoField(await getDeps(), actorOf(persona), { orderNo, field: formText(formData, "field") });
    return { notice: "The change was undone. The undo is recorded in the history too." };
  });
}

export async function acceptSuggestionAction(formData: FormData): Promise<void> {
  const persona = await requirePersona();
  const orderNo = formText(formData, "orderNo");
  await runAction(reviewPath(orderNo), async () => {
    await acceptSuggestion(await getDeps(), actorOf(persona), {
      orderNo,
      fingerprint: formText(formData, "fingerprint"),
      remember: formData.get("remember") === "on",
    });
  });
}

export async function overrideFlagAction(formData: FormData): Promise<void> {
  const persona = await requirePersona();
  const orderNo = formText(formData, "orderNo");
  await runAction(reviewPath(orderNo), async () => {
    await overrideFlag(await getDeps(), actorOf(persona), { orderNo, fingerprint: formText(formData, "fingerprint"), reason: formText(formData, "reason") });
    return { notice: "The difference was accepted with your reason and name." };
  });
}

export async function withdrawOverrideAction(formData: FormData): Promise<void> {
  const persona = await requirePersona();
  const orderNo = formText(formData, "orderNo");
  await runAction(reviewPath(orderNo), async () => {
    await withdrawOverride(await getDeps(), actorOf(persona), { orderNo, fingerprint: formText(formData, "fingerprint") });
  });
}

export async function setFieldAction(formData: FormData): Promise<void> {
  const persona = await requirePersona();
  const orderNo = formText(formData, "orderNo");
  await runAction(reviewPath(orderNo), async () => {
    await editField(await getDeps(), actorOf(persona), {
      orderNo,
      field: formText(formData, "field"),
      value: formText(formData, "value"),
      reason: formText(formData, "reason") || null,
    });
  });
}

export async function addLineAction(formData: FormData): Promise<void> {
  const persona = await requirePersona();
  const orderNo = formText(formData, "orderNo");
  await runAction(reviewPath(orderNo), async () => {
    await addLine(await getDeps(), actorOf(persona), orderNo, formText(formData, "partNo"));
    return { notice: "Line added. Open it to type the quantity and unit price." };
  });
}

/** Removing a line is an edit of its "removed" marker, so it has a history and can be undone like any other change. */
export async function removeLineAction(formData: FormData): Promise<void> {
  const persona = await requirePersona();
  const orderNo = formText(formData, "orderNo");
  await runAction(reviewPath(orderNo), async () => {
    const index = formNumber(formData, "lineIndex") ?? -1;
    await editField(await getDeps(), actorOf(persona), { orderNo, field: lineKey(index, "removed"), value: "true", reason: "Line removed by hand" });
  });
}

export async function proposeCustomerCardAction(formData: FormData): Promise<void> {
  const persona = await requirePersona();
  const orderNo = formText(formData, "orderNo");
  await runAction(reviewPath(orderNo), async () => {
    await proposeCustomerCard(await getDeps(), actorOf(persona), {
      orderNo,
      address: formText(formData, "address"),
      country: formText(formData, "country"),
      email: formText(formData, "email"),
    });
    return { notice: "New customer card proposed. It is shown in the export preview and created only when you approve." };
  });
}

export async function withdrawCustomerCardAction(formData: FormData): Promise<void> {
  const persona = await requirePersona();
  const orderNo = formText(formData, "orderNo");
  await runAction(reviewPath(orderNo), async () => {
    await withdrawCustomerCard(await getDeps(), actorOf(persona), orderNo);
  });
}

/** The person approves exactly the preview they were shown (identified by its hash). */
export async function approveExportAction(formData: FormData): Promise<void> {
  const persona = await requirePersona();
  const orderNo = formText(formData, "orderNo");
  await runAction(`/orders/${orderNo}/preview`, async () => {
    const result = await approveAndExport(await getDeps(), actorOf(persona), { orderNo, previewHash: formText(formData, "previewHash") });
    return { goTo: `/orders/${orderNo}`, notice: `Approved and exported: ${result.paths.join(", ")}` };
  });
}

export async function approveCancellationAction(formData: FormData): Promise<void> {
  const persona = await requirePersona();
  const orderNo = formText(formData, "orderNo");
  await runAction(`/orders/${orderNo}/preview?mode=cancel`, async () => {
    const result = await approveCancellation(await getDeps(), actorOf(persona), {
      orderNo,
      previewHash: formText(formData, "previewHash"),
      reason: formText(formData, "reason"),
    });
    return {
      goTo: `/orders/${orderNo}`,
      notice: result.paths.length > 0 ? `Order cancelled. Written for Navision: ${result.paths.join(", ")}` : "Order cancelled. The draft was closed; nothing was written to Navision.",
    };
  });
}

export async function recordDeliveryAction(formData: FormData): Promise<void> {
  const persona = await requirePersona();
  const orderNo = formText(formData, "orderNo");
  await runAction(`/orders/${orderNo}`, async () => {
    await recordDelivery(await getDeps(), actorOf(persona), {
      orderNo,
      partNo: formText(formData, "partNo"),
      quantity: formNumber(formData, "quantity"),
      note: formText(formData, "note") || null,
    });
    return { notice: "Delivery recorded." };
  });
}
