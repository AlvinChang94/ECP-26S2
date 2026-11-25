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
  // AWS (docs/AWS_DEPLOY.md). Every value has a local default, so nothing here is needed on a laptop.
  AWS_REGION: z.string().default("ap-southeast-1"),
  STORAGE_BACKEND: z.enum(["local", "s3"]).default("local"),
  S3_BUCKET: z.string().optional(),
  NOTIFIER: z.enum(["outbox", "ses"]).default("outbox"),
  SES_FROM_ADDRESS: z.string().email().optional(),
  SES_TEST_RECIPIENT: z.string().email().optional(),
  DATABASE_SSL: z.enum(["true", "false"]).default("false"),
  JOBS_SECRET: z.string().min(16).optional(),
});

export type AppConfig = {
  /** Where PDFs are kept: a local folder (storageDir) or an Amazon S3 bucket. */
  storage: { backend: "local" } | { backend: "s3"; bucket: string; region: string };
  /** How messages leave: only the Outbox table, or the Outbox table plus email through Amazon SES. */
  notifier: { kind: "outbox" } | { kind: "ses"; region: string; fromAddress: string; testRecipient: string | null };
  /** True for Amazon RDS: connect to MySQL over TLS (the RDS certificate bundle is given with NODE_EXTRA_CA_CERTS). */
  databaseSsl: boolean;
  /** Shared secret that EventBridge Scheduler's call to /api/jobs/run must send. Null = the endpoint is switched off. */
  jobsSecret: string | null;
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
    AWS_REGION: env.AWS_REGION || undefined,
    STORAGE_BACKEND: env.STORAGE_BACKEND || undefined,
    S3_BUCKET: env.S3_BUCKET || undefined,
    NOTIFIER: env.NOTIFIER || undefined,
    SES_FROM_ADDRESS: env.SES_FROM_ADDRESS || undefined,
    SES_TEST_RECIPIENT: env.SES_TEST_RECIPIENT || undefined,
    DATABASE_SSL: env.DATABASE_SSL || undefined,
    JOBS_SECRET: env.JOBS_SECRET || undefined,
  });
  // Settings that only make sense together. A clear message here beats a confusing AWS error later.
  if (parsed.STORAGE_BACKEND === "s3" && !parsed.S3_BUCKET) throw new Error("STORAGE_BACKEND=s3 needs S3_BUCKET (the bucket name from the CloudFormation outputs).");
  if (parsed.NOTIFIER === "ses" && !parsed.SES_FROM_ADDRESS) throw new Error("NOTIFIER=ses needs SES_FROM_ADDRESS (an email address verified in Amazon SES).");
  const databaseUrl = resolveDatabaseUrl(rootDir, parsed.DATABASE_URL);
  if (!databaseUrl.startsWith("file:") && !databaseUrl.startsWith("mysql://")) {
    throw new Error('DATABASE_URL must start with "file:" (SQLite on this computer) or "mysql://" (Amazon RDS). A value set in your terminal wins over .env.');
  }
  return {
    databaseUrl,
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
    storage: parsed.STORAGE_BACKEND === "s3" ? { backend: "s3", bucket: parsed.S3_BUCKET as string, region: parsed.AWS_REGION } : { backend: "local" },
    notifier:
      parsed.NOTIFIER === "ses"
        ? { kind: "ses", region: parsed.AWS_REGION, fromAddress: parsed.SES_FROM_ADDRESS as string, testRecipient: parsed.SES_TEST_RECIPIENT ?? null }
        : { kind: "outbox" },
    databaseSsl: parsed.DATABASE_SSL === "true",
    jobsSecret: parsed.JOBS_SECRET ?? null,
  };
}
