// What: the Prisma settings for MySQL (Amazon RDS): the generated MySQL schema, its migrations, and DATABASE_URL.
// Who calls it: `prisma generate --config prisma.mysql.config.ts` (npm install) and the seed script when DATABASE_URL starts with mysql://.
// To extend: do not edit the schema it points to; it is generated from prisma/schema.prisma by scripts/make-mysql-schema.mjs.
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/mysql/schema.prisma",
  migrations: { path: "prisma/mysql/migrations" },
  // A placeholder lets `prisma generate` run without a database; migrate commands need the real mysql:// URL.
  datasource: { url: process.env.DATABASE_URL?.startsWith("mysql://") ? process.env.DATABASE_URL : "mysql://placeholder:placeholder@localhost:3306/orderflow" },
});
