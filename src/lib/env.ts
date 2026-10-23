import { z } from "zod";

const required = () =>
  z.string({ error: (issue) => (issue.input === undefined ? "is missing" : undefined) }).min(1);

const mysqlUrl = required().refine((v) => v.startsWith("mysql://"), "must start with mysql://");

const filled = required().refine(
  (v) => v !== "replace-me",
  "still has the placeholder value from .env.example",
);

const envSchema = z.object({
  DATABASE_URL: mysqlUrl,
  SHADOW_DATABASE_URL: mysqlUrl,
  AWS_ACCESS_KEY_ID: filled,
  AWS_SECRET_ACCESS_KEY: filled,
  AWS_REGION: z.string().min(1).default("ap-southeast-1"),
  S3_BUCKET: filled,
  BEDROCK_MODEL_ID: filled,
  REPLAY_MODE: z.stringbool().default(false),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/**
 * Validated environment. Throws on first call if anything in .env is missing or invalid,
 * listing every problem at once. Never logs values.
 */
export function getEnv(): Env {
  if (cached) return cached;
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `Invalid environment configuration. Fix these variables in .env ` +
        `(see .env.example for the full list):\n${problems}`,
    );
  }
  cached = result.data;
  return cached;
}
