// What: finds Navision items whose number looks like a part number written on a PO (suggestions only), and compares company names.
// Who calls it: FileNavisionGateway.searchItems / getCustomerByName, and the PO check when it builds a suggestion.
// To extend: tune SIMILARITY_THRESHOLD or add a normalisation step. A suggestion is never applied without a person confirming it.
import Fuse from "fuse.js";

/** 0 = identical, 1 = anything matches. 0.25 allows roughly one wrong character in a seven-character part number. */
const SIMILARITY_THRESHOLD = 0.25;
/** Shorter fragments would match half the catalogue, so we do not suggest for them. */
const MIN_CHARACTERS = 4;

/** "ab-1234 x" -> "AB1234X": upper case, letters and digits only. Used for comparing, never for storing. */
export function normalizePartNo(partNo: string): string {
  return partNo.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Items that look like `query`, best first. Items that differ only by punctuation or case come first
 * (the classic "AB-1234X" on the PO versus "AB1234X" in Navision), then near misses found by Fuse.js.
 * An exact match is not a suggestion, so it is left out.
 */
export function rankSimilarItems<T extends { itemNo: string }>(query: string, items: T[], limit = 3): T[] {
  const wanted = normalizePartNo(query);
  if (wanted.length < 2) return [];

  const candidates = items
    .filter((item) => item.itemNo !== query.trim())
    .map((item) => ({ item, normalized: normalizePartNo(item.itemNo) }));

  const sameCharacters = candidates
    .filter((candidate) => candidate.normalized === wanted)
    .sort((a, b) => a.item.itemNo.localeCompare(b.item.itemNo));

  // Near misses are only looked for when the part number is long enough to be distinctive.
  if (wanted.length < MIN_CHARACTERS) return sameCharacters.slice(0, limit).map((candidate) => candidate.item);

  const fuse = new Fuse(candidates, {
    keys: ["normalized"],
    threshold: SIMILARITY_THRESHOLD,
    ignoreLocation: true,
    includeScore: true,
  });
  const nearMisses = fuse
    .search(wanted)
    .filter((result) => result.item.normalized !== wanted)
    // Fuse sorts by score; the item number breaks ties so the order is the same on every run.
    .sort((a, b) => (a.score ?? 0) - (b.score ?? 0) || a.item.item.itemNo.localeCompare(b.item.item.itemNo))
    .map((result) => result.item);

  return [...sameCharacters, ...nearMisses].slice(0, limit).map((candidate) => candidate.item);
}

const COMPANY_SUFFIXES = new Set([
  "pte", "ltd", "limited", "llc", "inc", "co", "company", "corp", "corporation", "fze", "plc", "pvt", "private", "sdn", "bhd", "llp", "gmbh",
]);

/**
 * "Lanka Tech Pte. Ltd." -> "lanka tech": lower case, no punctuation, no legal suffix.
 * Two names are the same customer when their normalised forms are equal. This is a lookup rule, not a correction:
 * the name on the document is left as it is.
 */
export function normalizeCompanyName(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 0);
  while (words.length > 1 && COMPANY_SUFFIXES.has(words[words.length - 1])) words.pop();
  return words.join(" ");
}

export function sameCompany(a: string, b: string): boolean {
  const left = normalizeCompanyName(a);
  return left.length > 0 && left === normalizeCompanyName(b);
}
