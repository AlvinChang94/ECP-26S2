// What: creates the Prisma database client: SQLite on a laptop (better-sqlite3), MySQL on Amazon RDS (mariadb driver), chosen by DATABASE_URL.
// Who calls it: getDeps() for the app, scripts/seed.ts, and test helpers (each test gets its own temporary SQLite file).
// To extend: nothing else imports a database driver. The MySQL schema is generated from prisma/schema.prisma (scripts/make-mysql-schema.mjs).
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import Database from "better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaClient as MysqlPrismaClient } from "@/generated/prisma-mysql/client";

export type Db = PrismaClient;

// Row types of the tables, re-exported so the rest of the code never imports the generated client directly.
export type {
  ApprovalToken as ApprovalTokenRow,
  AuditEvent as AuditEventRow,
  Delivery as DeliveryRow,
  Document as DocumentRow,
  FlagDecision as FlagDecisionRow,
  Order as OrderRow,
  OutboxMessage as OutboxMessageRow,
  PartAlias as PartAliasRow,
  PaymentProof as PaymentProofRow,
  PoVersion as PoVersionRow,
  ScheduledJob as ScheduledJobRow,
  Shipment as ShipmentRow,
  ShipmentDocument as ShipmentDocumentRow,
  Spr as SprRow,
} from "@/generated/prisma/client";

/**
 * `databaseUrl` is "file:C:/path/to/orderflow.db" (config.ts makes the path absolute) or "mysql://user:password@host:3306/orderflow".
 * `ssl` is true on Amazon RDS: the connection is encrypted and the server certificate is checked
 * (the RDS certificate bundle is added to Node's trusted list with NODE_EXTRA_CA_CERTS, see infra/ec2/setup.sh).
 */
export function createDb(databaseUrl: string, options: { ssl?: boolean } = {}): Db {
  if (databaseUrl.startsWith("mysql://")) {
    const url = new URL(databaseUrl);
    const adapter = new PrismaMariaDb({
      host: url.hostname,
      port: Number(url.port || 3306),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: url.pathname.replace(/^\//, ""),
      connectionLimit: 5,
      // RDS: TLS with the certificate checked. A local MySQL without TLS needs the server's key to check the password instead.
      ...(options.ssl ? { ssl: { rejectUnauthorized: true } } : { allowPublicKeyRetrieval: true }),
    });
    // Both clients come from the same models, so their methods and row types are the same; only the driver differs.
    // TypeScript sees two separately generated classes, hence the cast through unknown.
    return new MysqlPrismaClient({ adapter }) as unknown as Db;
  }
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
