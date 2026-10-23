import { createHash } from "node:crypto";

/** sha256 of the file bytes, lower-case hex. Used as the extraction cache key and documents.file_hash. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
