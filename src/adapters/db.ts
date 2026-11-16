// What: creates the Prisma database client (SQLite through the better-sqlite3 driver adapter).
// Who calls it: getDeps() for the app, scripts/seed.ts, and test helpers (each test gets its own temporary file).
// To extend: for MySQL swap the adapter here (see docs/DEVELOPER_GUIDE.md "move from SQLite to MySQL"). Nothing else imports the driver.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import Database from "better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";

export type Db = PrismaClient;

/** `databaseUrl` looks like "file:C:/path/to/orderflow.db" (config.ts makes the path absolute). */
export function createDb(databaseUrl: string): Db {
  const adapter = new PrismaBetterSqlite3({ url: databaseUrl });
  return new PrismaClient({ adapter });
}

/**
 * Creates all tables in an empty SQLite file by running the SQL in prisma/migrations, oldest first.
 * Tests and the KPI replay use this because it is fast. The real app database is created by
 * `prisma migrate deploy` (see scripts/seed.ts), which also records the migration history.
 */
export function createTablesFromMigrations(databaseFile: string, migrationsDir: string): void {
  const folders = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const database = new Database(databaseFile);
  try {
    for (const folder of folders) {
      database.exec(readFileSync(path.join(migrationsDir, folder, "migration.sql"), "utf8"));
    }
  } finally {
    database.close();
  }
}
