# Daily Qualified Job Preparation Specification

## Problem

Opportunity Tracker can record a public job posting and prepare job-specific materials after a human supplies a link, but it does not discover jobs, enforce a numeric qualification threshold, or run on a schedule. Its application-material workflow asks for a candid fit analysis but has no deterministic scoring contract. It also does not require a complete submission-ready dossier or manual submission instructions.

The user wants a daily, local-first workflow that searches for roles aligned with their actual seniority and experience, prepares only jobs where the supported match is at least 80%, and leaves every passing opportunity in JobTracker for human review. The workflow must never submit an application, sign in to an application site, use credentials, expose private source material, or edit the master resume.

## User Outcomes

- Once per day, the workflow searches public employer career pages and public job boards for currently open roles.
- Job discovery is based on demonstrated scope and experience rather than a fixed title list.
- No job is added to the active review queue or receives application materials unless a deterministic gate confirms at least an 80% overall match, at least an 80% mandatory-qualification match, adequate seniority alignment, and no unmet non-negotiable requirement.
- Passing opportunities are saved as `wishlist` jobs and include a complete application dossier.
- All scheduled reads and writes use the user's existing working JobTracker database—the same SQLite data shown by the local app—not a worktree, temporary, fixture, or fallback database.
- The user can review every prepared opportunity in the existing tracker, choose which to submit manually, and reject or archive the rest.
- The master resume remains private, read-only, and unchanged.
- The workflow produces exact manual submission instructions but never performs the final submission or any authenticated application-site action.

## Scope

This change includes:

- A deterministic JSON-in/JSON-out qualification-scoring command.
- A versioned scoring schema and validation rules.
- Updates to the repository application coordinator, posting-intake skill, and application-material skill.
- A complete application dossier contract: tailored resume, fit analysis, cover letter, outreach draft, and submission guide.
- A stable database-instance identity check that fails closed if the configured live database is missing, replaced, malformed, or no longer matches the deployment identity.
- A bounded run lock plus atomic status/version preconditions so overlapping runs and concurrent user archive/reject actions cannot mutate inactive opportunities.
- An executable automated-intake coordinator with scenario tests for sub-threshold, inactive, unchanged-complete, incomplete-repair, race, and no-submit paths.
- Duplicate and repeat-run controls that use the existing posting dry-run behavior before mutating the tracker.
- Contract and behavioral tests for scoring, workflow ordering, artifact requirements, fail-closed behavior, and submission safety.
- A daily Codex automation for the local JobTracker project at 08:00 in `Etc/UTC`.
- Explicit live-database binding through the readiness result returned from the saved local project checkout.

The existing tracker UI, job lifecycle, artifact viewer, and archive/reject controls remain the human review surface.

## Non-Goals

- Submitting applications or clicking a final application-site submission control.
- Signing in to job sites, using credentials, solving CAPTCHAs, accepting legal attestations, or representing the user to an employer.
- Automatically changing a job from `wishlist` to `applied`.
- Editing or overwriting the master resume.
- Making private Google Drive documents public.
- Inventing experience, credentials, dates, metrics, management scope, work authorization, salary expectations, or demographic answers.
- Building a first-party crawler, external job-feed service, provider daemon, or new discovery database.
- Adding a dedicated candidate-queue page or changing the existing Opportunity Tracker pipeline.
- Guaranteeing exhaustive coverage of every public job posting.

## Current-State Evidence

