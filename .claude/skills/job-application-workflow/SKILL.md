---
name: job-application-workflow
description: Coordinate application readiness, reusable application-profile configuration, job intake, and tailored materials for Opportunity Tracker. Use for application intent with or without a job link, including requests to apply, prepare an application, tailor a resume for a job, start an application workflow, configure, save, remember, or update application-profile references, or messages whose primary content is a public job-posting URL.
---

# Job Application Workflow

Own orchestration only. Work from the repository root and keep the readiness result available throughout the workflow.

Use `./applications` by default; it resolves to the repository's `applications/` folder. Do not ask for an application-materials path unless the human wants an override. Preserve relative input exactly as relative input, so relative values remain relative, and never reinterpret `applications` as `/applications`.

## Required Sequence

1. Locate the repository root containing `.env.example` and `scripts/check-application-readiness.mjs`. If the source coordinator is present but a personal skill copy is missing, continue with this repository source and offer to run the appropriate skill installer when authorized.
2. Run `node scripts/check-application-readiness.mjs` and parse its schema-v1 JSON. Do not process a supplied job link yet.
3. If status is `needs_input`, or the user asks to configure, save, remember, or update application-profile references, use any allowlisted values already present in the user's message before asking another question. When the message supplies more than one of `applicationsDirectory`, `baseResumeUrl`, `baseResumePath`, or `profileUrl`, persist every supplied allowlisted field together in one update. Omit fields the user did not supply so existing values remain unchanged. Prefer a private Google Doc, then DOCX, then PDF with a formatting warning. Persist through:

   ```bash
   printf '%s\n' '<allowlisted-json>' | node scripts/configure-application-profile.mjs --input-json -
   ```

   Rerun readiness after the combined update. Then collect only the next missing or invalid value, one at a time.

   Never request credentials or make a document public. For repository-local resume or output paths, continue only after readiness confirms the exact path is Git-ignored; otherwise ask for a safe external path or an exact ignore rule.
4. Rerun readiness after each update until local issues are resolved. Stop on `blocked`; explain the blocking issue without silently choosing fallback paths. Preserve `database.path` and `applicationsDirectory.path` exactly as returned; both must be absolute.
5. If `resume.kind` is `google_doc`, use the host's connected Google Drive/Docs capability to read back the exact document identity and enough content to confirm it is a resume. If access fails, preserve the configured URL, ask the user to reconnect or grant the signed-in agent access, and offer DOCX. Never ask for public sharing.
6. When readiness is complete and no job link is present, say exactly: “Your application workspace is ready. Your master resume is configured and will not be modified. Send me a job-posting link when you're ready.” Then stop and wait for the link.
7. For a supplied link, invoke `job-tracker-add-posting`. Pass readiness `database.path` to the upsert command as `--db "/absolute/database.path"`; never rely on process defaults. Verify the returned action, `opportunity.type = job`, organization, role/label, canonical URL, status, and activity IDs before proceeding.
8. Only after verified intake, invoke `job-application-resume` with the verified opportunity ID, the same absolute `database.path`, and the exact absolute `applicationsDirectory.path`. Pass them explicitly as `--db` and `--applications-dir` to every applicable material or tracker command.
9. Treat the configured source as a read-only master. Create a role-specific copy and never edit or overwrite the master resume. For a tailored Google Doc, export or save a local PDF or DOCX snapshot under the exact applications directory. Verify the snapshot exists before registration, then register it with the verified opportunity ID and the same `--db` path. Parse and confirm the registration output. If export or registration fails, return any valid Docs link but do not claim tracker resume registration succeeded.
10. Return the tailored Google Doc link when created, the local fit-analysis path, and important qualification or research caveats. End the final response with exactly: “I'm ready for another job-posting link whenever you are.” Use this sentence only after tracker intake, verification, and all requested application-material work complete successfully. Do not use this sentence when the workflow is blocked, failed, incomplete, or awaiting user input.

## Failure and Safety Rules

- Do not generate materials when readiness reports a missing or invalid resume.
- Treat a missing public profile as a warning and continue.
- Record only verified posting facts; if a posting is unavailable, ask for pasted text or another public URL.
- Keep conflicting open/closed postings active unless the user confirms archive.
- Do not submit applications, sign in to job sites, use credentials, expose private files, or modify the master resume.

## Daily Qualified Discovery Mode

