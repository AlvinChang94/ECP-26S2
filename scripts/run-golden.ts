// What: command-line entry for the golden test: prints one table of cases plus accuracy per document type and per flag code.
// Who calls it: `npm run test:golden`. Add a word to run only matching cases: `npm run test:golden -- po-alias`.
// To extend: the checking itself is in scripts/golden-runner.ts. Set EXTRACTOR=llm to measure the LLM extractor instead.
import path from "node:path";
import { loadConfig } from "../src/adapters/config";
import { createExtractor } from "../src/adapters/extractor";
import { formatGoldenReport, runGolden } from "./golden-runner";

async function main(): Promise<void> {
  try {
    process.loadEnvFile();
  } catch {
    // no .env file: defaults apply
  }
  const only = process.argv.slice(2).find((argument) => !argument.startsWith("-"));
  const report = await runGolden({
    goldenDir: path.resolve(process.cwd(), "data", "golden"),
    extractor: createExtractor(loadConfig()),
    only,
  });
  console.log(formatGoldenReport(report));
  process.exit(report.pass ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
