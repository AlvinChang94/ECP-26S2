import Decimal from "decimal.js";
import {
  DEFAULT_COMMISSION_PARAMS,
  type CommissionParams,
  type CommissionRecalc,
  type InvoiceCommission,
  type LineLabel,
  type SalesLine,
} from "./types";

// Pure commission calculations. No DB or network access.

const money = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
const pct = (d: Decimal) => d.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);

function gpPctOf(revenue: Decimal, grossProfit: Decimal): Decimal | null {
  return revenue.isZero() ? null : grossProfit.dividedBy(revenue);
}

/**
 * Labels a line that earns zero commission. Checked in this order:
 * FREE_ITEM (no revenue), NEGATIVE_GP (cost above revenue), LOW_GP (GP% not above minGpPct;
 * exactly 6.00% counts as LOW_GP because commission is paid only *above* 6%).
 */
export function labelZeroCommission(
  line: Pick<SalesLine, "revenue" | "cost">,
  params: Pick<CommissionParams, "minGpPct"> = DEFAULT_COMMISSION_PARAMS,
): LineLabel {
  const revenue = new Decimal(line.revenue);
  const gp = revenue.minus(line.cost);
  const ratio = gpPctOf(revenue, gp);
  const base = { grossProfit: money(gp), gpPct: ratio ? pct(ratio) : null };

  if (revenue.isZero()) return { ...base, label: "FREE_ITEM" };
  if (gp.isNegative()) return { ...base, label: "NEGATIVE_GP" };
  if (ratio!.lte(params.minGpPct)) return { ...base, label: "LOW_GP" };
  return { ...base, label: null };
}

/**
 * Recalculates commission for an invoice after credit notes:
 * - net revenue/cost = invoice minus all credit notes
 * - eligible only if net GP% is strictly above minGpPct
 * - full commission = rate x basis (net GP or net revenue)
 * - earned = full x (customer paid / net revenue), capped to 0..1, rounded to cents
 * - clawback = paid - earned when positive; topUp = earned - paid when positive
 */
export function recalculateCommission(
  invoice: InvoiceCommission,
  params: CommissionParams = DEFAULT_COMMISSION_PARAMS,
): CommissionRecalc {
  const revenue = new Decimal(invoice.revenue);
  const cost = new Decimal(invoice.cost);
  const cnRevenue = invoice.creditNotes.reduce((s, cn) => s.plus(cn.revenue), new Decimal(0));
  const cnCost = invoice.creditNotes.reduce((s, cn) => s.plus(cn.cost), new Decimal(0));

  const netRevenue = revenue.minus(cnRevenue);
  const netGp = netRevenue.minus(cost.minus(cnCost));
  const ratio = gpPctOf(netRevenue, netGp);
  const before = gpPctOf(revenue, revenue.minus(cost));

  const eligible = netRevenue.gt(0) && ratio !== null && ratio.gt(params.minGpPct);
  const basis = params.basis === "REVENUE" ? netRevenue : netGp;
  const full = eligible ? basis.times(invoice.commissionRate) : new Decimal(0);

  const paidRatio = netRevenue.gt(0)
    ? Decimal.max(0, Decimal.min(1, new Decimal(invoice.customerPaid).dividedBy(netRevenue)))
    : new Decimal(0);
  const earned = new Decimal(money(full.times(paidRatio)));
  const delta = new Decimal(invoice.commissionPaid).minus(earned);

  return {
    invoiceNo: invoice.invoiceNo,
    netRevenue: money(netRevenue),
    netGrossProfit: money(netGp),
    gpPct: ratio ? pct(ratio) : null,
    eligible,
    eligibleBeforeCreditNotes: before !== null && before.gt(params.minGpPct),
    fullCommission: money(full),
    paidRatio: pct(paidRatio),
    earnedCommission: money(earned),
    clawback: money(Decimal.max(0, delta)),
    topUp: money(Decimal.max(0, delta.negated())),
  };
}
