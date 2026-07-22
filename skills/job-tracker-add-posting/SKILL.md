---
name: job-tracker-add-posting
description: Add or update a public job posting in a local Next.js/SQLite JobTracker app. Use for a direct request such as "add this posting," or to record, refresh, or inspect a specific public posting in the tracker. Handles posting extraction, duplicate company+role checks, explicit database-path upsert, source/status update notes, and verified readback. Broad application intent belongs to job-application-workflow.
---

# Job Tracker Add Posting

Use this skill before application-materials work whenever a public job posting should be recorded in the local JobTracker app.

## Input Contract

When no coordinating readiness result is supplied, run and parse `node scripts/check-application-readiness.mjs` from the repository root before intake. Require an absolute `database.path` with `database.parentExists = true` and `database.parentWritable = true`; stop and report the database issue otherwise. Ignore only application-material issues: `resume_missing`, `resume_invalid`, `resume_unreadable`, `resume_permission_denied`, `resume_inspection_failed`, `resume_path_not_ignored`, `applications_directory_unconfigured`, `applications_directory_unavailable`, `applications_directory_unwritable`, `applications_directory_permission_denied`, `applications_directory_inspection_failed`, and `applications_directory_not_ignored`. Stop before intake when any other `blockingIssues` entry is present, including `configuration_unreadable`, `database_parent_unavailable`, `database_parent_unwritable`, `database_parent_permission_denied`, or `database_parent_inspection_failed`. Profile and personal-skill entries are warnings and do not block direct tracker intake. Use the exact validated database path for the upsert. Never infer it from process defaults or a synthesized fallback after configuration failure.

## Required Order

1. Obtain the absolute database path from the coordinating or directly established readiness result.
2. Extract posting facts from the public job URL.
3. Add or update the tracker record with `node scripts/upsert-job-posting.mjs --db "/absolute/database/path"`. Never rely on the script's process defaults.
4. Verify the script output shows the expected opportunity, URL, status, and action.
5. If the user is applying or wants interview-ready materials, invoke `job-application-resume` after the tracker record is verified.

Never sign in, never log in, never use credentials, never upload, never fill forms, never attest, never solve CAPTCHAs, never send, and never submit for the user.

## Extract Posting Facts

Collect the most reliable available values:

- `company`: employer name from the posting.
- `role`: exact job title from the posting.
- `url`: canonical public posting URL supplied by the user.
- `location`: remote/hybrid/city/country text if present.
- `source`: posting source or host, such as `EverCommerce careers` or `LinkedIn`.
- `summary`: 1-3 concise sentences describing the role, team, seniority, and notable requirements.
- `posting-state`: `open`, `closed`, or `unknown`.

If sources disagree about whether the job is open, keep the tracker record active unless the user explicitly confirms it should be archived.

## Upsert Command

Run the bundled project script from the JobTracker project root.

```bash
node scripts/upsert-job-posting.mjs \
  --db "/absolute/database/path" \
  --company "Company Name" \
  --role "Role Title" \
  --url "https://example.com/job" \
  --source "Company careers" \
  --location "Remote" \
  --summary "Short role summary." \
  --posting-state open
```

Script defaults:

- DB path: `JOBTRACKER_DB_PATH` when set, otherwise `./data/jobtracker.sqlite` from the current working directory.
- New record status: `wishlist`
- Duplicate key: normalized `organization + label` among job opportunities only.
- Duplicate behavior: update the existing job opportunity and add a `note` activity, never create a duplicate.
- `--reactivate`: if an existing duplicate is `archived` or `rejected` and the posting is not closed, set it back to `wishlist`.

Use `--status applied` only when the user says they already applied. Use `--status archived` only when the user explicitly confirms the posting should be archived.

For complex quoting, pass JSON through stdin:

```bash
printf '%s\n' '{"company":"Company","role":"Role","url":"https://example.com/job","posting_state":"open"}' |
  node scripts/upsert-job-posting.mjs --db "/absolute/database/path" --input-json -
```

## Verification

Read the script JSON output. Confirm:

- Confirm action is created or updated.
- Confirm opportunity.type is job.
- Confirm opportunity.organization, opportunity.label, opportunity.url, and opportunity.status match the posting.
- Confirm changes and activityIds document duplicate updates.
- Treat application as a deprecated output alias and do not depend on it in new workflows.

If the script fails or the DB shape is unclear, read `references/schema.md`. Prefer fixing script invocation or using the reference to inspect state; do not hand-write ad hoc SQL unless the script is blocked.

## Companion Resume Workflow

When a coordinating application workflow invokes this skill:

1. Use this skill first and verify the tracker record.
2. Then use `job-application-resume` with the same public posting URL and the verified tracker context.
3. Tell the user the tracker record was created or updated before discussing resume, cover, or outreach materials.

## Automated Discovery Mode

This automated discovery mode applies only when the daily coordinator supplies an eligible assessment, exact readiness `database.path`, deployment `expected-database-id`, and active `lock-token`. It does not make its own optimistic eligibility decision and never performs an unguarded real upsert.

```text
same canonical assessment/posting + exact readiness database.path
    → prepare-qualified-job.mjs with expected database UUID + active lock token
    → executable evaluator before any posting command
    → automated dry-run + duplicate/dossier decision
    → transactional expect-new or exact ID/status/version real write when needed
    → no real write for inactive, unchanged-complete, or unchanged-incomplete
    → return verified wishlist identity and material precondition only for prepare/repair
```

Invoke `node scripts/prepare-qualified-job.mjs --db "/absolute/database.path" --expected-database-id "DEPLOYMENT_UUID" --lock-token "RUN_TOKEN" --input-json -`. Its transactional precondition owns score-before-dry-run, canonical posting/evaluation identity checks, guarded compare-and-set upsert, and inspection. Do not call `upsert-job-posting.mjs` directly in this mode.

Treat `skip_ineligible`, `skip_inactive`, and `skip_complete` as terminal without materials. For `repair_dossier`, preserve existing valid files and return only the verified wishlist material precondition; no posting mutation is permitted. For `prepare_dossier`, return only the verified wishlist identity and exact status/version precondition. Automation must never pass `--reactivate`, must skip rejected or archived records, and must never restore those user decisions. The underlying CLI still supports explicitly requested manual reactivation outside automated discovery.
