# Demo script

About 12 minutes. One order, ORD-1042, carries the story: it is blocked when the demo starts, and the audience watches the team find out why and clear it. The other stories are shown on the way. Every step below is also covered by an automated test (see [MANUAL_TEST.md](MANUAL_TEST.md)), so it works the same on the day.

## Before the audience arrives

1. `npm run reset-demo` (about 15 seconds; it can run while the app is open), then `npm run dev`. If the app was already open, refresh the browser.
2. Open http://localhost:3000 in a normal window, zoom to 90%. Open a **second, private window** for Janet, who has no login.
3. Run `npm run replay` once beforehand and keep `reports/kpi-replay.txt` open in an editor for the last step.
4. **Do not press "+1 h" or "+24 h" before step 6.** The demo is set at Monday 16 November 2026, 09:00 Singapore time, and ORD-1042's AWB is due at 16:00 that day.

If anything goes wrong at any point: `npm run reset-demo` and refresh. It always returns to exactly this starting state.

## The story so far (what the seed played through)

Beacon Devices ordered 100 docking hubs (PC-4402) on 4 November with PO BD-PO-5521. Spectra had none in stock, so Priya raised SPR-0001; Janet approved it after the automatic 24-hour reminder. Purchase ordered from Pacific Components (vendor PO PO-8341). Beacon paid in advance and Farah confirmed it, which told the warehouse. Yesterday the vendor's invoice and packing list arrived (100 units each), but the warehouse received 95, and the air waybill (AWB) still has not come. The import permit arrived this morning by WhatsApp and nobody has checked it yet. The goods are promised to ship on Wednesday 18 November.

## The demo

### 1. One view of every order (story 6), as Sam, sales team member

- Sign in as **Sam Tan**. Open **Order dashboard**.
- Point at the tiles: open orders, 1 blocked, 2 with the ship date at risk, 4 awaiting payment. *"Counted from the orders below, not typed in."*
- Point at the top row, **ORD-1042: Blocked, owner Peter Goh, promised 18 Nov 2026, At risk.** Read the grey line: *"5 units short, AWB missing and due today at 16:00."*
- Say: **"Nobody typed this status. It is worked out from what the other screens recorded: the shipment's documents, the payment, the SPR."**
- Type "beacon" in Search and press Show: one row. Clear.

### 2. The order's history (stories 1 to 4 on one timeline)

- Click **ORD-1042**. Show "Where this order stands": owner, next action, what holds it up.
- Show **Update for the customer**: *"Shipment at risk: 5 units short; AWB or BL pending. Promised ship date: 18 Nov 2026."* Say: *"One line Sam can paste into his reply. It comes from a fixed template, so it never leaks internal names or codes."*
- Scroll to the **Timeline**: the PO arriving, checked, the export approved by Sam after a preview, SPR-0001 approved by Janet after a reminder, Farah confirming the payment, the shipping documents, the alerts this morning. *"Every step with a name and a time."*

### 3. What exactly is wrong (story 5), as Peter, purchase team

