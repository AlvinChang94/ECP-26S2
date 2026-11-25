#!/bin/bash
# What: asks the running app to do its due jobs (SPR reminders and hand-overs, payment and document reminders, alerts).
# Who calls it: Amazon EventBridge Scheduler, through Systems Manager Run Command (infra/orderflow.yaml, JobsSchedule). Installed as /usr/local/bin/orderflow-run-jobs.
# To extend: the jobs themselves are runDueJobs() in src/services/jobs.ts; this only calls /api/jobs/run on this server.
set -euo pipefail

secret=$(grep '^JOBS_SECRET=' /opt/orderflow/app/.env | cut -d= -f2- | tr -d '"')
curl -fsS --max-time 50 -X POST -H "x-orderflow-jobs-secret: $secret" http://127.0.0.1:3000/api/jobs/run
echo
