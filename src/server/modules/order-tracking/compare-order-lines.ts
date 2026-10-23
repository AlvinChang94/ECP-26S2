import Decimal from "decimal.js";
import {
  DEFAULT_TOLERANCES,
  type MatchTolerances,
  type Mismatch,
  type OrderLineInput,
} from "./types";

const norm = (s: string) => s.trim().toUpperCase();

/**
 * Compares an expected order line (e.g. from the purchase order) with an actual line
 * (e.g. extracted from an invoice or delivery order) and returns reason-coded mismatches.
 *
 * Pure: no DB or network access. Returns [] when the lines match.
 * - SKU and UOM are compared case-insensitively, ignoring surrounding whitespace.
 * - Quantity and unit price must match exactly ("10" equals "10.000").
 * - Weight may differ by up to `tolerances.weightPct` of the expected weight.
 * - On a UOM mismatch, quantity and price are not compared (they would differ only as a
 *   knock-on effect of the different unit).
 * - Price and weight are only compared when both sides have a value.
 */
export function compareOrderLines(
  expected: OrderLineInput,
  actual: OrderLineInput,
  tolerances: MatchTolerances = DEFAULT_TOLERANCES,
): Mismatch[] {
  const mismatches: Mismatch[] = [];

  if (norm(expected.sku) !== norm(actual.sku)) {
    mismatches.push({
      code: "SKU_MISMATCH",
      field: "sku",
      expected: expected.sku,
      actual: actual.sku,
      severity: "ERROR",
    });
  }

  const uomMatches = norm(expected.uom) === norm(actual.uom);
  if (!uomMatches) {
    mismatches.push({
      code: "UOM_MISMATCH",
      field: "uom",
      expected: expected.uom,
      actual: actual.uom,
      severity: "ERROR",
    });
  }

  if (uomMatches) {
    if (!new Decimal(expected.quantity).equals(actual.quantity)) {
      mismatches.push({
        code: "QTY_MISMATCH",
        field: "quantity",
        expected: expected.quantity,
        actual: actual.quantity,
        severity: "ERROR",
      });
    }

    if (
      expected.unitPrice != null &&
      actual.unitPrice != null &&
      !new Decimal(expected.unitPrice).equals(actual.unitPrice)
    ) {
      mismatches.push({
        code: "UNIT_PRICE_MISMATCH",
        field: "unitPrice",
        expected: expected.unitPrice,
        actual: actual.unitPrice,
        severity: "ERROR",
      });
    }
  }

  if (expected.weightKg != null && actual.weightKg != null) {
    const exp = new Decimal(expected.weightKg);
    const allowed = exp.abs().times(tolerances.weightPct);
    if (exp.minus(actual.weightKg).abs().greaterThan(allowed)) {
      mismatches.push({
        code: "WEIGHT_MISMATCH",
        field: "weightKg",
        expected: expected.weightKg,
        actual: actual.weightKg,
        severity: "WARNING",
      });
    }
  }

  return mismatches;
}
