// What: copies the pdf.js worker file into public/ so the browser can load it from /pdf.worker.min.mjs.
// Who calls it: `npm install` (postinstall script in package.json).
// To extend: if pdfjs-dist moves the file in a new version, update the source path below.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "node_modules", "pdfjs-dist", "build", "pdf.worker.min.mjs");
const target = join(root, "public", "pdf.worker.min.mjs");

if (!existsSync(source)) {
  console.error(`pdf.js worker not found at ${source}. Is pdfjs-dist installed?`);
  process.exit(1);
}
mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
console.log("Copied pdf.js worker to public/pdf.worker.min.mjs");
