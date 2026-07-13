---
name: job-application-workflow
description: Coordinate application readiness, job intake, and tailored materials for Opportunity Tracker. Use for application intent with or without a job link, including requests to apply, prepare an application, tailor a resume for a job, start an application workflow, or messages whose primary content is a public job-posting URL.
---

# Job Application Workflow

Own orchestration only. Work from the repository root and keep the readiness result available throughout the workflow.

## Required Sequence

1. Locate the repository root containing `.env.example` and `scripts/check-application-readiness.mjs`. If the source coordinator is present but a personal skill copy is missing, continue with this repository source and offer to run the appropriate skill installer when authorized.
2. Run `node scripts/check-application-readiness.mjs` and parse its schema-v1 JSON. Do not process a supplied job link yet.
3. If status is `needs_input`, collect only the next missing or invalid value, one at a time. Prefer a private Google Doc, then DOCX, then PDF with a formatting warning. Persist only allowlisted application-profile fields:

   ```bash
   printf '%s\n' '<allowlisted-json>' | node scripts/configure-application-profile.mjs --input-json -
   ```

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
