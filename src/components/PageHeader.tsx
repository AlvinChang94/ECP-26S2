// What: the title block at the top of a page, with optional buttons on the right.
// Who calls it: every page.
// To extend: pass buttons or links as children.
import type { ReactNode } from "react";

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle ? <p className="subtitle">{subtitle}</p> : null}
      </div>
      {children ? <div className="row">{children}</div> : null}
    </div>
  );
}
