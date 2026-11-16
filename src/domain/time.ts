// What: pure date helpers (differences, adding hours, reading dates written on documents, display formatting).
// Who calls it: domain rules that receive `now` as a parameter, and pages that show dates.
// To extend: add helpers here. Never call `new Date()` or `Date.now()` in domain code: time comes from the Clock.

/** Business time zone used for display and for "end of day" rules. Assumption: Singapore (UTC+8, no daylight saving). */
export const BUSINESS_UTC_OFFSET_HOURS = 8;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * HOUR_MS);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** Hours from `from` to `to`, as a decimal number (negative when `to` is earlier). */
export function hoursBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / HOUR_MS;
}

/** Whole days from `from` to `to`, rounded down. 47 hours is 1 day. Never negative. */
export function wholeDaysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / DAY_MS));
}

/**
 * Reads a date written on a document and returns it as YYYY-MM-DD, or null when it cannot be read.
 * Understands "2026-11-10", "10 Nov 2026", "10 November 2026", "Nov 10, 2026" and "10/11/2026" (day first).
 */
export function parseDateText(text: string | null | undefined): string | null {
  if (!text) return null;
  const value = text.trim();

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (iso) return toIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const dayMonthName = /^(\d{1,2})[ -]([A-Za-z]{3,9})[ -](\d{4})$/.exec(value);
  if (dayMonthName) {
    const month = monthNumber(dayMonthName[2]);
    return month ? toIsoDate(Number(dayMonthName[3]), month, Number(dayMonthName[1])) : null;
  }

  const monthNameDay = /^([A-Za-z]{3,9}) (\d{1,2}),? (\d{4})$/.exec(value);
  if (monthNameDay) {
    const month = monthNumber(monthNameDay[1]);
    return month ? toIsoDate(Number(monthNameDay[3]), month, Number(monthNameDay[2])) : null;
  }

  const slashed = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (slashed) return toIsoDate(Number(slashed[3]), Number(slashed[2]), Number(slashed[1]));

  return null;
}

function monthNumber(name: string): number | null {
  const index = MONTHS.findIndex((month) => name.toLowerCase().startsWith(month.toLowerCase()));
  return index === -1 ? null : index + 1;
}

function toIsoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  // Rejects impossible dates such as 31 February (JavaScript would roll them over).
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The instant a YYYY-MM-DD business day starts (00:00 in the business time zone). */
export function startOfBusinessDay(isoDate: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, -BUSINESS_UTC_OFFSET_HOURS));
}

/** The instant a YYYY-MM-DD business day ends (the following midnight in the business time zone). */
export function endOfBusinessDay(isoDate: string): Date {
  return addDays(startOfBusinessDay(isoDate), 1);
}

/** The business-day date (YYYY-MM-DD) that an instant falls on. */
export function businessDate(date: Date): string {
  const shifted = new Date(date.getTime() + BUSINESS_UTC_OFFSET_HOURS * HOUR_MS);
  return shifted.toISOString().slice(0, 10);
}

/** "16 Nov 2026" from a Date or a YYYY-MM-DD string. */
export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "";
  const isoDate = typeof value === "string" ? value : businessDate(value);
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) return String(value);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

/** "16 Nov 2026, 09:05" in the business time zone. The same text on server and browser. */
export function formatDateTime(date: Date | null | undefined): string {
  if (!date) return "";
  const shifted = new Date(date.getTime() + BUSINESS_UTC_OFFSET_HOURS * HOUR_MS);
  const hours = String(shifted.getUTCHours()).padStart(2, "0");
  const minutes = String(shifted.getUTCMinutes()).padStart(2, "0");
  return `${formatDate(shifted.toISOString().slice(0, 10))}, ${hours}:${minutes}`;
}

/** "in 7 hours", "in 3 days", "5 hours ago", "2 days ago": for due dates and waiting times. */
export function describeTimeUntil(target: Date, now: Date): string {
  const hours = hoursBetween(now, target);
  const size = Math.abs(hours);
  const amount = size < 48 ? `${Math.max(1, Math.round(size))} hour${Math.round(size) === 1 ? "" : "s"}` : `${Math.round(size / 24)} days`;
  return hours >= 0 ? `in ${amount}` : `${amount} ago`;
}
