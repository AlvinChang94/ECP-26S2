// What: route handler that receives an uploaded PDF and hands it to the intake service.
// Who calls it: the upload form on the Inbox page (a normal HTML form post with a file).
// To extend: route handlers are only used for file upload and download in this project; everything else is a server action.
import { NextResponse } from "next/server";
import { actorOf, getPersona } from "@/app/_lib/session";
import { isDocumentType } from "@/domain/documents";
import { getDeps } from "@/services/deps";
import { UserError } from "@/services/errors";
import { ingestDocument, pathForRoute } from "@/services/intake";

/** After a form post the browser must fetch the next page with GET, which is what status 303 means. */
function seeOther(request: Request, path: string): NextResponse {
  return NextResponse.redirect(new URL(path, request.url), 303);
}

export async function POST(request: Request): Promise<Response> {
  const persona = await getPersona();
  if (!persona) return seeOther(request, "/sign-in");

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return seeOther(request, `/inbox?error=${encodeURIComponent("Choose a PDF file to upload.")}`);
  }
  const typeText = String(form.get("type") ?? "");
  const chosenType = isDocumentType(typeText) ? typeText : null;

  try {
    const deps = await getDeps();
    const result = await ingestDocument(deps, actorOf(persona), {
      bytes: new Uint8Array(await file.arrayBuffer()),
      fileName: file.name,
      channel: "upload",
      sender: persona.name,
      chosenType,
    });
    const notice = result.sameFileAs ? `?notice=${encodeURIComponent("Note: exactly the same file was received before.")}` : "";
    // When the person chose the type while uploading, the document is already confirmed and routed: go straight there.
    if (result.route) return seeOther(request, pathForRoute(result.documentId, result.route));
    return seeOther(request, `/documents/${result.documentId}${notice}`);
  } catch (error) {
    if (error instanceof UserError) return seeOther(request, `/inbox?error=${encodeURIComponent(error.message)}`);
    throw error;
  }
}
