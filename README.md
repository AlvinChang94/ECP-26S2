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
| `npm run test:e2e` | End-to-end tests in a real browser (Playwright). First time: `npx playwright install chromium` |
| `npm run replay` | Replays six months of synthetic orders and prints the four KPIs |

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

## Status

See [PLAN.md](PLAN.md) for the milestones and the end of this file's history for what is done. The source of truth for what the solution should do is the team's deck in `docs/spec/`.
