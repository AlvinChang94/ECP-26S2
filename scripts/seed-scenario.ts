// What: the scripted demo history. It feeds the seed PDFs through the same services a person would use, on a simulated clock.
// Who calls it: scripts/seed.ts (and an integration test that checks the scenario still ends with ORD-1042 blocked).
// To extend: add steps in time order. Use the services only, never write rows directly, so the demo state is always reachable by hand.
import type { FakeClock } from "../src/adapters/clock";
import type { Deps } from "../src/services/deps";

/** Returns a one-line summary of what was loaded. Steps are added milestone by milestone. */
export async function seedDemoScenario(_deps: Deps, _clock: FakeClock, _seedDir: string): Promise<string> {
  return "no history yet (added from milestone M1 on).";
}
