# PLAN: Spectra OrderFlow proof of concept

One page. Source of truth: the deck in `docs/spec/`. Rules: `CLAUDE.md`. Decisions made along the way: `docs/DECISIONS.md`. Open questions: `docs/ASSUMPTIONS.md`.

## File tree

```
data/navision/        mock Navision: items, customers, vendors, customerOrders, purchaseOrders, goodsReceipts, staff (+ export/ written by the app)
data/inbox/           PDFs waiting in the simulated email / WhatsApp inbox (+ manifest.json)
data/seed/            PDFs the seed loads to build the demo history (ORD-1042 and friends)
data/golden/          cases.json + context.json + files/ (expected type, fields, flags per sample PDF)
data/replay/          60 orders over 6 simulated months for the KPI replay
prisma/               schema.prisma (SQLite now, MySQL later) + migrations
scripts/              generate-sample-data, seed, run-golden, replay, copy-pdf-worker
src/domain/           pure rules and types (no file, database, network or clock access)
src/adapters/         Clock, FileStore, NavisionGateway, DocumentExtractor, Notifier, db client, config
src/services/         one use case per file: intake, PO review, export, SPR, payments, shipments, orders, jobs
src/app/              Next.js pages, server actions (actions.ts next to each page), route handlers (upload, download)
src/components/       shared UI (PDF viewer is the only large client component)
tests/                integration/, invariants/, golden/, helpers/   (unit tests sit next to the domain file)
e2e/                  Playwright: one happy path and one failure path per story
docs/                 DEVELOPER_GUIDE, FEATURE_MAP, TESTING, MANUAL_TEST, DEMO_SCRIPT, AWS_MAPPING, NAVISION_ADAPTER, DECISIONS, ASSUMPTIONS
```

## Data model (Prisma; no Float, no enums, no database clock, so it runs on SQLite and MySQL)

| Table | What it holds |
|---|---|
| Document | one PDF: file key, detected type and confidence, confirmed type (by a person), extracted fields as JSON (value, page, bounding box). Extracted values are never changed. |
| AuditEvent | who, when, action, entity, field, old value, new value, reason. Field edits and undos are audit events; the current value of a field is the extracted value plus its edits. |
| Order | one customer order (ORD-1042): PO number, customer, promised ship date, PI number, payment confirmation, cancellation. |
| PoVersion | one captured PO document for an order (revision 1, 2, ...): kind (new, amendment, cancellation), status, export file and hash. |
| FlagDecision | a person's override or resolution of one flag: reason, name, time. |
| PartAlias | remembered "this part number means that one". |
| Delivery | delivered quantity per part (partial fulfilment). |
| Spr, ApprovalToken, ScheduledJob | SPR state, signed single-use approval links, reminder jobs at 24, 48 and 72 hours. |
| PaymentProof | a proof-of-payment document and the order it was matched to. |
| Shipment, ShipmentDocument | inbound (purchase) or outbound (sales) shipment and its documents. |
| OutboxMessage | every notification the system "sent" (stand-in for SES and SNS). |
| AppSetting, Counter | demo clock offset; running numbers for ORD, SPR, SHP. |

Flags are data: `{ code, severity, field, reason, canOverride, suggestion? }`. Money is a decimal string handled with decimal.js.

## Build order (commit after each; run typecheck, lint, tests each time)

- **M0** scaffold, Clock, FileStore, Outbox, FileNavisionGateway, sample-data generator, golden dataset, persona picker, layout, audit log, docs skeleton.
- **M1** story 1: Inbox and upload, classify, extract, confirm type, PDF with highlights, PO checks against Navision.
- **M2** story 2: edit, undo, history, alias memory, overrides, export preview and approval, PI PDF, then amend, cancel, partial fulfilment.
- **M3** story 3: SPR from part number, suggested SPRs, state machine, reminders and stand-in, signed approval link.
- **M4** story 4: payment board, proof matching, Confirm paid, warehouse notification, nudges, vendor payment calendar.
- **M5** story 5: quantity reconciliation, document checklist, due-date alerts, exception review.
- **M6** story 6: `deriveOrderStatus`, order dashboard, order detail with timeline and customer-ready update.
- **M7** KPI replay, Playwright end-to-end tests, final docs, demo scenario ORD-1042.

## Progress

- [x] M0  - [x] M1  - [x] M2  - [x] M3  - [ ] M4  - [ ] M5  - [ ] M6  - [ ] M7
