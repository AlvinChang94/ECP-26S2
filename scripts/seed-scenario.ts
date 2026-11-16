// What: the scripted demo history. It feeds the seed PDFs through the same services a person would use, on a simulated clock.
// Who calls it: scripts/seed.ts (and an integration test that checks the scenario still ends with ORD-1042 blocked).
// To extend: add steps to buildSteps(). Use the services only, never write rows directly, so the demo state is always reachable by hand.
import { readFileSync } from "node:fs";
import path from "node:path";
import type { FakeClock } from "../src/adapters/clock";
import type { Actor } from "../src/domain/audit";
import { setLastUsedNumber } from "../src/services/counters";
import type { Deps } from "../src/services/deps";
import { recordDelivery } from "../src/services/fulfilment";
import { confirmDocumentType, ingestDocument } from "../src/services/intake";
import { runDueJobs } from "../src/services/jobs";
import { confirmPaid } from "../src/services/payments";
import { editField } from "../src/services/poEdit";
import { approveAndExport, approveCancellation, buildCancellationPreview, buildExportPreview } from "../src/services/poExport";
import { createSpr, decideSpr, latestApprovalTokenFromOutbox, submitSpr } from "../src/services/spr";
import { customerByName, DEMO_NOW } from "./sample-data/master";
import { SCENARIO_ORDERS, SCENARIO_PROOFS, scenarioOrder } from "./sample-data/scenario";

const SAM: Actor = { name: "Sam Tan", role: "sales" };
const PRIYA: Actor = { name: "Priya Nair", role: "product_manager" };
const FARAH: Actor = { name: "Farah Lim", role: "finance" };

/** One thing that happened in the demo's past, at a simulated time. */
type Step = { at: Date; label: string; run: () => Promise<void> };

function before(hours: number, minutesLater = 0): Date {
  return new Date(DEMO_NOW.getTime() - hours * 60 * 60 * 1000 + minutesLater * 60 * 1000);
}

/** Orders that are left as drafts with open findings, so the dashboard shows a PO still in review. */
const LEFT_IN_REVIEW = new Set(["ORD-1039"]);
/** Orders whose proof of payment has arrived but which Finance has not confirmed yet ("Proof received" on the board). */
const PROOF_NOT_YET_CONFIRMED = new Set(["ORD-1034", "ORD-1035"]);

