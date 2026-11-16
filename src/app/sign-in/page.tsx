// What: the mock sign-in page: pick one of the five personas from the deck.
// Who calls it: anyone not yet "signed in" is sent here by requirePersona().
// To extend: personas come from data/navision/staff.json. Add a person there and they appear here.
import { ROLE_LABELS } from "@/domain/audit";
import type { StaffRole } from "@/domain/navision";
import { getDeps } from "@/services/deps";
import { choosePersonaAction } from "./actions";

const ROLE_SUMMARY: Record<StaffRole, string> = {
  sales: "Captures customer POs, resolves mismatches and approves the export to Navision. Tracks outgoing shipment documents.",
  product_manager: "Raises SPRs from a part number and follows their approval.",
  approver: "Approves or rejects SPRs. Normally done from the emailed link, without signing in.",
  finance: "Confirms payments, reviews payment reminders and watches vendor payments.",
  purchase: "Matches goods receipts to invoices and packing lists and chases shipping documents.",
};

export default async function SignInPage() {
  const deps = await getDeps();
  const directory = await deps.navision.getStaffDirectory();
  // The stand-in only acts through approval links, so there is no persona for them.
  const personas = directory.staff.filter((member) => member.id !== directory.standInId);

  return (
    <div className="centered-page">
      <h1>Spectra OrderFlow</h1>
      <p className="subtitle">
        Proof of concept with synthetic sample data. Choose who you are for this session. There is no password: this is a persona
        picker, not real sign-in.
      </p>
      <div className="grid-2" style={{ marginTop: 20 }}>
        {personas.map((member) => (
          <form key={member.id} action={choosePersonaAction}>
            <input type="hidden" name="staffId" value={member.id} />
            <button type="submit" className="persona-card" data-testid={`persona-${member.id}`}>
              <div className="persona-name">{member.name}</div>
              <div className="badge badge-info" style={{ margin: "6px 0" }}>
                {ROLE_LABELS[member.role]}
              </div>
              <div className="muted">{ROLE_SUMMARY[member.role]}</div>
            </button>
          </form>
        ))}
      </div>
    </div>
  );
}
