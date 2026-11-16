// What: reads settings from environment variables once, checks them with Zod, and fills in local defaults.
// Who calls it: getDeps() in src/services/deps.ts, scripts and tests (tests pass their own values to loadConfig).
// To extend: add the variable to EnvSchema, to AppConfig, and to .env.example with a one-line explanation.
import path from "node:path";
import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.string().default("file:./storage/orderflow.db"),
  NAVISION_DIR: z.string().default("data/navision"),
  INBOX_DIR: z.string().default("data/inbox"),
  STORAGE_DIR: z.string().default("storage"),
  APP_BASE_URL: z.string().default("http://localhost:3000"),
  APPROVAL_LINK_SECRET: z.string().min(8).default("local-demo-secret-change-me"),
  EXTRACTOR: z.enum(["default", "llm"]).default("default"),
  ANTHROPIC_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default("claude-opus-5-5"),
  SHOW_MARGIN: z.enum(["true", "false"]).default("false"),
  // Alert windows. Whole numbers written as text, for example "48".
  DOCUMENT_ALERT_WINDOW_HOURS: z.coerce.number().int().min(1).max(720).default(48),
  SHIP_DATE_ALERT_DAYS: z.coerce.number().int().min(0).max(60).default(2),
});

export type AppConfig = {
  /** Absolute path of the SQLite file, or a full connection URL once the database is MySQL. */
  databaseUrl: string;
  navisionDir: string;
  inboxDir: string;
  storageDir: string;
  appBaseUrl: string;
  approvalLinkSecret: string;
  extractor: "default" | "llm";
  anthropicApiKey: string | null;
  llmModel: string;
  showMargin: boolean;
  /** How long an SPR approval link stays valid. The deck's wireframe says 48 hours. */
  approvalLinkTtlHours: number;
  /** A missing required document raises an alert this many hours before its due date. */
  documentAlertWindowHours: number;
  /** Vendor payment reminders are written this many days before the due date. */
  vendorPaymentReminderDays: number[];
  /** A customer payment is "late" (nudge suggested) after this many days waiting. */
  latePaymentAfterDays: number;
  /** An order still open this many days before its promised ship date raises a ship-date alert. */
  shipDateAlertDays: number;
  /** Suggested promised ship date = PO arrival + this many days. A person must still confirm it. */
  suggestedShipLeadDays: number;
};

/** Relative paths are resolved from the project root (the folder you run npm from). */
function absolute(rootDir: string, value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(rootDir, value);
}

function resolveDatabaseUrl(rootDir: string, url: string): string {
  if (!url.startsWith("file:")) return url;
  return "file:" + absolute(rootDir, url.slice("file:".length));
}

export function loadConfig(env: Record<string, string | undefined> = process.env, rootDir: string = process.cwd()): AppConfig {
  const parsed = EnvSchema.parse({
    DATABASE_URL: env.DATABASE_URL || undefined,
    NAVISION_DIR: env.NAVISION_DIR || undefined,
    INBOX_DIR: env.INBOX_DIR || undefined,
    STORAGE_DIR: env.STORAGE_DIR || undefined,
    APP_BASE_URL: env.APP_BASE_URL || undefined,
    APPROVAL_LINK_SECRET: env.APPROVAL_LINK_SECRET || undefined,
    EXTRACTOR: env.EXTRACTOR || undefined,
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY || undefined,
    LLM_MODEL: env.LLM_MODEL || undefined,
    SHOW_MARGIN: env.SHOW_MARGIN || undefined,
    DOCUMENT_ALERT_WINDOW_HOURS: env.DOCUMENT_ALERT_WINDOW_HOURS || undefined,
    SHIP_DATE_ALERT_DAYS: env.SHIP_DATE_ALERT_DAYS || undefined,
  });
  return {
    databaseUrl: resolveDatabaseUrl(rootDir, parsed.DATABASE_URL),
    navisionDir: absolute(rootDir, parsed.NAVISION_DIR),
    inboxDir: absolute(rootDir, parsed.INBOX_DIR),
    storageDir: absolute(rootDir, parsed.STORAGE_DIR),
    appBaseUrl: parsed.APP_BASE_URL.replace(/\/$/, ""),
    approvalLinkSecret: parsed.APPROVAL_LINK_SECRET,
    extractor: parsed.EXTRACTOR,
    anthropicApiKey: parsed.ANTHROPIC_API_KEY ?? null,
    llmModel: parsed.LLM_MODEL,
    showMargin: parsed.SHOW_MARGIN === "true",
    approvalLinkTtlHours: 48,
    documentAlertWindowHours: parsed.DOCUMENT_ALERT_WINDOW_HOURS,
    vendorPaymentReminderDays: [3, 1],
    latePaymentAfterDays: 7,
    shipDateAlertDays: parsed.SHIP_DATE_ALERT_DAYS,
    suggestedShipLeadDays: 7,
  };
}
