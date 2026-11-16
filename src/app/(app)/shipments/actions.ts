// What: server actions for story 5: track a shipment, link a document, request a document, assign, record or reopen a resolution, correct a value.
// Who calls it: the forms on /shipments and /shipments/[shipmentNo].
// To extend: keep each action to "read the form, call one service function". The rules are in src/services/shipments.ts.
"use server";

import { formText, runAction } from "@/app/_lib/forms";
import { actorOf, requirePersona } from "@/app/_lib/session";
import { getDeps } from "@/services/deps";
import { assignShipment, editShipmentDocument, linkDocumentToShipment, recordResolution, reopenFinding, requestDocument, trackShipment } from "@/services/shipments";

export async function trackShipmentAction(formData: FormData): Promise<void> {
  const persona = await requirePersona();
  await runAction("/shipments", async () => {
    const { shipmentNo, created } = await trackShipment(await getDeps(), actorOf(persona), formText(formData, "reference"));
    return { goTo: `/shipments/${shipmentNo}`, notice: created ? `${shipmentNo} is now tracked.` : `${shipmentNo} already tracks this reference.` };
  });
}

export async function linkDocumentAction(formData: FormData): Promise<void> {
  const persona = await requirePersona();
  await runAction("/shipments", async () => {
    const shipmentNo = await linkDocumentToShipment(await getDeps(), actorOf(persona), {
      documentId: formText(formData, "documentId"),
      reference: formText(formData, "reference"),
    });
    return { goTo: `/shipments/${shipmentNo}`, notice: `Document linked to ${shipmentNo}.` };
  });
}

export async function requestDocumentAction(formData: FormData): Promise<void> {
  const persona = await requirePersona();
  const shipmentNo = formText(formData, "shipmentNo");
  await runAction(`/shipments/${shipmentNo}`, async () => {
    await requestDocument(await getDeps(), actorOf(persona), { shipmentNo, documentKey: formText(formData, "documentKey") });
    return { notice: "Request written to the Outbox and recorded on this shipment." };
  });
}

export async function assignShipmentAction(formData: FormData): Promise<void> {
  const persona = await requirePersona();
  const shipmentNo = formText(formData, "shipmentNo");
  await runAction(`/shipments/${shipmentNo}`, async () => {
    await assignShipment(await getDeps(), actorOf(persona), { shipmentNo, staffId: formText(formData, "staffId") });
    return { notice: "Assigned. The team member was told through the Outbox." };
  });
}

export async function recordResolutionAction(formData: FormData): Promise<void> {
  const persona = await requirePersona();
  const shipmentNo = formText(formData, "shipmentNo");
  await runAction(`/shipments/${shipmentNo}`, async () => {
    await recordResolution(await getDeps(), actorOf(persona), { shipmentNo, fingerprint: formText(formData, "fingerprint"), reason: formText(formData, "reason") });
    return { notice: `Resolution recorded by ${persona.name}.` };
  });
}

export async function reopenFindingAction(formData: FormData): Promise<void> {
  const persona = await requirePersona();
  const shipmentNo = formText(formData, "shipmentNo");
  await runAction(`/shipments/${shipmentNo}`, async () => {
    await reopenFinding(await getDeps(), actorOf(persona), { shipmentNo, fingerprint: formText(formData, "fingerprint") });
    return { notice: "The finding is open again." };
  });
}

/** Saves every input named "field:<key>" for one document of the shipment. */
export async function editShipmentDocumentAction(formData: FormData): Promise<void> {
  const persona = await requirePersona();
  const shipmentNo = formText(formData, "shipmentNo");
  await runAction(`/shipments/${shipmentNo}`, async () => {
    const changes: { field: string; value: string | null }[] = [];
    for (const [name, value] of formData.entries()) {
      if (name.startsWith("field:") && typeof value === "string") changes.push({ field: name.slice("field:".length), value });
    }
    const changed = await editShipmentDocument(await getDeps(), actorOf(persona), { shipmentNo, documentId: formText(formData, "documentId"), changes });
    return { notice: changed === 0 ? "Nothing was changed." : `Saved ${changed} correction${changed === 1 ? "" : "s"} and checked the shipment again.` };
  });
}
