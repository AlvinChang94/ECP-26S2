// What: ESLint rules (Next.js recommended + TypeScript, and "no any" as CLAUDE.md requires).
// Who calls it: `npm run lint`.
// To extend: add rule overrides in the last object; add generated folders to globalIgnores.
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "src/generated/**",
    "public/pdf.worker.min.mjs",
    "storage/**",
    "playwright-report/**",
    "test-results/**",
  ]),
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
]);
