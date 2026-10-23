import type { Finding, Rule } from "@/server/engine";
import { compareOrderLines } from "./compare-order-lines";
import type { MatchTolerances, Mismatch, OrderDocumentsInput } from "./types";

const FIELD_LABELS: Record<Mismatch["field"], string> = {
  sku: "SKU",
  description: "description",
  quantity: "quantity",
  uom: "unit of measure",
  unitPrice: "unit price",
  weightKg: "weight (kg)",
};

const RULE_CODE = "OT_CROSS_DOCUMENT_LINES";

/**
 * Cross-document line check: every order line must appear on every supporting document
 * with matching SKU/UOM/quantity/price/weight, and documents must not add lines.
 */
export const crossDocumentLineRule: Rule<OrderDocumentsInput, MatchTolerances> = {
  code: RULE_CODE,
  description: "Order lines must match the lines on each supporting document",
  defaultParams: { weightPct: "0.02" },
  evaluate(input, params) {
    const findings: Finding[] = [];
    const subject = (lineNo: number) => ({
      type: "order_line",
      id: `${input.orderNumber}#${lineNo}`,
    });

    for (const doc of input.documents) {
      const docLines = new Map(doc.lines.map((l) => [l.lineNo, l]));
      const orderLineNos = new Set(input.orderLines.map((l) => l.lineNo));

      for (const orderLine of input.orderLines) {
        const docLine = docLines.get(orderLine.lineNo);
        if (!docLine) {
          findings.push({
            ruleCode: RULE_CODE,
            reasonCode: "LINE_MISSING_ON_DOCUMENT",
            severity: "ERROR",
            subject: subject(orderLine.lineNo),
            explanation: `Line ${orderLine.lineNo} (${orderLine.sku}) is on order ${input.orderNumber} but missing from ${doc.documentType} ${doc.documentRef}.`,
            details: { documentRef: doc.documentRef, sku: orderLine.sku },
          });
          continue;
        }
        for (const m of compareOrderLines(orderLine, docLine, params)) {
          findings.push({
            ruleCode: RULE_CODE,
            reasonCode: m.code,
            severity: m.severity,
            subject: subject(orderLine.lineNo),
            explanation: `${doc.documentType} ${doc.documentRef} has ${FIELD_LABELS[m.field]} ${m.actual} but the order says ${m.expected}.`,
            details: {
              documentRef: doc.documentRef,
              field: m.field,
              expected: m.expected,
              actual: m.actual,
            },
          });
        }
      }

      for (const docLine of doc.lines) {
        if (orderLineNos.has(docLine.lineNo)) continue;
        findings.push({
          ruleCode: RULE_CODE,
          reasonCode: "LINE_NOT_ON_ORDER",
          severity: "ERROR",
          subject: subject(docLine.lineNo),
          explanation: `${doc.documentType} ${doc.documentRef} has line ${docLine.lineNo} (${docLine.sku}) that is not on order ${input.orderNumber}.`,
          details: { documentRef: doc.documentRef, sku: docLine.sku, quantity: docLine.quantity },
        });
      }
    }
    return findings;
  },
};
