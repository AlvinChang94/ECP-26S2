// What: checks the shared secret on calls to /api/jobs/run (the call EventBridge Scheduler makes every few minutes).
// Who calls it: src/app/api/jobs/run/route.ts.
// To extend: the secret is created by infra/orderflow.yaml (Secrets Manager) and written to JOBS_SECRET in the server's .env.
import { createHash, timingSafeEqual } from "node:crypto";

export const JOBS_SECRET_HEADER = "x-orderflow-jobs-secret";

/**
 * True only when a secret is configured and the caller sent exactly that secret.
 * Both sides are hashed first so the comparison takes the same time whatever was sent (no hint from timing).
 */
export function jobsSecretMatches(configured: string | null, provided: string | null): boolean {
  if (!configured || !provided) return false;
  const digest = (text: string) => createHash("sha256").update(text).digest();
  return timingSafeEqual(digest(configured), digest(provided));
}
