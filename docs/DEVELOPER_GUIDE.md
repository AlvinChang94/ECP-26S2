# Developer guide

For the three of us who will keep building this, and for anyone joining later. It assumes you know TypeScript and a little React, but not Next.js.

Read part 1 and part 2 once (twenty minutes). After that, use part 3 when you need to change something: each recipe lists the files to edit in order, the test to write first, and how to see the result.

1. [A ten-minute tour](#1-a-ten-minute-tour)
2. [Next.js in one page](#2-nextjs-in-one-page)
3. [Recipes](#3-recipes)
4. [Rules of thumb](#4-rules-of-thumb)
5. [Glossary and troubleshooting](#5-glossary-and-troubleshooting)

---

## 1. A ten-minute tour

### The idea in one sentence

**AI reads, rules decide, people approve.** The extractor (the only "AI" part) classifies a PDF and reads fields from it. Everything after that, from matching and checking to status, reminders and alerts, is plain TypeScript in `src/domain`, and anything that changes Navision waits for a person to approve a preview. [CLAUDE.md](../CLAUDE.md) lists the rules we never break.

### Repository map

```
src/
  domain/      Pure rules and types. No files, no database, no network, no clock. Every rule has a *.test.ts next to it.
    po/          Customer PO: checks against Navision, export file, amendments, deliveries
    spr/         SPR state machine, reminder schedule, signed approval links, suggestions
    payment/     Matching a proof of payment to a PI, payment status
    shipment/    Story 5: quantity reconciliation, required documents, due dates
    order/       Story 6: deriveOrderStatus(), the order dashboard's one rule
    flags.ts     The Flag type and FLAG_CATALOGUE (every reason code)
    money.ts     All money arithmetic (decimal.js). Never use + or * on money.
    time.ts      Dates in Singapore time, "in 7 hours", start and end of a business day
  adapters/    Everything that touches the outside world, each behind an interface
    navision/    NavisionGateway interface + FileNavisionGateway (reads data/navision/*.json)
    extractor/   DocumentExtractor interface + the default reader (no keys) + the optional LLM reader
    db.ts        Prisma client: SQLite on a laptop, MySQL on AWS (chosen by DATABASE_URL)
    clock.ts     Clock interface: real, offset (the demo clock) and fake (tests, seed, replay)
    notifier.ts  Notifier interface: every message is written to the Outbox table
    sesNotifier.ts  ...and on AWS also emailed through Amazon SES (NOTIFIER=ses)
    fileStore.ts Where uploaded PDFs are kept (storage/documents)
    s3FileStore.ts  ...or in an Amazon S3 bucket on AWS (STORAGE_BACKEND=s3)
    config.ts    Reads environment variables once, checked with Zod
  services/    One file per use case. Gathers data through adapters, calls domain rules, records audit events.
  app/         Next.js pages, server actions and the three route handlers. Kept thin.
  components/  Small React components shared by pages (FlagCard, Timeline, PdfViewer, badges)
  generated/   Prisma's generated client. Never edit; `npm install` recreates it.
prisma/        schema.prisma (the tables) and the SQLite migrations; prisma/mysql/ is the generated MySQL copy and its migrations
scripts/       seed, sample data generator, golden test runner, KPI replay, e2e preparation
tests/         integration/, invariants/, golden/, e2e/ (Playwright), helpers/
data/          Synthetic sample data: navision/, inbox/, seed/, golden/, replay/ (see data/README.md)
infra/         CloudFormation templates (orderflow.yaml) and the AWS server's setup and update scripts (infra/ec2)
.github/       The CI/CD pipeline (GitHub Actions)
docs/          This guide and the other documents listed in the README
storage/       Created at run time: the SQLite database and uploaded PDFs (not in git)
```

### The three layers, and why

| Layer | May use | May not use | Why |
|---|---|---|---|
| `src/domain` | other domain files | files, database, network, `new Date()`, `Date.now()` | A rule you can call with plain values is a rule you can test in milliseconds, and the same input always gives the same output. |
| `src/services` | domain, adapters (through `deps`) | React, Next.js | One place per use case where "what happens, in which order, and what is recorded" is written down. |
| `src/app` | services, components | Prisma directly, rules | Pages and actions stay short enough to read in one screen. |

Every service function takes `deps` as its first argument ([src/services/deps.ts](../src/services/deps.ts)): `db`, `navision`, `extractor`, `notifier`, `clock`, `files`, `inbox`, `llm`, `config`. Pages get it with `await getDeps()`. Tests and scripts build their own with `buildDeps()` or `createTempWorkspace()` ([scripts/temp-workspace.ts](../scripts/temp-workspace.ts)), with a temporary database, a temporary Navision folder and a `FakeClock`. That is how the same code runs in the app, the tests, the seed and the replay.

### The journey of one request: uploading a customer PO

Follow this once with the files open. Every feature in the app works the same way.

1. **The page.** [src/app/(app)/inbox/page.tsx](../src/app/(app)/inbox/page.tsx) renders an ordinary HTML form: `<form action="/api/documents/upload" method="post" encType="multipart/form-data">`. You choose a PDF and click Upload.
2. **The route handler.** [src/app/api/documents/upload/route.ts](../src/app/api/documents/upload/route.ts) exports `POST(request)`. It reads the file from the form, finds out who is signed in (`getPersona()` in [src/app/_lib/session.ts](../src/app/_lib/session.ts)) and calls one service function.
3. **The service.** `ingestDocument()` in [src/services/intake.ts](../src/services/intake.ts):
   - checks it is a PDF of a sensible size,
   - stores the bytes with `deps.files.put()` (adapter: [src/adapters/fileStore.ts](../src/adapters/fileStore.ts)),
   - asks `deps.extractor.classify()` and `deps.extractor.extract()` what it is and what it says (adapter: [src/adapters/extractor/default/index.ts](../src/adapters/extractor/default/index.ts), which reads the PDF's text with pdf.js in [pdfText.ts](../src/adapters/extractor/pdfText.ts), scores the title in [classifier.ts](../src/adapters/extractor/default/classifier.ts) and finds labelled values and table rows with [labelParser.ts](../src/adapters/extractor/default/labelParser.ts) and [layouts.ts](../src/adapters/extractor/default/layouts.ts)),
   - saves a `Document` row with `deps.db.document.create()` (table defined in [prisma/schema.prisma](../prisma/schema.prisma)); the extracted fields are stored once and never changed,
   - records "received ... detected as Customer PO (97% sure)" with `recordAudit()` ([src/services/audit.ts](../src/services/audit.ts)).
4. **Back to the browser.** The route handler answers with a redirect (status 303) to `/documents/<id>`, the page [src/app/(app)/documents/[id]/page.tsx](../src/app/(app)/documents/[id]/page.tsx). It shows the PDF with highlights next to the fields and the detected type. **Nothing else has happened yet**: the type is only a proposal.
5. **A person confirms the type.** The "Confirm type" form calls the server action `confirmTypeAction` in [src/app/(app)/inbox/actions.ts](../src/app/(app)/inbox/actions.ts). It reads the form and calls `confirmDocumentType()` (intake.ts) inside `runAction()` ([src/app/_lib/forms.ts](../src/app/_lib/forms.ts)), which turns a `UserError` into a red message and success into a redirect.
6. **Routing.** `confirmDocumentType()` looks up `DOCUMENT_SPECS.customer_po.routesTo` (`"order"`, in [src/domain/documents.ts](../src/domain/documents.ts)) and calls the order router, `attachPoDocument()` in [src/services/orders.ts](../src/services/orders.ts). That creates the `Order` (ORD-1043) and its first `PoVersion`, and records `order_created`.
7. **The review page.** The browser goes to `/orders/ORD-1043/review` ([src/app/(app)/orders/[orderNo]/review/page.tsx](../src/app/(app)/orders/[orderNo]/review/page.tsx)). The page calls `loadPoReview()` ([src/services/poReview.ts](../src/services/poReview.ts)), which:
   - turns the stored fields plus any edits into current values (`currentValues()` in [src/domain/fields.ts](../src/domain/fields.ts)),
   - looks every part number and the customer up in Navision through `deps.navision` ([src/adapters/navision/fileGateway.ts](../src/adapters/navision/fileGateway.ts) reads `data/navision/items.json` and friends on every call),
   - runs the pure rule `checkCustomerPo()` in [src/domain/po/checks.ts](../src/domain/po/checks.ts), which returns flags such as `PRICE_MISMATCH` with a reason sentence,
   - pairs each flag with any decision a person already made (`attachDecisions()` in [src/domain/flags.ts](../src/domain/flags.ts)).
8. **The page shows the result** with `<FlagCard>` ([src/components/FlagCard.tsx](../src/components/FlagCard.tsx)) and the PDF viewer ([src/components/PdfViewer.tsx](../src/components/PdfViewer.tsx), the one client component that draws the PDF).

Each later step (fix a value, accept a difference, approve the export) follows the same path: page form → server action → service → domain rule → adapter → database → audit event → redirect.

---

## 2. Next.js in one page

**Routes come from folders.** A file called `page.tsx` makes a URL. The folder path is the URL:

| File | URL |
|---|---|
| `src/app/(app)/dashboard/page.tsx` | `/dashboard` |
| `src/app/(app)/orders/[orderNo]/review/page.tsx` | `/orders/ORD-1042/review` |
| `src/app/approve/[token]/page.tsx` | `/approve/abc123...` |
| `src/app/api/documents/upload/route.ts` | `/api/documents/upload` (not a page: a route handler) |

- `[orderNo]` is a *dynamic segment*: the page reads it with `const { orderNo } = await props.params;`.
- `(app)` in brackets is a *route group*: it does not appear in the URL. Every page inside it shares [src/app/(app)/layout.tsx](../src/app/(app)/layout.tsx) (the sidebar, the demo clock, the persona). The approval page is outside the group because Janet opens it from an email link without signing in.
- The query string arrives as `await props.searchParams`, for example `?search=beacon&status=blocked` on the dashboard.
- `PageProps<"/orders/[orderNo]">` is a type Next.js generates from the folders (`next typegen`, which `npm run typecheck` runs). After adding a page, run `npm run typecheck` once so the new route is known.

**Server components (the default).** A `page.tsx` here is an `async` function that runs on the server for every request. It may call services directly (`await getOrderDashboard(deps, ...)`) and returns HTML. There is no `useState` and no `onClick` in it, and no data reaches the browser except the finished HTML. The root layout sets `export const dynamic = "force-dynamic"`, so nothing is cached: every page shows the current data and the current demo time.

**Client components (`"use client"`).** Only two files need the browser: [src/components/PdfViewer.tsx](../src/components/PdfViewer.tsx) (pdf.js draws on a `<canvas>`, which exists only in the browser) and [src/components/NavLink.tsx](../src/components/NavLink.tsx) (it highlights the current link, which needs the browser's current path). Put `"use client"` at the very top of a file only when it needs state, effects, event handlers or browser APIs. A client component cannot call a service or Prisma; pass it plain data as props.

**Server actions (`"use server"`).** Forms post to functions in an `actions.ts` file that starts with `"use server"`:

```tsx
// page.tsx
<form action={recordResolutionAction}>
  <input type="hidden" name="shipmentNo" value={shipmentNo} />
  <input name="reason" />
  <button type="submit">Record resolution</button>
</form>

// actions.ts
"use server";
export async function recordResolutionAction(formData: FormData): Promise<void> {
  const persona = await requirePersona();
  const shipmentNo = formText(formData, "shipmentNo");
  await runAction(`/shipments/${shipmentNo}`, async () => {
    await recordResolution(await getDeps(), actorOf(persona), { shipmentNo, fingerprint: formText(formData, "fingerprint"), reason: formText(formData, "reason") });
    return { notice: "Resolution recorded." };
  });
}
```

The function runs on the server. `runAction()` redirects back with `?notice=` (green) or, when the service throws a `UserError`, with `?error=` (red). Any other error is a bug and shows Next.js's error page. Never call `redirect()` inside your own `try` block: it works by throwing, and your `catch` would swallow it.

**Route handlers (`route.ts`).** Exported `GET` or `POST` functions that return a `Response`. We use them only where a page or a server action is awkward:
- [api/documents/upload/route.ts](../src/app/api/documents/upload/route.ts): a plain multipart form post with a file;
- [api/documents/[id]/file/route.ts](../src/app/api/documents/[id]/file/route.ts): sends PDF bytes with the right `Content-Type` for the viewer;
- [api/orders/[orderNo]/pi/route.ts](../src/app/api/orders/[orderNo]/pi/route.ts): builds and downloads the proforma invoice PDF;
- [api/jobs/run/route.ts](../src/app/api/jobs/run/route.ts): runs the due jobs when EventBridge Scheduler calls on AWS (protected by a shared secret, switched off on a laptop).

Everything else is a page plus server actions.

**Signing in.** There is no real authentication. [src/app/sign-in](../src/app/sign-in) sets a cookie with the persona's id; `requirePersona()` reads it. Services check roles themselves (for example only Finance may confirm a payment), so a missing check in a page cannot let the wrong person act.

---

## 3. Recipes

Each recipe: files in the order you edit them, a code skeleton, the test to write first, how to see the result. Run `npm run typecheck`, `npm run lint` and `npm test` at the end of every recipe.

### 3.1 Add a validation rule to the PO check (minimum order quantity)

Goal: a warning when a PO line orders fewer units than the item's minimum order quantity in Navision.

1. **Test first**, in [src/domain/po/checks.test.ts](../src/domain/po/checks.test.ts) (the helpers `poValues`, `context`, `found`, `check`, `codes` are at the top of that file):
   ```ts
   it("warns when a line is below the item's minimum order quantity", () => {
     const dock = { ...DOCK, minOrderQty: 50 };
     const flags = check(poValues({ "lines[0].quantity": "20" }), context({ lines: { 0: found(dock) } }));
     expect(codes(flags)).toEqual(["QTY_BELOW_MINIMUM@lines[0].quantity"]);
     expect(flags[0].severity).toBe("warning");
     expect(check(poValues({ "lines[0].quantity": "50" }), context({ lines: { 0: found(dock) } }))).toEqual([]);
   });
   ```
2. [src/domain/navision.ts](../src/domain/navision.ts): add `minOrderQty?: number;` to `NavItem`.
3. [src/adapters/navision/schemas.ts](../src/adapters/navision/schemas.ts): add `minOrderQty: z.number().int().positive().optional()` to `ItemSchema`, so a bad value in the Navision file is caught when it is read.
4. [src/domain/flags.ts](../src/domain/flags.ts): add the code to `FLAG_CATALOGUE`:
   ```ts
   QTY_BELOW_MINIMUM: { severity: "warning", canOverride: true, title: "Below minimum order quantity" },
   ```
5. [src/domain/po/checks.ts](../src/domain/po/checks.ts): write the rule and call it from `checkCustomerPo()` next to `checkPrice`:
   ```ts
   function checkMinimumQuantity(line: PoLine, item: NavItem): Flag[] {
     const quantity = parseQuantity(line.quantity);
     if (quantity === null || !item.minOrderQty || quantity >= item.minOrderQty) return [];
     return [
       makeFlag({
         code: "QTY_BELOW_MINIMUM",
         field: lineKey(line.index, "quantity"),
         reason: `${lineLabel(line)}: ${quantity} ordered, but the minimum order quantity for ${item.itemNo} is ${item.minOrderQty}.`,
         values: [item.itemNo, quantity, item.minOrderQty],
       }),
     ];
   }
   // in checkCustomerPo:
   if (lookup?.item) flags.push(...checkPrice(line, lookup.item, po.currency), ...checkMinimumQuantity(line, lookup.item));
   ```
6. Sample data: add `minOrderQty: 50` to one item in `ITEMS` in [scripts/sample-data/master.ts](../scripts/sample-data/master.ts), then `npm run seed` (it rewrites `data/navision/items.json`). For a golden case, add one in [scripts/sample-data/golden.ts](../scripts/sample-data/golden.ts) next to the other PO cases and run `npm run test:golden`.

**See it:** import a PO with a small quantity of that item: the review page shows the new warning with its reason. Nothing else needs changing: `FlagCard`, the override form and the audit log work for every flag code.

### 3.2 Add a field to extraction (requested delivery date)

The sample POs already print "Delivery required by" (layout A) or "Required by" (layout B). We deliberately do not read it yet.

1. **Test first**, in [src/adapters/extractor/extractor.test.ts](../src/adapters/extractor/extractor.test.ts): read one golden PO of each layout and expect the value as printed on the page (for example `po-clean-a.pdf`; open it to see the exact text).
2. [src/domain/documents.ts](../src/domain/documents.ts): add to `customer_po.fields`:
   ```ts
   { key: "requestedDeliveryDate", label: "Requested delivery date", kind: "date" },
   ```
   This alone makes the review page show the field (it loops over `spec.fields`) and makes the LLM extractor ask for it (it builds its request from `DOCUMENT_SPECS`).
3. [src/adapters/extractor/default/layouts.ts](../src/adapters/extractor/default/layouts.ts): teach the default reader the labels:
   ```ts
   requestedDeliveryDate: { labels: ["Delivery required by", "Required by"] },
   ```
4. [scripts/sample-data/pdfs.ts](../scripts/sample-data/pdfs.ts): in `renderCustomerPo`, add `requestedDeliveryDate: spec.deliveryRequiredBy ?? null` to the `fields` it returns. The golden cases take their expected values from there, so `npm run seed` updates `data/golden/cases.json`.
5. To use it: add `requestedDeliveryDate` to `CustomerPo` and `toCustomerPo()` in [src/domain/po/types.ts](../src/domain/po/types.ts), then, for example, offer it as the suggested promised ship date in `loadPoReview()` (`suggestedShipDate`). Keep it a suggestion: a person still sets the promised ship date.

**See it:** `npm run test:golden` shows the new field in the extraction accuracy table; the review page shows it with a highlight on the PDF.

### 3.3 Add a document type (certificate of origin)

1. **Test first**: a golden "classify_only" case. In [scripts/sample-data/golden.ts](../scripts/sample-data/golden.ts), copy the `doc-vendor-po` case at the end and render the new document. Write the renderer next to the others in [scripts/sample-data/pdfs.ts](../scripts/sample-data/pdfs.ts) (copy `renderImportPermit`, keep the SYNTHETIC SAMPLE footer).
2. [src/domain/documents.ts](../src/domain/documents.ts): add `"certificate_of_origin"` to `DOCUMENT_TYPES` and its spec to `DOCUMENT_SPECS` with `routesTo: "filed"` (stored and shown, no workflow), `referenceField`, `fields` and `lineFields: []`. TypeScript then points at every place that lists all types.
3. [src/adapters/extractor/default/layouts.ts](../src/adapters/extractor/default/layouts.ts): its `titleKeywords` (how the classifier recognises it) and field labels.
4. If it belongs to a shipment: set `routesTo: "shipment"` and add it to `SHIPMENT_DOCUMENT_TYPES` (and, if it is required, to `REQUIRED_DOCUMENTS`) in [src/domain/shipment/assess.ts](../src/domain/shipment/assess.ts). The shipment router in `intake.ts` handles every type that routes to a shipment, so no new router is needed. A completely new destination would need a router in `ROUTERS` in [src/services/intake.ts](../src/services/intake.ts).

**See it:** `npm run seed`, then `npm run test:golden`: the new type appears in the "Extraction accuracy by document type" table. Upload the PDF on the Inbox page: it is detected and can be confirmed.

### 3.4 Add a screen and a navigation link (vendor list)

1. **Test first**: the data the page needs comes from a service, so test the service. Create `listVendorSummaries(deps)` in a new [src/services](../src/services) file and an integration test in `tests/integration/` using `createWorkspace()` from [tests/helpers/workspace.ts](../tests/helpers/workspace.ts) (copy the top of any test there).
2. Create `src/app/(app)/vendors/page.tsx`:
   ```tsx
   // What: the vendor list. Who calls it: the "Vendors" link in the sidebar. To extend: add columns from listVendorSummaries().
   import { requirePersona } from "@/app/_lib/session";
   import { PageHeader } from "@/components/PageHeader";
   import { getDeps } from "@/services/deps";
   import { listVendorSummaries } from "@/services/vendors";

   export default async function VendorsPage() {
     await requirePersona();
     const vendors = await listVendorSummaries(await getDeps());
     return (
       <>
         <PageHeader title="Vendors" subtitle="From Navision." />
         <div className="card card-tight">
           <table className="table">
             <tbody>
               {vendors.map((vendor) => (
                 <tr key={vendor.vendorId}><td>{vendor.name}</td><td>{vendor.email}</td></tr>
               ))}
             </tbody>
           </table>
         </div>
       </>
     );
   }
   ```
3. [src/app/(app)/layout.tsx](../src/app/(app)/layout.tsx): add `{ href: "/vendors", label: "Vendors" }` to the right group in `NAVIGATION`.
4. Run `npm run typecheck` once (it regenerates the route types).

**See it:** `npm run dev`, the new link is in the sidebar. Use the CSS classes in [src/app/globals.css](../src/app/globals.css) (`card`, `table`, `badge-*`, `btn`, `tile`) instead of new styles.

### 3.5 Add a notification type to the Outbox

1. **Test first**: an integration test that does the thing that should notify and then checks `listOutbox(deps, { type: "your_type" })` ([src/services/outbox.ts](../src/services/outbox.ts)).
2. [src/domain/notifications.ts](../src/domain/notifications.ts): add the type and its label to `NOTIFICATION_TYPES`, and a builder function next to the others:
   ```ts
   export function buildCustomerCardCreated(sales: Recipient, data: { customerName: string; orderNo: string }): OutgoingMessage {
     return {
       type: "customer_card_created",
       channel: "email",
       ...to(sales),
       subject: `New customer card: ${data.customerName}`,
       body: `A customer card for ${data.customerName} was written to Navision with ${data.orderNo}.`,
       entityType: "order",
       entityId: data.orderNo,
       orderNo: data.orderNo,
       dedupeKey: `customer-card:${data.orderNo}`, // set it when the same message must never be written twice
     };
   }
   ```
3. In the service where it happens: `await deps.notifier.send(buildCustomerCardCreated(recipient, {...}))`. On AWS (`NOTIFIER=ses`) the same call also emails it; drafts are emailed only when a person sends them.
4. If it should be sent when something *becomes due* rather than when someone clicks, write a sweep `(deps, now) => Promise<string[]>` and add it to `SWEEPS` in [src/services/jobs.ts](../src/services/jobs.ts). Use a `dedupeKey`, because sweeps run again and again. Look at `documentDueAlertSweep` in [src/services/shipments.ts](../src/services/shipments.ts) as an example.

**See it:** the Outbox page's type filter lists the new label automatically.

### 3.6 Change the SPR reminder schedule

The schedule is one constant: `REMINDER_SCHEDULE` in [src/domain/spr/stateMachine.ts](../src/domain/spr/stateMachine.ts) (today: reminders at 24 and 48 hours, hand-over to the stand-in at 72).

1. **Test first**: update the expected hours in [src/domain/spr/spr.test.ts](../src/domain/spr/spr.test.ts) (`planReminders`) and the step-by-step test in [tests/integration/spr.test.ts](../tests/integration/spr.test.ts), which moves the fake clock and checks each reminder line.
2. Change `REMINDER_SCHEDULE`. Submitting an SPR schedules one `ScheduledJob` per step; `runDueJobs()` sends each when it is due, and a decision cancels the rest.
3. Check the approval link lifetime still makes sense: `approvalLinkTtlHours` in [src/adapters/config.ts](../src/adapters/config.ts) (48 hours). Every reminder carries a fresh link.
4. The seed history ([scripts/seed-scenario.ts](../scripts/seed-scenario.ts)) has steps named "24-hour reminder"; adjust their times if you want the demo to match. The KPI replay reads the schedule itself.

**See it:** submit an SPR as Priya, press "+24 h" in the top bar and look at the Outbox.

### 3.7 Add a status to the order dashboard

Example: "Waiting for documents", for an order that could ship but whose outgoing shipment still misses a document.

1. **Test first**: a row in the status table of [src/domain/order/status.test.ts](../src/domain/order/status.test.ts) with the facts that should lead to the new status.
2. [src/domain/order/status.ts](../src/domain/order/status.ts):
   - add `"waiting_documents"` to `OrderStatus` and a label to `ORDER_STATUS_LABELS`;
   - in `planSteps()`, give the step that lists missing documents `status: "waiting_documents"` instead of `null`. The order of the blocks in `planSteps()` is the ranking: put the block where the new status should rank;
   - add a `case` to `customerUpdate()`.
3. TypeScript now lists every place that must know about it, because they are typed `Record<OrderStatus, ...>`: the badge colour in [src/components/OrderBadges.tsx](../src/components/OrderBadges.tsx) and the sort order in [src/services/orderDashboard.ts](../src/services/orderDashboard.ts). Fix them until `npm run typecheck` is clean.
4. The dashboard's status filter is built from `ORDER_STATUS_LABELS`, so it needs no change. If it deserves a tile, add a count to `summarizeOrders()`.

**See it:** the seeded order ORD-1038 (its outgoing import permit is missing) shows the new status on `/dashboard`.

### 3.8 Swap FileNavisionGateway for an API version

The rest of the app only knows the `NavisionGateway` interface in [src/adapters/navision/gateway.ts](../src/adapters/navision/gateway.ts). [docs/NAVISION_ADAPTER.md](NAVISION_ADAPTER.md) describes what each method must return.

1. **Test first**: copy [tests/integration/fileNavisionGateway.test.ts](../tests/integration/fileNavisionGateway.test.ts) into a test for the new class, against a small fake HTTP server (or recorded responses). Keep [tests/invariants/export-needs-approved-preview.test.ts](../tests/invariants/export-needs-approved-preview.test.ts) passing with the new gateway.
2. Create `src/adapters/navision/apiGateway.ts` with `export class ApiNavisionGateway implements NavisionGateway`. Rules:
   - validate every response with the Zod schemas in [schemas.ts](../src/adapters/navision/schemas.ts) before returning it;
   - `exportSalesOrder` and `createCustomerCard` must refuse to write without an approval whose `previewHash` matches the content (copy the check from `FileNavisionGateway`), and must be idempotent (the same order sent twice is written once);
   - never retry a write blindly; report the error to the person.
3. [src/adapters/config.ts](../src/adapters/config.ts): add `NAVISION_MODE` (`file` or `api`) and the API address to `EnvSchema` and `.env.example`.
4. [src/services/deps.ts](../src/services/deps.ts): in both `buildDeps()` and `longLived()`, create `ApiNavisionGateway` when `config.navisionMode === "api"`.
5. The "Mock Navision" page (`/navision`) only works with the file gateway; it already says so when another gateway is used.

**See it:** set `NAVISION_MODE=api` in `.env`, restart `npm run dev`, open an order's review page: lookups now come from the API.

### 3.9 Change the database tables (SQLite and MySQL)

The app runs on SQLite on a laptop and on MySQL (Amazon RDS) on AWS. There is **one** schema to edit, [prisma/schema.prisma](../prisma/schema.prisma); `prisma/mysql/schema.prisma` is generated from it. Each database has its own migration folder, so a table change needs one migration for each.

1. Edit `prisma/schema.prisma`. Keep it portable: money as a decimal string, no enums, no `@default(now())`. Mark a text field that can be long with the comment `// LONG TEXT` (it becomes LONGTEXT on MySQL; a plain `String` is limited to 191 characters there).
2. `npm install` (or `node scripts/make-mysql-schema.mjs && npx prisma generate && npx prisma generate --config prisma.mysql.config.ts`) regenerates the MySQL schema and both clients. A test fails if you forget.
3. SQLite migration: a new folder `prisma/migrations/<yyyymmddhhmmss>_<what>/migration.sql`, for example `ALTER TABLE "OutboxMessage" ADD COLUMN "deliveredAt" DATETIME;` (see `20261125000000_outbox_delivery`).
4. MySQL migration, written by Prisma from the difference between the old and the new MySQL schema (no database needed):
   ```bash
   git show HEAD:prisma/mysql/schema.prisma > old-mysql.prisma
   npx prisma migrate diff --from-schema old-mysql.prisma --to-schema prisma/mysql/schema.prisma --script      -o prisma/mysql/migrations/<yyyymmddhhmmss>_<what>/migration.sql --config prisma.mysql.config.ts
   rm old-mysql.prisma
   ```
5. `npm test` (the tests build their SQLite databases from `prisma/migrations`). On AWS, `orderflow-update` applies the MySQL migration (`prisma migrate deploy --config prisma.mysql.config.ts`).

To try MySQL on a laptop: start one (for example `docker run -d -p 3307:3306 -e MYSQL_ROOT_PASSWORD=... -e MYSQL_DATABASE=orderflow mysql:8.4`), set `DATABASE_URL="mysql://root:...@localhost:3307/orderflow"` in the terminal, and run `npx tsx scripts/seed.ts --reset-mysql`. The seed refuses MySQL without that flag, because it empties every table.

---

## 4. Rules of thumb

1. **Write the rule as a pure function first**, with a table-driven test, then call it from a service. If a rule needs "now", take `now: Date` as a parameter.
2. **Never `new Date()` or `Date.now()` in `src`.** Use `deps.clock.now()`. Otherwise the demo clock, the tests and the replay disagree with your code.
3. **Money is a string, arithmetic goes through [money.ts](../src/domain/money.ts).** `0.1 + 0.2` is not `0.3`; `toMoney("0.1").plus("0.2")` is.
4. **Never change a value the system read.** Show a suggestion; a person clicks it; record who, when, old and new. The test [tests/invariants/no-auto-correct.test.ts](../tests/invariants/no-auto-correct.test.ts) checks this.
5. **Every flag has a code from `FLAG_CATALOGUE` and a sentence a staff member can act on.** Write the sentence as you would say it to Sam: what is wrong, the numbers, what to do.
6. **Anything a person decides is an audit event** (`recordAudit`) with their name. An override or resolution also needs a reason (`validateDecisionInput`).
7. **Validate everything that comes from outside with Zod**: environment variables, Navision files, LLM answers, form input that is not plain text.
8. **Services throw `UserError` for things a person can fix** (a missing reason, the wrong role). Anything else is a bug and should be loud.
9. **Pages and actions stay thin.** If an action is more than "read the form, call one service", the logic belongs in the service.
10. **Say "detect and alert", never "prevent".** We cannot stop wrong data entering Navision. Use the project vocabulary: due date (never "cut-off"), order dashboard (never "command center").
11. **Each file starts with three comment lines**: what it does, who calls it, what to change to extend it.
12. **A new dependency needs a one-line reason** in [docs/DECISIONS.md](DECISIONS.md).

---

## 5. Glossary and troubleshooting

### Glossary

| Term | Meaning |
|---|---|
| Navision | Microsoft Dynamics NAV, Spectra's ERP. In the POC: JSON files in `data/navision`, read by `FileNavisionGateway`. |
| Posting / export | Writing a record into Navision. In the POC: a JSON file in `data/navision/export`, only after a person approves a preview of exactly that file. |
| PO, PO line | Purchase order; one row of it (part, quantity, price). A *customer PO* is what a customer sends us; a *vendor PO* is what we send a supplier. |
| PI | Proforma invoice: what the customer pays before the goods ship. Number = "PI-" + order number (assumption A12). |
| SPR | Sales Purchase Requisition: a restocking request raised by a product manager and approved by Janet (or her stand-in). |
| Alias | A remembered "this part number means that one" (AB-1234X means AB1234X). Suggested, never applied by itself. |
| Flag | A finding of a rule: reason code, severity (blocking, warning, note), field, sentence. |
| Override | A person accepts a flagged difference as it is, with a reason and their name. |
| Fix | A person changes a value to match. Recorded with the old and new value. |
| Resolution | A person records the outcome of a shipment finding (story 5), with a reason and their name. |
| AWB, BL | Air waybill, bill of lading: the transport documents of a shipment. |
| Import permit, packing list | Required shipping documents (assumption A9). |
| Goods receipt (GR) | What the warehouse received, as recorded in Navision (assumption A1). |
| Due date | When required documents are due. Never "cut-off". |
| Promised ship date | The date a sales team member agreed with the customer; the dashboard's ship ETA. |
| Order dashboard | Story 6: every order's status, owner, next action and risk, derived, never typed. |
| Outbox | The table where every message the system "sends" is written. Nothing leaves the machine. |
| Persona | The mock sign-in: Sam Tan (sales), Priya Nair (product manager), Janet (approver), Farah Lim (Finance), Peter Goh (purchase). |
| Demo clock | Real time plus an offset stored in the database; "+1 h" and "+24 h" move it, and due jobs run. |
| Due jobs | `runDueJobs(now)`: reminders, hand-overs and alerts that have become due. EventBridge Scheduler would call it on AWS. |
| Golden dataset | `data/golden`: PDFs with the exact answers we expect, for `npm run test:golden`. |
| KPI replay | `npm run replay`: six synthetic months through the real services on a simulated clock. |
| STUB | Shown in the UI and docs where a feature is deliberately not built (for example the vendor PO after an approved SPR). |

### The ten most likely errors

| You see | Why | Do this |
|---|---|---|
| `Could not locate the bindings file` (better-sqlite3) | The SQLite driver's native part was not built for your Node version (install ran with `--ignore-scripts`, or Node was upgraded). | `npm rebuild better-sqlite3` |
| `Cannot find module '@/generated/prisma/client'` | The Prisma client was not generated. | `npx prisma generate` (normally done by `npm install`) |
| `The table main.Document does not exist` / `no such table` | No database yet, or a new migration. | `npm run seed` |
| "The PDF could not be shown" next to the fields; 404 for `pdf.worker.min.mjs` in the browser console | The pdf.js worker was not copied to `public/`. | `node scripts/copy-pdf-worker.mjs` |
| `EBUSY` or `database is locked` when deleting `storage/orderflow.db` on Windows | `npm run dev` holds the file. | Stop the dev server first, or use `npm run reset-demo`, which empties the tables while the server runs. |
| `Port 3000 is in use` | Another dev server is running. | Stop it, or `npx next dev -p 3001` and set `APP_BASE_URL=http://localhost:3001` so approval links point at it. |
| Type error: the route is not in `AppRoutes`, or `PageProps` is unknown | Route types are generated from the folders. | `npm run typecheck` (runs `next typegen`), or restart `npm run dev`. |
| Approval page says the link has expired or was already used | Links expire after 48 hours (on the demo clock) and work once. | Open the SPR as Priya and click "Send a new approval link", or `npm run reset-demo`. |
| Your edits to `data/navision/*.json` disappeared | `npm run seed` regenerates every sample file. | Use `npm run reset-demo` (keeps the files), or change the generator in `scripts/sample-data`. |
| `npm run test:e2e`: `Executable doesn't exist` | Playwright's browser is not installed. | `npx playwright install chromium` |

Also worth knowing: a scanned PDF without a text layer is "Type not recognised" with no fields (assumption A20). Choose the type and type the values by hand; Amazon Textract is the planned fix. A server action that catches every error will swallow Next.js's redirect: use `runAction()`.
