// What: the shape of data/replay/orders.json (the six-month synthetic history for the KPI replay), with Zod checks.
// Who calls it: the generator writes it; scripts/replay.ts reads it.
// To extend: when Spectra's real six-month sample arrives, produce a file of this shape from it (see data/README.md).
import { z } from "zod";

/** What the simulated staff member does about a seeded error during the replay. */
const ResolutionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("use_suggestion") }),
  z.object({ action: z.literal("override"), reason: z.string() }),
  z.object({ action: z.literal("set_value"), field: z.string(), value: z.string() }),
  z.object({ action: z.literal("propose_customer_card") }),
  z.object({ action: z.literal("none") }),
]);

const SeededErrorSchema = z.object({
  /** The flag code the solution is expected to raise for this error. */
  code: z.string(),
  field: z.string(),
  detail: z.string(),
  resolution: ResolutionSchema,
});

export const ReplayOrderSchema = z.object({
  id: z.string(),
  poFile: z.string(),
  poNumber: z.string(),
  customerName: z.string(),
  channel: z.enum(["email", "whatsapp"]),
  /** Email or WhatsApp timestamp of the PO. */
  arrivedAt: z.string(),
  lineCount: z.number().int(),
  seededErrors: z.array(SeededErrorSchema),
  /** Present when the order needs an SPR (quantity above stock). */
  spr: z.object({ partNo: z.string(), quantity: z.number().int() }).nullable(),
  /** What happened in the (synthetic) past, before the solution existed. */
  baseline: z.object({
    navisionCreatedAt: z.string(),
    sprSubmittedAt: z.string().nullable(),
    sprDecidedAt: z.string().nullable(),
    promisedShipDate: z.string(),
    actualShipDate: z.string(),
  }),
});

export const ReplayReceiptSchema = z.object({
  id: z.string(),
  poNumber: z.string(),
  vendorName: z.string(),
  arrivedAt: z.string(),
  invoiceFile: z.string(),
  packingListFile: z.string(),
  lineCount: z.number().int(),
  seededErrors: z.array(z.object({ code: z.string(), field: z.string(), detail: z.string() })),
});

export const ReplayFileSchema = z.object({
  _note: z.string(),
  seed: z.string(),
  period: z.object({ from: z.string(), to: z.string() }),
  orders: z.array(ReplayOrderSchema),
  receipts: z.array(ReplayReceiptSchema),
});

export type ReplayOrder = z.infer<typeof ReplayOrderSchema>;
export type ReplayReceipt = z.infer<typeof ReplayReceiptSchema>;
export type ReplayFile = z.infer<typeof ReplayFileSchema>;
export type ReplaySeededError = z.infer<typeof SeededErrorSchema>;
