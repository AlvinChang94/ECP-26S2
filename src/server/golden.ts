import { readFileSync } from "node:fs";
import path from "node:path";

// Reads synthetic golden data from data/golden/<module>/. Used by tests, the seed and the
// placeholder UI. Not for use inside pure rule code.

export const GOLDEN_ROOT = path.join(process.cwd(), "data", "golden");

export function goldenPath(module: string, file: string): string {
  return path.join(GOLDEN_ROOT, module, file);
}

export function readGoldenJson<T>(module: string, file: string): T {
  return JSON.parse(readFileSync(goldenPath(module, file), "utf8")) as T;
}

export function readGoldenBytes(module: string, file: string): Uint8Array {
  return new Uint8Array(readFileSync(goldenPath(module, file)));
}
