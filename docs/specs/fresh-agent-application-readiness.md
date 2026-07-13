# Fresh-Agent Application Readiness Specification

## Problem

Opportunity Tracker already packages separate skills for recording a job posting and producing application materials, but a fresh Codex or Claude session only receives an explicit workflow when the user supplies a job link. The session has no deterministic way to decide whether the user's resume, applications directory, profile context, or skill installation is usable before it begins. This makes the experience depend on prior chat memory and exposes users to inconsistent questions, silent fallback paths, or attempted resume work without verified source material.

The system must make every application-intent conversation started at the repository root self-orienting. A nontechnical user should be able to say “help me apply,” with or without a link, and be guided to a clear ready state before job-specific work begins.

## User Outcomes

- A fresh Codex or Claude session at the repository root knows the application workflow without relying on earlier conversation history.
- The agent checks readiness before asking for or processing a job link.
- The agent asks only for missing or invalid information.
- Google Docs is presented as the preferred resume source; DOCX is the preferred file fallback and PDF is accepted with a formatting warning.
- The master resume is never edited. Every tailored resume is a role-specific copy.
- A missing resume blocks tailored materials, while a missing public profile produces a warning but does not block the workflow.
- The agent explicitly tells the user when the workspace is ready and asks for the job link if it has not already been provided.
- The tracker record is always created or updated and verified before application materials are generated.

## Scope

This change includes:

- A machine-readable readiness/configuration library and CLI scripts.
- Private persistence of a preferred Google Docs resume URL in `.env.local`.
- A safe agent-facing configuration command that preserves unrelated `.env.local` values.
- A coordinating `job-application-workflow` skill packaged identically for Codex and Claude.
- Fresh-session trigger instructions in `AGENTS.md` and `CLAUDE.md`.
- Updates to the existing setup wizard and resume skill.
- Documentation and automated tests for configuration, packaging, privacy, and workflow ordering.

## Non-Goals

- Automatically speaking when a repository is merely opened. Agent hosts require an initial user message.
- Installing Codex, Claude, Google Drive, or credentials for the user.
- Making a private Google Doc public.
- Submitting applications, signing into job sites, or using user credentials.
- Editing the user's master resume.
- Adding a remote-URL artifact schema or changing the tracker UI in this iteration.
- Guaranteeing Google Docs connector availability across every agent host.
- Persisting resumes, profile exports, provider secrets, or Google credentials in Git.

## Current-State Evidence

- `AGENTS.md` and `CLAUDE.md` trigger only when “help me apply” is accompanied by a job link and directly sequence the two component skills.
- `scripts/setup-user.mjs` writes `JOBTRACKER_BASE_RESUME_PATH` and `JOBTRACKER_LINKEDIN_URL`, but has no Google Docs source field.
- `.env.example` has no remote resume source setting.
- `scripts/lib/install-skills.mjs` discovers and recursively installs every immediate skill directory containing `SKILL.md`; Codex and Claude source folders are expected to be byte-identical.
- `scripts/install-skills.test.ts` hard-codes the two current skill names and verifies mirror parity and installation.
- The standalone tracker scripts consult `process.env` but do not load `.env.local`, so custom paths can silently fall back unless the invoking agent passes or exports them.
- `job-application-resume` already requires verified source material, creates local artifacts, and can deliver Google Docs output, but does not prefer Google Docs or protect a configured master explicitly.
- Tracker artifacts are local-file-backed. `register-application-artifact.mjs` resolves a local path, and the artifact route reads that path. Remote Google Docs URLs cannot be registered without a schema/UI change.
- `.gitignore` protects `.env.local`, local SQLite files, and the default `applications/` directory, but an arbitrary resume copied elsewhere inside the repository may not be ignored.

## Proposed Behavior

### Triggering

Application intent includes requests to apply, prepare an application, tailor a resume for a job, start an application workflow, or a message whose primary content is a public job-posting URL. It does not include unrelated repository development requests.

For application intent, repository instructions must invoke the coordinating workflow skill first. The workflow accepts both cases:

- If no job link is present, finish readiness and then ask for it.
- If a job link is present, finish readiness before job intake.

### Two-Stage Readiness

Stage one is deterministic local inspection through `node scripts/check-application-readiness.mjs`. It reads `.env.local` itself, applies process-environment overrides, and returns JSON without exposing resume contents, credentials, or other secret values.

