// What: builds the set of adapters ("deps") that every service function receives as its first argument.
// Who calls it: pages, server actions and route handlers call getDeps(); tests build their own Deps with fakes.
// To extend: to swap an adapter (S3, SES, a real Navision API), change what is created here. Services do not change.
import { type Clock, OffsetClock } from "@/adapters/clock";
import { type AppConfig, loadConfig } from "@/adapters/config";
import { createDb, type Db } from "@/adapters/db";
import { createExtractor } from "@/adapters/extractor";
import type { DocumentExtractor } from "@/adapters/extractor/types";
import { type FileStore, LocalFileStore } from "@/adapters/fileStore";
import { FolderInboxSource, type InboxSource } from "@/adapters/inbox";
import { FileNavisionGateway } from "@/adapters/navision/fileGateway";
import type { NavisionGateway } from "@/adapters/navision/gateway";
import { type Notifier, OutboxNotifier } from "@/adapters/notifier";

/** Everything a service needs from the outside world. Services never import an adapter directly. */
export type Deps = {
  db: Db;
  navision: NavisionGateway;
  extractor: DocumentExtractor;
  notifier: Notifier;
  clock: Clock;
  files: FileStore;
  /** Where forwarded PDFs wait (simulated email and WhatsApp). */
  inbox: InboxSource;
  config: AppConfig;
};

/**
 * Builds a full set of local adapters for a given configuration and clock.
 * Scripts (seed, replay) and tests use this with a FakeClock and their own folders.
 */
export function buildDeps(config: AppConfig, clock: Clock, overrides: Partial<Deps> = {}): Deps {
  const db = overrides.db ?? createDb(config.databaseUrl);
  return {
    config,
    clock,
    db,
    navision: new FileNavisionGateway(config.navisionDir),
    extractor: createExtractor(config),
    files: new LocalFileStore(config.storageDir),
    inbox: new FolderInboxSource(config.inboxDir),
    notifier: new OutboxNotifier(db, clock),
    ...overrides,
  };
}

type LongLived = Omit<Deps, "clock" | "notifier">;

// Next.js reloads modules while you edit in development. Keeping these on globalThis avoids opening
// a new database connection on every reload.
const globalStore = globalThis as unknown as { orderflowLongLived?: LongLived };

function longLived(): LongLived {
  if (!globalStore.orderflowLongLived) {
    const config = loadConfig();
    globalStore.orderflowLongLived = {
      config,
      db: createDb(config.databaseUrl),
      navision: new FileNavisionGateway(config.navisionDir),
      extractor: createExtractor(config),
      files: new LocalFileStore(config.storageDir),
      inbox: new FolderInboxSource(config.inboxDir),
    };
  }
  return globalStore.orderflowLongLived;
}

export const CLOCK_OFFSET_SETTING = "clockOffsetMs";

/** The demo clock is real time plus an offset stored in the database (set by the seed, moved by the demo buttons). */
export async function readClockOffsetMs(db: Db): Promise<number> {
  const setting = await db.appSetting.findUnique({ where: { key: CLOCK_OFFSET_SETTING } });
  const offset = setting ? Number.parseInt(setting.value, 10) : 0;
  return Number.isFinite(offset) ? offset : 0;
}

export async function getDeps(): Promise<Deps> {
  const base = longLived();
  const clock = new OffsetClock(await readClockOffsetMs(base.db));
  return { ...base, clock, notifier: new OutboxNotifier(base.db, clock) };
}
