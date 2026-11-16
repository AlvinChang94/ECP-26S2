// What: the shape of data/golden/cases.json and context.json (the golden dataset), with Zod checks for reading them back.
// Who calls it: the generator (writes the files), scripts/golden-runner.ts and tests/golden (read them).
// To extend: add a property here first, then to the generator and the runner. For Spectra's real samples, write cases.json by hand.
import { z } from "zod";

const ExpectedFlagSchema = z.object({
  code: z.string(),
  /** When set, the flag must be about this field (for example "lines[0].partNo" or "awb_bl"). */
  field: z.string().optional(),
});

const GoldenDocumentSchema = z.object({
  /** Path relative to data/golden. */
  file: z.string(),
  expectedType: z.string(),
  /** Field key -> the exact text a reader should find, or null when the field is not on the page. */
  expectedFields: z.record(z.string(), z.string().nullable()),
});

export const GoldenCaseSchema = z.object({
  id: z.string(),
  title: z.string(),
  story: z.number().int(),
  /** Which rules to run after extraction. */
  kind: z.enum(["customer_po", "proof_of_payment", "shipment", "classify_only"]),
  documents: z.array(GoldenDocumentSchema).min(1),
  shipment: z.object({ direction: z.enum(["inbound", "outbound"]), reference: z.string() }).optional(),
  expectedFlags: z.array(ExpectedFlagSchema),
  note: z.string().optional(),
});

export const GoldenCasesFileSchema = z.object({
  _note: z.string(),
  seed: z.string(),
  cases: z.array(GoldenCaseSchema),
});

/** Things that exist "already" when a golden case is checked: remembered aliases, earlier orders, open PIs, earlier proofs. */
export const GoldenContextSchema = z.object({
  _note: z.string(),
  now: z.string(),
  aliases: z.array(z.object({ fromPartNo: z.string(), toItemNo: z.string() })),
  existingOrders: z.array(
    z.object({ orderNo: z.string(), poNumber: z.string(), customerName: z.string(), status: z.enum(["open", "cancelled"]) }),
  ),
  openInvoices: z.array(
    z.object({
      orderNo: z.string(),
      piNumber: z.string(),
      poNumber: z.string(),
      customerName: z.string(),
      currency: z.string(),
      amount: z.string(),
    }),
  ),
  priorProofs: z.array(
    z.object({ reference: z.string(), amount: z.string(), currency: z.string(), payerName: z.string() }),
  ),
});

export type GoldenCase = z.infer<typeof GoldenCaseSchema>;
export type GoldenDocument = z.infer<typeof GoldenDocumentSchema>;
export type GoldenCasesFile = z.infer<typeof GoldenCasesFileSchema>;
export type GoldenContext = z.infer<typeof GoldenContextSchema>;
export type ExpectedFlag = z.infer<typeof ExpectedFlagSchema>;