The JSON contract includes:

```json
{
  "schemaVersion": 1,
  "status": "ready|needs_input|blocked",
  "projectRoot": "/absolute/project/path",
  "resume": {
    "kind": "google_doc|docx|pdf|text|none",
    "configured": true,
    "locallyValid": true,
    "requiresExternalAccessCheck": true,
    "location": "redacted-or-safe-display-value",
    "message": "Human-readable next step"
  },
  "profile": {
    "configured": false,
    "blocking": false,
    "message": "Public profile is recommended but optional."
  },
  "applicationsDirectory": {
    "path": "/absolute/path",
    "exists": true,
    "writable": true
  },
  "database": {
    "path": "/absolute/path",
    "parentExists": true,
    "parentWritable": true
  },
  "skills": {
    "repositoryComplete": true,
    "codexInstalled": true,
    "claudeInstalled": false
  },
  "blockingIssues": [],
  "warnings": []
}
```

Status mapping is explicit:

- `ready`: no local issue prevents application work. A configured Google Doc may still set `requiresExternalAccessCheck=true`; this is not a local failure.
- `needs_input`: the human can resolve the issue by supplying or correcting a resume source, profile, or output location. `resume_missing`, `resume_invalid`, and `applications_directory_unconfigured` use this status.
- `blocked`: the repository or machine cannot safely execute even with another user value. `skills_repository_incomplete`, unreadable configuration, permission failures, or an unsafe unignored repository-local private path use this status.

Warnings never change `ready` to another status. `profile_missing`, `pdf_formatting_limited`, `multiple_resume_sources`, and missing personal skill copies are warnings.

Stage two is performed by the coordinating agent when the selected source is a Google Doc. The agent uses the host's connected Google Drive/Docs capability to read back the exact document identity and enough content to confirm it is a resume. If access is unavailable, the agent asks the user to connect Drive or grant the signed-in agent access and offers DOCX as a fallback. It never asks the user to make the document public.

### Resume Source Policy

Source precedence is:

1. `JOBTRACKER_BASE_RESUME_URL` containing a valid Google Docs document URL.
2. `JOBTRACKER_BASE_RESUME_PATH` pointing to an existing DOCX file.
3. The same path pointing to an existing PDF.
4. The same path pointing to Markdown or text.

If both URL and path already exist in configuration, the Google Doc wins and readiness includes a nonblocking warning; the safe writer will not create this ambiguous state. An invalid or unsupported configured source prevents readiness with `needs_input` until repaired.

User-facing setup copy must say:

> Use a Google Doc for the best results. The agent can create a tailored copy while preserving your original resume and formatting. A Word document also works. PDFs are supported, but matching their formatting consistently can be difficult.

The master source is read-only. For a Google Doc, the workflow creates a new role-specific Google Doc. For a local source, it creates new role-specific files under the configured applications directory. Company-neutral resume naming and content rules remain in force.

When a tailored Google Doc is produced, the workflow also exports or saves a local PDF or DOCX snapshot under the company application folder and registers that local file as the tracker `resume` artifact. The Google Doc link is returned to the user. Remote-link persistence is deferred.

### Safe Configuration

`node scripts/configure-application-profile.mjs --input-json -` accepts a JSON object with only these keys:

- `applicationsDirectory`
- `baseResumeUrl`
- `baseResumePath`
- `profileUrl`

It validates values, updates the corresponding `JOBTRACKER_*` keys in `.env.local`, preserves unrelated entries and comments, and returns a redacted JSON summary. Supplying a nonempty `baseResumeUrl` clears `JOBTRACKER_BASE_RESUME_PATH`; supplying a nonempty `baseResumePath` clears `JOBTRACKER_BASE_RESUME_URL`; supplying both nonempty values is rejected; supplying both as empty strings clears both sources. It never accepts or writes provider credentials.

The library also exposes a separate trusted `updateSetupConfig` function for the repository-owned setup wizard. That internal function may update database path and the human-readable provider note in addition to the application-profile fields. The agent-facing CLI never exposes those extra keys. The setup wizard recommends Google Docs first, accepts a file fallback, and keeps existing noninteractive behavior compatible.

