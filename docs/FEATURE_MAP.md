# Feature map

One row per acceptance criterion from the deck. "Rule" is the pure function in `src/domain` that decides; "Test" is where it is checked. Rows are filled in as each milestone lands.

| # | Story | Acceptance criterion | Screen and route | Rule (src/domain) | Test | How to demo | Status |
|---|---|---|---|---|---|---|---|
| 1.1 | 1 Capture and check a PO | Key fields are highlighted and extracted | | | | | Planned (M1) |
| 1.2 | 1 | Easy to use, no tedious workflow | | | | | Planned (M1) |
| 1.3 | 1 | No changes to details without human action | | | | | Planned (M1) |
| 2.1 | 2 Review and remember | Past errors are remembered and suggested in context | | | | | Planned (M2) |
| 2.2 | 2 | Changes can be undone and traced | | | | | Planned (M2) |
| 2.3 | 2 | The corrected PO exports to Navision; the PI downloads as a PDF | | | | | Planned (M2) |
| 3.1 | 3 SPR from a part number | Part number fills vendor and price | | | | | Planned (M3) |
| 3.2 | 3 | SPR goes to Janet for approval | | | | | Planned (M3) |
| 3.3 | 3 | Reminders are automatic; late SPRs go to her stand-in | | | | | Planned (M3) |
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