function buildSteps(deps: Deps, seedDir: string): Step[] {
  const steps: Step[] = [];
  const read = (file: string): Uint8Array => new Uint8Array(readFileSync(path.join(seedDir, file)));
  /** Document ids by file name, filled in as documents are taken in. */
  const documentIds = new Map<string, string>();

  // ---- Stories 1 and 2: each PO arrives, its type is confirmed, the ship date is set and the export is approved.
  for (const order of SCENARIO_ORDERS) {
    const sender = customerByName(order.customer).email;
    steps.push({
      at: before(order.arrivedHoursAgo),
      label: `${order.orderNo}: PO ${order.poNumber} arrives by ${order.channel}`,
      run: async () => {
        const result = await ingestDocument(deps, SAM, { bytes: read(order.file), fileName: order.file, channel: order.channel, sender });
        documentIds.set(order.file, result.documentId);
      },
    });
    steps.push({
      at: before(order.arrivedHoursAgo, 10),
      label: `${order.orderNo}: Sam confirms the type`,
      run: async () => {
        // The demo script refers to fixed order numbers, so each order gets exactly the number planned for it.
        await setLastUsedNumber(deps, "order", Number(order.orderNo.replace("ORD-", "")) - 1);
        const route = await confirmDocumentType(deps, SAM, documentIds.get(order.file) as string, "customer_po");
        if (route.routedId !== order.orderNo) throw new Error(`Seed expected ${order.orderNo} but the order became ${route.routedId}`);
      },
    });
    if (LEFT_IN_REVIEW.has(order.orderNo)) continue;
    steps.push({
      at: before(order.arrivedHoursAgo, 40),
      label: `${order.orderNo}: Sam sets the promised ship date`,
      run: async () => {
        await editField(deps, SAM, { orderNo: order.orderNo, field: "promisedShipDate", value: order.promisedShipDate, reason: "Date agreed with the customer." });
      },
    });
    steps.push({
      at: before(order.arrivedHoursAgo, 50),
      label: `${order.orderNo}: Sam approves the export preview`,
      run: async () => {
        const preview = await buildExportPreview(deps, order.orderNo);
        await approveAndExport(deps, SAM, { orderNo: order.orderNo, previewHash: preview.previewHash });
      },
    });
  }

  // ---- Story 2: ORD-1041 was cancelled by the customer a day after it was exported.
  const cancelled = scenarioOrder("ORD-1041");
  const cancellationFile = "cancellation-ord-1041-dubai-dist.pdf";
  steps.push({
    at: before(cancelled.arrivedHoursAgo - 26),
    label: "ORD-1041: the customer's cancellation arrives and Sam confirms it",
    run: async () => {
      const result = await ingestDocument(deps, SAM, {
        bytes: read(cancellationFile),
        fileName: cancellationFile,
        channel: "email",
        sender: customerByName(cancelled.customer).email,
      });
      await confirmDocumentType(deps, SAM, result.documentId, "customer_po");
      const preview = await buildCancellationPreview(deps, "ORD-1041");
      await approveCancellation(deps, SAM, { orderNo: "ORD-1041", previewHash: preview.previewHash, reason: "The customer cancelled the PO (cancellation document received by email)." });
    },
  });

  // ---- Story 2, partial fulfilment: ORD-1031 is fully delivered; ORD-1037 shipped what was in stock.
  steps.push({
    at: before(5 * 24),
    label: "ORD-1031: both lines delivered in full",
    run: async () => {
      await recordDelivery(deps, SAM, { orderNo: "ORD-1031", partNo: "CD-77", quantity: 100, note: null });
      await recordDelivery(deps, SAM, { orderNo: "ORD-1031", partNo: "HS-700", quantity: 50, note: null });
    },
  });
  steps.push({
    at: before(2 * 24),
    label: "ORD-1037: partial delivery (95 of 120 memory modules, all flash drives)",
    run: async () => {
      await recordDelivery(deps, SAM, { orderNo: "ORD-1037", partNo: "RAM-16D4", quantity: 95, note: "Shipped the stock on hand; 25 follow when the vendor delivers." });
      await recordDelivery(deps, SAM, { orderNo: "ORD-1037", partNo: "FD-64U3", quantity: 300, note: null });
    },
  });

  // ---- Story 4: proofs of payment arrive; Farah confirms the type, checks the match and confirms the payment.
  for (const proof of SCENARIO_PROOFS) {
    const order = scenarioOrder(proof.orderNo);
    steps.push({
      at: before(proof.paidHoursAgo),
      label: `${proof.orderNo}: proof of payment arrives and Farah confirms its type`,
      run: async () => {
        const result = await ingestDocument(deps, FARAH, {
          bytes: read(proof.file),
          fileName: proof.file,
          channel: proof.layout === "A" ? "whatsapp" : "email",
          sender: customerByName(order.customer).email,
        });
        await confirmDocumentType(deps, FARAH, result.documentId, "proof_of_payment");
      },
    });
    if (PROOF_NOT_YET_CONFIRMED.has(proof.orderNo)) continue;
    steps.push({
      at: before(proof.paidHoursAgo, 45),
      label: `${proof.orderNo}: Farah confirms the payment; the warehouse is notified`,
      run: () => confirmPaid(deps, FARAH, { orderNo: proof.orderNo, reason: "" }),
    });
  }

  // ---- Story 3: SPRs. The approver is played by opening the link from the Outbox, as she would from her email.
  const decide = async (sprNo: string, decision: "approve" | "reject", remarks: string): Promise<void> => {
    const token = await latestApprovalTokenFromOutbox(deps, sprNo);
    if (!token) throw new Error(`No approval link found in the Outbox for ${sprNo}`);
    await decideSpr(deps, token, { decision, remarks });
  };
  const raise = async (expected: string, partNo: string, quantity: number, reason: string, sourceOrderNo: string | null, submit = true): Promise<void> => {
    const sprNo = await createSpr(deps, PRIYA, { partNo, quantity, reason, sourceOrderNo });
    if (sprNo !== expected) throw new Error(`Seed expected ${expected} but the SPR became ${sprNo}`);
    if (submit) await submitSpr(deps, PRIYA, sprNo);
  };

  // SPR-0001 for ORD-1042: decided after the 24-hour reminder went out.
  steps.push({ at: before(12 * 24 - 2), label: "SPR-0001: Priya raises 100 x PC-4402 for ORD-1042", run: () => raise("SPR-0001", "PC-4402", 100, "ORD-1042 (Beacon Devices) needs 100 and none are in stock.", "ORD-1042") });
  steps.push({ at: before(12 * 24 - 2 - 24, 5), label: "Due jobs run: 24-hour reminder for SPR-0001", run: async () => void (await runDueJobs(deps)) });
  steps.push({ at: before(12 * 24 - 2 - 25), label: "SPR-0001: Janet approves", run: () => decide("SPR-0001", "approve", "Approved. Customer has paid in advance.") });

  // SPR-0002 for ORD-1037: decided within hours, before any reminder.
  steps.push({ at: before(8 * 24 - 3), label: "SPR-0002: Priya raises 25 x RAM-16D4 for ORD-1037", run: () => raise("SPR-0002", "RAM-16D4", 25, "ORD-1037 (Nova Controls) is 25 short of stock.", "ORD-1037") });
  steps.push({ at: before(8 * 24 - 9), label: "SPR-0002: Janet approves", run: () => decide("SPR-0002", "approve", "Approved.") });

  // SPR-0003: a restocking request that was rejected.
  steps.push({ at: before(6 * 24), label: "SPR-0003: Priya raises a restocking request", run: () => raise("SPR-0003", "TC-LBL4", 50, "Restock label printers before the year-end orders.", null) });
  steps.push({ at: before(6 * 24 - 20), label: "SPR-0003: Janet rejects", run: () => decide("SPR-0003", "reject", "25 are in stock and no open order needs them. Raise it again when an order comes in.") });

  // SPR-0004 for ORD-1040: still waiting for Janet. Submitted 30 hours ago, so the 24-hour reminder has gone out.
  steps.push({ at: before(30), label: "SPR-0004: Priya raises 15 x EF-9 for ORD-1040", run: () => raise("SPR-0004", "EF-9", 15, "ORD-1040 (Lanka Tech) needs 60 monitors and 45 are in stock.", "ORD-1040") });
  steps.push({ at: before(6, 5), label: "Due jobs run: 24-hour reminder for SPR-0004", run: async () => void (await runDueJobs(deps)) });

  // SPR-0005: a draft that was never submitted.
  steps.push({ at: before(2), label: "SPR-0005: Priya saves a draft for NAS-2B", run: () => raise("SPR-0005", "NAS-2B", 6, "Open orders need 18 NAS enclosures and 12 are in stock.", null, false) });

  // ---- The regular job run shortly before the demo starts: vendor payment reminders, drafts for late payers, due-date alerts.
  steps.push({ at: before(0, -5), label: "Due jobs run before the demo starts", run: async () => void (await runDueJobs(deps)) });

  return steps;
}

/** Runs every step in time order on the simulated clock and returns a one-line summary. */
export async function seedDemoScenario(deps: Deps, clock: FakeClock, seedDir: string): Promise<string> {
  // sort() keeps steps with the same time in the order they were added.
  const steps = buildSteps(deps, seedDir).sort((a, b) => a.at.getTime() - b.at.getTime());
  for (const step of steps) {
    clock.set(step.at);
    try {
      await step.run();
    } catch (error) {
      throw new Error(`Seed step failed: "${step.label}": ${(error as Error).message}`);
    }
  }
  // Orders created by hand after the seed continue from the highest scenario number.
  const highest = Math.max(...SCENARIO_ORDERS.map((order) => Number(order.orderNo.replace("ORD-", ""))));
  await setLastUsedNumber(deps, "order", highest);
  clock.set(DEMO_NOW);
  return `${steps.length} steps, ${SCENARIO_ORDERS.length} orders (${SCENARIO_ORDERS[0].orderNo} to ${SCENARIO_ORDERS[SCENARIO_ORDERS.length - 1].orderNo}).`;
}