Atomic writes create a same-directory temporary file with mode `0600`, rename it over `.env.local`, preserve restrictive existing permissions, and remove the temporary file on every failure path.

### Coordinating Skill

The new `job-application-workflow` skill owns orchestration only:

1. Locate the repository root containing `.env.example` and `scripts/check-application-readiness.mjs`.
2. Run and parse the readiness CLI.
3. Collect missing values one at a time, favoring Google Docs, and persist them through the safe configuration CLI.
4. Rerun readiness until local blocking issues are resolved.
5. If configured for Google Docs, perform the host access check.
6. Say: “Your application workspace is ready. Your master resume is configured and will not be modified. Send me a job-posting link when you’re ready.” when no link is present.
7. Invoke `job-tracker-add-posting` for a supplied link using the readiness result's absolute `database.path`, then verify action, job type, organization, role, canonical URL, status, and activity IDs.
8. Invoke `job-application-resume` with the verified opportunity ID, absolute database path, and absolute applications directory. Artifact registration must receive the same database path.
9. Verify generated local artifacts exist before registration and confirm registration output.
10. Return the tailored Google Doc link when created, local analysis path, and important fit caveats.

The component skills remain independently usable, but their trigger descriptions must avoid competing with the coordinator for broad “help me apply” requests. Component-skill commands must accept the resolved paths explicitly because standalone Node scripts do not load `.env.local`.

### Fresh Local Versus Cloud Sessions

- A fresh local session reuses ignored `.env.local` and local files, then revalidates them.
- A new remote/cloud checkout receives committed repository instructions and skills but not `.env.local` or local resumes. It therefore enters `needs_input` and asks for a Google Doc or uploaded file again.
- Google authentication belongs to the host. Even when the URL persists locally, a new session may need to reconnect Drive.
- Root `AGENTS.md`/`CLAUDE.md` instructions route directly to the repository source skill, so a missing personal installed copy does not create a bootstrap deadlock. The coordinator then offers to refresh the personal copy.

## Interfaces and File Responsibilities

- `scripts/lib/application-readiness.mjs`: parse and merge configuration, validate resume sources and local paths, compute readiness, safely update `.env.local`, and provide separate restricted-agent and trusted-setup writers.
- `scripts/check-application-readiness.mjs`: read-only JSON CLI wrapper.
- `scripts/configure-application-profile.mjs`: allowlisted JSON update CLI wrapper.
- `scripts/setup-user.mjs`: interactive first-run experience using the shared configuration contract.
- `skills/job-application-workflow/`: provider-neutral orchestration instructions and UI metadata.
- `.claude/skills/job-application-workflow/`: exact mirror of the Codex source skill.
- `AGENTS.md` and `CLAUDE.md`: fresh-session routing rules.
- `skills/job-application-resume/SKILL.md`: Google Docs preference, master-copy protection, local snapshot registration.
- `README.md` and `docs/agent-setup.md`: nontechnical setup and fresh-session behavior.

## Failure Paths

- Missing resume: block application-material generation and ask for Google Doc, DOCX, or PDF.
- Invalid Google URL: reject it without writing configuration and explain the expected Docs URL form.
- Google Doc inaccessible: preserve the configured URL, request host reconnection/access, or accept a DOCX fallback.
- Missing local resume: block and report the resolved path without reading or echoing content.
- Missing public profile: warn and continue.
- Applications directory unavailable: report the path and ask for a writable destination; do not silently fall back.
- Repository-local resume or applications directory not covered by Git ignore rules: block and ask the user to choose a safe external directory or add an exact ignore rule before continuing.
- Packaged coordinator missing: block because workflow ordering cannot be guaranteed.
- Personal skill copy stale/missing: warn and run the appropriate installer when authorized; repository skill sources remain the source of truth.
- Posting unavailable: record only verified facts when possible and ask for pasted posting text or another public URL.
- Conflicting open/closed signals: keep the tracker record active unless the user confirms archive.
- Local Google Doc export fails: return the Google link but do not claim tracker resume registration succeeded; offer a retry or local fallback.

## Security and Privacy

