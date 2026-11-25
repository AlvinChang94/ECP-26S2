// What: tests for the AWS pieces without an AWS account: S3 file store and SES notifier with fake clients, the AWS settings, the jobs secret, the MySQL schema.
// Who calls it: `npm test`.
// To extend: give a new AWS adapter a client parameter (like S3FileStore and SesNotifier) so a fake can be passed here.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { GetObjectCommand, HeadObjectCommand, NotFound, PutObjectCommand } from "@aws-sdk/client-s3";
import { SendEmailCommand } from "@aws-sdk/client-sesv2";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "@/adapters/config";
import { S3FileStore, type S3Sender } from "@/adapters/s3FileStore";
import { SesNotifier, type SesSender } from "@/adapters/sesNotifier";
import { jobsSecretMatches } from "@/app/_lib/jobsAuth";
import type { OutgoingMessage } from "@/domain/notifications";
import { sendDraft } from "@/services/outbox";
import { createWorkspace, FARAH, PROJECT_ROOT, type TestWorkspace } from "../helpers/workspace";

describe("AWS settings", () => {
  const load = (env: Record<string, string>) => loadConfig(env, PROJECT_ROOT);

  it("uses local storage, the Outbox only and SQLite when nothing is set", () => {
    const config = load({});
    expect(config.storage).toEqual({ backend: "local" });
    expect(config.notifier).toEqual({ kind: "outbox" });
    expect(config.databaseUrl.startsWith("file:")).toBe(true);
    expect(config.jobsSecret).toBeNull();
  });

  it("reads the S3, SES and MySQL settings the server's .env contains", () => {
    const config = load({
      AWS_REGION: "ap-southeast-1",
      STORAGE_BACKEND: "s3",
      S3_BUCKET: "orderflow-docs",
      NOTIFIER: "ses",
      SES_FROM_ADDRESS: "orderflow@team.example",
      SES_TEST_RECIPIENT: "inbox@team.example",
      DATABASE_URL: "mysql://admin:p%40ss@db.example:3306/orderflow",
      DATABASE_SSL: "true",
      JOBS_SECRET: "a-long-enough-shared-secret",
    });
    expect(config.storage).toEqual({ backend: "s3", bucket: "orderflow-docs", region: "ap-southeast-1" });
    expect(config.notifier).toEqual({ kind: "ses", region: "ap-southeast-1", fromAddress: "orderflow@team.example", testRecipient: "inbox@team.example" });
    expect(config.databaseUrl).toBe("mysql://admin:p%40ss@db.example:3306/orderflow");
    expect(config.databaseSsl).toBe(true);
    expect(config.jobsSecret).toBe("a-long-enough-shared-secret");
  });

  it.each([
    ["S3 without a bucket", { STORAGE_BACKEND: "s3" }, /S3_BUCKET/],
    ["SES without a sender", { NOTIFIER: "ses" }, /SES_FROM_ADDRESS/],
    ["a database URL that is neither SQLite nor MySQL", { DATABASE_URL: "postgres://x@y/z" }, /file:.*mysql:\/\//],
    ["a jobs secret that is too short", { JOBS_SECRET: "short" }, /JOBS_SECRET/],
  ])("refuses %s with a clear message", (_name, env, message) => {
    expect(() => load(env)).toThrow(message);
  });
});

describe("S3FileStore", () => {
  /** A fake S3: remembers what was put and answers get and head from it. */
  function fakeS3(): { sender: S3Sender; calls: { name: string; input: Record<string, unknown> }[] } {
    const objects = new Map<string, Uint8Array>();
    const calls: { name: string; input: Record<string, unknown> }[] = [];
    const sender = {
      send: async (command: unknown) => {
        if (command instanceof PutObjectCommand) {
          calls.push({ name: "put", input: { ...command.input } });
          objects.set(command.input.Key as string, command.input.Body as Uint8Array);
          return {};
        }
        if (command instanceof GetObjectCommand) {
          const bytes = objects.get(command.input.Key as string);
          if (!bytes) throw new Error("NoSuchKey");
          return { Body: { transformToByteArray: async () => bytes } };
        }
        if (command instanceof HeadObjectCommand) {
          if (!objects.has(command.input.Key as string)) throw new NotFound({ message: "Not Found", $metadata: {} });
          return {};
        }
        throw new Error("unexpected command");
      },
    } as unknown as S3Sender;
    return { sender, calls };
  }

  it("stores and reads back a PDF in the bucket, as a PDF", async () => {
    const { sender, calls } = fakeS3();
    const store = new S3FileStore("orderflow-docs", "ap-southeast-1", sender);
    const bytes = new TextEncoder().encode("%PDF-1.7 sample");
    expect(await store.exists("documents/abc.pdf")).toBe(false);
    await store.put("documents/abc.pdf", bytes);
    expect(calls[0].input).toMatchObject({ Bucket: "orderflow-docs", Key: "documents/abc.pdf", ContentType: "application/pdf" });
    expect(await store.exists("documents/abc.pdf")).toBe(true);
    expect(new TextDecoder().decode(await store.get("documents/abc.pdf"))).toBe("%PDF-1.7 sample");
  });

  it.each(["../secret.pdf", "/documents/a.pdf", "documents/../../a.pdf", "documents\\a.pdf", ""])("refuses the key %j", async (key) => {
    const store = new S3FileStore("orderflow-docs", "ap-southeast-1", fakeS3().sender);
    await expect(store.put(key, new Uint8Array([1]))).rejects.toThrow(/valid file key/);
  });
});

describe("SesNotifier", () => {
  let workspace: TestWorkspace;
  let sent: { to: string[]; subject: string; body: string; from: string }[];
  let failNext: boolean;

  const fakeSes = {
    send: async (command: unknown) => {
      if (!(command instanceof SendEmailCommand)) throw new Error("unexpected command");
      if (failNext) {
        failNext = false;
        throw Object.assign(new Error("Email address is not verified."), { name: "MessageRejected" });
      }
      const input = command.input;
      sent.push({
        to: input.Destination?.ToAddresses ?? [],
        subject: input.Content?.Simple?.Subject?.Data ?? "",
        body: input.Content?.Simple?.Body?.Text?.Data ?? "",
        from: input.FromEmailAddress ?? "",
      });
      return { MessageId: "fake" };
    },
  } as unknown as SesSender;

  const message = (changes: Partial<OutgoingMessage> = {}): OutgoingMessage => ({
    type: "spr_approval_request",
    channel: "email",
    toName: "Janet",
    toAddress: "janet@spectra.example",
    subject: "SPR-0007: approval needed for 10 x UPS-650",
    body: "Hello Janet, please decide: http://localhost:3000/approve/abc",
    entityType: "spr",
    entityId: "SPR-0007",
    ...changes,
  });

  beforeEach(() => {
    workspace = createWorkspace();
    sent = [];
    failNext = false;
  });
  afterEach(async () => {
    await workspace.cleanup();
  });

  const notifier = (testRecipient: string | null = "team-inbox@example.org") =>
    new SesNotifier(workspace.deps.db, workspace.clock, { region: "ap-southeast-1", fromAddress: "orderflow@example.org", testRecipient }, fakeSes);

  it("writes the Outbox row and emails it; with a test recipient, the real recipient is named at the top", async () => {
    const { id } = await notifier().send(message());
    expect(sent).toEqual([
      {
        to: ["team-inbox@example.org"],
        from: "orderflow@example.org",
        subject: "[OrderFlow test] SPR-0007: approval needed for 10 x UPS-650",
        body: "Test copy. In real use this would go to Janet <janet@spectra.example>.\n\nHello Janet, please decide: http://localhost:3000/approve/abc",
      },
    ]);
    const row = await workspace.deps.db.outboxMessage.findUniqueOrThrow({ where: { id } });
    expect(row.deliveredAt?.toISOString()).toBe(workspace.clock.now().toISOString());
    expect(row.deliveryError).toBeNull();
  });

  it("sends to the real recipient when no test recipient is set", async () => {
    await notifier(null).send(message());
    expect(sent[0].to).toEqual(["janet@spectra.example"]);
    expect(sent[0].subject).toBe("SPR-0007: approval needed for 10 x UPS-650");
  });

  it("never emails the same reminder twice (the Outbox dedupe key still applies)", async () => {
    await notifier().send(message({ dedupeKey: "spr-reminder:SPR-0007:24h" }));
    const again = await notifier().send(message({ dedupeKey: "spr-reminder:SPR-0007:24h" }));
    expect(again.duplicate).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it("keeps a draft in the Outbox until Finance sends it, then emails the reviewed text", async () => {
    const ses = notifier();
    const { id } = await ses.send(message({ type: "customer_payment_reminder", status: "draft", toName: "Lanka Tech", toAddress: "ap@lanka.example", subject: "Payment reminder", body: "Draft text" }));
    expect(sent).toHaveLength(0);
    await sendDraft({ ...workspace.deps, notifier: ses }, FARAH, id, { subject: "Payment reminder for PI-1001", body: "Reviewed text" });
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe("[OrderFlow test] Payment reminder for PI-1001");
    expect(sent[0].body).toContain("Reviewed text");
  });

  it("records an SES failure on the Outbox row instead of losing the message or stopping the work", async () => {
    failNext = true;
    const { id } = await notifier().send(message());
    const row = await workspace.deps.db.outboxMessage.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("sent");
    expect(row.deliveredAt).toBeNull();
    expect(row.deliveryError).toBe("SES could not send it: MessageRejected: Email address is not verified.");
  });

  it("does not try to email something that is not an email address", async () => {
    const { id } = await notifier(null).send(message({ toAddress: "(no email address on the customer card)" }));
    expect(sent).toHaveLength(0);
    const row = await workspace.deps.db.outboxMessage.findUniqueOrThrow({ where: { id } });
    expect(row.deliveryError).toContain("is not an email address");
  });
});

describe("the jobs endpoint's secret", () => {
  it.each([
    ["the right secret", "a-long-enough-shared-secret", "a-long-enough-shared-secret", true],
    ["a wrong secret", "a-long-enough-shared-secret", "a-long-enough-shared-secreT", false],
    ["no secret sent", "a-long-enough-shared-secret", null, false],
    ["no secret configured (endpoint switched off)", null, "anything", false],
    ["nothing at all", null, null, false],
  ])("%s", (_name, configured, provided, expected) => {
    expect(jobsSecretMatches(configured, provided)).toBe(expected);
  });
});

describe("the MySQL schema for Amazon RDS", () => {
  it("is up to date with prisma/schema.prisma", () => {
    expect(() => execFileSync(process.execPath, [path.join(PROJECT_ROOT, "scripts", "make-mysql-schema.mjs"), "--check"], { stdio: "pipe" })).not.toThrow();
  });
});
