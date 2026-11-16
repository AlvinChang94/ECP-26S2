// What: server action for the alias memory page (remove a remembered alias).
// Who calls it: the Remove button on /aliases.
// To extend: aliases are created from the PO review page ("Remember this fix"), never here.
"use server";

import { formText, runAction } from "@/app/_lib/forms";
import { actorOf, requirePersona } from "@/app/_lib/session";
import { getDeps } from "@/services/deps";
import { UserError } from "@/services/errors";
import { removeAlias } from "@/services/poEdit";

export async function removeAliasAction(formData: FormData): Promise<void> {
  const persona = await requirePersona();
  await runAction("/aliases", async () => {
    if (persona.role !== "sales") throw new UserError("Only a sales team member can remove an alias.");
    await removeAlias(await getDeps(), actorOf(persona), formText(formData, "fromPartNo"));
    return { notice: "Alias removed. It will no longer be suggested." };
  });
}
