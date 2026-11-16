// What: tells the Prisma command-line tool where the schema, the migrations and the database are.
// Who calls it: `prisma generate`, `prisma migrate ...` (Prisma 7 no longer reads .env by itself).
// To extend: for MySQL only DATABASE_URL changes here; see docs/DEVELOPER_GUIDE.md "move from SQLite to MySQL".
import path from "node:path";
import { defineConfig } from "prisma/config";

// Same default as src/adapters/config.ts. Relative "file:" paths are resolved from the project root.
function databaseUrl(): string {
  const url = process.env.DATABASE_URL ?? "file:./storage/orderflow.db";
  if (!url.startsWith("file:")) return url;
  const filePath = url.slice("file:".length);
  return "file:" + path.resolve(process.cwd(), filePath);
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: databaseUrl() },
});
