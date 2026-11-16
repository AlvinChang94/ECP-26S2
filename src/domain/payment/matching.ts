// What: matches a proof of payment to a proforma invoice (PI) by deterministic rules: exact, short, over or no match.
// Who calls it: the payments service (with the open PIs from the database) and the golden test.
// To extend: add a rule as a flag here. The result is only evidence for Finance; nothing is ever marked paid by this code.
import type { FieldValues } from "../fields";
import { type Flag, makeFlag } from "../flags";
import { displayMoney, formatMoney, parseMoney } from "../money";

/** A PI that has been issued and not yet confirmed paid. */
export type OpenInvoice = {
  orderNo: string;
  piNumber: string;
  poNumber: string | null;
  customerName: string;
  currency: string;
  amount: string;
};

export type ProofData = {
  payerName: string | null;
  amount: string | null;
  currency: string | null;
  paymentDate: string | null;
  reference: string | null;
  bankReference: string | null;
};

/** An earlier proof, used to spot the same proof arriving twice. */
export type PriorProof = { reference: string | null; amount: string | null; currency: string | null; payerName: string | null };

export type MatchOutcome = "exact" | "short" | "over" | "no_match";

export type MatchResult = {
  result: MatchOutcome;
  /** The PI the proof was matched to, when its reference (or a person) identified one. */
  invoice: OpenInvoice | null;
  /** Paid amount minus PI amount, as a decimal string ("-80.00" means 80.00 short). Null when they cannot be compared. */
  difference: string | null;
  flags: Flag[];
};

export function toProofData(values: FieldValues): ProofData {
  return {
    payerName: values.payerName ?? null,
    amount: values.amount ?? null,
    currency: values.currency ?? null,
    paymentDate: values.paymentDate ?? null,
    reference: values.reference ?? null,
    bankReference: values.bankReference ?? null,
  };
}