- Job statuses already include `wishlist`, `applied`, `interviewing`, `offer`, `rejected`, and `archived` in `src/types.ts`.
- The dashboard already exposes active, closed, and archived views; job detail pages render linked application artifacts and allow stage changes or archive confirmation in `src/components/Dashboard.tsx` and `src/components/OpportunityDetailPage.tsx`.
- Markdown artifacts render inline, PDFs preview inline, and other registered files remain openable through `src/components/OpportunityArtifactViewer.tsx`.
- `scripts/upsert-job-posting.mjs` creates new jobs as `wishlist`, deduplicates normalized organization and role, records activity, supports rollback-only `--dry-run`, and returns structured JSON.
- `scripts/register-application-artifact.mjs` already accepts `fit_analysis`, `outreach_message`, `cover_letter`, `resume`, `posting`, and `other` artifact types.
- Artifact registration currently resolves a supplied path but does not reject a missing or non-file path, so the executable contract is weaker than the skill's file-existence requirement.
- `skills/job-application-workflow/SKILL.md` already enforces readiness before intake, intake before materials, explicit absolute paths, master-resume protection, and no submission.
- `skills/job-application-resume/SKILL.md` already requires a candid evidence-based fit analysis, role-specific files, company-neutral resume content, web research when helpful, file verification, and explicit artifact registration.
- The application workflow currently has no discovery policy, numeric score, scoring command, daily scheduler, cover-letter requirement, submission-guide requirement, or repeat-run dossier completeness rule.
- The configured private resume has been validated read-only through the signed-in host. It establishes 10+ years of product delivery, progression from JavaScript Engineer to Technical Lead, Director-level engineering and operations experience, people leadership, React/React Native/TypeScript/Node/AWS depth, platform/developer-experience work, customer translation, and AI-assisted workflows.
- Current local readiness has confirmed an absolute project root, working SQLite path, and applications-materials path in the saved local checkout. These ignored paths are the user's working tracker state and materials directory; the specification intentionally does not commit machine-specific personal paths.
- Readiness currently validates the configured database parent but does not prove that the database file exists, is a regular SQLite file, has the current tracker schema, or is the same database instance selected at deployment. The scheduled workflow therefore needs a stronger fail-closed identity command before any automated intake.
- The user identifies the app normally served on `http://localhost:3000` as the UI for this working database. The server may not be running at every scheduled execution, so the validated SQLite path—not server reachability—is the database identity contract.

## Proposed Behavior

### Daily Discovery

At 08:00 `Etc/UTC`, a standalone Codex automation runs with `executionEnvironment=local` against the saved JobTracker project. It must not run in the implementation worktree because ignored `.env.local`, the live SQLite database, and generated application materials belong to the saved local checkout.

Every run begins from that repository root, uses the repository source coordinator as authoritative, and runs `node scripts/check-application-readiness.mjs` before discovery-driven mutation. It must parse and preserve the returned absolute `projectRoot`, `database.path`, and `applicationsDirectory.path`. Every dry run, real posting upsert, dossier inspection, and artifact registration receives that exact `database.path` through `--db`; every material command receives the exact `applicationsDirectory.path` through `--applications-dir`. Process defaults and synthesized fallback paths are forbidden.

Deployment initializes one stable UUID in the existing `schema_metadata` table of the already-existing working database through `node scripts/jobtracker-database-identity.mjs initialize --db "/absolute/database/path"`. Initialization uses SQLite `fileMustExist` and a shared structural validator for the current tracker schema before writing: required tables and columns, primary keys, foreign-key targets/actions, the artifact uniqueness key, and required named indexes must all match. Correctly named lookalike tables are rejected. Initialization never replaces an existing identity and adds only the `jobtracker_instance_id` metadata row; it does not create a database or change the schema. The automation stores that returned UUID in its private external prompt/state, not in committed repository files.

Every scheduled run then invokes `node scripts/jobtracker-database-identity.mjs verify --db "/absolute/database/path" --expected-id "DEPLOYMENT_UUID"` before discovery-driven intake. Verification requires an absolute existing regular file, the complete shared structural schema contract, a readable `schema_metadata` identity row, and an exact UUID match. A missing file, directory, empty/new database, named-table lookalike with missing/wrong columns, broken primary/foreign/unique keys, missing required index, missing identity, or different identity stops the run. The workflow never initializes identity during a scheduled run.

After identity verification, the run acquires one bounded lock in the verified database's existing `schema_metadata` table with `node scripts/daily-job-prep-lock.mjs acquire --db "/absolute/database/path"`. The returned random token is required by every automated decision, guarded upsert, guarded dossier precondition, and guarded artifact/dossier commit. Acquisition, expired takeover, and release use `BEGIN IMMEDIATE` transactions around the single `daily_job_prep_lock` metadata row, so concurrent contenders serialize and cannot delete or replace a successor's lock. The lock expires after six hours to recover from a crashed run and is released in a `finally` path. A second unexpired acquisition fails closed. Expiry or token mismatch during a command also fails closed.

The local Next.js app at `http://localhost:3000` is a presentation surface over the working SQLite state, not a second data service. The automation may use the public local API for read-only corroboration when it is already available, but it does not require the development server to be running and must never start a second server or choose another database when port 3000 is unavailable.

The automation searches broadly across public sources:

1. Public employer career pages are authoritative for posting state, exact requirements, location, and application URL.
2. Public job boards may be used for discovery and corroboration.
3. A board result must be resolved to a complete public posting whenever possible.
4. Login-only descriptions, snippets without complete requirements, expired pages, and unverifiable reposts are not eligible for scoring.

