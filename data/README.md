# The data folder

**Everything in this folder is synthetic.** It was written by `scripts/generate-sample-data.ts` from a seeded random generator, so every run produces exactly the same files. Company and staff names are invented (Janet is the only name taken from the deck). Every PDF says SYNTHETIC SAMPLE in its footer and every JSON file starts with a `_note` saying the same.

| Folder | What it is | Who reads it |
|---|---|---|
| `navision/` | "Our form of Navision": `items`, `customers`, `vendors`, `customerOrders`, `purchaseOrders`, `goodsReceipts`, `staff` as JSON | The app, through `FileNavisionGateway`, on every request |
| `navision/export/` | Files the app wrote for Navision after a person approved a preview. Not in git. | You, to see what was exported (also shown on the Mock Navision page) |
| `inbox/` | PDFs waiting in the simulated email and WhatsApp inbox, plus `manifest.json` (channel, sender, time) | The Inbox page |
| `seed/` | PDFs the seed script feeds through the app to build the demo history (ORD-1031 to ORD-1042) | `npm run seed`, `npm run reset-demo` |
| `golden/` | The golden dataset: `cases.json` (expected type, fields and flags per PDF), `context.json`, `files/`, and its own `navision/` folder | `npm run test:golden`, `npm test` |
| `replay/` | 60 orders and 20 goods receipts over six simulated months with baseline timestamps, and its own `navision/` folder | `npm run replay` |

## Commands

- `npm run seed`: regenerates all of the above, then resets the app to the demo starting state.
- `npm run reset-demo`: resets the app to the demo starting state but leaves these files alone (use this once you have edited or replaced them).
- `npm run generate-data`: only regenerates the files.

You can drop any PDF into `data/inbox/` and it will show up on the Inbox page (as an email from an unknown sender unless you add it to `manifest.json`).

## Swapping in Spectra's real sample data

Spectra offered six months of sample data. When it arrives:

1. **Never commit real customer data to a public repository.** Keep it in a private location and point the app at it with environment variables (`NAVISION_DIR`, `INBOX_DIR`), or add the folder to `.gitignore`.
2. **Navision master data.** Convert Spectra's export of items, customers, vendors, open orders, purchase orders and goods receipts into the seven JSON files. The exact shapes are the Zod schemas in `src/adapters/navision/schemas.ts`; a wrong file gives a clear error that names the file and the field. Prices must be strings such as `"12.40"`.
3. **Documents.** Put real PDFs in the inbox folder. The default reader was written for our generated layouts, so expect missing fields on real layouts. Either add the real labels to `src/adapters/extractor/default/layouts.ts`, or switch on the LLM extractor (`EXTRACTOR=llm`), or use Textract and Bedrock once on AWS.
4. **Golden dataset.** For each real sample you want to keep as a regression test, add a case to a copy of `golden/cases.json` by hand: the file, the type it should be detected as, the field values a careful person reads from it, and the flags it should raise. Do not paste the app's own output as the expectation: a person must check it.
5. **KPI replay.** Produce `replay/orders.json` in the shape of `scripts/sample-data/replayTypes.ts` from the real timestamps: when each PO arrived, when its order was created in Navision, when an SPR was submitted and decided, and the promised and actual ship dates. Then `npm run replay` compares the solution with the real baseline instead of the invented one.
6. From then on use `npm run reset-demo` (not `npm run seed`, which would write the synthetic files again).

## Why the PDFs look the way they do

The sample PDFs have a simple "Label: value" header and one table. Two PO layouts and two proof-of-payment layouts use different labels and column orders so the reader is not tied to a single template. `scripts/sample-data/pdfs.ts` draws them; `scripts/sample-data/golden.ts` lists every golden case with the reason it exists.
