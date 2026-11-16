// What: the root layout. Every page is rendered inside this <html> and <body>.
// Who calls it: Next.js, for every route.
// To extend: put things here only if every page needs them (global CSS, the page title).
import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Spectra OrderFlow (proof of concept)",
  description: "Purchase and sales order automation proof of concept. Synthetic sample data only.",
};

// Every page reads live data (database, Navision files, the demo clock), so nothing is cached or pre-built.
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