Run this mode only as local automation at `08:00 Etc/UTC` with `executionEnvironment=local`, from the saved local project checkout. Never use a feature worktree. This scheduled mode is separate from ordinary supplied-link work: retain the manual readiness and database behavior above for one-off requests.

1. Run `node scripts/check-application-readiness.mjs` in the saved local project checkout and parse its JSON. Bind the exact absolute `projectRoot`, `database.path`, and `applicationsDirectory.path` for the complete run. Pass that exact `database.path` as `--db` to every database command and the exact `applicationsDirectory.path` as `--applications-dir` to every material command. Never use a default, temporary, worktree, synthesized, or fallback database. A missing localhost port 3000 does not authorize a fallback or permission to never start a second server.
2. Verify the deployment-provided `jobtracker_instance_id` before discovery with `node scripts/jobtracker-database-identity.mjs verify --db "/absolute/database.path" --expected-id "DEPLOYMENT_UUID"`. Never initialize identity during a scheduled run; stop on identity or lock failure.
3. Acquire the six-hour run lock with `node scripts/daily-job-prep-lock.mjs acquire --db "/absolute/database.path"`, retain its returned token locally, and require that `lock-token` for every automated decision, guarded material precondition, and commit. Release it in `finally`, even if a candidate fails.
4. Perform public discovery only after the lock. Prefer an employer career page as the authoritative source for complete requirements, posting state, location, and canonical application URL; public job boards may discover or corroborate. Search varied senior-management and technical-leadership scope, including Engineering Manager, Senior Engineering Manager, Director of Engineering, Engineering and Operations, Technical Lead, Platform/Integrations, Developer Experience, and adjacent product-engineering leadership roles. A title alone is never eligibility.
5. Apply pre-score exclusions before constructing an assessment: skip closed, expired, inaccessible, snippet-only, login-only, or unverifiable postings; clearly junior/materially below-scope roles; agency leads without a verifiable employer; incompatible location, schedule, or jurisdiction; and clearly unsupported mandatory licence, designation, clearance, citizenship, language, degree, or specialized-experience requirements. Accept remote only when explicitly Example Country-eligible; accept hybrid/onsite only when compatible with Example City, Example City, or the Example Region. Treat ambiguous logistics as unresolved and skip. Skip rejected or archived records unless the posting is materially distinct, and never pass `--reactivate`.
6. For each remaining posting, construct exact `{ assessment, posting }` using canonical URL, organization, role, source, posting state, location, evidence timestamp, criterion groups, evidence classifications, and non-negotiable blockers. The assessment must satisfy `overallScore >= 80`, `mandatoryMatch >= 80`, `seniorityMatch >= 75`, open state, and no blocker. Invoke `node scripts/prepare-qualified-job.mjs --db "/absolute/database.path" --expected-database-id "DEPLOYMENT_UUID" --lock-token "RUN_TOKEN" --input-json -`; it owns evaluator-before-dry-run and guarded intake; intake and materials are forbidden until the executable coordinator returns an eligible `repair_dossier` or `prepare_dossier` decision.
7. For `skip_ineligible`, `skip_inactive`, or `skip_complete`, make no files or tracker mutations. Only for `repair_dossier` or `prepare_dossier`, invoke `job-application-resume` with the returned exact wishlist ID/status/version material precondition, assessment, evaluator result, `--db`, `--applications-dir`, and active lock token. It must create or repair the five registered outputs: `--type resume --title "Tailored Resume"`, `--type fit_analysis --title "Fit Analysis"`, `--type cover_letter --title "Cover Letter"`, `--type outreach_message --title "Outreach Message"`, and `--type other --title "Submission Guide"` with a separated `Needs Your Answer` section.
8. Produce a sanitized daily summary: authoritative sources consulted; reviewed, excluded, scored, eligible, prepared, unchanged, and failed counts; prepared organization/role/scores/wishlist identity/material paths; and concise skipped reason categories, limitations, and clarification needs. Do not reproduce private resume material, personal contact details, or credentials. In `finally`, run `node scripts/daily-job-prep-lock.mjs release --db "/absolute/database.path" --lock-token "RUN_TOKEN"`. Automation must never submit, sign in, use credentials, upload, fill forms, attest, solve CAPTCHAs, send messages, or change a job to applied/rejected/archived.

For a supplied public link, use the existing readiness flow first, then create the assessment and require parsed evaluator output with `eligible: true` before the supplied-link intake step. Preserve the exact no-link ready sentence and successful next-link sentence above, each uniquely.