Search queries vary titles while preserving seniority and scope. Relevant title families include Engineering Manager, Senior Engineering Manager, Director of Engineering, Director of Engineering and Operations, Technical Lead, Platform or Integrations Engineering Lead, Developer Experience Lead, and adjacent product-engineering leadership roles. A title alone never creates eligibility.

The default geographic policy is conservative: accept remote roles that explicitly permit employment from Example Country and hybrid or onsite roles whose stated location is compatible with Example City, Example City, or the Example Region without assuming relocation. If the posting is ambiguous about Canadian eligibility or required presence, treat logistics as unresolved and fail closed unless another authoritative public source resolves it.

### Pre-Score Exclusions

Do not score or record a candidate when any of these conditions is true:

- The posting is closed, expired, inaccessible, or lacks a complete public description.
- The role is clearly junior or materially below the user's demonstrated seniority.
- The role requires a location, schedule, or employment jurisdiction that is clearly incompatible.
- A mandatory licence, professional designation, security clearance, citizenship condition, language requirement, degree, or specialized experience is explicitly required and clearly unsupported.
- The posting is an agency lead without a verifiable employer and role.
- The opportunity was previously rejected or archived by the user and the posting does not represent a materially distinct role.

Rejected and archived tracker records remain inactive. Automated runs must not pass `--reactivate`.

### Qualification Assessment Input

For each otherwise eligible posting, the agent creates a structured assessment containing:

- Canonical posting URL, organization, exact role, source, posting state, location, and evidence timestamp.
- Criterion groups with fixed total weights:
  - Required qualifications: 50 points.
  - Seniority and leadership scope: 20 points.
  - Technical and domain relevance: 15 points.
  - Product, delivery, and customer context: 10 points.
  - Logistics and employment compatibility: 5 points.
- One or more criteria in every group. Criteria within a group must sum exactly to the group's fixed weight.
- For every criterion: the posting requirement, whether it is mandatory, evidence classification, supporting resume evidence, and concise rationale.
- Any non-negotiable blockers found.

Evidence classifications are fixed:

- `direct`: explicit support in verified resume or profile evidence; receives 100% of the criterion weight.
- `adjacent`: clearly transferable evidence that does not fully establish the requested qualification; receives 50% of the criterion weight.
- `unsupported`: no verified support; receives 0%.

Reasonable inference may explain adjacency but may not upgrade it to direct evidence. No credit is allowed for a claim that would need invention, unverifiable memory, or optimistic interpretation.

### Deterministic Qualification Gate

`node scripts/evaluate-job-match.mjs --input-json -` validates the assessment and returns schema-versioned JSON. It rejects malformed input, missing groups, unknown evidence classifications, incorrect category totals, missing evidence text for credited criteria, non-boolean mandatory flags, or total weights other than 100.

The command computes:

- `overallScore`: earned points out of 100, expressed to one decimal place.
- `mandatoryMatch`: earned weight across mandatory criteria divided by available mandatory weight, expressed as a percentage to one decimal place.
- `seniorityMatch`: earned points in the 20-point seniority group divided by 20, expressed as a percentage to one decimal place.
- `eligible`: true only when every required gate passes.
- `reasons`: stable machine-readable failure reasons and concise human-readable explanations.

Eligibility requires all of the following:

1. `overallScore >= 80`.
2. `mandatoryMatch >= 80`.
3. `seniorityMatch >= 75`.
4. No non-negotiable blocker.
5. Posting state is `open`.

All gates compare the exact half-point arithmetic before display formatting. Display values use one decimal place, rounded to the nearest tenth. This means an earned score of `79.5` remains below the threshold and cannot be displayed or treated as `80` for eligibility.

If there are no explicitly mandatory criteria, the command returns a validation failure rather than treating mandatory match as 100%. The agent must revisit the posting and identify its required qualifications or skip the candidate as unverifiable.

The scoring command is the mutation boundary. Tracker intake and material generation are forbidden until its parsed output reports `eligible: true` and all returned values are verified against the input opportunity. Automated candidates pass through `node scripts/prepare-qualified-job.mjs`, which verifies database identity and the run-lock token, invokes the evaluator before any posting command, performs the dry-run/inspection/decision sequence below, and is the only automated route to a real posting upsert.

### Repeat-Run and Duplicate Controls

Before a real tracker write, the workflow invokes the existing posting command with `--dry-run` and the exact live database path returned by local readiness. When the dry-run result identifies an existing opportunity, `node scripts/inspect-job-dossier.mjs --db "/absolute/database/path" --opportunity-id "ID"` returns its status and the validity of every required registered artifact without mutating the database.

