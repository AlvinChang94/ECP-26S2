// What: builds the set of adapters ("deps") that every service function receives as its first argument.
// Who calls it: pages, server actions and route handlers call getDeps(); tests build their own Deps with fakes.
// To extend: to swap an adapter (a real Navision API, for example), change what is created here. Services do not change.
import { type Clock, OffsetClock } from "@/adapters/clock";
import { type AppConfig, loadConfig } from "@/adapters/config";
import { createDb, type Db } from "@/adapters/db";
import { createExtractor } from "@/adapters/extractor";
import { createAnthropicReader, type LlmReader } from "@/adapters/extractor/llm";
import type { DocumentExtractor } from "@/adapters/extractor/types";
import { type FileStore, LocalFileStore } from "@/adapters/fileStore";
import { FolderInboxSource, type InboxSource } from "@/adapters/inbox";
import { FileNavisionGateway } from "@/adapters/navision/fileGateway";
import type { NavisionGateway } from "@/adapters/navision/gateway";
import { type Notifier, OutboxNotifier } from "@/adapters/notifier";
import { S3FileStore } from "@/adapters/s3FileStore";
import { SesNotifier } from "@/adapters/sesNotifier";

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
  /** Only set when EXTRACTOR=llm. Used to reword a reminder draft; never to decide anything. */
  llm: LlmReader | null;
  config: AppConfig;
};

/**
 * Builds a full set of local adapters for a given configuration and clock.
 * Scripts (seed, replay) and tests use this with a FakeClock and their own folders.
 */
export function buildDeps(config: AppConfig, clock: Clock, overrides: Partial<Deps> = {}): Deps {
  const db = overrides.db ?? createDb(config.databaseUrl, { ssl: config.databaseSsl });
  return {
    config,
    clock,
    db,
    navision: new FileNavisionGateway(config.navisionDir),
    extractor: createExtractor(config),
    files: createFileStore(config),
    inbox: new FolderInboxSource(config.inboxDir),
    llm: config.extractor === "llm" ? createAnthropicReader(config) : null,
    notifier: createNotifier(config, db, clock),
    ...overrides,
  };
}

/** A local folder, or the S3 bucket when STORAGE_BACKEND=s3. */
function createFileStore(config: AppConfig): FileStore {
  return config.storage.backend === "s3" ? new S3FileStore(config.storage.bucket, config.storage.region) : new LocalFileStore(config.storageDir);
}

/** The Outbox only, or the Outbox plus email through Amazon SES when NOTIFIER=ses. */
function createNotifier(config: AppConfig, db: Db, clock: Clock): Notifier {
  if (config.notifier.kind === "ses") {
    const { region, fromAddress, testRecipient } = config.notifier;
    return new SesNotifier(db, clock, { region, fromAddress, testRecipient });
  }
  return new OutboxNotifier(db, clock);
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
      db: createDb(config.databaseUrl, { ssl: config.databaseSsl }),
      navision: new FileNavisionGateway(config.navisionDir),
      extractor: createExtractor(config),
      files: createFileStore(config),
      inbox: new FolderInboxSource(config.inboxDir),
      llm: config.extractor === "llm" ? createAnthropicReader(config) : null,
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
  return { ...base, clock, notifier: createNotifier(base.config, base.db, clock) };
}
