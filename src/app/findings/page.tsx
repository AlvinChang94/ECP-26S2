import Link from "next/link";
import { Suspense } from "react";
import { SeverityBadge } from "@/components/severity-badge";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { demoFindings, FINDING_STATUSES, SEVERITIES } from "@/server/demo/findings";
import { MODULES } from "@/server/modules";

type Filters = { severity?: string; status?: string; module?: string };

export default function FindingsPage(props: PageProps<"/findings">) {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Findings</h1>
        <p className="text-sm text-muted-foreground">
          Placeholder data from the rule engine over the golden datasets; statuses are made up.
        </p>
      </header>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading findings…</p>}>
        <FindingsList searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function FindingsList({ searchParams }: Pick<PageProps<"/findings">, "searchParams">) {
  const sp = await searchParams;
  const filters: Filters = {
    severity: first(sp.severity),
    status: first(sp.status),
    module: first(sp.module),
  };

  const all = demoFindings();
  const rows = all.filter(
    (f) =>
      (!filters.severity || f.severity === filters.severity) &&
      (!filters.status || f.status === filters.status) &&
      (!filters.module || f.module === filters.module),
  );

  return (
    <>
      <div className="flex flex-col gap-3">
        <FilterRow label="Severity" name="severity" options={SEVERITIES} filters={filters} />
        <FilterRow label="Status" name="status" options={FINDING_STATUSES} filters={filters} />
        <FilterRow
          label="Module"
          name="module"
          options={MODULES.map((m) => m.id)}
          filters={filters}
        />
      </div>

      <p className="text-sm text-muted-foreground">
        Showing {rows.length} of {all.length} findings
      </p>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Severity</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Subject</TableHead>
              <TableHead className="min-w-80">Explanation</TableHead>
              <TableHead>Module</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((f) => (
              <TableRow key={f.id}>
                <TableCell>
                  <SeverityBadge severity={f.severity} />
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{f.status}</Badge>
                </TableCell>
                <TableCell className="font-mono text-xs">{f.reasonCode}</TableCell>
                <TableCell className="whitespace-nowrap">
                  <span className="text-muted-foreground">{f.subject.type}</span> {f.subject.id}
                </TableCell>
                <TableCell className="whitespace-normal">{f.explanation}</TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {f.module}
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  No findings match these filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

function FilterRow({
  label,
  name,
  options,
  filters,
}: {
  label: string;
  name: keyof Filters;
  options: readonly string[];
  filters: Filters;
}) {
  const href = (value: string | undefined) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...filters, [name]: value })) if (v) next.set(k, v);
    const qs = next.toString();
    return qs ? `/findings?${qs}` : "/findings";
  };
  const chip = (value: string | undefined, text: string) => {
    const active = filters[name] === value;
    return (
      <Link
        key={text}
        href={href(value)}
        aria-current={active ? "true" : undefined}
        className={cn(
          "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
          active
            ? "border-primary bg-primary text-primary-foreground"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        {text}
      </Link>
    );
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-16 text-xs font-medium text-muted-foreground">{label}</span>
      {chip(undefined, "All")}
      {options.map((o) => chip(o, o))}
    </div>
  );
}
