// What: the alias memory page (story 2): every remembered "this part number means that one".
// Who calls it: the "Alias memory" link in the sidebar.
// To extend: an alias is only ever a suggestion on a later PO; a person always confirms it there.
import { readMessages } from "@/app/_lib/forms";
import { requirePersona } from "@/app/_lib/session";
import { Notices } from "@/components/Notices";
import { PageHeader } from "@/components/PageHeader";
import { formatDateTime } from "@/domain/time";
import { getDeps } from "@/services/deps";
import { listAliases } from "@/services/poEdit";
import { removeAliasAction } from "./actions";

export default async function AliasesPage(props: PageProps<"/aliases">) {
  const searchParams = await props.searchParams;
  const persona = await requirePersona();
  const aliases = await listAliases(await getDeps());

  return (
    <>
      <PageHeader
        title="Alias memory"
        subtitle="Part numbers customers write differently from Navision. Remembered when a person fixes one; suggested next time; never applied automatically."
      />
      <Notices messages={readMessages(searchParams)} />
      <div className="card card-tight">
        <table className="table">
          <thead>
            <tr>
              <th>Written on customer documents</th>
              <th>Means Navision item</th>
              <th>Remembered by</th>
              <th>When</th>
              <th className="right">Confirmed again</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {aliases.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
                  Nothing remembered yet. Fix a part number on a PO and tick &quot;Remember this fix&quot;.
                </td>
              </tr>
            ) : null}
            {aliases.map((alias) => (
              <tr key={alias.id}>
                <td className="mono">{alias.fromPartNo}</td>
                <td className="mono">{alias.toItemNo}</td>
                <td>{alias.createdBy}</td>
                <td className="nowrap">{formatDateTime(alias.createdAt)}</td>
                <td className="right">
                  {alias.timesConfirmed} time{alias.timesConfirmed === 1 ? "" : "s"}
                </td>
                <td>
                  {persona.role === "sales" ? (
                    <form action={removeAliasAction}>
                      <input type="hidden" name="fromPartNo" value={alias.fromPartNo} />
                      <button className="btn btn-danger btn-small" type="submit">
                        Remove
                      </button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
