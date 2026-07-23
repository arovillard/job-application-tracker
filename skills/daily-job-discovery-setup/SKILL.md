---
name: daily-job-discovery-setup
description: Use when a user wants to configure, enable, repair, verify, or migrate recurring qualified-job discovery for this JobTracker repository in Codex or Claude, including private targeting preferences, match thresholds, local database binding, and a daily schedule.
---

# Daily Job Discovery Setup

Read `references/schedulers.md` before creating or changing a schedule.

## Setup Workflow

1. Run `node scripts/check-application-readiness.mjs` from the saved checkout and complete ordinary readiness. Treat its resume, database, and applications-directory results as authoritative.
2. Confirm read-only access to the private resume. Never edit it, change sharing, or copy raw resume text into configuration.
3. Suggest role families, seniority, adjacent scope, and hard qualifications from verified resume evidence. Collect jurisdiction, remote/onsite policy, exclusions, travel/relocation limits, daily time, IANA timezone, and agents. Confirm the structured preferences before saving; earlier explicit values count as confirmed.
4. Select one scheduler owner. Both provider skills may be installed, but create one active schedule. When delegated, choose the current supported desktop agent.
5. Require the overall match threshold and qualification match threshold to be at least 80 and seniority alignment to be at least 75. Never weaken them silently.
6. Use the exact existing JobTracker database from readiness. Initialize its identity once with `node scripts/jobtracker-database-identity.mjs initialize --db "<readiness-database-path>"`. Never create or select a fallback. `localhost:3000` may be offline.
7. Save allowlisted schema-v1 JSON through `node scripts/configure-daily-discovery.mjs --input-json -`. Only structured preferences and database identity belong in ignored `data/job-discovery.json`; paths and resume/profile references remain in ignored `.env.local`. Never store credentials, contact details, private URLs, or raw resume content.
8. Run `npm run skills:install`, restricted to selected providers when requested.
9. Run `node scripts/check-daily-discovery-readiness.mjs`. Continue only on `ready`, using its exact generic `scheduler.prompt`. Never embed private values in scheduler text.
10. Create or update the one local task with the confirmed time and timezone. Bind the saved checkout, not a worktree or cloud clone. Update an exact stable-name match instead of duplicating it.
11. Read the task back and verify owner, folder, local execution, schedule, enabled state, prompt, and uniqueness. Use **Run now** only after readiness succeeds. If durable scheduling cannot be created or inspected, provide the scheduler-reference steps and report setup incomplete.

## Completion Contract

Report:

- readiness, selected owner, and whether one active schedule was verified;
- local-runtime requirements and private-file Git exclusion;
- confirmation that runs use the existing database and prepare only dossiers passing both 80% gates.

Never sign in, never upload files, never fill forms, never attest, never send messages, and never submit applications. Never change a job to applied, rejected, or archived. The human reviews `wishlist` opportunities.
