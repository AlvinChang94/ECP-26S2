# Spectra OrderFlow: proof of concept

A locally runnable web app for SCCCI x NYP AI Innovation Challenge 26S2, problem statement PS11 (Spectra Innovations: purchase and sales order automation around Microsoft Dynamics Navision).

**AI reads, rules decide, people approve.** AI only classifies documents and reads fields from them. Matching, validation, routing, statuses and reminders are plain TypeScript rules. Nothing is exported to Navision without a person approving a preview.

All data is synthetic. No AWS account, API key or real Navision is needed.

## Run it

You need [Node.js](https://nodejs.org) 22.13 or newer.

```bash
npm install        # installs packages, generates the database client, copies the PDF viewer worker
npm run seed       # writes the sample data and loads the demo scenario
npm run dev        # starts the app
```

Open http://localhost:3000 and pick a persona. The simulated time starts at Monday 16 November 2026, 09:00 (Singapore time).

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Starts the app at http://localhost:3000 |
| `npm run seed` | Regenerates the synthetic sample data and resets the app to the demo starting state |
| `npm run reset-demo` | Resets the app to the demo starting state without touching the data files |
| `npm run typecheck` | Checks types |
| `npm run lint` | Checks code style |
| `npm test` | Unit, integration, invariant and golden tests (Vitest) |
| `npm run test:golden` | Runs every golden case and prints a pass/fail table with accuracy figures |
| `npm run test:e2e` | End-to-end tests in a real browser (Playwright), on a private copy of the data in `.e2e` and port 3217. First time: `npx playwright install chromium` |
| `npm run replay` | Replays six months of synthetic orders with simulated staff and prints the four KPIs (saved to `reports/kpi-replay.txt`) |

## Where to read next

| Document | For |
|---|---|
| [docs/DEVELOPER_GUIDE.md](docs/DEVELOPER_GUIDE.md) | New to Next.js? Start here: tour of the code, how one request travels, recipes for common changes |
| [docs/FEATURE_MAP.md](docs/FEATURE_MAP.md) | Each acceptance criterion: screen, route, rule, test, how to demo it |
| [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md) | The final demo, step by step (ORD-1042) |
| [docs/TESTING.md](docs/TESTING.md) and [docs/MANUAL_TEST.md](docs/MANUAL_TEST.md) | How the tests are organised; what to check by hand before demo day |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Design choices and where the build differs from the deck |
| [docs/ASSUMPTIONS.md](docs/ASSUMPTIONS.md) | Open questions for Spectra |
| [docs/AWS_MAPPING.md](docs/AWS_MAPPING.md) | How each local adapter maps to the AWS service in the deck |
| [docs/NAVISION_ADAPTER.md](docs/NAVISION_ADAPTER.md) | How to connect the real Navision later |
| [data/README.md](data/README.md) | What the sample data is and how to swap in Spectra's real data |
| [CLAUDE.md](CLAUDE.md) | The standing rules of the project |

## What it does

Six user stories from the team's deck, each working end to end against a file-based stand-in for Navision:

| Story | Screen | In one line |
|---|---|---|
| 1 Capture and check a PO | Inbox and upload, PO review | A PDF from the (simulated) email or WhatsApp inbox is classified and read; every value is shown on the PDF and checked against Navision. |
| 2 Review and remember | PO review, preview, alias memory | Fix or accept each finding (with a reason), undo any change, remember part-number corrections, approve a preview of exactly what is written to Navision, download the PI. |
| 3 SPR from a part number | SPRs, approval link | Vendor and price come from Navision; Janet approves from a signed link without logging in; reminders at 24 and 48 hours, her stand-in at 72. |
| 4 Payment tracking | Payments | Proofs of payment are matched to PIs; only Finance confirms Paid; the warehouse is then notified; reminders for late payers and vendor payments. |
| 5 Receipts and shipment documents | Receipts and shipments | Invoice, packing list and received quantities compared per part; AWB or BL, permit, packing list and invoice checked against the due date, with alerts; resolutions recorded with a name. |
| 6 Order dashboard | Order dashboard, order page | Status, owner, next action, delay reason and ship-date risk per order, all derived from stories 1 to 5; search, timeline, a customer-ready update. |

Start with ORD-1042 on the dashboard: [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md) walks through it.

## Test results

Last full run (17 November 2026): typecheck and lint clean; `npm test` 575 of 575 passed; `npm run test:golden` 44 of 44 cases; `npm run test:e2e` 12 of 12; `npm run replay` flagged 36 of 36 seeded errors. Details and what each layer proves: [docs/TESTING.md](docs/TESTING.md).

## Not built

The vendor PO after an approved SPR is a labelled STUB. Real Navision, email, WhatsApp and AWS are replaced by local stand-ins behind interfaces. The optional LLM reader is tested with a fake model only. See the end of [docs/FEATURE_MAP.md](docs/FEATURE_MAP.md).

The source of truth for what the solution should do is the team's deck in `docs/spec/`. Where the build differs from it, [docs/DECISIONS.md](docs/DECISIONS.md) says how and why.
