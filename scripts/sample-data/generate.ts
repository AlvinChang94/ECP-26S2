// What: writes all synthetic sample data to a folder: Navision files, golden dataset, seed PDFs, Inbox PDFs and the replay history.
// Who calls it: scripts/generate-sample-data.ts (into ./data) and the determinism test (into a temporary folder).
// To extend: add a new data set here. Everything must come from fixed values or the seeded generator, so two runs are identical.
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  CustomerOrdersFileSchema,
  CustomersFileSchema,
  GoodsReceiptsFileSchema,
  ItemsFileSchema,
  PurchaseOrdersFileSchema,
  StaffFileSchema,
  VendorsFileSchema,
} from "../../src/adapters/navision/schemas";
import type { NavGoodsReceipt, NavOpenOrder, NavPurchaseOrder } from "../../src/domain/navision";
import { buildGoldenDataset } from "./golden";
import { GoldenCasesFileSchema, GoldenContextSchema } from "./goldenTypes";
import { CUSTOMERS, DEMO_NOW, ITEMS, STAFF, SYNTHETIC_NOTE, VENDORS } from "./master";
import { buildReplayDataset, REPLAY_SEED } from "./replay";
import { ReplayFileSchema } from "./replayTypes";
import {
  buildInboxFiles,
  buildSeedFiles,
  DEMO_CUSTOMER_ORDERS,
  DEMO_GOODS_RECEIPTS,
  DEMO_PURCHASE_ORDERS,
} from "./scenario";

export const GOLDEN_SEED = "spectra-orderflow-golden-v1";

export type GenerationSummary = { files: number; goldenCases: number; replayOrders: number; replayReceipts: number };

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

async function writeBytes(filePath: string, bytes: Uint8Array): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, bytes);
}

/** Writes one complete mock-Navision folder. Each file is checked against its schema before it is written. */
async function writeNavisionFolder(
  dir: string,
  transactions: { customerOrders: NavOpenOrder[]; purchaseOrders: NavPurchaseOrder[]; goodsReceipts: NavGoodsReceipt[] },
): Promise<number> {
  await writeJson(path.join(dir, "items.json"), ItemsFileSchema.parse({ _note: SYNTHETIC_NOTE, items: ITEMS }));
  await writeJson(path.join(dir, "customers.json"), CustomersFileSchema.parse({ _note: SYNTHETIC_NOTE, customers: CUSTOMERS }));
  await writeJson(path.join(dir, "vendors.json"), VendorsFileSchema.parse({ _note: SYNTHETIC_NOTE, vendors: VENDORS }));
  await writeJson(path.join(dir, "staff.json"), StaffFileSchema.parse({ _note: SYNTHETIC_NOTE, ...STAFF }));
  await writeJson(
    path.join(dir, "customerOrders.json"),
    CustomerOrdersFileSchema.parse({ _note: SYNTHETIC_NOTE, customerOrders: transactions.customerOrders }),
  );
  await writeJson(
    path.join(dir, "purchaseOrders.json"),
    PurchaseOrdersFileSchema.parse({ _note: SYNTHETIC_NOTE, purchaseOrders: transactions.purchaseOrders }),
  );
  await writeJson(
    path.join(dir, "goodsReceipts.json"),
    GoodsReceiptsFileSchema.parse({ _note: SYNTHETIC_NOTE, goodsReceipts: transactions.goodsReceipts }),
  );
  return 7;
}

export async function generateSampleData(dataDir: string): Promise<GenerationSummary> {
  let files = 0;

  // 1. Mock Navision for the demo. The export/ folder (written by the app) is left alone.
  files += await writeNavisionFolder(path.join(dataDir, "navision"), {
    customerOrders: DEMO_CUSTOMER_ORDERS,
    purchaseOrders: DEMO_PURCHASE_ORDERS,
    goodsReceipts: DEMO_GOODS_RECEIPTS,
  });
  await mkdir(path.join(dataDir, "navision", "export"), { recursive: true });
  await writeFile(path.join(dataDir, "navision", "export", ".gitkeep"), "", "utf8");

  // 2. Golden dataset, with its own small Navision folder so tests never depend on the demo files.
  const golden = await buildGoldenDataset();
  const goldenDir = path.join(dataDir, "golden");
  await rm(path.join(goldenDir, "files"), { recursive: true, force: true });
  for (const file of golden.files) await writeBytes(path.join(goldenDir, file.path), file.bytes);
  await writeJson(path.join(goldenDir, "cases.json"), GoldenCasesFileSchema.parse({ _note: SYNTHETIC_NOTE, seed: GOLDEN_SEED, cases: golden.cases }));
  await writeJson(path.join(goldenDir, "context.json"), GoldenContextSchema.parse(golden.context));
  files += golden.files.length + 2;
  files += await writeNavisionFolder(path.join(goldenDir, "navision"), {
    customerOrders: [],
    purchaseOrders: golden.purchaseOrders,
    goodsReceipts: golden.goodsReceipts,
  });

  // 3. PDFs the seed script loads to build the demo history.
  const seedDir = path.join(dataDir, "seed");
  await rm(seedDir, { recursive: true, force: true });
  const seedFiles = await buildSeedFiles();
  for (const file of seedFiles) await writeBytes(path.join(seedDir, file.path), file.bytes);
  files += seedFiles.length;

  // 4. Inbox: only our own files are (re)written; PDFs a person dropped into the folder are kept.
  const inbox = await buildInboxFiles();
  const inboxDir = path.join(dataDir, "inbox");
  for (const file of inbox.files) await writeBytes(path.join(inboxDir, file.path), file.bytes);
  await writeJson(path.join(inboxDir, "manifest.json"), {
    _note: SYNTHETIC_NOTE,
    messages: inbox.manifest.map((entry) => ({
      file: entry.file,
      channel: entry.channel,
      sender: entry.sender,
      receivedAt: new Date(DEMO_NOW.getTime() - entry.receivedMinutesAgo * 60 * 1000).toISOString(),
      purpose: entry.purpose,
    })),
  });
  files += inbox.files.length + 1;

  // 5. Six-month history for the KPI replay, again with its own Navision folder.
  const replay = await buildReplayDataset();
  const replayDir = path.join(dataDir, "replay");
  await rm(path.join(replayDir, "files"), { recursive: true, force: true });
  for (const file of replay.files) await writeBytes(path.join(replayDir, file.path), file.bytes);
  await writeJson(path.join(replayDir, "orders.json"), ReplayFileSchema.parse(replay.file));
  files += replay.files.length + 1;
  files += await writeNavisionFolder(path.join(replayDir, "navision"), {
    customerOrders: [],
    purchaseOrders: replay.purchaseOrders,
    goodsReceipts: replay.goodsReceipts,
  });

  return {
    files,
    goldenCases: golden.cases.length,
    replayOrders: replay.file.orders.length,
    replayReceipts: replay.file.receipts.length,
  };
}

export { REPLAY_SEED };
