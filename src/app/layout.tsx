import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { NavLink } from "@/components/nav-link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ECP",
  description: "Enterprise Cloud Project",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-background text-foreground md:flex-row">
        <aside className="border-b md:min-h-screen md:w-56 md:shrink-0 md:border-r md:border-b-0">
          <div className="flex items-center gap-4 px-4 py-3 md:flex-col md:items-stretch md:gap-1 md:py-6">
            <span className="px-3 text-lg font-semibold tracking-tight md:mb-4">ECP</span>
            <nav className="flex gap-1 md:flex-col">
              <NavLink href="/">Dashboard</NavLink>
              <NavLink href="/findings">Findings</NavLink>
            </nav>
          </div>
        </aside>
        <main className="min-w-0 flex-1 px-4 py-6 md:px-8">{children}</main>
      </body>
    </html>
  );
}