- A new candidate may proceed to real intake.
- An existing candidate with material posting changes may be refreshed and rescored.
- An unchanged candidate with a complete registered dossier is skipped.
- An unchanged candidate with an incomplete dossier may proceed only to create or repair missing material; existing valid files are preserved.
- A previously rejected or archived candidate is skipped and never reactivated automatically.

The dossier-inspection command reports each required artifact's registration, expected type/title, absolute path, file existence, and regular-file status. A dossier is complete only when all five required outputs are registered and their local files are present. The tailored Google Doc URL is returned separately and is not a substitute for the registered local resume snapshot.

The real upsert uses the same canonical facts and absolute database path as the dry run. The workflow verifies action, opportunity type, organization, role, canonical URL, status, changes, and activity IDs. The resulting job remains `wishlist`.

Automated dry-run output also returns the pre-mutation duplicate snapshot: whether the record existed and, when it did, its ID, status, and `updated_at` value. A guarded real upsert accepts either `expect new` or that exact existing ID/status/version. Inside the same SQLite transaction and before any update, activity, or task write, it rechecks the current record. A new duplicate, missing record, ID mismatch, status mismatch, version mismatch, or current `rejected`/`archived` state aborts with no mutation. Dry-run is allowed to describe an inactive duplicate, but a real automated upsert can never update one.

Immediately before creating or repairing materials, the coordinator reruns dossier inspection with the run-lock token and the expected `wishlist` status plus the `updated_at` value returned by the intake decision. That single read-only SQLite snapshot must match. Every automated artifact registration also requires the same active run-lock token and atomically rechecks `status = wishlist` inside its write transaction before inserting/updating an artifact. If the user rejects or archives during material authoring, subsequent registration stops, the tracker record remains inactive, and the workflow reports the dossier as incomplete rather than ready. Generated but unregistered files remain private local files and are not described as submission-ready.

### Complete Application Dossier

After verified intake, the coordinating workflow invokes `job-application-resume` with the verified opportunity ID, the same absolute database path, and the exact absolute applications directory.

Every prepared job must include:

1. **Tailored resume**
   - A role-specific copy of the private master.
   - Company-neutral visible content, filename, and Google Doc title.
   - No unsupported claims.
   - A verified local PDF snapshot registered as `resume` before completion is claimed.
2. **Fit analysis**
   - The existing required qualification sections.
   - Overall, mandatory, and seniority scores.
   - A criterion-by-criterion evidence matrix matching the scoring input and output.
   - Explicit partial matches, unsupported requirements, blockers considered, and the eligibility decision.
   - Current company/interview research with sources and caveats.
   - Registered as `fit_analysis`.
3. **Targeted cover letter**
   - Grounded only in verified experience and posting facts.
   - Tailored to the organization and role without repeating the resume mechanically.
   - Registered as `cover_letter`.
4. **Outreach draft**
   - A concise recruiter or hiring-manager message using the same verified evidence.
   - No invented recipient name or contact details.
   - Registered as `outreach_message`.
5. **Manual submission guide**
   - Canonical application URL and verified posting status.
   - Exact files to upload and which file should be used for each upload field.
   - Step-by-step human actions from opening the public application page through reviewing the final form before submission.
   - Suggested answers only when supported by verified source material.
   - A clearly separated `Needs Your Answer` section for salary expectations, availability, demographic disclosures, legal attestations, work authorization, relocation, references, or any other fact not established by the source material.
   - Qualification caveats, attachment checklist, and a final reminder that the user—not the automation—must review and submit.
   - Registered as `other` with title `Submission Guide`.

All local files use role-specific slugs and preserve unrelated existing files. The workflow verifies every file exists before registration and parses every registration response. A remote Google Doc link without a verified local resume snapshot is incomplete.

In automated mode, the agent writes only missing dossier outputs to a private staging directory inside the verified applications directory, then invokes `node scripts/commit-job-dossier.mjs` with an exact manifest. The command performs a fresh guarded status/version inspection, rejects any manifest entry that would replace an already-valid required artifact or reuse any already-registered destination path, validates every staged input and destination boundary, copies missing outputs without overwrite semantics, registers them under the fixed type/title contract with the active lock and expected `wishlist` status, and finally reruns guarded dossier inspection. Registration is called through an imported function with an explicit committed return. If any error is ambiguous after the registration call, the commit command queries the exact artifact row before cleanup: a matching committed row keeps the copied file and is treated as committed, while absence of the row permits removal only of the destination created by that iteration. A failure may leave only registered valid outputs for a later repair; it never creates a dangling registration, overwrites a valid existing file, or calls the dossier complete unless all five requirements validate.

