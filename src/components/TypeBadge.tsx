// What: shows a document's type: what was detected (with confidence) or what a person confirmed.
// Who calls it: the Inbox list and the document page.
// To extend: the wording of each state lives here so every page says it the same way.
import type { DocumentRow } from "@/adapters/db";
import { documentTypeLabel, LOW_CONFIDENCE_THRESHOLD } from "@/domain/documents";

export function TypeBadge({ document }: { document: Pick<DocumentRow, "typeStatus" | "confirmedType" | "detectedType" | "detectedConfidence"> }) {
  if (document.typeStatus === "confirmed" && document.confirmedType) {
    return <span className="badge badge-ok">{documentTypeLabel(document.confirmedType)} · confirmed</span>;
  }
  if (document.detectedType === "unknown") {
    return <span className="badge badge-blocking">Type not recognised · choose it</span>;
  }
  const unsure = document.detectedConfidence < LOW_CONFIDENCE_THRESHOLD * 100;
  return (
    <span className={unsure ? "badge badge-warning" : "badge badge-info"}>
      {documentTypeLabel(document.detectedType)} · detected, {document.detectedConfidence}% sure{unsure ? " · please check" : ""}
    </span>
  );
}