- `.env.local` remains ignored and contains references only, not resume contents or credentials.
- Google OAuth tokens and provider credentials remain in the host agent's secure configuration.
- Readiness output must not include document contents, access tokens, or arbitrary environment values.
- The configuration CLI must allowlist keys and reject unknown input.
- Before accepting a local resume or applications directory inside the repository, readiness checks `git check-ignore`. An unignored private source or output location is blocking until the user selects a safe external location or an exact ignore rule protects it.
- Application artifacts remain local-file-backed and within the existing local-first trust boundary.
- No application submission, credential use, or public sharing is authorized.

## Compatibility and Migration

- Existing `JOBTRACKER_BASE_RESUME_PATH` installations continue to work unchanged.
- `JOBTRACKER_BASE_RESUME_URL` is additive.
- Existing databases and artifact records require no migration.
- Existing component skill names remain stable.
- `npm run skills:install` continues to install all discovered skills and will add the coordinator automatically.
- Installed same-named skill folders are replaced on refresh, matching current behavior.

## Rollback

The feature can be rolled back by removing the coordinator skill and readiness/configuration scripts, restoring the previous root instructions, and removing `JOBTRACKER_BASE_RESUME_URL` from documentation and setup output. Existing `.env.local` files may retain the unused additive key harmlessly. No database rollback is required.

## Acceptance Criteria

1. A fresh application-intent request with no link invokes the coordinator, validates readiness, and ends by asking for a job link.
2. A supplied job link does not bypass readiness.
3. No resume prevents material generation with `status=needs_input`; no profile produces only a warning.
4. A syntactically valid Google Docs URL is preferred and marked for external access verification.
5. An accessible Google Doc is read without requiring public sharing; an inaccessible one yields a reconnect/fallback prompt.
6. DOCX and PDF sources work, with PDF carrying the documented warning.
7. `.env.local` updates preserve unrelated keys and never accept credential fields.
8. The original resume is never modified.
9. Tracker upsert and verification occur before application-material work.
10. Tracker intake, artifact registration, and all material commands use the same absolute database path and applications directory returned by readiness.
11. A Google Docs tailored resume has a role-specific copy and a local registered snapshot, or the agent reports snapshot/registration failure accurately.
12. Codex and Claude skill source trees are byte-identical and include the coordinator.
13. Existing installations using only `JOBTRACKER_BASE_RESUME_PATH` remain compatible.
14. Private source and output paths inside the repository must be ignored; readiness output leaks no resume contents or secrets.
15. Fresh-context forward tests pass for readiness-before-intake, intake-before-materials, custom-path propagation, accessible/inaccessible Google scenarios, unchanged master behavior, and snapshot-before-registration ordering.
16. All focused tests, `npm run verify`, and `npm run build` pass.

## Verification Commands

```bash
npm test -- scripts/application-readiness.test.ts scripts/configure-application-profile.test.ts scripts/install-skills.test.ts
diff -qr skills .claude/skills
npm run verify
npm run build
git diff --check
git status --short
```

Mandatory fresh-context acceptance:

1. Start fresh isolated agent contexts at the repository root and forward-test “help me apply” with and without a link.
2. Provide fixture readiness outputs for accessible and inaccessible Google Docs, DOCX, PDF, missing resume, and missing profile; require the expected decisions and command order.
3. Execute a custom database/applications-directory fixture through real upsert and artifact commands and assert every command uses the same resolved paths.
4. Confirm through artifact hashes/IDs that the master is unchanged, the tailored document is a copy, a local snapshot exists before registration, and tracker intake precedes materials.
5. When a connected Google Docs host and private test document are available, additionally perform real create/readback/export verification. If unavailable, record that external capability limitation without representing the fixture forward-test as live connector proof.

## Material Decisions and Tradeoffs

- Trigger on application intent rather than repository open because agent hosts cannot reliably emit unsolicited messages and unrelated developer sessions must not be hijacked.
- Prefer Google Docs but do not require it; requiring one would exclude valid DOCX/PDF users and environments without Drive access.
- Require a resume but not a public profile; inventing experience is unacceptable, while profile context is supplementary.
- Use two-stage readiness because local code cannot inspect a host-managed Google connection.
- Export a local snapshot rather than add remote artifact URLs. This preserves the local-first model and avoids a database/UI migration; direct tracker links to Google Docs remain a possible future enhancement.

## Open Decisions

No blocking product decisions remain. Host-specific manual verification is required because repository tests cannot prove that every Codex or Claude release rescans installed skills identically.
