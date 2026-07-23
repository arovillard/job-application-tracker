# Private Daily Discovery Setup Design

## Purpose

Make daily qualified-job discovery a reusable repository capability for Codex and Claude without adding a JobTracker UI setting or committing a user's resume-derived preferences, local paths, or other private profile data.

The repository will expose one setup skill and one copyable prompt. The skill will collect and validate a user's preferences, save them only in ignored local state, bind the scheduler to the same SQLite database used by JobTracker, and configure one local scheduler. Daily runs will prepare qualifying opportunities for review but will never submit an application.

This change also removes machine-specific paths and unrelated personal information from the current repository and its public Git history, then adds an automated privacy check to prevent recurrence. GitHub account identity, repository URLs, license attribution, and commit-author metadata are intentionally outside the cleanup scope.

## Chosen Approach

Use one canonical repository skill with provider-specific scheduling guidance.

- `skills/daily-job-discovery-setup` is the canonical Codex source.
- `.claude/skills/daily-job-discovery-setup` is a byte-identical Claude mirror.
- `AGENTS.md` and `CLAUDE.md` route setup intent to the repository source even before personal skill installation.
- `README.md` and `docs/agent-setup.md` publish the exact invocation prompt and explain local scheduling requirements.
- Deterministic scripts own private configuration validation and readiness reporting; the skill owns the interactive conversation and host scheduler operation.

A documentation-only prompt was rejected because it cannot validate storage, database binding, or scheduler completion. Separate Codex and Claude workflows were rejected because safety and scoring rules would drift.

## User Experience

After ordinary project setup, a user pastes this prompt into Codex or Claude from the repository:

```text
Set up daily qualified job discovery for this JobTracker project.

Use the repository's daily-job-discovery-setup skill. Guide me through configuring my private job-search preferences, resume source, target roles and seniority, location and remote-work constraints, mandatory qualifications, schedule, timezone, and whether I use Codex, Claude, or both. If I use both, help me choose one agent to own the active schedule so jobs are not processed twice.

You may suggest preferences derived from my resume, but ask me to confirm them before saving. Keep all personal information in ignored local configuration and never commit it.

Configure a daily local scheduled task that searches complete public job postings, accepts only jobs with both an overall match score and qualification score of at least 80%, prepares all expected application documents and submission instructions, and adds the opportunity to my local JobTracker database for review. Never submit an application on my behalf.

Verify the configuration, database connection, installed skills, and scheduled task when finished.
```

The setup skill will:

1. Complete ordinary application readiness first, using the configured private resume source and existing database.
2. Read the resume only through the configured private source and propose target functions, scope, and seniority as editable suggestions. It will not persist raw resume text.
3. Collect target roles, acceptable seniority, location/jurisdiction/remote policy, mandatory constraints, schedule, timezone, installed agents, and one scheduler owner.
4. Show the structured preferences for confirmation before persistence.
5. Initialize or verify the identity of the existing JobTracker SQLite database without creating a replacement database.
6. Persist the validated profile to ignored local state with private file permissions.
7. Install or refresh repository skills for the selected agents.
8. Create one local daily scheduled task with a generic prompt that loads the private profile at runtime.
9. Run readiness checks and, when supported by the host, a manual scheduler test.
10. Report precisely what is ready and any remaining host-UI step. It will not claim scheduler success without evidence.

## Private Configuration

Store the profile at `data/job-discovery.json`. Add that exact path to `.gitignore`; do not broadly ignore committed schemas or fixtures.

The schema contains:

- `schemaVersion`
- `enabled`
- `schedule`: local time, IANA timezone, and scheduler owner (`codex` or `claude`)
- `agents`: installed/used agents, while allowing only one active scheduler owner
- `targets`: confirmed functions/titles, seniority levels, adjacent scope, and exclusions
- `locationPolicy`: jurisdictions, remote eligibility, acceptable onsite/hybrid locations, relocation policy, and travel limits
- `qualificationPolicy`: user-confirmed mandatory credentials, work authorization, languages, and other hard constraints
- `thresholds`: overall match `80`, qualification match `80`, and the existing seniority-alignment minimum
- `databaseInstanceId`: the initialized identity of the configured existing database

Validation requires both match thresholds to remain at least 80. Empty or contradictory targeting, invalid timezones/times, multiple scheduler owners, and unknown fields fail closed. The file contains structured preferences only: no raw resume text, credentials, contact details, private document URLs, or absolute project/resume paths.

The existing `.env.local` remains the private source for the database path, applications directory, resume reference, and optional public-profile reference. Readiness joins those values in memory; it does not duplicate them into the discovery profile.

## Deterministic Commands

Add small JSON-in/JSON-out commands and shared validation:

- `daily-discovery:configure`: validate an allowlisted JSON document and atomically write the private profile with owner-only permissions.
- `daily-discovery:readiness`: combine application readiness, discovery-profile validation, database identity verification, skill-mirror status, and a redacted scheduler contract.
- `privacy:check`: scan tracked repository content for forbidden private-state files, non-placeholder home-directory paths, local orchestration paths, desktop paths, and known non-anonymized fixtures.

