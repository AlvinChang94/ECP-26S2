import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { demoFindings, SEVERITIES } from "@/server/demo/findings";
import { MODULES } from "@/server/modules";

export default function DashboardPage() {
  const findings = demoFindings();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Placeholder: findings come from running each candidate module&apos;s rules over its
          synthetic golden dataset. Pick one problem statement and this becomes its status view.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        {MODULES.map((m) => {
          const mine = findings.filter((f) => f.module === m.id);
          const open = mine.filter((f) => f.status === "OPEN").length;
          return (
            <Card key={m.id}>
              <CardHeader>
                <CardTitle>{m.title}</CardTitle>
                <CardDescription>{m.summary}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <dl className="grid grid-cols-3 gap-2 text-center">
                  {SEVERITIES.map((s) => (
                    <div key={s} className="rounded-md bg-muted px-2 py-2">
                      <dt className="text-xs text-muted-foreground">{s}</dt>
                      <dd className="text-lg font-semibold tabular-nums">
                        {mine.filter((f) => f.severity === s).length}
                      </dd>
                    </div>
                  ))}
                </dl>
                <p className="text-sm text-muted-foreground">{open} open findings</p>
                <Link
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                  href={`/findings?module=${m.id}`}
                >
                  View findings
                </Link>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>System health</CardTitle>
          <CardDescription>Check the database and AWS connections.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <a className={buttonVariants({ variant: "outline" })} href="/api/health">
            /api/health
          </a>
          <a className={buttonVariants({ variant: "outline" })} href="/api/health/aws">
            /api/health/aws
          </a>
        </CardContent>
      </Card>
    </div>
  );
}
