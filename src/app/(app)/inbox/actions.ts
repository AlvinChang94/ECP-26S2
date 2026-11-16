// What: server actions of the Inbox and document pages: import waiting messages and confirm a document's type.
// Who calls it: the forms on /inbox and /documents/[id].
// To extend: keep actions thin: read the form, call one service inside runAction(), nothing else.
"use server";

import { formText, runAction } from "@/app/_lib/forms";
import { actorOf, requirePersona } from "@/app/_lib/session";
import { getDeps } from "@/services/deps";
import { confirmDocumentType, importAllInbox, importInboxMessage, parseDocumentType, pathForRoute } from "@/services/intake";

export async function importMessageAction(formData: FormData): Promise<void> {
  const persona = await requirePersona();
  await runAction("/inbox", async () => {
    const result = await importInboxMessage(await getDeps(), actorOf(persona), formText(formData, "messageId"));
    return { goTo: `/documents/${result.documentId}` };
  });
}

export async function importAllAction(): Promise<void> {
  const persona = await requirePersona();
  await runAction("/inbox", async () => {
    const count = await importAllInbox(await getDeps(), actorOf(persona));
    return { notice: count === 0 ? "Nothing new in the inbox." : `Imported ${count} document${count === 1 ? "" : "s"}. Confirm each type to continue.` };
  });
}

/** A person confirms or changes the type. Only then is the document routed. */
export async function confirmTypeAction(formData: FormData): Promise<void> {
  const persona = await requirePersona();
  const documentId = formText(formData, "documentId");
  await runAction(`/documents/${documentId}`, async () => {
    const type = parseDocumentType(formText(formData, "type"));
    const route = await confirmDocumentType(await getDeps(), actorOf(persona), documentId, type);
    return { goTo: pathForRoute(documentId, route) };
  });
}
