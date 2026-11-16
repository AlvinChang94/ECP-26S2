// What: Next.js settings for the OrderFlow POC.
// Who calls it: `next dev`, `next build` and `next typegen` read this file on start.
// To extend: add options here; keep the list of server-only packages in step with package.json.
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // These packages load native code or worker files from node_modules,
  // so Node must load them directly instead of the bundler copying them.
  serverExternalPackages: ["pdfjs-dist", "better-sqlite3", "@prisma/adapter-better-sqlite3"],
};

export default nextConfig;
