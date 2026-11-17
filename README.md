<<<<<<< HEAD
# Spectra OrderFlow: proof of concept
=======
ECP
>>>>>>> main/main

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

<<<<<<< HEAD
| Story | Screen | In one line |
|---|---|---|
| 1 Capture and check a PO | Inbox and upload, PO review | A PDF from the (simulated) email or WhatsApp inbox is classified and read; every value is shown on the PDF and checked against Navision. |
| 2 Review and remember | PO review, preview, alias memory | Fix or accept each finding (with a reason), undo any change, remember part-number corrections, approve a preview of exactly what is written to Navision, download the PI. |
| 3 SPR from a part number | SPRs, approval link | Vendor and price come from Navision; Janet approves from a signed link without logging in; reminders at 24 and 48 hours, her stand-in at 72. |
| 4 Payment tracking | Payments | Proofs of payment are matched to PIs; only Finance confirms Paid; the warehouse is then notified; reminders for late payers and vendor payments. |
| 5 Receipts and shipment documents | Receipts and shipments | Invoice, packing list and received quantities compared per part; AWB or BL, permit, packing list and invoice checked against the due date, with alerts; resolutions recorded with a name. |
| 6 Order dashboard | Order dashboard, order page | Status, owner, next action, delay reason and ship-date risk per order, all derived from stories 1 to 5; search, timeline, a customer-ready update. |
=======
PowerShell doesn't support `<` Use this instead:
>>>>>>> main/main

Start with ORD-1042 on the dashboard: [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md) walks through it.

## Test results

Last full run (17 November 2026): typecheck and lint clean; `npm test` 575 of 575 passed; `npm run test:golden` 44 of 44 cases; `npm run test:e2e` 12 of 12; `npm run replay` flagged 36 of 36 seeded errors. Details and what each layer proves: [docs/TESTING.md](docs/TESTING.md).

<<<<<<< HEAD
## Not built

The vendor PO after an approved SPR is a labelled STUB. Real Navision, email, WhatsApp and AWS are replaced by local stand-ins behind interfaces. The optional LLM reader is tested with a fake model only. See the end of [docs/FEATURE_MAP.md](docs/FEATURE_MAP.md).

The source of truth for what the solution should do is the team's deck in `docs/spec/`. Where the build differs from it, [docs/DECISIONS.md](docs/DECISIONS.md) says how and why.
=======
**4. Ask me for the .env file to send to you

**5. Create the tables** (applies all migrations in `prisma/migrations/`):

```bash
npm run db:migrate
```

**6. Load the synthetic test data** from `data/golden/`:

```bash
npm run db:seed
```

**7. Start the app:**

```bash
npm run dev
```

Open http://localhost:3000.

## 3. Check that it works

With `npm run dev` running, open:

