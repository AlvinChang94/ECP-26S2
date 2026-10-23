import type { SheetSpec } from "@/server/export/excel";
import { matchPayments } from "./match-payments";
import { toConsolidationRows, type PaymentMatchingInput } from "./rules";
import { DEFAULT_PAYMENT_PARAMS, type PaymentMatchingParams } from "./types";

/** The "one Excel file" for payment matching: every payment and how it was matched. Pure. */
export function paymentConsolidationSheets(
  input: PaymentMatchingInput,
  params: PaymentMatchingParams = DEFAULT_PAYMENT_PARAMS,
): SheetSpec[] {
  const matches = matchPayments(input.payments, input.invoices, input.parties, params);
  return [
    {
      name: "Payments",
      columns: [
        { header: "Payment", key: "paymentId" },
        { header: "Value date", key: "valueDate", type: "date" },
        { header: "Payer (as written)", key: "payerName", width: 30 },
        { header: "Customer", key: "customerCode" },
        { header: "Amount", key: "amount", type: "money" },
        { header: "Currency", key: "currency" },
        { header: "Reference", key: "reference", width: 30 },
        { header: "Source document", key: "sourceDocument", width: 28 },
        { header: "Status", key: "status" },
        { header: "Method", key: "method", width: 20 },
        { header: "Invoices", key: "invoices", width: 40 },
        { header: "Difference", key: "difference", type: "money" },
      ],
      rows: toConsolidationRows(input.payments, matches),
    },
  ];
}
