// What: a clearly labelled box for something that is not built yet.
// Who calls it: any page that shows a feature the POC does not implement.
// To extend: when the feature is built, delete the <Stub> and remove it from the "not done" list in the README.
import type { ReactNode } from "react";

export function Stub({ children }: { children: ReactNode }) {
  return (
    <div className="stub">
      <span className="stub-label">STUB</span>
      {children}
    </div>
  );
}
