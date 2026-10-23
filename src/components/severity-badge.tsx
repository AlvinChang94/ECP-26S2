import { Badge } from "@/components/ui/badge";
import type { Severity } from "@/server/engine";

const VARIANT = {
  ERROR: "destructive",
  WARNING: "default",
  INFO: "secondary",
} as const satisfies Record<Severity, "destructive" | "default" | "secondary">;

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <Badge variant={VARIANT[severity]}>{severity}</Badge>;
}
