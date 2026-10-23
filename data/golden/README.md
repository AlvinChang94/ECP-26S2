# Golden datasets

Small, **fully synthetic** datasets, one folder per candidate problem statement. Every company,
SKU, file name and hash is made up. Decimal values are strings, never JSON numbers.

Each folder has the input data plus an `expected_*.json` file that says what the rules must
return for every record. `npm test` checks all of them, so when you add a case, update the
expectations in the same commit. Each expectation's `note` explains what was planted.

## order-tracking/

`orders.json` (purchase orders) vs `documents.json` (extracted invoice / delivery order lines).
Expectations: `expected_mismatches.json`, one entry per order line.

Planted: short quantity, changed unit price, wrong SKU, two errors on one line, UOM change
(CTN vs REAM, quantity not double-flagged), weight over the 2% tolerance, an invoice line that
was never ordered, an ordered line missing from the delivery order. Also clean lines with
formatting noise and a weight just inside tolerance.

## payment-matching/

`payments.json` (from payment proofs) vs `invoices.json` (open invoices), with `parties.json`
for payer-name aliases. Expectations: `expected_matches.json`, one entry per payment.

Planted: one payment for two invoices short by a bank charge, partial payment, unreferenced
payment that only matches after the partial payment is applied, two invoices with the same
amount (ambiguous), unknown payer, duplicate payment, known payer with no matching amount.

## commission-check/

`sales_lines.json` is the ERP sales/commission report; `erp_sales_report.txt` is the same data as
a fixed-width text report (the parser test checks they agree). `credit_note_invoices.json` has
invoices with credit notes and customer payments. Expectations: `expected_labels.json` and
`expected_recalc.json`.

Planted: free items (one with commission paid), negative GP, GP below 6% with commission paid,
GP exactly 6.00% (not eligible) vs 6.01% (eligible), a price credit, a credit note that pushes
GP below 6%, a goods return on a half-paid invoice, two credit notes on one invoice, unpaid
commission (top-up), and a clean invoice.