### Tracker Review Workflow

Prepared opportunities remain in `wishlist` and appear in the existing active pipeline. The user reviews the job details, source link, fit analysis, resume, cover letter, outreach draft, and submission guide.

The user may:

- Submit manually and then change the tracker status to `applied`.
- Change the opportunity to `rejected`.
- Archive it through the existing confirmation flow.

Automation never changes a prepared job to `applied`, `rejected`, or `archived` and never restores a rejected or archived job.

### Daily Run Summary

Each run reports:

- Search scope and authoritative sources consulted.
- Count of postings reviewed, pre-score exclusions, scored candidates, eligible candidates, prepared dossiers, unchanged skips, and failures.
- For every prepared job: organization, role, score, tracker status, tracker identity, and material paths/links.
- For skipped jobs: concise reason categories without adding sub-80 opportunities to JobTracker.
- Any capability limitation, inaccessible source, incomplete dossier, or candidate requiring human clarification.

The summary must not reproduce private resume content, personal contact details, or credentials.

## Executable Automated Intake Decisions

`node scripts/prepare-qualified-job.mjs --db "/absolute/database/path" --expected-database-id "DEPLOYMENT_UUID" --lock-token "RUN_TOKEN" --input-json -` accepts exactly `{ assessment, posting }`; submission, credential, or authenticated-action fields/options are invalid. Posting organization, role, canonical URL, and `posting_state` must exactly match the evaluated posting identity and state after documented normalization; a contradiction such as evaluated `open` with intake `closed` fails before dry-run. It returns a schema-versioned decision without creating application materials:

- `skip_ineligible`: evaluator failed one or more gates; no posting command or tracker mutation occurred.
- `skip_inactive`: the dry run identified a rejected or archived record; no real upsert or dossier creation occurred.
- `skip_complete`: the posting was unchanged and the read-only inspector proved all five files valid; no real upsert or file change occurred.
- `repair_dossier`: the posting was unchanged and the dossier was incomplete; no posting mutation occurred, valid existing files are preserved, and the response includes the exact ID/status/version precondition for material work.
- `prepare_dossier`: a new or materially changed eligible posting was committed through guarded compare-and-set, remains `wishlist`, and the response includes the exact ID/status/version precondition for material work.

The command rejects posting facts that do not match the evaluated organization, role, canonical URL, or posting state. Candidate scenario tests use only temporary databases and applications directories. They prove score-before-dry-run, contradictory-state rejection before dry-run, dry-run-before-real-write, inactive preservation including activities, `updated_at`, schema, and metadata, unchanged-complete skipping, incomplete repair without overwriting valid files, compare-and-set race failure, overlap lock failure, and rejection of any submit-style option before mutation.

## Interfaces and File Responsibilities

