# Open assumptions and questions for Spectra

Nothing here is a fact about Spectra. Each line is something the proof of concept had to assume in order to work. Confirm or correct them with Spectra, then update the code and this file.

| # | We assume | Where it matters | To confirm with Spectra |
|---|---|---|---|
| A1 | The quantity the warehouse received reaches us through Navision (the `goodsReceipts` file in the POC). | Story 5 quantity reconciliation | How do warehouse counts get recorded today, and can we read them? |
| A2 | After Janet approves, the SPR is only an approved SPR. Creating the vendor PO is a separate draft that a person approves before anything is exported. The POC stops at the approved SPR (the vendor PO step is a labelled STUB). | Story 3 | Should the system prepare the vendor PO draft? Who releases it? |
| A3 | How we may connect to Navision is not confirmed. The POC reads and writes plain JSON files (`data/navision`). | Everything that reads Navision | Navision version, and whether an API, web services or file import is available (see NAVISION_ADAPTER.md). |
| A4 | Navision holds, per item, a sales price and a last purchase price. | Story 1 price check, story 3 pre-fill, `SHOW_MARGIN` | Which price fields exist and may be read. |
| A5 | An SPR can be raised from a shortage on a customer order (suggested) or typed in directly for restocking. | Story 3 | The briefing notes say Spectra only sells from inventory and that suggestions are "a novelty": is the suggestion list wanted? |
| A6 | Customers pay in advance (the PI is paid before goods ship). A "credit" term exists in the data model but no sample uses it. | Story 4, order status | Which payment terms are in use. |
| A7 | A sales team member sets the promised ship date when approving the order. | Stories 2 and 6 | Where the promised date comes from today. |
| A8 | Each vendor PO has a date by which its shipping documents are due (`documentsDueAt` in mock Navision). For outgoing shipments the due date is the start of the promised ship day. | Story 5 due-date alerts | What deadline applies to AWB, BL and permits, and where it is recorded. |
| A9 | Every shipment, in or out, needs four documents: AWB or BL, import permit, packing list, invoice. | Story 5 checklist | The real list per route and country. |
| A10 | A remembered alias applies to all customers. | Story 2 alias memory | Do two customers ever use the same code for different parts? |
| A11 | A customer is matched by name, ignoring case, punctuation and legal suffixes (Pte Ltd, LLC). A new customer card holds name, address, country, email, payment terms and currency. | Stories 1 and 2 | What a Navision customer card must contain; whether a customer number is quoted on POs. |
| A12 | The PI number is "PI-" plus the order number. Bank details are printed from Navision in the real system and are left out of the POC's PI. | Story 2 PI download, story 4 matching | PI numbering and layout. |
| A13 | Customers send proof of payment as a PDF by email or WhatsApp, quoting the PI number or their PO number. | Story 4 matching | What proofs look like in practice (screenshots? bank advices?). |
| A14 | Janet's stand-in and planned leave come from a staff file (`staff.json`). | Story 3 routing | Where leave and delegation are recorded. |
| A15 | The warehouse is told by a message when payment is confirmed. The warehouse does not use this system and is never blocked by it. | Story 4 | How the warehouse wants to be notified. |
| A16 | Business time is Singapore time (UTC+8). | Due dates, "days waiting", display | Confirm. |
| A17 | ORD numbers are OrderFlow's own tracking references; Navision assigns its own sales order numbers when it imports. | Export file, dashboard | How Navision numbers orders on import. |
| A18 | Prices are compared in the same currency (the samples are all USD). A different currency is flagged, never converted. | Stories 1 and 4 | Which currencies occur. |
| A19 | Email and WhatsApp intake is simulated by a folder (`data/inbox`) and by manual upload. | Story 1 intake | Which mailbox and which WhatsApp number or export would be connected. |
| A20 | PDFs have a text layer. Scans and photos cannot be read by the default reader (the type and fields must then be entered by hand; Textract is the planned fix). | Story 1 | How many documents arrive as scans or photos. |
| A21 | The PO check compares the ordered quantity with the stock on hand. It does not subtract stock already promised to other open orders (the suggested-SPR list does add up all open orders). | Story 1, story 3 | Whether Navision exposes available (unreserved) stock. |
| A22 | The six-month history used by the KPI replay is synthetic, including every baseline timestamp. | KPI replay | Spectra offered six months of sample data; replace the synthetic set when it arrives (see `data/README.md`). |
| A23 | A PO that states "partial shipment allowed" may be delivered in parts; delivered quantities are recorded by a person. | Story 2 partial fulfilment | Where partial shipments are recorded today. |
| A24 | An amended PO carries the same PO number with a marking such as "AMENDMENT 1"; a cancellation carries "CANCELLATION". | Story 2 amend and cancel | How customers actually send amendments and cancellations. |
| A25 | A missing document is requested from the vendor (purchases) or from the warehouse contact (sales). The request is a message in the Outbox. | Story 5 "Request document" | Who really supplies each document (vendor, forwarder, declarant, warehouse)? |
| A26 | A shipment is tracked from the moment its first document is confirmed, or when a person starts tracking it by entering the vendor PO or order number. Vendor POs in Navision are not tracked automatically. | Story 5 checklist and alerts | Should every open vendor PO be tracked as soon as it exists in Navision? Which field tells us it is still open? |
| A27 | A shipping document names its shipment by a reference: the vendor PO number (purchases) or our order number, the customer's PO number or the PI number (sales). | Story 5 routing | Which reference do AWBs, BLs and permits really carry? |
| A28 | Part numbers on vendor invoices and packing lists are compared with Navision item numbers exactly as written. Alias memory (story 2) is not applied to vendor documents. | Story 5 reconciliation | Do vendors use their own part numbers? |
| A29 | An outgoing shipment is compared with the whole order. A partial shipment therefore shows as a quantity difference that a person resolves with a reason. | Story 5 (sales) | Should outgoing documents be compared with the delivery being shipped instead? |
| A30 | One goods receipt per vendor PO. A second receipt for the same PO (goods arriving in two lots) is not added up. | Story 5 reconciliation | How does Navision record part deliveries from a vendor? |
