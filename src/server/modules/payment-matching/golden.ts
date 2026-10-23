import { readGoldenJson } from "@/server/golden";
import type { PaymentMatchingInput } from "./rules";
import type {
  Allocation,
  MatchMethod,
  MatchStatus,
  OpenInvoice,
  PartyAliases,
  Payment,
} from "./types";

export interface GoldenMatchExpectation {
  paymentId: string;
  status: MatchStatus;
  method: MatchMethod | null;
  allocations: Allocation[];
  reasonCodes: string[];
  note: string;
}

export function loadPaymentMatchingGolden() {
  const input: PaymentMatchingInput = {
    payments: readGoldenJson<Payment[]>("payment-matching", "payments.json"),
    invoices: readGoldenJson<OpenInvoice[]>("payment-matching", "invoices.json"),
    parties: readGoldenJson<PartyAliases[]>("payment-matching", "parties.json"),
  };
  const expectations = readGoldenJson<GoldenMatchExpectation[]>(
    "payment-matching",
    "expected_matches.json",
  );
  return { input, expectations };
}
