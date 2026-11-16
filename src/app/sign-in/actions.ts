// What: the server action behind the persona picker.
// Who calls it: the buttons on /sign-in.
// To extend: real sign-in (Amazon Cognito) replaces this file; pages keep calling requirePersona().
"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { formText } from "@/app/_lib/forms";
import { homePathFor, PERSONA_COOKIE } from "@/app/_lib/session";
import { getDeps } from "@/services/deps";

export async function choosePersonaAction(formData: FormData): Promise<void> {
  const staffId = formText(formData, "staffId");
  const deps = await getDeps();
  const directory = await deps.navision.getStaffDirectory();
  const member = directory.staff.find((candidate) => candidate.id === staffId);
  if (!member) redirect("/sign-in");
  const store = await cookies();
  // No password and no security: this is a demo persona picker, not authentication.
  store.set(PERSONA_COOKIE, member.id, { path: "/", sameSite: "lax", httpOnly: true });
  redirect(homePathFor(member.role));
}
