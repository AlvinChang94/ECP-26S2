// What: the scripted demo history. It feeds the seed PDFs through the same services a person would use, on a simulated clock.
// Who calls it: scripts/seed.ts (and an integration test that checks the scenario still ends with ORD-1042 blocked).
// To extend: add steps to buildSteps(). Use the services only, never write rows directly, so the demo state is always reachable by hand.
import { readFileSync } from "node:fs";
import path from "node:path";
import type { FakeClock } from "../src/adapters/clock";
import type { Actor } from "../src/domain/audit";
import { setLastUsedNumber } from "../src/services/counters";
import type { Deps } from "../src/services/deps";
import { confirmDocumentType, ingestDocument } from "../src/services/intake";
import { customerByName, DEMO_NOW } from "./sample-data/master";
import { SCENARIO_ORDERS } from "./sample-data/scenario";

const SAM: Actor = { name: "Sam Tan", role: "sales" };

/** One thing that happened in the demo's past, at a simulated time. */
type Step = { at: Date; label: string; run: () => Promise<void> };

function before(hours: number, minutesLater = 0): Date {
  return new Date(DEMO_NOW.getTime() - hours * 60 * 60 * 1000 + minutesLater * 60 * 1000);
}

function buildSteps(deps: Deps, seedDir: string): Step[] {
  const steps: Step[] = [];
  const read = (file: string): Uint8Array => new Uint8Array(readFileSync(path.join(seedDir, file)));
  /** Document ids by file name, filled in as documents are taken in. */
  const documentIds = new Map<string, string>();

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
  }
  return steps;
}

/** Runs every step in time order on the simulated clock and returns a one-line summary. */
export async function seedDemoScenario(deps: Deps, clock: FakeClock, seedDir: string): Promise<string> {
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
