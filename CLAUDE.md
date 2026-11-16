# Spectra OrderFlow POC: standing rules

Project: proof of concept for SCCCI x NYP AI Innovation Challenge 26S2, problem statement PS11 (Spectra Innovations, AI-powered purchase and sales order automation, Microsoft Dynamics Navision). Built by three NYP students who are new to Next.js, so code must be simple, readable and commented.

The source of truth is the team's deck in docs/spec/. If this file and the deck disagree, stop and ask.

## Design principles (never break these)
1. AI only reads. It may classify a document's type, extract fields from text, and draft reminder wording. Matching, validation, routing, status changes and reminders are plain deterministic TypeScript functions.
2. The system never auto-corrects. It flags a mismatch, gives a plain-language reason, and may suggest a fix. A person confirms.
3. Nothing is exported or posted to "Navision" without a person approving a preview of exactly what will be written.
4. Finance confirms that payment arrived. The system never marks an order paid by itself. The warehouse is notified once Finance confirms; we do not block the warehouse in the system.
5. An override means a person accepts a flagged difference. It needs a reason and the person's name. A fix means the value is changed to match. Both are written to the audit log (who, when, old value, new value).
6. We detect and alert. We cannot prevent wrong data entering upstream (for example a wrong warehouse count in Navision), so never claim prevention.
7. Every flag carries a reason code and a human-readable sentence.

## Vocabulary (use these words in code, UI and docs)
- SPR: Sales Purchase Requisition, a restocking request raised by a product manager and approved by Janet.
- PI: proforma invoice. PO: purchase order. PO line: one row of a PO (part, quantity, price).
- Alias: a remembered "this part number means that one".
- Posting or export: writing a record into Navision (in the POC, writing an import file).
- Due date (never "cut-off"). Order dashboard (never "command center" or "control tower").
- Roles: sales team member, product manager, Janet (approver), Finance, purchase team. There is no manager role and no logistics role.

## Architecture rules
- src/domain: pure functions and types. No file, database, network or clock access. Fully unit-tested.
- src/adapters: everything that touches the outside world, each behind an interface: NavisionGateway, DocumentExtractor, Notifier, Clock, FileStore. The POC implements them with local files and SQLite. AWS versions come later.
- src/services: orchestrate domain + adapters for one use case each.
- src/app: Next.js App Router pages and route handlers. Keep them thin.
- Time comes only from the Clock interface, so tests and the KPI replay can use a simulated clock.
- Money uses decimal.js, never floating-point numbers. Validate all external input with Zod.
- TypeScript strict mode, no `any`. Each file starts with a 3-line comment: what it does, who calls it, what to change to extend it.

## Testing and honesty
- Run `npm run typecheck`, `npm run lint` and `npm test` before saying a task is done. Never claim a test passes without running it.
- Sample data is synthetic and labelled as such. Never invent facts about Spectra. Record open questions in docs/ASSUMPTIONS.md and design choices in docs/DECISIONS.md.
- Do not add a dependency without a one-line reason in docs/DECISIONS.md.
- Commit after each milestone with a clear message. Keep docs in step with code.