// What: command-line entry for the KPI replay: prints the four measures against the sample's baseline and saves the report.
// Who calls it: `npm run replay`. Change a simulated delay with `npm run replay -- --set reviewMinutes=45`.
// To extend: the simulation and the measures are in scripts/replay-runner.ts; this file only reads arguments and prints.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_REPLAY_SETTINGS, formatReplayReport, type ReplaySettings, runReplay } from "./replay-runner";

/** Reads "--set name=value" pairs. Unknown names and values that are not numbers stop the run with a clear message. */
function readSettings(argv: string[]): Partial<ReplaySettings> {
  const settings: Partial<ReplaySettings> = {};
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] !== "--set") continue;
    const [name, value] = (argv[index + 1] ?? "").split("=");
    if (!(name in DEFAULT_REPLAY_SETTINGS)) throw new Error(`Unknown setting "${name}". Known settings: ${Object.keys(DEFAULT_REPLAY_SETTINGS).join(", ")}.`);
    const number = Number(value);
    if (value === undefined || value === "" || Number.isNaN(number) || number < 0) throw new Error(`"${value}" is not a usable value for ${name}. Use a number, for example --set ${name}=30.`);
    settings[name as keyof ReplaySettings] = number;
  }
  return settings;
}

async function main(): Promise<void> {
  const settings = readSettings(process.argv.slice(2));
  const started = Date.now();
  console.log("Replaying six simulated months through OrderFlow (this takes about a minute)...");
  const report = await runReplay({
    replayDir: path.resolve(process.cwd(), "data", "replay"),
    settings,
    onProgress: (message) => console.log(`  ${message}`),
  });
  const text = formatReplayReport(report);
  console.log(`\n${text}\n`);

  const reportsDir = path.resolve(process.cwd(), "reports");
  mkdirSync(reportsDir, { recursive: true });
  writeFileSync(path.join(reportsDir, "kpi-replay.txt"), `${text}\n`);
  console.log(`Saved to reports/kpi-replay.txt (real time taken: ${Math.round((Date.now() - started) / 1000)} seconds).`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