The configuration command accepts only documented keys. It preserves the last valid configuration if validation fails. Readiness emits machine paths only to the local caller because the daily workflow needs the exact live paths; summaries and committed files must never copy those values.

## Daily Runtime Contract

The existing `job-application-workflow` retains responsibility for daily discovery but becomes profile-driven:

1. Load application readiness and `data/job-discovery.json` from the saved checkout.
2. Verify the configured database file and `databaseInstanceId`; never select a fallback database or start another server.
3. Acquire the existing bounded run lock.
4. Discover complete public postings using the confirmed target, seniority, location, and hard-constraint policies. No role, city, jurisdiction, or candidate name is hardcoded in the reusable skill.
5. Skip closed, incomplete, unverifiable, duplicate/inactive, log-in-only, clearly below-scope, logistically incompatible, or hard-disqualified postings before material preparation.
6. Score truthful evidence through the deterministic evaluator. Continue only when overall match is at least 80, qualification match is at least 80, seniority meets the configured minimum, the posting is open, and no blocker exists.
7. Use the existing resume/application skill to create or repair the full dossier: tailored resume snapshot, fit analysis, cover letter, outreach message, and submission guide with unresolved user answers separated.
8. Register artifacts against the exact existing JobTracker opportunity and leave it in `wishlist` for human review.
9. Never sign in, upload, fill forms, attest, message, change the job to applied, or submit.
10. Release the lock and emit a sanitized summary that does not reproduce private resume evidence or configuration.

The local web server does not need to be running because the workflow writes the same validated SQLite file directly. The computer and the selected desktop agent must be running for local schedules. A cloud scheduler is not selected because it cannot access the user's local ignored database and resume state.

## Scheduler Adapters

The skill will choose one scheduler owner:

- **Codex in ChatGPT Desktop:** create or update a local Scheduled task in the current saved project, using the user's confirmed daily time and timezone.
- **Claude Desktop:** create or update a local scheduled task in the current saved project. Do not use session-scoped `/loop` as the durable schedule.
- **Unsupported host surface:** produce the exact provider-specific prompt and UI steps, mark scheduling as incomplete, and stop short of claiming full readiness.

The scheduled prompt contains no user-specific roles, locations, paths, name, or resume evidence. It directs the agent to read the repository workflow and private profile at runtime. Selecting both agents installs both skill copies but still creates only one active schedule.

## Repository Privacy Remediation

The leak sources are known:

- internal goal, plan, specification, and handoff documents captured controller/worktree/report/screenshot absolute paths;
- a test fixture reused a real resume filename;
- the daily workflow and its deployment prompt embedded private geography and inferred seniority;
- no repository guard rejected those values before commit.

Remediation will:

1. Replace machine-specific paths in retained documentation with relative paths or explicit placeholders such as `<project-root>` and `<skill-root>`.
2. Remove internal orchestration telemetry/path details that have no durable product value.
3. Replace realistic personal filenames, people, locations, and application examples with clearly fictional fixtures.
4. Move all daily targeting and scheduler values to ignored private configuration.
5. Add the privacy check to `npm run verify` and CI.
6. Rewrite every public branch and tag containing in-scope repository-content PII, verify the rewritten object graph, remove rewrite backup refs, and force-push only after fresh tests and scans pass.

The rewrite replacement rules must not alter GitHub usernames, repository URLs, the license holder, or commit author/committer metadata.

## Testing

Use test-driven development for all deterministic behavior:

- profile schema acceptance and rejection, including both 80% floors;
- atomic/private writes and preservation on invalid input;
- exact ignored-path enforcement;
- readiness against missing, malformed, mismatched, and valid database identities;
- one-owner scheduling rules for Codex, Claude, and both-agent installs;
- provider-neutral scheduled prompt content with no private values;
- setup-skill contract tests for privacy, confirmation, database reuse, no-submit behavior, and honest scheduler reporting;
- byte-identical Codex/Claude skill mirrors;
- privacy scan failures for macOS, Linux, and Windows home paths, local orchestration paths, tracked private files, and realistic fixture regressions;
- full `npm run verify` and production build;
- pre-push scans of the current tree and complete rewritten public history.

## Completion Criteria

The work is complete when:

- a fresh clone documents and routes the copyable setup prompt for both Codex and Claude;
- the setup skill produces a validated ignored profile and binds one scheduler to the existing local JobTracker database;
- the daily workflow consumes only private profile values and enforces both 80% gates;
- application dossiers are prepared but never submitted;
- the current tree contains no in-scope private paths or non-anonymized fixtures;
- the rewritten public history contains no in-scope repository-content PII;
- privacy checks, all tests, lint, typecheck, build, and skill validation pass;
- the sanitized history is force-pushed and the remote default branch is verified.
