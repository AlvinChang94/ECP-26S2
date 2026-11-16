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
import { editField } from "../src/services/poEdit";
import { approveAndExport, approveCancellation, buildCancellationPreview, buildExportPreview } from "../src/services/poExport";
import { customerByName, DEMO_NOW } from "./sample-data/master";
import { SCENARIO_ORDERS, scenarioOrder } from "./sample-data/scenario";

const SAM: Actor = { name: "Sam Tan", role: "sales" };

/** One thing that happened in the demo's past, at a simulated time. */
type Step = { at: Date; label: string; run: () => Promise<void> };

function before(hours: number, minutesLater = 0): Date {
  return new Date(DEMO_NOW.getTime() - hours * 60 * 60 * 1000 + minutesLater * 60 * 1000);
}

/** Orders that are left as drafts with open findings, so the dashboard shows a PO still in review. */
const LEFT_IN_REVIEW = new Set(["ORD-1039"]);

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
