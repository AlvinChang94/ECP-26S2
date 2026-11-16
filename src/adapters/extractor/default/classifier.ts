// What: decides the document type from keywords in the title and from who the document is addressed to.
// Who calls it: DefaultExtractor.classify(). The result is only a proposal: a person confirms or changes the type.
// To extend: add title keywords in layouts.ts. Add a new tie-break rule here only when two types share a title.
import { DOCUMENT_TYPES, type DetectedType, type DocumentType } from "@/domain/documents";
import type { Classification } from "../types";
import type { PdfLine, PdfText } from "../pdfText";
import { normalizeLabel, splitLabel } from "./labelParser";
import { OWN_COMPANY_KEYWORD, TYPE_LAYOUTS } from "./layouts";

/** Titles sit in the top part of the first page. */
const TITLE_AREA_BOTTOM = 0.12;
/** Labels that name the seller on a purchase order, and labels that name the buyer. */
const SELLER_LABELS = ["to", "vendor", "supplier", "seller"];
const BUYER_LABELS = ["buyer", "customer", "bill to", "from"];

function upperText(lines: PdfLine[]): string {
  return lines
    .map((line) => line.items.map((item) => item.text).join(" "))
    .join("\n")
    .toUpperCase();
}

/** The value printed after one of the given labels on page 1, or null. */
function partyAfterLabel(text: PdfText, labels: string[]): string | null {
  for (const line of text.lines) {
    if (line.page !== 1) continue;
    for (let index = 0; index < line.items.length; index++) {
      const parts = splitLabel(line.items[index].text);
      if (!parts || !labels.includes(normalizeLabel(parts.label))) continue;
      const value = parts.rest || line.items[index + 1]?.text || "";
      if (value) return value;
    }
  }
  return null;
}

export function classifyText(text: PdfText): Classification {
  if (text.items.length === 0) {
    return {
      type: "unknown",
      confidence: 0,
      reasons: ["This PDF has no readable text (it may be a scan). The default reader cannot read it; choose the type by hand."],
    };
  }

  const firstPage = text.lines.filter((line) => line.page === 1);
  const title = upperText(firstPage.filter((line) => line.y <= TITLE_AREA_BOTTOM));
  const scores = new Map<DocumentType, number>();
  const reasons = new Map<DocumentType, string[]>();

  for (const type of DOCUMENT_TYPES) {
    const layout = TYPE_LAYOUTS[type];
    if (layout.excludeKeywords?.some((keyword) => title.includes(keyword))) continue;
    let score = 0;
    const why: string[] = [];
    for (const keyword of layout.titleKeywords) {
      if (title.includes(keyword.text)) {
        score += keyword.weight;
        why.push(`The title contains "${keyword.text}".`);
      }
    }
    if (score > 0) {
      scores.set(type, score);
      reasons.set(type, why);
    }
  }

  // "PURCHASE ORDER" is the title of both a customer's PO to us and our PO to a vendor.
  // Who sells and who buys settles it.
  if (scores.has("customer_po") || scores.has("vendor_po")) {
    const seller = partyAfterLabel(text, SELLER_LABELS);
    const buyer = partyAfterLabel(text, BUYER_LABELS);
    if (seller && seller.toLowerCase().includes(OWN_COMPANY_KEYWORD)) {
      scores.set("customer_po", (scores.get("customer_po") ?? 0) + 3);
      reasons.set("customer_po", [...(reasons.get("customer_po") ?? []), `It is addressed to ${seller} as the seller.`]);
    }
    if (buyer && buyer.toLowerCase().includes(OWN_COMPANY_KEYWORD)) {
      scores.set("vendor_po", (scores.get("vendor_po") ?? 0) + 3);
      reasons.set("vendor_po", [...(reasons.get("vendor_po") ?? []), `${buyer} is the buyer.`]);
    }
  }

  // Highest score wins; the fixed order of DOCUMENT_TYPES breaks ties so the answer never varies between runs.
  const ranked = DOCUMENT_TYPES.filter((type) => scores.has(type)).sort(
    (a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0) || DOCUMENT_TYPES.indexOf(a) - DOCUMENT_TYPES.indexOf(b),
  );
  if (ranked.length === 0) {
    return { type: "unknown", confidence: 0, reasons: ["No known document title was found on the first page."] };
  }

  const best = ranked[0];
  const bestScore = scores.get(best) ?? 0;
  const secondScore = ranked.length > 1 ? (scores.get(ranked[1]) ?? 0) : 0;
  // A clear lead gives high confidence; a tie gives 0.5, which is below the threshold, so a person must choose.
  const confidence = Math.min(0.99, 0.5 + 0.1 * (bestScore - secondScore));
  const type: DetectedType = best;
  const why = [...(reasons.get(best) ?? [])];
  if (bestScore === secondScore) why.push(`It could equally be: ${ranked[1]}. Please choose the type.`);
  return { type, confidence: Math.round(confidence * 100) / 100, reasons: why };
}
