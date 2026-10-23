import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "@/generated/prisma/client";
import { getEnv } from "@/lib/env";

function createClient(): PrismaClient {
  const url = new URL(getEnv().DATABASE_URL);
  const adapter = new PrismaMariaDb({
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ""),
    connectionLimit: 5,
    // MySQL 8's default caching_sha2_password auth needs this over a non-TLS localhost connection.
    allowPublicKeyRetrieval: true,
  });
  return new PrismaClient({ adapter });
}

// Reuse one client across hot reloads in dev.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export function getDb(): PrismaClient {
  globalForPrisma.prisma ??= createClient();
  return globalForPrisma.prisma;
}
