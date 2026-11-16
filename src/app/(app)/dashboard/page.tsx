// What: the order dashboard (story 6). This first version is a placeholder until milestone M6 builds the real one.
// Who calls it: the "Order dashboard" link in the sidebar, and "/" redirects here.
// To extend: replaced in M6 by the order list with status, owner, next action and summary tiles.
import { PageHeader } from "@/components/PageHeader";
import { Stub } from "@/components/Stub";

export default function DashboardPage() {
  return (
    <>
      <PageHeader title="Order dashboard" subtitle="One view of each order's status, owner and next action." />
      <Stub>The order dashboard is built in milestone M6. Use the sidebar to open the parts that already work.</Stub>
    </>
  );
}