/** "pi-0901 / inv" -> "PI0901INV": letters and digits only, so spacing and punctuation do not matter. */
export function normalizeReference(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * A pattern that finds a number such as "PI-0901" inside a reference however it is punctuated ("PI0901", "PI 0901"),
 * but not as part of a longer number ("PI-09011"). Numbers shorter than four characters are too vague to match on.
 */
function numberPattern(number: string): RegExp | null {
  const chunks = number
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((chunk) => chunk.length > 0);
  if (chunks.join("").length < 4) return null;
  return new RegExp(`(?<![A-Z0-9])${chunks.join("[^A-Z0-9]*")}(?![A-Z0-9])`);
}

/** Invoices whose PI number, PO number or order number appears in the proof's reference. */
export function invoicesNamedBy(reference: string, invoices: OpenInvoice[]): OpenInvoice[] {
  const text = reference.toUpperCase();
  return invoices.filter((invoice) =>
    [invoice.piNumber, invoice.orderNo, invoice.poNumber ?? ""].some((number) => numberPattern(number)?.test(text) === true),
  );
}

function missingFieldFlags(proof: ProofData): Flag[] {
  const flags: Flag[] = [];
  if (!proof.amount) {
    flags.push(makeFlag({ code: "MISSING_FIELD", field: "amount", reason: "The paid amount could not be read from the proof. Type it in from the PDF." }));
  } else if (parseMoney(proof.amount) === null) {
    flags.push(makeFlag({ code: "INVALID_VALUE", field: "amount", reason: `The paid amount "${proof.amount}" is not a valid amount.`, values: [proof.amount] }));
  }
  if (!proof.currency) {
    flags.push(makeFlag({ code: "MISSING_FIELD", field: "currency", reason: "The currency could not be read from the proof. Type it in from the PDF." }));
  }
  if (!proof.reference) {
    flags.push(makeFlag({ code: "MISSING_FIELD", field: "reference", reason: "The payment reference could not be read from the proof. Type it in from the PDF." }));
  }
  return flags;
}

/** Compares currency and amount with one PI. Assumes the proof's amount is a valid number. */
function compareWithInvoice(proof: ProofData, invoice: OpenInvoice): Pick<MatchResult, "result" | "difference" | "flags"> {
  if (proof.currency && proof.currency.toUpperCase() !== invoice.currency.toUpperCase()) {
    return {
      result: "no_match",
      difference: null,
      flags: [
        makeFlag({
          code: "PAYMENT_CURRENCY_MISMATCH",
          field: "currency",
          reason: `The proof is in ${proof.currency} but ${invoice.piNumber} is in ${invoice.currency}, so the amounts cannot be compared.`,
          values: [proof.currency, invoice.currency, invoice.piNumber],
        }),
      ],
    };
  }
  const paid = parseMoney(proof.amount);
  const due = parseMoney(invoice.amount);
  if (paid === null || due === null) return { result: "no_match", difference: null, flags: [] };
  const difference = paid.minus(due);
  if (difference.isZero()) return { result: "exact", difference: "0.00", flags: [] };
  const short = difference.isNegative();
  const gap = displayMoney(formatMoney(difference.abs()));
  return {
    result: short ? "short" : "over",
    difference: formatMoney(difference),
    flags: [
      makeFlag({
        code: short ? "PAYMENT_SHORT" : "PAYMENT_OVER",
        field: "amount",
        reason: `Paid ${invoice.currency} ${displayMoney(proof.amount)}; ${invoice.piNumber} is ${invoice.currency} ${displayMoney(invoice.amount)}: ${gap} ${short ? "short" : "too much"}.`,
        values: [proof.amount, invoice.amount, invoice.piNumber],
        data: { paid: proof.amount as string, invoiced: invoice.amount, difference: formatMoney(difference) },
      }),
    ],
  };
}

function duplicateFlag(proof: ProofData, priorProofs: PriorProof[]): Flag[] {
  if (!proof.reference || parseMoney(proof.amount) === null) return [];
  const reference = normalizeReference(proof.reference);
  const paid = parseMoney(proof.amount);
  const earlier = priorProofs.find(
    (prior) =>
      prior.reference !== null &&
      normalizeReference(prior.reference) === reference &&
      paid !== null &&
      parseMoney(prior.amount)?.equals(paid) === true &&
      (prior.currency ?? "").toUpperCase() === (proof.currency ?? "").toUpperCase(),
  );
  if (!earlier) return [];
  return [
    makeFlag({
      code: "PAYMENT_DUPLICATE",
      field: "reference",
      reason: `A proof with the same reference (${proof.reference}) and the same amount was already received. This may be the same payment sent twice, not a second payment.`,
      values: [proof.reference, proof.amount],
    }),
  ];
}

/**
 * Matches a proof to the open PIs. Pure: the same proof, PIs and earlier proofs always give the same result.
 * `linkedInvoice` is set when a Finance person linked the proof to an order by hand; the reference flag then stays,
 * so the confirmation still needs a reason.
 */
export function matchProof(proof: ProofData, invoices: OpenInvoice[], priorProofs: PriorProof[], linkedInvoice: OpenInvoice | null = null): MatchResult {
  const missing = missingFieldFlags(proof);
  const duplicates = duplicateFlag(proof, priorProofs);
  // Without a readable amount and a currency there is nothing to compare, so the outcome cannot be "exact".
  const amountUsable = parseMoney(proof.amount) !== null && Boolean(proof.currency);

  const named = proof.reference ? invoicesNamedBy(proof.reference, invoices) : [];
  const referenceFlags: Flag[] = [];
  let invoice: OpenInvoice | null = null;
  if (named.length === 1) {
    invoice = named[0];
  } else if (proof.reference) {
    referenceFlags.push(
      makeFlag({
        code: "PAYMENT_REFERENCE_NOT_FOUND",
        field: "reference",
        reason:
          named.length === 0
            ? `The reference "${proof.reference}" names no open proforma invoice, PO or order.${linkedInvoice ? ` It was linked to ${linkedInvoice.piNumber} by hand.` : " Link the proof to an order by hand if you know which one it pays."}`
            : `The reference "${proof.reference}" fits more than one open invoice (${named.map((candidate) => candidate.piNumber).join(", ")}). Link the proof to the right order by hand.`,
        values: [proof.reference, linkedInvoice?.piNumber ?? ""],
      }),
    );
  }
  invoice = invoice ?? linkedInvoice;

  if (!invoice || !amountUsable) {
    return { result: "no_match", invoice, difference: null, flags: [...missing, ...referenceFlags, ...duplicates] };
  }
  const comparison = compareWithInvoice(proof, invoice);
  return {
    result: comparison.result,
    invoice,
    difference: comparison.difference,
    flags: [...missing, ...referenceFlags, ...comparison.flags, ...duplicates],
  };
}

/** In words, for the status board: "Exact match", "Short by 80.00", ... */
export function describeMatch(match: Pick<MatchResult, "result" | "difference">): string {
  if (match.result === "exact") return "Exact match";
  if (match.result === "short") return `Short by ${displayMoney((match.difference ?? "").replace("-", ""))}`;
  if (match.result === "over") return `Over by ${displayMoney(match.difference)}`;
  return "No match";
}
