// What: money helpers built on decimal.js, so amounts are never JavaScript floating-point numbers.
// Who calls it: every rule that compares, adds or formats money (PO checks, payment matching, export files).
// To extend: add helpers here. Never use parseFloat, Number() or the + operator on money anywhere else.
import Decimal from "decimal.js";

/** Accepts "12.40", "2,480.00", "USD 12.40" or "$12.40". Anything else is not money. */
const MONEY_PATTERN = /^-?\d+(\.\d+)?$/;
const CURRENCY_PREFIX = /^(?:[A-Z]{3}|US\$|S\$|\$)\s*/;

/**
 * Reads a money amount from text. Returns null when the text is empty or not a number.
 * The text itself is never changed: callers keep the original string and use the Decimal only to compare.
 */
export function parseMoney(text: string | null | undefined): Decimal | null {
  if (text === null || text === undefined) return null;
  if (typeof text !== "string") {
    // A JavaScript number here means a float slipped in somewhere upstream. Refuse it loudly.
    throw new TypeError("Money must be passed as a decimal string, never as a JavaScript number.");
  }
  const cleaned = text.trim().replace(CURRENCY_PREFIX, "").replace(/,/g, "");
  if (!MONEY_PATTERN.test(cleaned)) return null;
  return new Decimal(cleaned);
}

/** Like parseMoney, but throws when the text is not a valid amount. Use for values we created ourselves. */
export function toMoney(text: string): Decimal {
  const amount = parseMoney(text);
  if (amount === null) throw new Error(`Not a valid money amount: "${text}"`);
  return amount;
}

/** True when both texts are valid amounts with exactly the same value ("12.4" equals "12.40"). */
export function moneyEquals(a: string | null, b: string | null): boolean {
  const left = parseMoney(a);
  const right = parseMoney(b);
  if (left === null || right === null) return false;
  return left.equals(right);
}

/** Formats with two decimal places, rounding half up: Decimal(2480) -> "2480.00". */
export function formatMoney(amount: Decimal): string {
  return amount.toFixed(2, Decimal.ROUND_HALF_UP);
}

/** Adds a thousands separator for display only: "2480.00" -> "2,480.00". */
export function displayMoney(amountText: string | null | undefined): string {
  const amount = parseMoney(amountText);
  if (amount === null) return amountText ?? "";
  const [whole, fraction] = formatMoney(amount).split(".");
  const sign = whole.startsWith("-") ? "-" : "";
  const digits = sign ? whole.slice(1) : whole;
  return `${sign}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction}`;
}

/** unit price x whole-number quantity, exact. */
export function lineTotal(unitPrice: Decimal, quantity: number): Decimal {
  if (!Number.isInteger(quantity)) throw new Error(`Quantity must be a whole number, got ${quantity}`);
  return unitPrice.times(quantity);
}

export function sumMoney(amounts: Decimal[]): Decimal {
  return amounts.reduce((total, amount) => total.plus(amount), new Decimal(0));
}

/**
 * How far `actual` is from `expected`, in percent with one decimal place: ("11.90", "12.40") -> "-4.0".
 * Returns null when either amount is invalid or expected is zero.
 */
export function percentDifference(actual: string | null, expected: string | null): string | null {
  const a = parseMoney(actual);
  const e = parseMoney(expected);
  if (a === null || e === null || e.isZero()) return null;
  return a.minus(e).dividedBy(e).times(100).toFixed(1, Decimal.ROUND_HALF_UP);
}

/** Margin in percent of the sell price: (sell - cost) / sell. Only shown when SHOW_MARGIN is on. */
export function marginPercent(sellPrice: string | null, cost: string | null): string | null {
  const sell = parseMoney(sellPrice);
  const unitCost = parseMoney(cost);
  if (sell === null || unitCost === null || sell.isZero()) return null;
  return sell.minus(unitCost).dividedBy(sell).times(100).toFixed(1, Decimal.ROUND_HALF_UP);
}

/** Reads a whole-number quantity such as "200" or "1,200". Returns null for anything else (including "2.5"). */
export function parseQuantity(text: string | null | undefined): number | null {
  if (text === null || text === undefined) return null;
  const cleaned = text.trim().replace(/,/g, "");
  if (!/^\d+$/.test(cleaned)) return null;
  const quantity = Number.parseInt(cleaned, 10);
  return Number.isSafeInteger(quantity) ? quantity : null;
}
