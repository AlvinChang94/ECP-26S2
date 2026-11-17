# Design decisions

Choices made while building the proof of concept, with the reason for each. Open questions for Spectra are in [ASSUMPTIONS.md](ASSUMPTIONS.md).

## Where the build differs from the deck

The deck in `docs/spec/` is the source of truth. These are the places where the deck's own slides disagree with each other, or where `CLAUDE.md` and the build brief chose different wording. Each one was resolved as shown; tell us if any should go the other way.

| Deck says | Build does | Why |
|---|---|---|
| Slide 14 wireframe: "Reminder 24 h, Manager 48 h, Alternate approver 72 h" | Reminders at 24 and 48 hours to whoever must decide; at 72 hours the SPR goes to Janet's stand-in | Slide 13's acceptance criteria say "late SPRs go to her stand-in", and there is no manager role (slide 21 note, `CLAUDE.md`) |
| Slide 14 note: "Once approved, a Vendor PO is automatically generated" | An approved SPR is only an approved SPR. The vendor PO is a separate draft a person approves (shown as a STUB) | Design principle 3: nothing is posted without a person approving a preview |
| Slides 18 to 20: "cut-off", "Control Center"; slide 22: "Command Center" | "due date", "Receipts and shipments", "Order dashboard" | Vocabulary in `CLAUDE.md` |
| Slides 19 to 23: owner "Logistics" | Owner is the purchase team (vendor shipments) or a sales team member (outgoing shipments), or the person a shipment was assigned to | There is no logistics role (`CLAUDE.md`) |
| Slide 10: intake by "email, Excel, PDF" | PDF only, from an Inbox folder (simulated email and WhatsApp) and manual upload | Spectra's briefing answer: PDF only, from Navision, email and WhatsApp |
| Slide 15: sell price and margin on the SPR | Hidden unless `SHOW_MARGIN=true` | Slide 15 note: depends on data Spectra may not provide |
| Slide 17: "releases packing when paid" | The warehouse is notified when Finance confirms payment; the system does not block or release anything | Design principle 4 |
| Slide 22: "ON TRACK 96%" | Tiles are counted from the orders in the database | Brief: do not hard-code percentages |

## Tools and versions

- **Versions installed (November 2026):** Next.js 16.4, React 19.3, Prisma 7.10, Zod 4, Vitest 5, Playwright 1.65, pdf.js 6.5. Node.js 22.13 or newer is required (pdf.js and Vitest need it).
- **TypeScript 5.9, not 7.** TypeScript 7 is the new native compiler; the lint tooling that ships with Next.js 16.4 was only verified here with 5.9.
- **ESLint 9, not 10.** ESLint 9 with `eslint-config-next` 16.4 is the combination that was verified on this machine. npm prints a "no longer supported" notice for ESLint 9; moving to 10 is a small follow-up.
- **Prisma 7.10, not 8.** npm's `latest` tag for Prisma currently points at a release candidate of version 8.
- **Next.js 16 is different from older tutorials.** `params`, `searchParams` and `cookies()` must be awaited, `next lint` is gone, and `middleware.ts` is now `proxy.ts` (not used here). The matching docs are in `node_modules/next/dist/docs/`.

## Dependencies (one line each, as `CLAUDE.md` requires)

