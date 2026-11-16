// What: small helpers for server actions: read form fields, run a service, and show its error or success on the page.
// Who calls it: every actions.ts file next to a page.
// To extend: keep actions thin. Read the form, call one service function inside runAction(), nothing else.
import { redirect } from "next/navigation";
import { UserError } from "@/services/errors";

/** A text field from a submitted form, trimmed. Missing fields come back as "". */
export function formText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export function formNumber(formData: FormData, name: string): number | null {
  const text = formText(formData, name);
  if (!/^-?\d+$/.test(text)) return null;
  return Number.parseInt(text, 10);
}

function withParam(path: string, key: string, message: string): string {
  const [base, hash] = path.split("#");
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}${key}=${encodeURIComponent(message)}${hash ? `#${hash}` : ""}`;
}

/**
 * Runs the work of a server action, then redirects.
 *  - Success: goes to `returnPath` (or to the path the work returns), optionally with a green notice.
 *  - UserError (something the person can fix): goes back to `returnPath` with the message shown in red.
 *  - Any other error is a bug and is not hidden: Next.js shows its error page.
 */
export async function runAction(
  returnPath: string,
  work: () => Promise<{ goTo?: string; notice?: string } | void>,
): Promise<never> {
  let target = returnPath;
  try {
    const result = await work();
    target = result?.goTo ?? returnPath;
    if (result?.notice) target = withParam(target, "notice", result.notice);
  } catch (error) {
    if (error instanceof UserError) redirect(withParam(returnPath, "error", error.message));
    throw error;
  }
  // redirect() works by throwing, so it must stay outside the try block above.
  redirect(target);
}

/** The ?error= and ?notice= messages of the current page, for the <Notices> component. */
export type PageMessages = { error?: string; notice?: string };

export function readMessages(searchParams: Record<string, string | string[] | undefined>): PageMessages {
  const pick = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);
  return { error: pick(searchParams.error), notice: pick(searchParams.notice) };
}
