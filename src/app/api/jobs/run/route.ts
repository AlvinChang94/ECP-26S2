// What: route handler that runs the due jobs (SPR reminders and hand-overs, payment and document reminders, alerts) when the scheduler calls.
// Who calls it: on AWS, EventBridge Scheduler every few minutes (through infra/ec2/run-jobs.sh). Locally the "Run due jobs" button does the same.
// To extend: the work itself is runDueJobs() in src/services/jobs.ts. This handler only checks the secret and reports what was done.
import { NextResponse } from "next/server";
import { JOBS_SECRET_HEADER, jobsSecretMatches } from "@/app/_lib/jobsAuth";
import { getDeps } from "@/services/deps";
import { runDueJobs } from "@/services/jobs";

export async function POST(request: Request): Promise<Response> {
  const deps = await getDeps();
  // Without JOBS_SECRET the endpoint is switched off (the default on a laptop). A wrong secret gets the same answer.
  if (!jobsSecretMatches(deps.config.jobsSecret, request.headers.get(JOBS_SECRET_HEADER))) {
    return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  }
  const summary = await runDueJobs(deps);
  return NextResponse.json({ ranAt: summary.ranAt.toISOString(), actions: summary.lines.length, lines: summary.lines });
}
