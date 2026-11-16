// What: the frame around every signed-in page: sidebar navigation, top bar with the demo clock and the current persona.
// Who calls it: Next.js wraps every page inside the (app) folder with this layout.
// To extend: add a sidebar link to NAVIGATION below when you add a screen (see the developer guide recipe).
import Link from "next/link";
import type { ReactNode } from "react";
import { requirePersona } from "@/app/_lib/session";
import { NavLink } from "@/components/NavLink";
import { ROLE_LABELS } from "@/domain/audit";
import { formatDateTime } from "@/domain/time";
import { getDeps } from "@/services/deps";
import { advanceClockAction, runJobsAction } from "./actions";

const NAVIGATION: { group: string; links: { href: string; label: string }[] }[] = [
  { group: "Orders", links: [{ href: "/dashboard", label: "Order dashboard" }] },
  {
    group: "Sales",
    links: [
      { href: "/inbox", label: "Inbox and upload" },
      { href: "/aliases", label: "Alias memory" },
    ],
  },
  {
    group: "Purchase",
    links: [
      { href: "/spr", label: "SPRs" },
      { href: "/shipments", label: "Receipts and shipments" },
    ],
  },
  { group: "Finance", links: [{ href: "/payments", label: "Payments" }] },
  {
    group: "System",
    links: [
      { href: "/outbox", label: "Outbox" },
      { href: "/audit", label: "Audit log" },
      { href: "/navision", label: "Mock Navision" },
    ],
  },
];

export default async function AppLayout({ children }: { children: ReactNode }) {
  const persona = await requirePersona();
  const deps = await getDeps();

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">Spectra OrderFlow</div>
        <div className="brand-sub">Proof of concept</div>
        <nav>
          {NAVIGATION.map((section) => (
            <div key={section.group}>
              <div className="nav-group">{section.group}</div>
              {section.links.map((link) => (
                <NavLink key={link.href} href={link.href} label={link.label} />
              ))}
            </div>
          ))}
        </nav>
      </aside>
      <div className="main">
        <header className="topbar">
          <span className="badge badge-neutral">Demo workspace · sample data only</span>
          <div className="row">
            <span className="muted small">Simulated time</span>
            <strong data-testid="demo-clock">{formatDateTime(deps.clock.now())}</strong>
            <form action={advanceClockAction} className="inline-form">
              <input type="hidden" name="hours" value="1" />
              <button className="btn btn-secondary btn-small" type="submit" title="Demo tool: move the simulated time forward 1 hour and run due jobs">
                +1 h
              </button>
            </form>
            <form action={advanceClockAction} className="inline-form">
              <input type="hidden" name="hours" value="24" />
              <button className="btn btn-secondary btn-small" type="submit" title="Demo tool: move the simulated time forward 24 hours and run due jobs">
                +24 h
              </button>
            </form>
            <form action={runJobsAction} className="inline-form">
              <button className="btn btn-secondary btn-small" type="submit" title="Run reminders and alerts that are due now">
                Run due jobs
              </button>
            </form>
          </div>
          <div className="row">
            <span>
              <strong>{persona.name}</strong> <span className="muted">· {ROLE_LABELS[persona.role]}</span>
            </span>
            <Link href="/sign-in" className="btn btn-secondary btn-small">
              Switch persona
            </Link>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
