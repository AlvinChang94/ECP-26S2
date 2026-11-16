# Feature map

One row per acceptance criterion from the deck. "Rule" is the pure function in `src/domain` that decides; "Test" is where it is checked. Rows are filled in as each milestone lands.

| # | Story | Acceptance criterion | Screen and route | Rule (src/domain) | Test | How to demo | Status |
|---|---|---|---|---|---|---|---|
| 1.1 | 1 Capture and check a PO | Key fields are highlighted and extracted | PO review `/orders/[orderNo]/review`, document page `/documents/[id]` (PDF left, fields right; click a value to jump to it) | Reading: `src/adapters/extractor/default/` (AI reads). Checks: `checkCustomerPo` in `po/checks.ts` | `tests/golden/golden.test.ts`, `src/domain/po/checks.test.ts`, `src/adapters/extractor/extractor.test.ts` | Inbox: import `po-lanka-tech-lt-po-2310.pdf`, confirm the type, click "11.90" on the right: the PDF scrolls to it | Done |
| 1.2 | 1 | Easy to use, no tedious workflow | Inbox `/inbox`: Import all, one-click "Confirm type", or upload with the type already chosen | `LOW_CONFIDENCE_THRESHOLD` in `documents.ts` decides when a person must choose the type | `tests/integration/intake.test.ts` | Inbox: Import all, then Confirm type on a row: two clicks from email to checked PO | Done |
| 1.3 | 1 | No changes to details without human action | Same screens: findings only suggest; the type is only a proposal until confirmed | `currentValues` in `fields.ts` (extracted values plus recorded edits) | `tests/invariants/no-auto-correct.test.ts`, `tests/integration/intake.test.ts` | Open ORD-1039: TB240 is flagged with a suggestion, yet the value on screen and in the database is still TB240 | Done |
| 2.1 | 2 Review and remember | Past errors are remembered and suggested in context | PO review `/orders/[orderNo]/review` ("Use AB1234X", "Remember this fix"); alias list `/aliases` | `checkPartNumber` in `po/checks.ts` (alias memory wins over a similar item); `aliasKey` in `po/partMatch.ts` | `tests/integration/poReview.test.ts` (alias memory), `src/domain/po/checks.test.ts` | Import `po-lanka-tech-lt-po-2310.pdf`, click "Use AB1234X" with the box ticked; then import `po-dhaka-it-dh-5120.pdf`: AB-1234X is suggested "from the alias memory" and still waits for a click | Done |
| 2.2 | 2 | Changes can be undone and traced | PO review: "Edit line", "History of changes" with Undo; audit log `/audit` | `currentValues`, `undoTarget`, `fieldHistory` in `fields.ts` | `src/domain/fields.test.ts`, `tests/integration/poReview.test.ts` (editing) | Edit a quantity twice, press Undo twice: the value walks back and every step (including each undo) is in the history with name and time | Done |
| 2.3 | 2 | The corrected PO exports to Navision; the PI downloads as a PDF | Preview `/orders/[orderNo]/preview` (exact file, changes, Approve and export); order page `/orders/[orderNo]` (Download PI); route `/api/orders/[orderNo]/pi` | `buildSalesOrderExport` in `po/exportFile.ts`; `unresolvedBlocking` in `flags.ts`; `diffPoVersions`, `buildCancellationExport` in `po/amend.ts`; `summarizeFulfilment` in `po/fulfilment.ts` | `tests/invariants/export-needs-approved-preview.test.ts`, `tests/invariants/override-needs-reason.test.ts`, `src/domain/po/export.test.ts`, `tests/integration/poReview.test.ts` | On a PO with a price difference the Approve button is disabled; accept the difference with a reason, set the ship date, approve: the file appears under Mock Navision; download the PI from the order page | Done |
| 3.1 | 3 SPR from a part number | Part number fills vendor and price | New SPR `/spr/new` (shaded = from Navision, white = typed); suggested SPRs on `/spr` | `validateSprDraft` in `spr/stateMachine.ts`; `suggestSprs` in `spr/suggestions.ts`. The lookup is `lookupPart` in `src/services/spr.ts` | `tests/integration/spr.test.ts` (creating an SPR), `src/domain/spr/spr.test.ts` | As Priya: SPRs, "Open pre-filled SPR" on UPS-650: vendor Beta Parts and USD 47.20 are filled in; a part that is not in Navision (AB-1234X) fills nothing | Done |
| 3.2 | 3 | SPR goes to Janet for approval | SPR page `/spr/[sprNo]`; Outbox `/outbox`; approval page `/approve/[token]` (no login, shows the evidence) | `nextSprStatus`, `chooseAssignee` in `spr/stateMachine.ts`; `createApprovalToken`, `verifyApprovalToken` in `spr/approvalLink.ts` | `tests/invariants/approval-link.test.ts`, `tests/integration/spr.test.ts` (submitting, deciding) | Submit the SPR, open the Outbox, open the message to Janet and click its link: approve with remarks. The SPR shows Approved by Janet | Done |
| 3.3 | 3 | Reminders are automatic; late SPRs go to her stand-in | SPR page "Reminder schedule"; top bar "+24 h" (demo clock) | `REMINDER_SCHEDULE`, `planReminders`, `leaveCovering` in `spr/stateMachine.ts`; run by `runDueJobs` in `src/services/jobs.ts` | `tests/invariants/reminders-stop-after-decision.test.ts`, `tests/integration/spr.test.ts` (reminders and the stand-in) | Open SPR-0004 (waiting for Janet). Press "+24 h" twice: a 48-hour reminder, then the hand-over to Marcus Lee appear in the Outbox and on the SPR page. Decide it: the remaining rows show "Cancelled by the decision" | Done |
| 4.1 | 4 Payment tracking | Every order shows Proof received, Paid or Awaiting, with days waiting | | | | | Planned (M4) |
| 4.2 | 4 | The warehouse is notified when payment is confirmed | | | | | Planned (M4) |
| 4.3 | 4 | Vendor payments trigger reminders before they are due | | | | | Planned (M4) |
| 5.1 | 5 Receipts and documents | Quantity mismatches are flagged | | | | | Planned (M5) |
| 5.2 | 5 | AWB, BL and permits are flagged when missing | | | | | Planned (M5) |
| 5.3 | 5 | An alert is raised before the due date | | | | | Planned (M5) |
| 5.4 | 5 | Reviewer and outcome are logged | | | | | Planned (M5) |
| 6.1 | 6 Order dashboard | Status, owner and ship ETA per order | | | | | Planned (M6) |
| 6.2 | 6 | The delay reason is shown | | | | | Planned (M6) |
| 6.3 | 6 | Tasks with assignees | | | | | Planned (M6) |
| 6.4 | 6 | Search and a timeline | | | | | Planned (M6) |

