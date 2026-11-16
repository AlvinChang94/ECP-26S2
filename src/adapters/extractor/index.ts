// What: picks the DocumentExtractor implementation from the configuration.
// Who calls it: getDeps() in src/services/deps.ts, and scripts that need an extractor.
// To extend: add another implementation (for example Textract plus Bedrock) and return it here for a new EXTRACTOR value.
import type { AppConfig } from "../config";
import { DefaultExtractor } from "./default";
import { createAnthropicReader, LlmExtractor } from "./llm";
import type { DocumentExtractor } from "./types";

export function createExtractor(config: Pick<AppConfig, "extractor" | "llmModel">): DocumentExtractor {
  const defaultExtractor = new DefaultExtractor();
  if (config.extractor !== "llm") return defaultExtractor;
  // The LLM extractor always carries the default one as its fallback.
  return new LlmExtractor(createAnthropicReader(config), defaultExtractor);
}
