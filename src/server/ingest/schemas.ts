import { z } from "zod";

/**
 * An extraction schema describes ONE record (e.g. one invoice line or one payment).
 * `jsonSchema` is sent to Bedrock as the forced tool's input schema; `parse` validates
 * what comes back. Bump `version` whenever the shape changes: it is part of the cache key.
 */
export interface ExtractionSchema<T extends Record<string, unknown> = Record<string, unknown>> {
  name: string;
  version: number;
  description: string;
  jsonSchema: Record<string, unknown>;
  parse(fields: unknown): T;
}

export function defineExtractionSchema<S extends z.ZodObject>(
  name: string,
  version: number,
  description: string,
  schema: S,
): ExtractionSchema<z.infer<S>> {
  const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
  delete jsonSchema.$schema; // Bedrock wants the bare schema
  return { name, version, description, jsonSchema, parse: (fields) => schema.parse(fields) };
}

// Decimals are extracted as strings exactly as printed (minus thousands separators).
const decimal = z.string().regex(/^-?\d+(\.\d+)?$/, "decimal as a string, e.g. 1250.00");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date as YYYY-MM-DD");

export const orderLineSchemaV1 = defineExtractionSchema(
  "order-line",
  1,
  "One line item on a purchase order, invoice or delivery order",
  z.object({
    documentNumber: z.string().describe("PO, invoice or delivery order number"),
    lineNo: z.number().int(),
    sku: z.string(),
    description: z.string(),
    quantity: decimal,
    uom: z.string().describe("Unit of measure as printed, e.g. PCS, CTN"),
    unitPrice: decimal.nullable(),
    weightKg: decimal.nullable(),
  }),
);

export const paymentProofSchemaV1 = defineExtractionSchema(
  "payment-proof",
  1,
  "One payment shown on a bank slip, transfer screenshot, remittance advice or statement",
  z.object({
    payerName: z.string(),
    amount: decimal,
    currency: z.string().length(3),
    valueDate: isoDate,
    reference: z.string().nullable().describe("Payer's reference or memo text, verbatim"),
    bankReference: z.string().nullable(),
  }),
);

export const EXTRACTION_SCHEMAS: Record<string, ExtractionSchema> = Object.fromEntries(
  [orderLineSchemaV1, paymentProofSchemaV1].map((s) => [`${s.name}@${s.version}`, s]),
);
