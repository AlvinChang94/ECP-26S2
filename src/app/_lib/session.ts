// What: the mock sign-in. Remembers which persona was picked (a cookie) and turns it into an Actor for services.
// Who calls it: layouts, pages and server actions.
// To extend: with Amazon Cognito, replace the cookie lookup with the signed-in user's claims (docs/AWS_MAPPING.md).
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Actor } from "@/domain/audit";
import type { StaffMember } from "@/domain/navision";
import { getDeps } from "@/services/deps";

export const PERSONA_COOKIE = "orderflow_persona";

/** The persona picked on the sign-in page, or null. Staff come from the approvedStaff file in mock Navision. */
export async function getPersona(): Promise<StaffMember | null> {
  const store = await cookies();
  const staffId = store.get(PERSONA_COOKIE)?.value;
  if (!staffId) return null;
  const deps = await getDeps();
  const directory = await deps.navision.getStaffDirectory();
  return directory.staff.find((member) => member.id === staffId) ?? null;
}

/** Like getPersona, but sends the visitor to the sign-in page when nobody is picked. */
export async function requirePersona(): Promise<StaffMember> {
  const persona = await getPersona();
  if (!persona) redirect("/sign-in");
  return persona;
}

export function actorOf(persona: StaffMember): Actor {
  return { name: persona.name, role: persona.role };
}

/** Where each role starts after picking a persona. */
export function homePathFor(role: StaffMember["role"]): string {
  if (role === "sales") return "/inbox";
  if (role === "product_manager" || role === "approver") return "/spr";
  if (role === "finance") return "/payments";
  if (role === "purchase") return "/shipments";
  return "/dashboard";
}
