// What: SHA-256 fingerprints of text and bytes (pure computation, no file or network access).
// Who calls it: export previews (the approved hash must equal the hash of what is written) and document intake.
// To extend: nothing to extend; use these two functions wherever "is this exactly the same content?" matters.
import { createHash } from "node:crypto";

export function sha256OfText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function sha256OfBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
