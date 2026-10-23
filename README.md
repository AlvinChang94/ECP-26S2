op# ECP

ECP reads business documents (PDFs, images, Excel and ERP text reports), extracts their data with
AWS AI services, and runs deterministic rules over it to raise findings for review and approval.
It is a shared foundation for three candidate problem statements (order tracking, payment
matching, commission check); we pick one later.

**Stack:** Next.js 16 (App Router, TypeScript) · Tailwind CSS 4 · shadcn/ui · MySQL 8 + Prisma 7 ·
AWS SDK v3 (S3, Textract, Bedrock, region `ap-southeast-1`) · ExcelJS · zod · decimal.js · Vitest ·
ESLint + Prettier · npm.

**How the code is laid out**

| Folder                           | What lives there                                                                                                       |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `src/server/ingest/`             | File in, normalised records out: `document-ai` (Textract + Bedrock, cached by file hash), `spreadsheet`, `text-report` |
| `src/server/engine/`             | Rule type, rule runner and a small state-machine helper. Pure: no DB or network                                        |
| `src/server/modules/<candidate>` | One folder per candidate: its types, pure rules and tests against `data/golden/<candidate>/`                           |
| `src/server/export/`             | Writes Excel files and records them in the `exports` table                                                             |
| `src/app/`                       | UI: dashboard (`/`), findings list (`/findings`), health checks (`/api/health`, `/api/health/aws`)                     |
| `worker/`                        | Background worker that runs jobs from the `jobs` table                                                                 |
| `data/golden/`                   | Small synthetic datasets with deliberately planted errors                                                              |

AI only **extracts** data. All matching, validation, approvals and status changes are plain,
testable TypeScript.

---

## 1. Prerequisites

Install these once:

| Tool    | Version                            | Get it                                                                                                                                                        |
| ------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Git     | any recent                         | https://git-scm.com/downloads                                                                                                                                 |
| Node.js | the major version in `.nvmrc` (24) | https://nodejs.org (LTS installer), or `nvm install 24` with [nvm](https://github.com/nvm-sh/nvm) / [nvm-windows](https://github.com/coreybutler/nvm-windows) |
| VS Code | any recent                         | https://code.visualstudio.com                                                                                                                                 |
| MySQL   | 8.x                                | https://dev.mysql.com/downloads/mysql/ (remember the `root` password you set)                                                                                 |

Check they work:

```bash
git --version
node --version
npm --version
mysql --version
```

`node --version` should print `v24.x`. If `mysql` is not found on Windows, add
`C:\Program Files\MySQL\MySQL Server 8.0\bin` to your `PATH` and open a new terminal.

## 2. First-time setup

Run every command from the project folder.

**1. Clone the repo**

```bash
git clone https://github.com/AlvinChang94/ECP-26S2.git
cd ECP-26S2
```

**2. Create the databases and user.** This runs [`scripts/init_db.sql`](scripts/init_db.sql), which
creates the `ecp` and `ecp_shadow` databases and the `ecp_user` user. Enter your MySQL `root`
password when asked.

```bash
mysql -u root -p < scripts/init_db.sql
```

PowerShell doesn't support `<`. Use this instead:

```powershell
Get-Content scripts/init_db.sql | mysql -u root -p
```

**3. Install dependencies** (this also generates the Prisma client):

```bash
npm ci
```

**4. Create your `.env` file** from the template:

```bash
cp .env.example .env
```

(PowerShell: `Copy-Item .env.example .env`)

Open `.env` and fill it in:

| Variable                                     | What to put                                                                                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                               | Leave as is: `mysql://ecp_user:password@localhost:3306/ecp`                                                                          |
| `SHADOW_DATABASE_URL`                        | Leave as is: `mysql://ecp_user:password@localhost:3306/ecp_shadow`                                                                   |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Your personal AWS access keys. Ask the team lead to create them for you and send them privately (never in a group chat or a commit). |
| `AWS_REGION`                                 | Leave as `ap-southeast-1`                                                                                                            |
| `S3_BUCKET`                                  | Bucket name from the team lead                                                                                                       |
| `BEDROCK_MODEL_ID`                           | Model ID from the team lead (everyone uses the same pinned ID)                                                                       |
| `REPLAY_MODE`                                | `false` normally; `true` to use only cached extraction results (offline demo)                                                        |

The app checks these on startup and tells you exactly which ones are missing or wrong.

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