| Package | Why it is here |
|---|---|
| next, react, react-dom | The web framework named in the brief (App Router). |
| @prisma/client, prisma | Typed database access and migrations (brief). |
| @prisma/adapter-better-sqlite3 | Prisma 7 talks to databases through a driver adapter; this is the SQLite one. |
| better-sqlite3 | The SQLite driver itself; also used directly to create throwaway test databases quickly. |
| pdfjs-dist | Shows PDFs in the browser and reads text with positions on the server (brief). |
| pdf-lib | Creates PDFs: the synthetic samples and the PI download. Pure JavaScript and deterministic. |
| zod | Validates all external input: Navision files, forms, LLM answers (brief). |
| decimal.js | Exact money arithmetic (brief). |
| fuse.js | Fuzzy part-number suggestions only (brief). |
| @anthropic-ai/sdk | The optional LLM extractor (`EXTRACTOR=llm`). Never called with default settings. |
| typescript, tsx | The compiler, and a runner for TypeScript scripts (seed, generator, golden, replay). |
| vitest, @playwright/test | Unit, integration and golden tests; end-to-end tests (brief). |
| eslint, eslint-config-next | Linting with the Next.js rules. |
| @types/* | Type definitions for Node.js, React and better-sqlite3. |

No UI library and no CSS framework: one hand-written stylesheet (`src/app/globals.css`) keeps the number of things a Next.js beginner must learn small.

## Architecture

1. **Extracted values are never changed.** A document's extracted fields are stored once (`Document.fieldsJson`). Every change a person makes is an audit event (`field_edit`, `field_undo`). The current value of a field is the extracted value plus its edits, computed by `currentValues()` in `src/domain/fields.ts`. This makes "no auto-correct" a property of the data model, gives a per-field history for free, and makes undo a logged step (a stack per field).
2. **Flags are data.** A flag has a code, severity, field, reason sentence, whether it may be overridden, and a fingerprint (code + field + the values involved). A person's override or resolution is stored against the fingerprint, so changing the value afterwards needs a new decision.
3. **A document changes nothing until a person confirms its type.** Classification and extraction run at intake and are shown at once, but the document is only routed (to an order, a payment or a shipment) when someone clicks Confirm or picks a different type. This is how "a wrong type must never silently route a document" is enforced. A shipping document that is still unconfirmed appears on its shipment as "Pending check".
4. **Exports are checked at the lowest level.** The export service shows a preview and remembers its SHA-256 hash. `FileNavisionGateway` recomputes the hash of what it is about to write and refuses when they differ, so no code path can write something that was not previewed and approved. Export files never contain a timestamp, which keeps "exactly what will be written" true.
5. **Severity choices.** `QTY_EXCEEDS_STOCK` is a warning, not blocking: the order can be entered while stock is purchased (it links to an SPR). `MISSING_FIELD`, `INVALID_VALUE` and `CUSTOMER_NOT_FOUND` cannot be overridden because the export file cannot be written without those values; they must be fixed (or, for the customer, a new customer card proposed).
6. **Alias suggestions.** `getItem` matches a part number exactly (case and punctuation count). Anything else is either `PART_ALIAS_SUGGESTED` (a remembered alias or a similar item exists) or `PART_NOT_FOUND`, never both. Suggestions are never applied without a click.
7. **Money is a decimal string everywhere** (database, JSON files, export files) and is only handled through `src/domain/money.ts`. The schema has no Float column.
8. **Time.** The app uses real time plus an offset stored in the database (`OffsetClock`), so the seeded scenario always starts on Monday 16 November 2026, 09:00 Singapore time, and the top bar can move time forward to show reminders. Jobs run only when someone presses "Run due jobs" or moves the demo clock; there is no background timer. All times are shown in Singapore time (UTC+8).
9. **Forms.** Pages are server components. Forms post to server actions, which call one service function through `runAction()` and then redirect; a problem the user can fix comes back as `?error=...` and is shown in a red box. Route handlers are used only for file upload and file download.
10. **NavisionGateway has three reads beyond the brief's list**: `listPurchaseOrders`, `getPurchaseOrder` and `getStaffDirectory`. Stories 3 to 5 need purchase orders (payment and document due dates, ordered quantities) and the approval hierarchy.
11. **An exported customer card counts as an existing customer** for later lookups, as if Navision had imported it (it has no customer number yet). Without this the same new customer would be flagged on every later PO.
12. **Items have two prices**: `price` (sales price, compared with the customer PO) and `purchasePrice` (last vendor price, pre-fills the SPR). The deck's wireframes show both (12.40 and 10.10).
13. **The promised ship date is typed by a sales team member**, not read from the PO. The page offers "PO arrival + 7 days" as a one-click suggestion. The sample POs do print a "Delivery required by" date; it is deliberately not extracted so that it can serve as the worked example in the developer guide.
14. **SPR approval links** are valid for 48 hours (the deck's wireframe). Every reminder and the hand-over to the stand-in carry a fresh link. A decision uses up the link and revokes every other link for that SPR.
15. **Golden and replay data have their own Navision folders** (`data/golden/navision`, `data/replay/navision`), so tests never depend on the demo files.
16. **LLM extractor.** It sends pdf.js text (with item numbers) to Claude and asks for each value plus the number of the text item it was copied from. A value is accepted only if it really appears in that item; anything else falls back to the default reader. The model defaults to `claude-opus-5-5` (`LLM_MODEL` changes it), effort is `low` because reading labelled values is routine, and server-side refusal fallback is enabled.
17. **Vendor PO after an approved SPR is a STUB** (see ASSUMPTIONS A2). None of the six stories' acceptance criteria cover it.
18. **A shipment is the unit of story 5.** One shipment per vendor PO (incoming) or per order (outgoing). A confirmed shipping document joins the shipment its reference names; a reference that matches nothing is not guessed at and waits for a person to link it. Everything shown about a shipment (quantities, checklist, findings, status) is worked out fresh from the documents and Navision each time (`loadShipmentView`), so a new goods receipt or a passing due date shows without any stored state to update.
19. **A missing document escalates in three steps**: `DOCUMENT_MISSING` (warning) while the due date is far off, `DOCUMENT_DUE_SOON` (blocking) inside the alert window, `DOCUMENT_OVERDUE` (blocking) after it. Each step is a different finding, so a resolution recorded for "due soon" does not silence "overdue". The same holds for quantities: a changed quantity is a new finding.
20. **A resolution is a recorded decision, not a fix.** It needs a reason and the name of a purchase or sales team member, is stored in `FlagDecision` with kind `resolution`, and can be reopened (also recorded). Notes (severity info) cannot be resolved because there is nothing to decide. The system actor cannot resolve anything.
21. **One due-date alert per shipment and step**, naming every document still missing, instead of one message per document. The Outbox key includes the due date, so a moved due date alerts again. Alerts go to the assignee, otherwise to the purchase team (incoming) or sales (outgoing).
22. **Vendor POs are not tracked automatically.** Tracking starts with the first confirmed document or when a person enters the reference (ASSUMPTIONS A26). Tracking every Navision PO would raise alerts for old or closed POs until we know which Navision field says a PO is still open.
23. **Alert windows are settings**: `DOCUMENT_ALERT_WINDOW_HOURS` (default 48) and `SHIP_DATE_ALERT_DAYS` (default 2) in `.env`.
24. **The order dashboard stores nothing.** `deriveOrderStatus(orderState, flags, now)` is a pure function; the service only gathers what stories 1 to 5 recorded (PO findings, payment, SPRs, deliveries, shipments). There is no status column to keep in step: the `Order.status` column only says open or cancelled.
25. **How statuses rank.** `planSteps` lists an order's open work in this order: PO in review, blocked (a changed PO, or a shipment finding), awaiting payment, waiting for stock, then ready or partly shipped. The first item gives the status, the owner, the next action and the delay reason; every item is a task with an assignee. Cancelled and shipped (every unit delivered) are decided before any of this.
26. **The owner is whoever must act next**: the person a shipment is assigned to or an SPR waits for, otherwise the team member for that kind of work (the sales team member who confirmed the PO, Finance, the purchase team) from the staff file. The warehouse is not a user of the system, so "Ready to ship" belongs to the sales team member, who records the delivery.
27. **Ship ETA is the promised ship date** agreed by a sales team member. The dashboard does not predict a date. It marks the date On track, At risk (blocked, or still not ready two days before) or Late (the promised day has ended and not every unit is delivered).
28. **One ship-date alert per order and promised date**, sent when the order is inside the alert window (or past the date) and still at risk. It goes to the owner. An order that is merely blocked far ahead of its date shows "At risk" on the dashboard but is not alerted yet; its shipment's own due-date alerts cover that.
29. **The customer-ready update is a fixed template per status** (`customerUpdate`). It never contains staff names, reason codes or internal numbers, and nothing is sent: the sales team member copies it.
30. **The KPI replay runs the real services**, not a model of them: a temporary database and a copy of `data/replay/navision`, a `FakeClock` moved event by event, and simulated staff whose delays are named settings printed in the report (`DEFAULT_REPLAY_SETTINGS` in `scripts/replay-runner.ts`). Shipping happens on the sample's dates, so the replay cannot claim fewer overdue orders; it only measures whether an alert came before the promised date. Random choices come from a seeded generator, so the same sample and settings always give the same report.
31. **The baseline comes from the sample's own timestamps** (PO arrival, Navision creation, SPR submitted and decided, promised and actual ship dates). There is no baseline for "errors caught by hand" because the sample does not record it; the report says so instead of inventing one.
32. **End-to-end tests run on a private copy** of the sample data in `.e2e` with their own database and port (3217), started by `npm run e2e:server` (prepare, seed, build, start). They run one after another on one seeded scenario, each on its own order or document, so a developer's demo database is never touched.
33. **One temporary-workspace helper** (`scripts/temp-workspace.ts`) serves the integration tests and the replay, so both build their world exactly the same way.

## Repository

- Work is on the branch `orderflow-poc`. The files of an earlier, unrelated experiment were already deleted from the working folder before this build started; the deletion is part of the first commit and the old files remain in git history on `main`.
- Generated sample data is committed, so tests run on a clean clone before `npm run seed`. The generator is deterministic (same bytes on every run), which a test checks.