- In "Open task", click **Open** (it goes to shipment SHP-0004). Switch persona to **Peter Goh** if asked.
- **Quantity reconciliation:** invoiced 100, packing list 100, received 95 (from Navision's goods receipt GR-2048): **5 units short**.
- **Required documents:** invoice and packing list Present, **AWB or BL Missing**, **import permit Pending check**.
- The yellow banner: **due today at 16:00, in 7 hours**. Under "Alerts and requests sent": the due-date alert sent to Peter at 03:05, and Sam's assignment.
- Say: **"We detect and alert. We cannot stop a wrong count from being entered into Navision, and we never change a quantity by ourselves. A person decides."**

### 4. Peter deals with it

- Next to AWB or BL, click **Request document**. *"A request to the vendor, in the Outbox."* (In AWS this is an email through SES.)
- On "Quantities do not match", click **Record resolution** with the box empty: refused, *"A reason is required."*
- Type *"Vendor confirmed the 5 missing units ship next week"* and record it. The finding shows **Resolved by Peter Goh** with the time; the audit trail has it.
- Click the permit's file name, `permit-po-8341.pdf`, and **Confirm type**. Back on the shipment, the permit is **Present**.

### 5. The AWB arrives (story 1: capture)

- Open **Inbox and upload**. The vendor's email with `awb-pacific-components-po-8341.pdf` is waiting. Click **Import**.
- The document page shows the PDF with highlights and **"AWB or BL · detected, 99% sure"**. Say: *"The AI only reads. Nothing happens until a person confirms the type."* Click **Confirm type**.
- It lands on SHP-0004: AWB or BL **Present**, status **Resolved by a person**.
- Open the **Order dashboard**: **ORD-1042 is now Ready to ship, owner Sam Tan, On track.** Blocked tile: 0.

### 6. A new PO, from email to Navision (stories 1 and 2), as Sam

- **Inbox**, Import `po-lanka-tech-lt-po-2310.pdf`, **Confirm type**.
- On the review page, click the unit price **11.90** on the right: the PDF jumps to it. *"Every value is shown where it was read."*
- Flag "Similar part suggested": the customer wrote AB-1234X. Keep "Remember this fix" ticked and click **Use AB1234X**. *"Next time, the same mistake is suggested from memory, and it still waits for a click."*
- Flag "Price differs from Navision": open "Accept this difference as it is", reason *"Special deal agreed by phone"*. *"An override needs a reason and a name."*
- Click the suggested ship date button. Then **Preview the export**: the exact file that will be written. **Approve and export.**
- On the order page, **Download PI (PDF)**. Open **Mock Navision** to show the file that was written.

### 7. An SPR in two minutes (story 3), as Priya, then Janet

- Switch to **Priya Nair**. SPRs, "Open pre-filled SPR" on UPS-650: vendor Beta Parts and the price come from Navision. Type a reason, **Submit to Janet**.
- **Outbox**, open the approval request, copy its link into the **private window**: no login. Janet sees the evidence (stock, open orders, last price) and clicks **Approve**. Open the link again: it is closed. *"Signed, single use, expires in 48 hours."*
- Optional, only now: back in the main window open **SPR-0004** and press **+24 h** twice: the 48-hour reminder, then the hand-over to Marcus Lee (her stand-in) appear.

### 8. Payment (story 4), as Farah, Finance

- Switch to **Farah Lim**. **Payments**: Awaiting, Proof received and Paid with days waiting.
- Open **ORD-1034** (proof matches exactly): **Confirm paid**. The Outbox has *"ORD-1034: payment confirmed, ready to pack"* for the warehouse. Say: **"The system never marks an order paid. Finance confirms; the warehouse is told, not blocked."**
- Open **ORD-1035**: short by 38.40. Confirm without a reason is refused.

### 9. Close: what it could mean (KPI replay)

- Show `reports/kpi-replay.txt`. **Say first: "This is synthetic data and simulated staff. It shows how we will measure, not what Spectra will get."**
- Order-processing time from PO arrival to Navision: mean 24.9 hours in the sample, 1.5 hours with the simulated staff.
- 36 of 36 seeded errors flagged (part numbers, prices, stock, unknown customers, receipt differences), with 0 false alarms.
- SPR turnaround: mean 83.7 hours in the sample, 52.4 hours with reminders and the stand-in.
- Overdue orders: 21 of 60 in both, because the replay ships on the sample's dates. 12 of the 21 had an alert before the promised date; 9 were late for reasons the system cannot see.
- End with the next step: *"Run this on Spectra's six months of real data."*

## Questions you may get

| Question | Answer |
|---|---|
| Does it connect to Navision? | Not yet: the POC writes import files after a person approves a preview. The connection sits behind one interface ([NAVISION_ADAPTER.md](NAVISION_ADAPTER.md)); the right way in depends on Spectra's Navision version and IT. |
| What if the AI reads a value wrong? | A person sees every value next to the PDF and corrects it; the correction is logged. The rules then check the corrected value. The golden test measures the reader separately from the rules. |
| Can it stop a wrong warehouse count? | No. It compares what the documents and Navision say and alerts a person in time. We say "detect and alert", never "prevent". |
| Where is this on AWS? | [AWS_MAPPING.md](AWS_MAPPING.md): S3 for files, Textract and Bedrock for reading, SES and SNS for messages, EventBridge Scheduler for due jobs, Step Functions for the SPR flow, Cognito for sign-in. |
| Is this Spectra's data? | No. Every company, order and number is generated and labelled SYNTHETIC SAMPLE. Only Janet's name comes from the briefing. |
