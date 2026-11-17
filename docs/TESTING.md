# Testing

How the tests are organised, how to run them, and what they prove. For the checks a person does by hand before a demo, see [MANUAL_TEST.md](MANUAL_TEST.md).

## Commands

| Command | What runs | Time |
|---|---|---|
| `npm run typecheck` | `next typegen` (route types) then `tsc --noEmit`, TypeScript strict | ~20 s |
| `npm run lint` | ESLint with the Next.js rules | ~15 s |
| `npm test` | Vitest: unit, integration, invariant and golden tests (every `*.test.ts` under `src/` and `tests/`) | ~1 min |
| `npm run test:golden` | The golden dataset as a printed table: one row per case, accuracy per document type and per flag code | ~10 s |
| `npm run test:e2e` | Playwright in Chromium: one happy path and one failure path per story, against a freshly seeded and built app | ~1.5 min |
| `npm run replay` | The KPI replay over six synthetic months (not a test, but it checks that every seeded error is flagged) | ~40 s |

First time only for the end-to-end tests: `npx playwright install chromium`.

Run one file or one test while working: `npx vitest run src/domain/shipment` or `npx vitest run -t "5 units short"`. Run one golden case: `npm run test:golden -- ship-receipt-short`.

## Results

Obtained on 17 November 2026 on Windows 11, Node.js 22.15:

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npm test` | 575 of 575 tests passed in 32 files |
| `npm run test:golden` | 44 of 44 cases passed. Extraction: document type 75/75, fields 812/812. Rules: every expected flag found, no unexpected flag |
| `npm run test:e2e` | 12 of 12 passed |
| `npm run replay` | 60 orders and 20 receipts replayed; 36 of 36 seeded errors flagged, 0 findings that were not seeded |

The extraction figures are for **our own synthetic PDFs**, which the default reader was written for. They say nothing about Spectra's real documents. When Spectra's samples arrive, add them to the golden dataset (see [data/README.md](../data/README.md)) and expect lower numbers at first.

## The layers

### 1. Unit tests: every rule in `src/domain`

Next to each rule file, for example [src/domain/shipment/assess.test.ts](../src/domain/shipment/assess.test.ts) next to `assess.ts`. They call pure functions with plain values, so they run in milliseconds and need no database.

Most are **table-driven**: one row per case, so adding a case is adding a row.

```ts
it.each([
  ["everything agrees", 100, 100, 100, "match", "", []],
  ["the deck's example: received 5 fewer than invoiced", 100, 100, 95, "variance", "5 units short", ["QTY_VARIANCE"]],
])("%s", (_name, invoiced, packed, received, status, note, codes) => { ... });
```

| File | Rules |
|---|---|
| `src/domain/money.test.ts`, `time.test.ts` | Decimal arithmetic and rounding; Singapore business days, "in 7 hours" |
| `src/domain/flags.test.ts`, `fields.test.ts` | Flag fingerprints and decisions; current value = extracted value + edits; undo |
| `src/domain/po/checks.test.ts`, `partMatch.test.ts`, `export.test.ts` | Story 1 and 2: PO checks, alias and similar-part suggestions, export file, amendments, deliveries |
| `src/domain/spr/spr.test.ts` | Story 3: state machine, reminder schedule, stand-in routing, signed links, suggestions |
| `src/domain/payment/payment.test.ts` | Story 4: matching a proof to a PI, payment status, late payers, vendor payment reminders |
| `src/domain/shipment/assess.test.ts` | Story 5: quantity reconciliation, required documents, due-date window boundaries, shipment status |
| `src/domain/order/status.test.ts` | Story 6: `deriveOrderStatus` (status, owner, next action, delay reason, ship-date risk, tasks), customer update, tiles |
| `src/domain/kpi.test.ts` | KPI arithmetic used by the replay |
| `src/adapters/extractor/extractor.test.ts` | The default reader on sample PDFs; the LLM reader with a fake model (its answer is checked against the PDF text and falls back when it is wrong) |

### 2. The golden test: reading and rules against known answers

`data/golden` holds 44 cases: PDFs plus, for each, the expected document type, the exact text of every field, and the flags the rules must raise ([cases.json](../data/golden/cases.json)). The Navision data they are checked against is in `data/golden/navision`; earlier orders, aliases, open PIs and earlier proofs are in [context.json](../data/golden/context.json).

The runner ([scripts/golden-runner.ts](../scripts/golden-runner.ts)) keeps two questions apart:

- **Extraction accuracy** (what the reader got right): document type and each field, reported per document type.
- **Rule correctness** (what the deterministic checks did with what was read): expected flags found, missing, unexpected, reported per flag code.

A case **fails** when a document type is wrong, an expected flag is missing, or an unexpected *blocking* flag appears. An extra warning or note is listed but does not fail the case. A wrongly read field is listed under extraction and shows up as a failure only if it changes the flags.

It runs in two ways: inside `npm test` ([tests/golden/golden.test.ts](../tests/golden/golden.test.ts)), and as a readable table with `npm run test:golden`. With `EXTRACTOR=llm` and an API key in `.env`, `npm run test:golden` measures the LLM reader instead.

### 3. Integration tests: services with a real database

[tests/integration](../tests/integration). Each test gets its own world from `createWorkspace()` ([tests/helpers/workspace.ts](../tests/helpers/workspace.ts), built on [scripts/temp-workspace.ts](../scripts/temp-workspace.ts)):

- a **temporary SQLite file** with the real migration applied,
- a **temporary copy of a Navision folder** (golden, demo or replay data; exports go to its own `export/`),
- a **`FakeClock`** the test moves by hand (`workspace.clock.advanceHours(24)`), followed by `runDueJobs()` exactly as the demo clock buttons do.

Tests never share state and never touch `storage/` or `data/navision/export`. Short-cuts for common steps (take in a PO, set a ship date, approve the export) are in [tests/helpers/flows.ts](../tests/helpers/flows.ts); they call the same services the pages call.

| File | Covers |
|---|---|
| `foundation.test.ts`, `fileNavisionGateway.test.ts`, `sampleData.test.ts` | Outbox, audit log, reference counters, file store, clocks, `runDueJobs`; the Navision gateway's reads and approved writes; the sample data generator |
| `intake.test.ts`, `poReview.test.ts` | Stories 1 and 2 |
| `spr.test.ts` | Story 3, including the reminder and hand-over timeline |
| `payments.test.ts` | Story 4 |
| `shipments.test.ts` | Story 5 |
| `orderDashboard.test.ts` | Story 6, on the full seeded demo scenario (ORD-1042 blocked), plus ship-date alerts |
| `replay.test.ts` | The KPI replay's staff rules, and a short replay through the real services |

### 4. Invariant tests: the design principles

[tests/invariants](../tests/invariants), one file per promise in [CLAUDE.md](../CLAUDE.md). Each tries hard to break the promise: other roles, the system user, long runs of the due jobs, tampered input.

| File | Promise |
|---|---|
| `export-needs-approved-preview.test.ts` | Nothing is written to the Navision export folder without a person approving a preview of exactly that content; the gateway itself checks the approval hash |
| `no-auto-correct.test.ts` | Every value is kept exactly as read, even when a suggestion is ready |
| `override-needs-reason.test.ts` | An override or a shipment resolution without a reason (or a name) is refused; findings never close by themselves |
| `paid-needs-finance.test.ts` | An order is never Paid without Finance's confirmation; the warehouse message appears only after it; only `confirmPaid` sets the confirmation |
| `reminders-stop-after-decision.test.ts` | SPR reminders and the hand-over stop once Janet (or the stand-in) decides |
| `approval-link.test.ts` | Expired, used, tampered, never-issued and wrongly signed approval links are rejected and logged |
| `same-input-same-output.test.ts` | Classification, extraction and the golden report are identical on every run |
| `money-never-float.test.ts` | No float columns, no float money in Navision files, no `parseFloat` on money in the code |

### 5. End-to-end tests: the screens in a real browser

[tests/e2e](../tests/e2e), one file per story, each with one happy path and one failure path. [playwright.config.ts](../playwright.config.ts) starts the app for them with `npm run e2e:server`, which:

1. copies `data/navision` and `data/inbox` to a private `.e2e` folder ([scripts/e2e-prepare.ts](../scripts/e2e-prepare.ts)),
2. seeds a database in `.e2e` with the demo scenario,
3. builds the app and starts it on port 3217.

So the tests never touch your demo database, and they can run while `npm run dev` is open. The tests run one after another in file order on that one seeded scenario; each uses its own order or document so they do not depend on each other's results. On a failure, Playwright keeps a screenshot and a trace in `test-results/` (`npx playwright show-trace <path>`).

| File | Happy path | Failure path |
|---|---|---|
| `story-1-capture.spec.ts` | An Inbox PO is read, highlighted on the PDF and checked against Navision | An unknown document is not routed until a person chooses its type |
| `story-2-review.spec.ts` | Accept a suggestion, override a price with a reason, approve the preview, PI available, alias remembered | Blocking findings disable the export; an override with no real reason is refused |
| `story-3-spr.spec.ts` | Pre-filled SPR, Janet approves from the link without logging in, the link then closes | Unknown part fills nothing in; a tampered link is rejected |
| `story-4-payments.spec.ts` | Finance confirms an exact proof; warehouse message in the Outbox | A short payment needs a reason; other roles cannot confirm |
| `story-5-shipments.spec.ts` | 5 units short and AWB missing are flagged; a resolution is recorded with a name; due-date alert in the Outbox | A resolution without a reason is refused; Finance cannot act |
| `story-6-dashboard.spec.ts` | ORD-1042 blocked with owner, next action, risk; search, filter, customer update, timeline | No-match search, unknown order is 404, the dashboard has no data entry |

### 6. The KPI replay

`npm run replay` ([scripts/replay-runner.ts](../scripts/replay-runner.ts)) runs the six-month synthetic history in `data/replay` through the real services on a simulated clock, with simulated staff, and prints four measures against the sample's baseline: order-processing time, error rate, approval turnaround and overdue orders. The report says plainly that the data is synthetic and the staff are simulated, and lists every simulated delay. The report is saved to `reports/kpi-replay.txt`. Change a delay with `npm run replay -- --set reviewMinutes=45`.

## Writing a new test

- **A new rule** goes in `src/domain` with a table-driven test next to it. Write the test first.
- **A new screen or action** gets an integration test of its service (copy the top of any file in `tests/integration`), and, if it is part of an acceptance criterion, a step in the story's e2e test.
- **A new design promise** gets its own file in `tests/invariants`, named after the promise, starting with `// INVARIANT:`.
- **A new kind of document or flag** gets a golden case in [scripts/sample-data/golden.ts](../scripts/sample-data/golden.ts); `npm run seed` regenerates `data/golden`.
- Never use `new Date()` in a test to mean "now": use the workspace's `FakeClock`.

## What is not tested automatically

- The LLM extractor and the LLM rewording against the real Anthropic API (they are tested with a fake model; running them needs an API key and costs money).
- How the pages look, and anything about a real Navision, a real mailbox or WhatsApp. These are in [MANUAL_TEST.md](MANUAL_TEST.md) or are out of scope for the POC.