- `scripts/evaluate-job-match.mjs`: validate assessment JSON, compute deterministic scores, enforce gates, and emit schema-versioned JSON.
- `scripts/evaluate-job-match.test.ts`: behavioral coverage for valid eligibility, threshold boundaries, half-credit adjacency, blockers, group totals, mandatory rules, rounding, and malformed input.
- `scripts/jobtracker-database-identity.mjs`: deployment-only identity initialization and scheduled fail-closed verification for an existing tracker database.
- `scripts/jobtracker-database-identity.test.ts`: missing/non-file/malformed/missing-ID/mismatch/success/idempotent-initialize coverage.
- `scripts/lib/current-opportunity-schema.mjs`: one read-only structural schema validator shared by identity, lock, automated upsert, automated inspection/registration, and dossier commit paths.
- `scripts/daily-job-prep-lock.mjs` and `scripts/lib/daily-job-prep-lock.mjs`: acquire, verify, and release one expiring lock keyed to the verified database path.
- `scripts/daily-job-prep-lock.test.ts`: simultaneous acquire, token mismatch, transactional release/acquire, expiry takeover, and database isolation coverage.
- `scripts/inspect-job-dossier.mjs`: read-only lookup for existing opportunity status and required registered artifact/file completeness.
- `scripts/inspect-job-dossier.test.ts`: complete, incomplete, missing-file, inactive-status, and invalid-opportunity coverage.
- `scripts/register-application-artifact.mjs`: reject missing or non-file artifact paths before any database mutation and enforce lock/status preconditions in automated mode.
- `scripts/register-application-artifact.test.ts`: regression coverage for file validation, guarded inactive-state races, and unchanged valid registration behavior.
- `scripts/commit-job-dossier.mjs`: guarded, no-overwrite promotion and registration of only missing staged dossier outputs.
- `scripts/commit-job-dossier.test.ts`: real temporary-file coverage for complete creation, incomplete repair, valid-file preservation, unsafe paths, collisions, and concurrent inactive status.
- `scripts/prepare-qualified-job.mjs`: executable score-first, dry-run, duplicate/dossier decision, and compare-and-set automated intake coordinator.
- `scripts/prepare-qualified-job.test.ts`: temporary-fixture scenario coverage for all decision paths and submission rejection.
- `scripts/upsert-job-posting.mjs`: preserve manual behavior while adding automated dry-run precondition output and guarded compare-and-set writes.
- `scripts/upsert-job-posting.test.ts`: automated race, inactive, expect-new, and manual-compatibility coverage.
- `skills/job-application-workflow/SKILL.md`: daily discovery policy, pre-score exclusions, gate-before-mutation ordering, duplicate controls, run summary, and no-submit boundary.
- `skills/job-tracker-add-posting/SKILL.md`: automated dry-run-before-write behavior, no automatic reactivation, and verified unchanged-candidate handling.
- `skills/job-application-resume/SKILL.md`: complete dossier requirements, scoring evidence integration, artifact types, source-grounded answers, and submission-guide contract.
- `.claude/skills/**`: exact generated mirrors of the repository source skills.
- `scripts/application-workflow-contract.test.ts`: durable workflow and dossier contract assertions.
- `scripts/install-skills.test.ts`: provider mirror and installation coverage.
- `package.json`: a focused script for the qualification evaluator if consistent with existing command conventions.
- Codex automation state: once-daily local schedule targeting the saved JobTracker project.

## Failure Paths

- Readiness not `ready`: stop the run before discovery-driven mutation and report the exact issue.
- Readiness returns a database path different from the saved local project's configured working path: stop and report the configuration change; never silently use the worktree or a default database.
- `http://localhost:3000` is unavailable but local readiness remains `ready`: continue through the validated SQLite commands because server availability does not change database identity.
- Private Google Doc inaccessible: preserve the configured URL, do not weaken privacy, and fail the run or use an already configured valid local fallback.
- Posting description unavailable or incomplete: skip without scoring or tracker mutation.
- Official source contradicts a job-board listing: treat the official source as authoritative.
- Qualification input invalid: scoring command exits nonzero; do not repair by lowering weights or changing evidence classifications optimistically.
- Score or independent gate below threshold: skip without tracker mutation or dossier creation.
- Dry run identifies an inactive prior record: skip without `--reactivate`.
- Tracker intake fails or returns mismatched facts: stop that candidate before material generation.
- One dossier artifact fails: keep valid files, report the dossier as incomplete, and do not claim the opportunity is submission-ready.
- Registration fails: return the valid local path or Docs link with an explicit registration failure; never claim tracker linkage succeeded.
- Dossier inspection fails or cannot prove file validity: treat the dossier as incomplete; do not skip or claim readiness based only on filenames.
- Database identity cannot be verified: stop the scheduled run before discovery-driven intake; never initialize, replace, or fall back during the run.
- The run lock is held, expired during work, or has the wrong token: stop mutation/material registration, release only a lock owned by the current token, and report the conflict.
- A guarded ID/status/version precondition fails: treat it as concurrent user or automation activity, make no write, and re-evaluate on a later run rather than overriding the newer state.
- An automated command encounters a legacy or incomplete schema: fail closed without running schema creation or migration helpers. Manual one-off commands retain their existing migration compatibility.
- Research source unavailable: disclose the limitation and continue only if the posting itself remains sufficient for scoring.
- One candidate fails: continue safely with independent candidates and report the isolated failure.
- Automation run exceeds available time: stop at a clean candidate boundary and report unprocessed discoveries without partially mutating the next candidate.

## Security and Privacy

- The master resume is read-only and never overwritten.
- Resume contents, contact details, private document URLs, generated dossiers, and the live SQLite database remain ignored and uncommitted.
- OAuth tokens, browser sessions, provider credentials, job-site credentials, and secrets remain host-managed and are never written to the repository or dossier.
- Only public job pages may be discovered automatically.
- No application-site login, upload, form fill, attestation, CAPTCHA, message send, or final submission is authorized.
- Suggested application answers must cite verified source support internally or be placed in `Needs Your Answer`; absence must never be converted into a guess.
- The scoring JSON and fit analysis may contain concise resume evidence but must remain inside the ignored applications directory, never the repository documentation tree.
- Artifact registration always uses the verified opportunity ID and exact readiness database path.

