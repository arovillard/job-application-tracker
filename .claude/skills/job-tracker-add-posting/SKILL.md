---
name: job-tracker-add-posting
description: Add or update a public job posting in a local Next.js/SQLite JobTracker app. Use when the user provides a job posting URL and asks to add it to the tracker, help apply to the job, start an application workflow, or prepare application materials before using job-application-resume. Handles public posting extraction, duplicate company+role checks, direct SQLite upsert, source/status update notes, and verified readback.
---

# Job Tracker Add Posting

Use this skill before application-materials work whenever a public job posting should be recorded in the local JobTracker app.

## Required Order

1. Read `.env.local` when present and note `JOBTRACKER_DB_PATH`.
2. Extract posting facts from the public job URL.
3. Add or update the tracker record with `node scripts/upsert-job-posting.mjs`.
4. Verify the script output shows the expected company, role, URL, status, and action.
5. If the user is applying or wants interview-ready materials, invoke `job-application-resume` after the tracker record is verified.

Do not submit applications, sign in, or use credentials for the user.

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
  --company "Company Name" \
  --role "Role Title" \
  --url "https://example.com/job" \
  --source "Company careers" \
  --location "Remote" \
  --summary "Short role summary." \
  --posting-state open \
  --reactivate
```

Script defaults:

- DB path: `JOBTRACKER_DB_PATH` when set, otherwise `./data/jobtracker.sqlite` from the current working directory.
- New record status: `wishlist`
- Duplicate key: normalized `company + role`
- Duplicate behavior: update the existing record and add an `update` note, never create a duplicate.
- `--reactivate`: if an existing duplicate is `archived` or `rejected` and the posting is not closed, set it back to `wishlist`.

Use `--status applied` only when the user says they already applied. Use `--status archived` only when the user explicitly confirms the posting should be archived.

For complex quoting, pass JSON through stdin:

```bash
printf '%s\n' '{"company":"Company","role":"Role","url":"https://example.com/job","posting_state":"open"}' |
  node scripts/upsert-job-posting.mjs --input-json - --reactivate
```

## Verification

Read the script JSON output. Confirm:

- `action` is `created` or `updated`.
- `application.company`, `application.role`, and `application.url` match the posting.
- `application.status` is appropriate for the user intent.
- `changes` and `noteIds` show that duplicate updates were documented.

If the script fails or the DB shape is unclear, read `references/schema.md`. Prefer fixing script invocation or using the reference to inspect state; do not hand-write ad hoc SQL unless the script is blocked.

## Companion Resume Workflow

When the user says "help me apply to this job" or asks for application materials:

1. Use this skill first and verify the tracker record.
2. Then use `job-application-resume` with the same public posting URL and the verified tracker context.
3. Tell the user the tracker record was created or updated before discussing resume, cover, or outreach materials.