- http://localhost:3000/api/health should show `{"ok":true,"db":"up"}`.
- http://localhost:3000/api/health/aws should show `"ok":true`, with an `s3` and a `bedrock` check.
  If one fails, its `error` field says why (see [Troubleshooting](#7-troubleshooting)).
- http://localhost:3000 shows the dashboard: one card per candidate with finding counts.
- http://localhost:3000/findings lists findings. Click the Severity, Status and Module chips to
  filter. (For now these come from running the rules over `data/golden/`; statuses are
  placeholders.)

Then run the tests in a second terminal:

```bash
npm test
```

All tests should pass.

**Try the worker and the Excel export.** Queue a job, then start the worker in a second terminal
(stop it with Ctrl+C):

```bash
npm run job:enqueue -- export-payment-consolidation
npm run worker
```

The worker writes `storage/exports/<timestamp>-payment-consolidation.xlsx` and adds a row to the
`exports` table. Open the file in Excel to see every payment and how it was matched.

## 4. Daily routine

```bash
git checkout main
git pull
npm ci              # only needed when package-lock.json changed
npm run db:migrate  # applies any new migrations from teammates
npm run dev
```

**Making a change:**

```bash
git checkout -b feature/short-description
# ...work, then:
npm run lint
npm test
git add -A
git commit -m "Short description of the change"
git push -u origin feature/short-description
```

Then open a pull request into `main` on GitHub. Keep commits small.

**Changing the database schema:** edit `prisma/schema.prisma`, then run

```bash
npm run db:migrate -- --name describe_your_change
```

and commit the new folder under `prisma/migrations/` together with the schema change. Never
change tables by hand in MySQL.

**Other useful commands:**

| Command                                         | What it does                                                                                                     |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `npm run build`                                 | Production build                                                                                                 |
| `npm run lint`                                  | ESLint                                                                                                           |
| `npm run format`                                | Prettier: format every file                                                                                      |
| `npm run typecheck`                             | TypeScript type check                                                                                            |
| `npm run worker`                                | Background worker that runs jobs from the `jobs` table                                                           |
| `npm run job:enqueue -- <type> [key=value ...]` | Queue a job, e.g. `noop`, `export-payment-consolidation`, `extract-document documentId=1 schema=payment-proof@1` |
| `npm run db:reset`                              | Drop and recreate your local database from all migrations (deletes all data; run `npm run db:seed` after)        |

## 5. Rules

- **Never commit `.env`** or any AWS key. `.env` is git-ignored; keep it that way. If a key
  leaks, tell the team lead immediately so it can be revoked.
- **Synthetic data only**, both in the repo and in any shared database. No real customer
  names, documents or prices.
- Schema changes only through Prisma migrations (see above).
- Use npm, not yarn or pnpm, and commit `package-lock.json`.

## 6. Using Claude Code (optional)

1. In VS Code, open the Extensions view, search for **Claude Code**, and install it.
2. Sign in with **your own** Claude account.
3. Stop it from reading your secrets. Create (or edit) `.claude/settings.local.json` in the
   project folder so it contains:

   ```json
   { "permissions": { "deny": ["Read(./.env)", "Read(./.env.local)"] } }
   ```

   `.claude/` is git-ignored, so this file stays on your machine.

The project rules for Claude are in `.claude/CLAUDE.md`.

## 7. Troubleshooting

**`Access denied for user 'ecp_user'@'localhost'`**
The user doesn't exist or has a different password. Check that `DATABASE_URL` in `.env` uses
`ecp_user:password`, then check the user exists:

```bash
mysql -u root -p -e "SELECT user, host FROM mysql.user WHERE user = 'ecp_user';"
```

If there are no rows, run step 2 of the setup again. If it fails with "database exists" or
"user exists", that part was already done.

**`npm run db:migrate` fails with a shadow database or permission error** (for example
`P3014`, or "Prisma Migrate could not create the shadow database")
Prisma needs full rights on `ecp_shadow`. Check `SHADOW_DATABASE_URL` points to `ecp_shadow`,
then re-grant:

```bash
mysql -u root -p -e "GRANT ALL PRIVILEGES ON ecp_shadow.* TO 'ecp_user'@'localhost'; FLUSH PRIVILEGES;"
```

**`npm run db:migrate` fails or reports drift after pulling new migrations**
Your local database has drifted from the migrations, for example because it was created from an
older version. The data is synthetic, so rebuild it:

```bash
npm run db:reset
npm run db:seed
```

**`/api/health` shows `RSA public key is not available client side` or an authentication plugin error**
This should not happen, because the app already enables `allowPublicKeyRetrieval`. If it does,
make sure you're on the latest `main` and run `npm ci`.

**`/api/health/aws` shows an AWS credential error**

- `CredentialsProviderError` or `InvalidAccessKeyId`: the AWS keys in `.env` are missing or
  mistyped. Restart `npm run dev` after editing `.env`.
- `SignatureDoesNotMatch`: the secret key is wrong (often extra spaces or quotes).
- `AccessDenied` or `NoSuchBucket` on S3: check `S3_BUCKET` and ask the team lead to check your
  IAM permissions.
- `AccessDeniedException` or `ValidationException` on Bedrock: check `BEDROCK_MODEL_ID` and that
  `AWS_REGION` is `ap-southeast-1`. Model access may need to be enabled for the account; ask the
  team lead.

**The app won't start: `Invalid environment configuration`**
The message lists each variable to fix in `.env`. Compare with `.env.example`.

**Strange install, build or "module not found" errors**
Delete `node_modules` and reinstall.

macOS / Linux / Git Bash:

```bash
rm -rf node_modules
npm ci
```

PowerShell:

```powershell
Remove-Item -Recurse -Force node_modules
npm ci
```
=======
# ECP-26S2
>>>>>>> 053d0cabdba95b5f48c7047af739cf25eff66791
>>>>>>> main/main