## Compatibility and Migration

- Existing databases, opportunities, statuses, activities, tasks, and artifact records require no schema migration. Deployment adds one stable `jobtracker_instance_id` row to the existing `schema_metadata` table after validating the current database; scheduled runs never add or change it.
- Existing manual single-link application requests continue through the same coordinator, now with the deterministic score gate. Database-instance initialization and the six-hour run lock are scheduled-mode deployment controls and are not prerequisites for ordinary one-off manual intake on a newly installed tracker.
- Existing `resume`, `fit_analysis`, and `outreach_message` artifacts remain valid.
- `cover_letter` and `other` are already accepted artifact types.
- Existing archived and rejected records remain unchanged.
- The scheduler is external Codex automation state and can be disabled without changing repository data.
- The feature worktree and automated worktree environments do not receive or replace the ignored working database. Scheduled execution intentionally targets the saved local checkout.

## Rollback

- Disable or delete the daily Codex automation.
- Remove the `jobtracker_instance_id` metadata row only if database-instance verification is intentionally retired; ordinary rollback may leave the inert row in place.
- Remove the evaluator command, tests, and qualification script entry.
- Revert the three skill contract updates and reinstall personal skill copies if they were refreshed.
- Existing prepared `wishlist` opportunities and local dossiers remain valid user-owned records and files.
- No database rollback is required.

## Acceptance Criteria

1. The workflow runs once daily at 08:00 in `Etc/UTC` against the local JobTracker project.
2. Discovery uses public sources, prioritizes employer career pages, varies titles, and preserves management/technical-leadership seniority.
3. Readiness and private resume access are verified before any candidate mutation.
4. Closed, incomplete, junior, geographically incompatible, and clearly blocker-qualified postings are excluded before scoring.
5. The evaluator rejects malformed assessments and accepts only fixed category totals summing to 100.
6. Direct evidence receives full credit, adjacent evidence half credit, and unsupported evidence zero credit.
7. Eligibility is true only for an open posting with overall score at least 80, mandatory match at least 80, seniority match at least 75, and no blocker.
8. Boundary tests prove that 79 fails and 80 passes only when every independent gate also passes.
9. No tracker mutation or material generation occurs before parsed evaluator output reports `eligible: true`.
10. Automated intake uses a dry run first, never uses `--reactivate`, and leaves passing jobs in `wishlist`.
11. A read-only dossier command proves registered artifact and file completeness before an unchanged candidate is skipped; incomplete dossiers repair only missing or invalid materials without overwriting unrelated files.
12. Every completed dossier contains a tailored resume with local PDF snapshot, scored fit analysis, cover letter, outreach draft, and manual submission guide.
13. Every local artifact exists and is a regular file before registration; the registration command rejects invalid paths before database mutation and registers valid files to the verified opportunity ID with the exact readiness database path.
14. The submission guide identifies attachments, supported answers, unresolved human questions, exact manual steps, and the no-submit boundary.
15. Sub-80, blocked, rejected, and archived candidates are not added or reactivated in the active review queue.
16. Candidate failures are isolated and accurately reported; incomplete dossiers are never described as submission-ready.
17. No skill instruction authorizes credentials, private sharing, uploads, form submission, attestations, or final application submission.
18. Codex and Claude skill mirrors remain byte-identical after installation refresh.
19. Focused evaluator and workflow contract tests, `npm run verify`, `npm run build`, `git diff --check`, and privacy/status checks pass.
20. A created daily automation can be viewed and its returned configuration confirms the expected project, enabled status, cadence, and prompt safety contract.
21. The automation uses `executionEnvironment=local`, runs readiness from the saved local JobTracker project, and passes the returned absolute `database.path` explicitly to every database command; it never creates or selects a worktree, temporary, fixture, or fallback database.
22. Localhost port 3000 availability does not alter database selection: an unavailable UI does not trigger a second server or database, and an available UI reflects the same working records after scheduled writes.
23. Deployment initializes one immutable database instance ID in the existing live tracker; every scheduled run verifies file existence, regular-file status, required columns/primary keys/foreign keys/artifact uniqueness/named indexes, and exact identity before automated intake. Missing, replaced, or named-table lookalike databases fail without creation or migration.
24. A six-hour lock stored in the verified database prevents overlapping scheduled executions; simultaneous acquisition, transaction-safe expiry takeover and release/acquire, token mismatch, and release behavior are tested.
25. Guarded real upserts atomically compare expected new/existing identity, status, and version before any mutation; guarded artifact registration atomically requires `wishlist`, so concurrent reject/archive actions remain authoritative.
26. Temporary-fixture scenario tests exercise `skip_ineligible`, `skip_inactive`, `skip_complete`, `repair_dossier`, `prepare_dossier`, real missing-only dossier commit with valid-file preservation, compare-and-set race failure, overlap prevention, and rejection of submission-style input.
27. Scheduler deployment looks up the stable name/project key, updates an existing matching automation or creates one only when absent, recovers from ambiguous failures by re-reading state, and leaves exactly one enabled matching daily automation.
28. A fresh `sol-final-reviewer` examines the complete branch plus sanitized post-deployment evidence—including database identity verification, installed-skill equality, and exact-one automation state—before the native goal is completed.

