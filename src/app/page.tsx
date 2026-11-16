// What: the address "/" has no page of its own; it sends people to the order dashboard.
// Who calls it: Next.js, when someone opens http://localhost:3000/.
// To extend: change the target if another page should be the home page.
import { redirect } from "next/navigation";

export default function HomePage() {
  redirect("/dashboard");
}
