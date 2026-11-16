// What: route handler that returns the stored PDF of a document, for the PDF viewer and for downloading.
// Who calls it: <PdfViewer fileUrl="/api/documents/ID/file" /> and "Open PDF" links.
// To extend: with S3 this could redirect to a short-lived signed URL instead of streaming the bytes.
import { getPersona } from "@/app/_lib/session";
import { getDeps } from "@/services/deps";

export async function GET(_request: Request, context: RouteContext<"/api/documents/[id]/file">): Promise<Response> {
  if (!(await getPersona())) return new Response("Pick a persona first.", { status: 401 });
  const { id } = await context.params;
  const deps = await getDeps();
  const document = await deps.db.document.findUnique({ where: { id } });
  if (!document) return new Response("No such document.", { status: 404 });
  const bytes = await deps.files.get(document.fileKey);
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${document.fileName.replace(/[^\w.\-]+/g, "_")}"`,
      "Cache-Control": "private, max-age=300",
    },
  });
}
