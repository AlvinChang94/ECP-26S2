import Decimal from "decimal.js";
import {
  DEFAULT_PAYMENT_PARAMS,
  type Allocation,
  type OpenInvoice,
  type PartyAliases,
  type Payment,
  type PaymentMatch,
  type PaymentMatchingParams,
} from "./types";

// Pure payment-to-invoice matching. No DB or network access.

const squash = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
const money = (d: Decimal) => d.toFixed(2);

/** Resolves a payer name from a slip to a customer code using the party name and aliases. */
export function resolveCustomer(
  payerName: string,
  parties: readonly PartyAliases[],
): string | null {
  const key = squash(payerName);
  const hit = parties.find((p) => [p.name, ...p.aliases].some((n) => squash(n) === key));
  return hit?.code ?? null;
}

/** Invoices whose number appears in the free-text reference, ignoring spaces/dashes/case. */
export function referencedInvoices(
  reference: string | null,
  invoices: readonly OpenInvoice[],
): OpenInvoice[] {
  if (!reference) return [];
  const ref = squash(reference);
  return invoices.filter((inv) => ref.includes(squash(inv.invoiceNo)));
}

const byAge = (a: OpenInvoice, b: OpenInvoice) =>
  a.issueDate.localeCompare(b.issueDate) || a.invoiceNo.localeCompare(b.invoiceNo);

function combinations<T>(items: readonly T[], size: number): T[][] {
  if (size === 0) return [[]];
  const out: T[][] = [];
  items.forEach((item, i) => {
    for (const rest of combinations(items.slice(i + 1), size - 1)) out.push([item, ...rest]);
  });
  return out;
}

/**
 * Matches one payment against open invoices.
 * 1. Invoice numbers found in the reference win: allocate oldest first. The result is MATCHED
 *    (within tolerance), PARTIAL (short) or OVERPAID (excess, e.g. a duplicate payment).
 * 2. Otherwise match on amount, only within the resolved customer's invoices: a single invoice,
 *    then combinations of up to `maxCombination` invoices. Several equally good answers give
 *    AMBIGUOUS. Nothing within tolerance (or unknown payer) gives UNMATCHED for manual review.
 */
export function matchPayment(
  payment: Payment,
  customerCode: string | null,
  openInvoices: readonly OpenInvoice[],
  params: PaymentMatchingParams = DEFAULT_PAYMENT_PARAMS,
): PaymentMatch {
  const amount = new Decimal(payment.amount);
  const tolerance = new Decimal(params.tolerance);
  const pool = openInvoices
    .filter((i) => customerCode === null || i.customerCode === customerCode)
    .sort(byAge);
  const base = { paymentId: payment.paymentId, customerCode, candidates: [] as string[][] };
  const full = (invs: OpenInvoice[]): Allocation[] =>
    invs.map((i) => ({ invoiceNo: i.invoiceNo, amount: money(new Decimal(i.amountDue)) }));
  const sum = (invs: OpenInvoice[]) => invs.reduce((s, i) => s.plus(i.amountDue), new Decimal(0));

  // 1. By reference. Referenced invoices may belong to the customer even if already paid (amountDue 0).
  const refs = referencedInvoices(payment.reference, customerCode ? pool : openInvoices).sort(
    byAge,
  );
  if (refs.length > 0) {
    const due = sum(refs);
    const diff = amount.minus(due);
    if (diff.abs().lte(tolerance)) {
      return {
        ...base,
        status: "MATCHED",
        method: "REFERENCE",
        allocations: full(refs),
        difference: money(diff),
        shortfall: "0.00",
      };
    }
    if (diff.gt(0)) {
      return {
        ...base,
        status: "OVERPAID",
        method: "REFERENCE",
        allocations: full(refs.filter((r) => new Decimal(r.amountDue).gt(0))),
        difference: money(diff),
        shortfall: "0.00",
      };
    }
    // Short payment: oldest invoices first, the last one partially.
    let remaining = amount;
    const allocations: Allocation[] = [];
    for (const inv of refs) {
      if (remaining.lte(0)) break;
      const take = Decimal.min(remaining, inv.amountDue);
      if (take.gt(0)) allocations.push({ invoiceNo: inv.invoiceNo, amount: money(take) });
      remaining = remaining.minus(take);
    }
    return {
      ...base,
      status: "PARTIAL",
      method: "REFERENCE",
      allocations,
      difference: "0.00",
      shortfall: money(due.minus(amount)),
    };
  }

  // 2. By amount: only when we know who paid, otherwise any coincidence would "match".
  if (customerCode === null) {
    return {
      ...base,
      status: "UNMATCHED",
      method: null,
      allocations: [],
      difference: money(amount),
      shortfall: "0.00",
    };
  }
  const payable = pool.filter((i) => new Decimal(i.amountDue).gt(0));
  for (let size = 1; size <= params.maxCombination; size++) {
    const hits = combinations(payable, size).filter((c) =>
      amount.minus(sum(c)).abs().lte(tolerance),
    );
    if (hits.length === 1) {
      return {
        ...base,
        status: "MATCHED",
        method: size === 1 ? "AMOUNT_SINGLE" : "AMOUNT_COMBINATION",
        allocations: full(hits[0]),
        difference: money(amount.minus(sum(hits[0]))),
        shortfall: "0.00",
      };
    }
    if (hits.length > 1) {
      return {
        ...base,
        status: "AMBIGUOUS",
        method: null,
        allocations: [],
        difference: money(amount),
        shortfall: "0.00",
        candidates: hits.map((c) => c.map((i) => i.invoiceNo)),
      };
    }
  }
  return {
    ...base,
    status: "UNMATCHED",
    method: null,
    allocations: [],
    difference: money(amount),
    shortfall: "0.00",
  };
}

/**
 * Matches payments in value-date order, reducing what is outstanding after each one so that
 * two payments cannot both settle the same invoice.
 */
export function matchPayments(
  payments: readonly Payment[],
  invoices: readonly OpenInvoice[],
  parties: readonly PartyAliases[],
  params: PaymentMatchingParams = DEFAULT_PAYMENT_PARAMS,
): PaymentMatch[] {
  const outstanding = new Map(invoices.map((i) => [i.invoiceNo, new Decimal(i.amountDue)]));
  const ordered = [...payments].sort(
    (a, b) => a.valueDate.localeCompare(b.valueDate) || a.paymentId.localeCompare(b.paymentId),
  );

  return ordered.map((payment) => {
    const open = invoices.map((i) => ({ ...i, amountDue: money(outstanding.get(i.invoiceNo)!) }));
    const result = matchPayment(payment, resolveCustomer(payment.payerName, parties), open, params);
    for (const a of result.allocations) {
      outstanding.set(a.invoiceNo, outstanding.get(a.invoiceNo)!.minus(a.amount));
    }
    return result;
  });
}
