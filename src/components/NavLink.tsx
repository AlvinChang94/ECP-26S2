// What: one link in the sidebar, highlighted when its page is open.
// Who calls it: the app layout (src/app/(app)/layout.tsx).
// To extend: this is a client component only because it needs the current address (usePathname) to highlight itself.
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link href={href} className={active ? "nav-link nav-link-active" : "nav-link"}>
      {label}
    </Link>
  );
}