## Asked for by Spectra in the briefing (built in M2, after the core flow)

| Feature | Where | Test | How to demo |
|---|---|---|---|
| Amended PO links to its earlier version and shows a diff | Review page "Changes from revision 1"; preview "Changes from the previous revision" | `tests/integration/poReview.test.ts`, `src/domain/po/export.test.ts` | Import `po-dubai-dist-dd-7802-amendment-1.pdf`: it attaches to ORD-1032 as revision 2 with the changed quantity and the new line listed |
| Cancelled PO closes the draft or the export record | Preview page in cancel mode (`/orders/[orderNo]/preview?mode=cancel`) | `tests/integration/poReview.test.ts`, `tests/invariants/export-needs-approved-preview.test.ts` | Import `po-muscat-micro-mm-3342-cancellation.pdf`: confirming closes the ORD-1039 draft. ORD-1041 in the seed shows a cancelled revision written for Navision |
| Partial fulfilment shows delivered and remaining quantities | Order page "Delivered and remaining" | `src/domain/po/export.test.ts`, `tests/integration/poReview.test.ts` | Open ORD-1037: 95 of 120 delivered, 25 remaining; record a delivery |

## Foundation (milestone M0)

| Piece | Where | Test |
|---|---|---|
| Clock (real, offset, fake) | `src/adapters/clock.ts`, demo buttons in the top bar | `tests/integration/foundation.test.ts` |
| FileStore | `src/adapters/fileStore.ts` | `tests/integration/foundation.test.ts` |
| Outbox (Notifier) | `src/adapters/notifier.ts`, page `/outbox` | `tests/integration/foundation.test.ts` |
| Mock Navision | `src/adapters/navision/`, page `/navision` | `tests/integration/fileNavisionGateway.test.ts` |
| Sample data and golden dataset | `scripts/sample-data/`, `data/` | `tests/integration/sampleData.test.ts` |
| Persona picker | `/sign-in`, `src/app/_lib/session.ts` | end-to-end tests (M7) |
| Audit log | `src/services/audit.ts`, page `/audit` | `tests/integration/foundation.test.ts` |