## Verification Commands

```bash
npm test -- scripts/evaluate-job-match.test.ts scripts/jobtracker-database-identity.test.ts scripts/daily-job-prep-lock.test.ts scripts/inspect-job-dossier.test.ts scripts/commit-job-dossier.test.ts scripts/prepare-qualified-job.test.ts scripts/application-workflow-contract.test.ts scripts/upsert-job-posting.test.ts scripts/register-application-artifact.test.ts scripts/install-skills.test.ts
npm run verify
npm run build
diff -qr skills .claude/skills
node scripts/check-application-readiness.mjs
git diff --check
git status --short
```

Mandatory evaluator checks include:

- An 80-point candidate with mandatory and seniority gates passing is eligible.
- A 79-point candidate is ineligible.
- An 80-point candidate with mandatory match below 80 is ineligible.
- An 80-point candidate with seniority match below 75 is ineligible.
- A blocker makes an otherwise high-scoring candidate ineligible.
- Adjacent evidence contributes exactly half of its criterion weight.
- Missing mandatory criteria, incorrect group totals, unsupported group names, and malformed evidence fail validation.
- Exact `79.5` remains ineligible even though ordinary integer rounding would produce `80`.

Mandatory workflow checks include:

- Readiness before discovery mutation.
- Score before dry-run or real intake.
- Dry-run before real intake.
- Read-only dossier inspection before unchanged-candidate skipping.
- No `--reactivate` in automated mode.
- Intake verification before dossier creation.
- All five dossier outputs and their registration types.
- Snapshot before resume registration.
- `Needs Your Answer` and manual-submit language.
- No application submission or authenticated job-site action.

## Material Decisions and Tradeoffs

- Strengthen the existing agent workflow instead of building a first-party job crawler. This preserves the local-first architecture and uses Codex's current public-web capability while keeping discovery replaceable.
- Add an executable scoring gate rather than rely on prose alone. Agent judgment still classifies evidence, but fixed weights, deterministic math, independent gates, and a machine-enforced mutation boundary make the decision auditable.
- Keep the existing Wishlist pipeline instead of adding a new candidate queue. The current UI already provides the required review, rejection, archive, source, and artifact surfaces.
- Prepare a full dossier only after eligibility. This spends document-generation effort only on jobs that pass every gate.
- Treat employer pages as authoritative and fail closed on ambiguity. This reduces false positives at the cost of skipping some potentially viable but unverifiable postings.
- Use a conservative geographic default derived from the verified resume and never assume relocation or work authorization.
- Bind automation to a stable database UUID instead of path text alone. This adds one inert metadata row but prevents a missing database from being silently recreated at the configured path and detects replacement with a different tracker instance.
- Combine a bounded transactionally managed database lock with compare-and-set checks. SQLite serialization prevents stale takeover/release races and overlapping scheduled runs; the status/version checks keep user reject/archive actions authoritative even if they race with a running automation.
- Put automated intake branching in an executable coordinator while leaving web discovery and document prose agent-driven. This makes mutation ordering and repeat-run behavior testable without building a crawler or document-generation service.
- Call artifact registration as an imported function and reconcile the exact row after ambiguous exceptions. This avoids deleting a file whose database registration actually committed while preserving cleanup for proven pre-commit failures.
- Keep scheduling in Codex automation state rather than repository cron configuration. This avoids credentials, daemons, and host-specific scheduler code in the project.
- Target the saved local checkout rather than an automation worktree. This intentionally shares the user's current ignored SQLite/application state with the daily run while implementation remains isolated in its feature worktree.

## Open Decisions

No blocking design decisions remain. The user can later change the daily time, geographic policy, or discovery sources without changing the scoring and submission-safety contracts.
