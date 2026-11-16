// What: the server action behind the Approve and Reject buttons on the approval link page.
// Who calls it: the form on /approve/[token]. There is no login: the signed token in the link is the permission.
// To extend: all checks (signature, expiry, single use, SPR still waiting) are in decideSpr() in src/services/spr.ts.
"use server";

import { formText, runAction } from "@/app/_lib/forms";
import { getDeps } from "@/services/deps";
import { UserError } from "@/services/errors";
import { decideSpr } from "@/services/spr";

export async function decideSprAction(formData: FormData): Promise<void> {
  const token = formText(formData, "token");
  await runAction(`/approve/${token}`, async () => {
    const decision = formText(formData, "decision");
    if (decision !== "approve" && decision !== "reject") throw new UserError("Choose Approve or Reject.");
    const spr = await decideSpr(await getDeps(), token, { decision, remarks: formText(formData, "remarks") });
    return { notice: `Thank you. ${spr.sprNo} is now ${spr.status.toLowerCase()}, and ${spr.requestedBy} has been told.` };
  });
}
