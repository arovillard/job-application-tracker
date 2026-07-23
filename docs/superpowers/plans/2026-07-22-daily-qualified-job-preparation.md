# Daily Qualified Job Preparation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an auditable 80% qualification gate and complete-dossier workflow, then schedule it once daily against the user's existing local JobTracker database without ever submitting an application.

**Architecture:** Keep discovery and document authoring agent-driven, but put the eligibility calculation and dossier-completeness decision behind deterministic local commands. The repository skills coordinate readiness, score-before-mutation ordering, duplicate handling, and five required artifacts; a local Codex automation invokes those source skills from the saved project checkout and passes the exact paths returned by readiness to every command.

**Tech Stack:** Node.js ESM CLIs, TypeScript/Vitest subprocess tests, SQLite via `better-sqlite3`, Markdown skill contracts, existing Next.js JobTracker, and local Codex automation state.

## Global Constraints

- The authoritative behavior is `docs/specs/daily-qualified-job-preparation.md`.
- Eligibility requires exact `overallScore >= 80`, `mandatoryMatch >= 80`, `seniorityMatch >= 75`, `posting.state = "open"`, and zero non-negotiable blockers.
- Evidence credit is fixed: `direct = 100%`, `adjacent = 50%`, and `unsupported = 0%` of criterion weight.
- Category weights are fixed at 50 required qualifications, 20 seniority/leadership, 15 technical/domain, 10 product/delivery/customer, and 5 logistics/employment.
- The score command is the mutation boundary: no dry-run intake, real intake, or material generation may occur before parsed output reports `eligible: true`.
- Deployment initializes one immutable `jobtracker_instance_id` in the existing working database; scheduled runs verify that exact UUID, existing regular-file status, and tracker schema before intake and never initialize or create a database.
- A six-hour lock row managed with SQLite `BEGIN IMMEDIATE` transactions prevents overlapping scheduled runs and stale takeover/release races; automated mutations additionally use transactional ID/status/version compare-and-set checks so user reject/archive actions remain authoritative.
- Every scheduled database operation uses the exact absolute `database.path` returned by readiness in the saved project checkout; every material operation uses the exact absolute `applicationsDirectory.path`.
- Scheduled work never selects a worktree, temporary, fixture, default, or fallback database and never starts another local server.
- Automated intake always runs `--dry-run` before a real upsert, never passes `--reactivate`, and never restores rejected or archived records.
- A complete dossier requires a local resume snapshot, fit analysis, cover letter, outreach draft, and `Submission Guide`; every registered path must exist and be a regular file.
- The master resume remains private, read-only, and unchanged.
- The workflow must not sign in, use credentials, upload files, fill authenticated forms, accept attestations, solve CAPTCHAs, send messages, or submit applications.
- Generated materials and the live database remain ignored and uncommitted.

## File Map, Task IDs, and Dependency Waves

| Wave | Task ID | Risk | Outcome | Exclusive write set | Depends on |
|---|---|---:|---|---|---|
| 1 | `MATCH-001` | Medium | Deterministic JSON qualification evaluator and focused package command | `scripts/evaluate-job-match.mjs`, `scripts/evaluate-job-match.test.ts`, `package.json` | None |
| 2 | `GUARD-002` | High | Structural current-schema validation, existing-database identity verification, and bounded overlap lock | `scripts/lib/current-opportunity-schema.mjs`, `scripts/lib/jobtracker-database-identity.mjs`, `scripts/jobtracker-database-identity.mjs`, `scripts/jobtracker-database-identity.test.ts`, `scripts/lib/daily-job-prep-lock.mjs`, `scripts/daily-job-prep-lock.mjs`, `scripts/daily-job-prep-lock.test.ts` | `MATCH-001` |
| 3 | `DOSSIER-003` | High | Read-only guarded dossier inspection, fail-closed artifact registration, and no-overwrite missing-file commit | `scripts/inspect-job-dossier.mjs`, `scripts/inspect-job-dossier.test.ts`, `scripts/register-application-artifact.mjs`, `scripts/register-application-artifact.test.ts`, `scripts/commit-job-dossier.mjs`, `scripts/commit-job-dossier.test.ts` | `GUARD-002` |
| 4 | `INTAKE-004` | High | Executable score-first automated intake, dry-run decisions, and compare-and-set writes | `scripts/prepare-qualified-job.mjs`, `scripts/prepare-qualified-job.test.ts`, `scripts/upsert-job-posting.mjs`, `scripts/upsert-job-posting.test.ts` | `MATCH-001`, `GUARD-002`, `DOSSIER-003` |
| 5 | `WORKFLOW-005` | High | Coordinator, intake, and materials skills bind to the executable gate and five-output dossier | `skills/job-application-workflow/SKILL.md`, `skills/job-tracker-add-posting/SKILL.md`, `skills/job-application-resume/SKILL.md`, `.claude/skills/job-application-workflow/SKILL.md`, `.claude/skills/job-tracker-add-posting/SKILL.md`, `.claude/skills/job-application-resume/SKILL.md`, `scripts/application-workflow-contract.test.ts`, `scripts/install-skills.test.ts` | `INTAKE-004` |
| 6 | `DEPLOY-006` | High | Merge verified code, initialize/verify the live DB identity, refresh the three installed application skills, and update-or-create exactly one daily automation | External Codex automation state, one live `schema_metadata` row, and three personal installed skill copies only; no repository source edits | `WORKFLOW-005` |

Implementation workers run serially so each review observes an immutable earlier wave. Each repository task receives a fresh `terra-worker` and then a fresh `sol-reviewer`; the final branch receives a fresh `sol-final-reviewer`.

Before Task 1 dispatch, the root controller owns and commits the reviewed specification, this plan, and `docs/goals/daily-qualified-job-preparation.md` in one documentation commit. Workers never edit those controller artifacts. That commit makes the implementation base and clean-worktree expectation unambiguous.

---

### Task 1 (`MATCH-001`): Deterministic Qualification Evaluator

**Risk:** Medium. The command is new and isolated, but it is the eligibility/mutation boundary.

**Spec contracts:** Qualification Assessment Input; Deterministic Qualification Gate; acceptance criteria 5–9.

**Files:**
- Create: `scripts/evaluate-job-match.mjs`
- Create: `scripts/evaluate-job-match.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes JSON from a file or stdin through the required `--input-json <path|->` option.
- Input root: `{ schemaVersion: 1, posting, groups, blockers }`.
- `posting`: `{ url, organization, role, source, state, location, evaluatedAt }`; all fields except `location` are non-empty strings, and `state` is one of `open`, `closed`, `unknown`.
- `groups`: exactly one object for each category name. Each group is `{ name, criteria }`; each criterion is `{ id, requirement, mandatory, evidence, evidenceText, rationale, weight }`.
- Criterion `weight` is a positive integer. Criteria in each category sum to that category's fixed integer weight.
- `evidence` is exactly `direct`, `adjacent`, or `unsupported`. `direct` and `adjacent` require non-empty `evidenceText`; all criteria require non-empty `id`, `requirement`, and `rationale`; `mandatory` is a boolean.
- `blockers`: an array of `{ code, requirement, evidence }` with non-empty strings.
- Produces one JSON document: `{ schemaVersion: 1, overallScore, mandatoryMatch, seniorityMatch, eligible, reasons, categoryScores }`.
- Exports `evaluateJobMatch(input)` for the automated intake coordinator; importing the module does not execute the CLI. The export applies the same validation and returns the same object written by the CLI.
- `reasons` contains stable `{ code, message }` entries in gate order: `posting_not_open`, `overall_below_threshold`, `mandatory_below_threshold`, `seniority_below_threshold`, `non_negotiable_blocker`.
- `categoryScores` is keyed by the five category names and each value is `{ available, earned }` with display numbers to one decimal.
- Invalid input writes a concise validation message to stderr, exits 1, and writes no JSON to stdout.

- [ ] **Step 1: Write the subprocess test harness and the passing-threshold fixture**

Create `scripts/evaluate-job-match.test.ts` with a subprocess helper that pipes JSON to stdin and parses stdout:

```ts
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(__dirname, "..");
const categoryWeights = {
  required_qualifications: 50,
  seniority_leadership: 20,
  technical_domain: 15,
  product_delivery_customer: 10,
  logistics_employment: 5
} as const;

function criterion(id: string, weight: number, evidence = "direct", mandatory = false) {
  return {
    id,
    requirement: `${id} requirement`,
    mandatory,
    evidence,
    evidenceText: evidence === "unsupported" ? "" : `${id} verified evidence`,
    rationale: `${id} rationale`,
    weight
  };
}

function assessment() {
  return {
    schemaVersion: 1,
    posting: {
      url: "https://example.com/jobs/engineering-manager",
      organization: "Example Co",
      role: "Engineering Manager",
      source: "Example careers",
      state: "open",
      location: "Remote — Example Country",
      evaluatedAt: "2026-07-22T16:00:00.000Z"
    },
    groups: Object.entries(categoryWeights).map(([name, weight]) => ({
      name,
      criteria: [criterion(`${name}-1`, weight, "direct", name === "required_qualifications")]
    })),
    blockers: []
  };
}

function run(input: unknown) {
  return spawnSync(process.execPath, ["scripts/evaluate-job-match.mjs", "--input-json", "-"], {
    cwd: projectRoot,
    encoding: "utf8",
    input: JSON.stringify(input)
  });
}
```

Add a test that changes required qualifications to direct 40/unsupported 10, changes product/delivery/customer to unsupported 10, and expects exactly:

```ts
{
  schemaVersion: 1,
  overallScore: 80,
  mandatoryMatch: 80,
  seniorityMatch: 100,
  eligible: true,
  reasons: [],
  categoryScores: {
    required_qualifications: { available: 50, earned: 40 },
    seniority_leadership: { available: 20, earned: 20 },
    technical_domain: { available: 15, earned: 15 },
    product_delivery_customer: { available: 10, earned: 0 },
    logistics_employment: { available: 5, earned: 5 }
  }
}
```

- [ ] **Step 2: Add all independent gate and validation tests**

Use fresh `assessment()` values in each test and cover these exact cases:

```ts
it.each([
  ["closed", "posting_not_open"],
  ["unknown", "posting_not_open"]
])("rejects posting state %s", (state, code) => { /* set state; expect eligible false and code */ });

it("rejects an exact 79 score while independent mandatory and seniority gates pass", () => {
  // required: mandatory direct 40 + non-mandatory unsupported 10;
  // technical: non-mandatory direct 14 + unsupported 1; product unsupported 10;
  // seniority and logistics direct.
  // overall 79, mandatoryMatch 100, seniorityMatch 100.
});

it("keeps an exact 79.5 score below the overall threshold", () => {
  // required: direct 29 + adjacent 21 = 39.5; product: unsupported 10;
  // every other group direct = 40; exact total = 79.5.
});

it("rejects an 80-or-higher overall score when mandatory match is below 80", () => {
  // required: non-mandatory direct 40 + mandatory unsupported 10; all other groups direct.
});

it("rejects an 80-or-higher overall score when seniority is below 75", () => {
  // seniority: direct 14 + unsupported 6; all other groups direct; expect seniorityMatch 70.
});

it("rejects an otherwise perfect assessment with a non-negotiable blocker", () => { /* one blocker */ });
it("awards adjacent evidence exactly half credit", () => { /* technical: adjacent 15 => 7.5 */ });
it("rounds display scores to one decimal without changing exact gate comparisons", () => { /* use adjacent odd weights */ });
```

Add table-driven invalid-input cases and assert exit 1, empty stdout, and a matching stderr fragment:

```ts
[
  ["unsupported schema version", input => input.schemaVersion = 2, /schemaVersion/i],
  ["missing category", input => input.groups.pop(), /exactly the required categories/i],
  ["unknown category", input => input.groups[0].name = "culture_fit", /unknown category/i],
  ["duplicate category", input => input.groups[1].name = input.groups[0].name, /duplicate category/i],
  ["wrong category total", input => input.groups[0].criteria[0].weight = 49, /must sum to 50/i],
  ["fractional criterion weight", input => input.groups[0].criteria[0].weight = 49.5, /positive integer/i],
  ["unknown evidence", input => input.groups[0].criteria[0].evidence = "likely", /evidence/i],
  ["credited evidence without text", input => input.groups[0].criteria[0].evidenceText = "", /evidenceText/i],
  ["non-boolean mandatory", input => input.groups[0].criteria[0].mandatory = "yes", /mandatory/i],
  ["no mandatory criteria", input => input.groups.flatMap(g => g.criteria).forEach(c => c.mandatory = false), /mandatory criterion/i],
  ["malformed blocker", input => input.blockers = [{ code: "", requirement: "x", evidence: "y" }], /blocker/i]
]
```

- [ ] **Step 3: Run the focused test and confirm RED**

Run:

```bash
npm test -- scripts/evaluate-job-match.test.ts
```

Expected: FAIL because `scripts/evaluate-job-match.mjs` does not exist.

- [ ] **Step 4: Implement the minimal evaluator CLI**

Implement these constants and pure calculation rules in `scripts/evaluate-job-match.mjs`:

```js
const SCHEMA_VERSION = 1;
const CATEGORY_WEIGHTS = new Map([
  ["required_qualifications", 50],
  ["seniority_leadership", 20],
  ["technical_domain", 15],
  ["product_delivery_customer", 10],
  ["logistics_employment", 5]
]);
const CREDIT = { direct: 1, adjacent: 0.5, unsupported: 0 };
const display = value => Number(value.toFixed(1));
```

Parse only `--input-json <path|->`, reject missing/extra arguments, read stdin when the value is `-`, and parse JSON. Validate the complete interface above before scoring. Compute every earned amount in half-point units so comparisons are exact:

```js
const earnedHalfUnits = criterion.weight * 2 * CREDIT[criterion.evidence];
const overallHalfUnits = criteria.reduce((sum, criterion) => sum + earnedHalfUnits(criterion), 0);
const mandatoryAvailableHalfUnits = mandatory.reduce((sum, criterion) => sum + criterion.weight * 2, 0);
const mandatoryEarnedHalfUnits = mandatory.reduce((sum, criterion) => sum + earnedHalfUnits(criterion), 0);
const overallExact = overallHalfUnits / 2;
const mandatoryExact = mandatoryEarnedHalfUnits * 100 / mandatoryAvailableHalfUnits;
const seniorityExact = seniorityEarnedHalfUnits * 100 / (20 * 2);
```

Export the pure `evaluateJobMatch(input)` function and guard CLI execution with an `import.meta.url`/resolved-entrypoint check so imports do not read process arguments. Build reasons in the documented stable order, using exact values for all comparisons and `display(...)` only in output/messages. `eligible` is `reasons.length === 0`. Catch all errors at the executable boundary, print only the message to stderr, and set exit code 1.

- [ ] **Step 5: Add the focused package command**

Add this key to `package.json` without changing dependency versions:

```json
"job:score": "node scripts/evaluate-job-match.mjs"
```

- [ ] **Step 6: Run GREEN and regression checks**

Run:

```bash
npm test -- scripts/evaluate-job-match.test.ts
npm run job:score -- --input-json /path/that/does/not/exist
git diff --check
```

Expected: the Vitest file passes; the direct CLI check exits 1 with a concise missing-file error; `git diff --check` is silent.

- [ ] **Step 7: Commit the task**

```bash
git add package.json scripts/evaluate-job-match.mjs scripts/evaluate-job-match.test.ts
git commit -m "feat: add deterministic job match evaluator"
```

**Task evidence:** Preserve the RED and GREEN command/output summaries for the reviewer. The reviewer checks exact threshold math, validation fail-closed behavior, stable reason ordering, and absence of tracker/material writes.

---

### Task 2 (`GUARD-002`): Live Database Identity and Run Lock

**Risk:** High. This task creates the fail-closed identity boundary for the existing working database and the overlap guard used by all scheduled mutations.

**Spec contracts:** Daily Discovery live-database binding; failure behavior for missing/replaced databases and lock conflicts; acceptance criteria 21–25.

**Files:**
- Create: `scripts/lib/current-opportunity-schema.mjs`
- Create: `scripts/lib/jobtracker-database-identity.mjs`
- Create: `scripts/jobtracker-database-identity.mjs`
- Create: `scripts/jobtracker-database-identity.test.ts`
- Create: `scripts/lib/daily-job-prep-lock.mjs`
- Create: `scripts/daily-job-prep-lock.mjs`
- Create: `scripts/daily-job-prep-lock.test.ts`

**Interfaces:**
- `assertCurrentOpportunitySchema(db)` is the authoritative read-only structural validator. It rejects missing/extra required-table columns, wrong declared column types, missing primary keys, wrong/missing foreign keys or delete actions, a missing unique artifact `(opportunity_id,type,file_path)` index, and missing required named indexes.
- Required tables are `opportunities`, `job_opportunity_details`, `connection_opportunity_details`, `opportunity_activities`, `opportunity_tasks`, `opportunity_artifacts`, and `schema_metadata`. Exact column order/types/nullability/defaults/primary-key flags come from `scripts/lib/opportunity-schema.mjs` and are encoded once in the validator rather than duplicated by consumers.
- Required foreign keys are: `opportunities.origin_opportunity_id → opportunities.id ON DELETE SET NULL`; each job/connection/activity/task/artifact `opportunity_id → opportunities.id ON DELETE CASCADE`; and `opportunity_tasks.source_activity_id → opportunity_activities.id ON DELETE SET NULL`.
- Required named indexes are `opportunities_status_idx`, `opportunities_updated_at_idx`, `opportunity_activities_opportunity_occurred_idx`, `opportunity_tasks_opportunity_state_idx`, and `opportunity_artifacts_opportunity_updated_idx`, with exact indexed columns/order. `opportunity_artifacts` must also have a unique index over `(opportunity_id, type, file_path)` regardless of SQLite's autoindex name.
- `initializeDatabaseIdentity(databasePath)` and `verifyDatabaseIdentity(databasePath, expectedId)` reject non-absolute paths, missing/non-file paths, malformed SQLite, and any failure from `assertCurrentOpportunitySchema(db)`.

Encode table columns once with tuples `[name, declaredType, notNull, defaultValue, primaryKeyPosition]` matching SQLite PRAGMA output:

```js
export const CURRENT_TABLES = {
  opportunities: [
    ["id", "TEXT", 0, null, 1], ["type", "TEXT", 1, null, 0],
    ["label", "TEXT", 1, null, 0], ["organization", "TEXT", 0, null, 0],
    ["status", "TEXT", 1, null, 0], ["priority", "TEXT", 1, "'medium'", 0],
    ["summary", "TEXT", 0, null, 0], ["origin_opportunity_id", "TEXT", 0, null, 0],
    ["created_at", "TEXT", 1, null, 0], ["updated_at", "TEXT", 1, null, 0]
  ],
  job_opportunity_details: [
    ["opportunity_id", "TEXT", 0, null, 1], ["url", "TEXT", 0, null, 0],
    ["source", "TEXT", 0, null, 0], ["location", "TEXT", 0, null, 0],
    ["contact", "TEXT", 0, null, 0], ["applied_date", "TEXT", 0, null, 0]
  ],
  connection_opportunity_details: [
    ["opportunity_id", "TEXT", 0, null, 1], ["role_context", "TEXT", 0, null, 0],
    ["contact_info", "TEXT", 0, null, 0], ["meeting_context", "TEXT", 0, null, 0],
    ["relationship_strength", "TEXT", 1, "'new'", 0]
  ],
  opportunity_activities: [
    ["id", "TEXT", 0, null, 1], ["opportunity_id", "TEXT", 1, null, 0],
    ["type", "TEXT", 1, null, 0], ["body", "TEXT", 1, null, 0],
    ["metadata_json", "TEXT", 0, null, 0], ["occurred_at", "TEXT", 1, null, 0],
    ["created_at", "TEXT", 1, null, 0]
  ],
  opportunity_tasks: [
    ["id", "TEXT", 0, null, 1], ["opportunity_id", "TEXT", 1, null, 0],
    ["title", "TEXT", 1, null, 0], ["due_date", "TEXT", 0, null, 0],
    ["state", "TEXT", 1, null, 0], ["source_activity_id", "TEXT", 0, null, 0],
    ["completed_at", "TEXT", 0, null, 0], ["created_at", "TEXT", 1, null, 0],
    ["updated_at", "TEXT", 1, null, 0]
  ],
  opportunity_artifacts: [
    ["id", "TEXT", 0, null, 1], ["opportunity_id", "TEXT", 1, null, 0],
    ["type", "TEXT", 1, null, 0], ["title", "TEXT", 1, null, 0],
    ["file_path", "TEXT", 1, null, 0], ["content_type", "TEXT", 1, "'text/markdown'", 0],
    ["created_at", "TEXT", 1, null, 0], ["updated_at", "TEXT", 1, null, 0]
  ],
  schema_metadata: [
    ["key", "TEXT", 0, null, 1], ["value", "TEXT", 1, null, 0]
  ]
};
```

Use `PRAGMA index_xinfo` for named-index column order and descending flags: `opportunities_status_idx(status ASC)`, `opportunities_updated_at_idx(updated_at DESC)`, `opportunity_activities_opportunity_occurred_idx(opportunity_id ASC, occurred_at ASC)`, `opportunity_tasks_opportunity_state_idx(opportunity_id ASC, state ASC)`, and `opportunity_artifacts_opportunity_updated_idx(opportunity_id ASC, updated_at DESC)`.
- Initialization uses `new Database(databasePath, { fileMustExist: true })`, inserts `schema_metadata(key='jobtracker_instance_id', value=<uuid>)` only when absent, never replaces a value, and returns `{ schemaVersion: 1, action: 'initialized'|'existing', databasePath, instanceId }`.
- Verification uses `{ readonly: true, fileMustExist: true }`, validates UUID format and exact match, performs no write, and returns `{ schemaVersion: 1, action: 'verified', databasePath, instanceId }`.
- CLI forms are `jobtracker-database-identity.mjs initialize --db PATH` and `jobtracker-database-identity.mjs verify --db PATH --expected-id UUID`; scheduled work uses only `verify`.
- The lock is the `schema_metadata` row whose key is exactly `daily_job_prep_lock`; its JSON value is `{ schemaVersion: 1, token, acquiredAt, expiresAt }` with a fixed six-hour TTL. No lock file exists.
- `acquireDailyJobPrepLock(databasePath, now?)`, `verifyDailyJobPrepLock(databasePathOrOpenDb, token, now?)`, and `releaseDailyJobPrepLock(databasePath, token)` require the existing database and tracker schema. The verify helper accepts an already-open SQLite connection so a guarded mutation can check lock ownership inside its own transaction without opening a second connection.
- Acquire opens with `fileMustExist`, uses `BEGIN IMMEDIATE`, reads/validates the row, inserts when absent, rejects an unexpired owner, or replaces an expired value within the same transaction. Concurrent contenders serialize; after the first commit the second sees the new unexpired owner and fails.
- Verify opens read-only and requires exact token plus `expiresAt > now`. Release uses `BEGIN IMMEDIATE`, deletes only when the row in that transaction still has the matching token, and otherwise fails without deletion. A successor cannot acquire until the release transaction commits, eliminating check/unlink races.
- CLI forms are `daily-job-prep-lock.mjs acquire|verify|release --db PATH [--token TOKEN]` and emit schema-v1 JSON.

- [ ] **Step 1: Write failing database-identity tests**

Create `scripts/jobtracker-database-identity.test.ts` with temporary paths and a helper that creates exactly the required tables. Add these tests:

```ts
it("initializes one stable UUID only in an existing valid tracker database", () => {
  // Run initialize twice; expect first action initialized, second existing,
  // the same UUID both times, and exactly one metadata row.
});
it("verifies the exact initialized identity read-only", () => {
  // Capture database bytes and mtime before verify and compare afterward.
});
it("rejects a missing database without creating it", () => { /* file remains absent */ });
it("rejects a directory path", () => { /* /regular file/i */ });
it("rejects a valid SQLite file without tracker tables", () => { /* /required table/i */ });
it.each([
  "missing required column",
  "wrong declared column type or primary key",
  "wrong foreign-key target or delete action",
  "missing artifact uniqueness index",
  "missing or wrong-column named index",
  "wrong ASC/DESC direction on a named index"
])("rejects a named-table lookalike with %s before identity mutation", defect => {
  // Build/corrupt a structural fixture, snapshot schema_metadata, initialize/verify,
  // and expect failure with no jobtracker_instance_id or other mutation.
});
it("rejects a tracker database without an initialized identity in verify mode", () => { /* /identity/i */ });
it("rejects a different expected UUID", () => { /* /does not match/i */ });
it("rejects a relative database path", () => { /* /absolute/i */ });
```

- [ ] **Step 2: Write failing overlap-lock tests**

Create `scripts/daily-job-prep-lock.test.ts` with a separate initialized temporary tracker database per test and an injectable clock at the library boundary. Cover:

```ts
it("allows one active token and rejects an overlapping acquire", () => { /* second exits 1 */ });
it("serializes two simultaneous contenders for an expired row so exactly one wins", async () => {
  // Seed an expired valid row, launch two acquire CLI processes concurrently,
  // expect one status 0, one status 1, and the row token equal to the winner.
});
it("verifies only the matching token and database path", () => { /* wrong token/path fail */ });
it("releases only the matching owner", () => { /* wrong token leaves row; owner removes */ });
it("serializes release and acquire without allowing the releaser to delete a successor", async () => {
  // Launch owner release and contender acquire concurrently. If acquire succeeds,
  // final row must contain exactly its new token; if it conflicts before release,
  // no successor existed and an absent final row is valid.
});
it("recovers one expired lock and issues a new token", () => { /* fixed clock */ });
it("keeps different database files isolated", () => { /* both acquire */ });
it("rejects a malformed lock row instead of replacing it", () => { /* fail closed */ });
```

- [ ] **Step 3: Run focused tests and confirm RED**

Run:

```bash
npm test -- scripts/jobtracker-database-identity.test.ts scripts/daily-job-prep-lock.test.ts
```

Expected: FAIL because both CLIs and libraries do not exist.

- [ ] **Step 4: Implement database identity validation and CLI**

Implement `assertCurrentOpportunitySchema(db)` in `scripts/lib/current-opportunity-schema.mjs` with `PRAGMA table_info`, `PRAGMA foreign_key_list`, `PRAGMA index_list`, and `PRAGMA index_xinfo`. Filter `index_xinfo` to key columns, then compare normalized exact column order and `desc` flags. Compare all structural descriptors and throw an error naming the first table/key/index mismatch. It performs no DDL/DML.

In `scripts/lib/jobtracker-database-identity.mjs`, validate with `lstatSync(...).isFile()` before opening SQLite and call `assertCurrentOpportunitySchema(db)` before any metadata read/write. In initialize mode, transactionally read the metadata key and insert `randomUUID()` only when absent; validate an existing value as a UUID. In verify mode, open read-only, require the row, validate both UUIDs, and compare exact lowercase values.

In `scripts/jobtracker-database-identity.mjs`, accept only the documented positional action/options, call the library, write one JSON result, and print concise errors to stderr with exit 1. Do not offer a default database path.

- [ ] **Step 5: Implement the lock library and CLI**

Use these fixed definitions:

```js
export const LOCK_TTL_MS = 6 * 60 * 60 * 1000;
export const LOCK_METADATA_KEY = "daily_job_prep_lock";
```

Write acquisition and release with explicit `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` on a `better-sqlite3` connection opened with `{ fileMustExist: true }`. Validate required tracker tables before touching metadata. Parse and validate an existing row; acquisition inserts/replaces only absent/expired valid state in its transaction. Verification uses a read-only connection. Release deletes only after reading a matching token in the same immediate transaction.

The CLI must require an absolute database path for all actions, require `--token` for verify/release, emit the full acquired result only to the local caller, and never write the token into repository files, tracker activities, or logs.

- [ ] **Step 6: Run GREEN and safety regressions**

Run:

```bash
npm test -- scripts/jobtracker-database-identity.test.ts scripts/daily-job-prep-lock.test.ts
npm test -- scripts/application-readiness.test.ts scripts/upsert-job-posting.test.ts
git diff --check
```

Expected: focused and related tests pass; identity verify-mode bytes/mtime remain unchanged; simultaneous lock tests prove exactly one owner and no lost successor row; diff check is silent.

- [ ] **Step 7: Commit the task**

```bash
git add scripts/lib/current-opportunity-schema.mjs scripts/lib/jobtracker-database-identity.mjs scripts/jobtracker-database-identity.mjs scripts/jobtracker-database-identity.test.ts scripts/lib/daily-job-prep-lock.mjs scripts/daily-job-prep-lock.mjs scripts/daily-job-prep-lock.test.ts
git commit -m "feat: guard the live job tracker database"
```

**Task evidence:** Preserve RED/GREEN output, database byte/mtime proof, simultaneous expired-acquire and release/acquire results, overlap rejection, and exact changed files. The reviewer checks no database creation, immutable identity, read-only verify, `BEGIN IMMEDIATE` stale/release safety, fail-closed malformed state, six-hour expiry, and token secrecy.

---

### Task 3 (`DOSSIER-003`): Dossier Inspection and Artifact-Path Safety

**Risk:** High. These commands inspect or mutate the user's tracker database, so invalid files must fail before schema or row mutation, inspection must be read-only, and automated mode must revalidate the active run and user-controlled status.

**Spec contracts:** Repeat-Run and Duplicate Controls; Complete Application Dossier; failure behavior; acceptance criteria 10–13, 15–16.

**Files:**
- Create: `scripts/inspect-job-dossier.mjs`
- Create: `scripts/inspect-job-dossier.test.ts`
- Create: `scripts/commit-job-dossier.mjs`
- Create: `scripts/commit-job-dossier.test.ts`
- Modify: `scripts/register-application-artifact.mjs`
- Modify: `scripts/register-application-artifact.test.ts`

**Interfaces:**
- Inspection requires exactly `--db /absolute/database/path --opportunity-id ID`.
- Automated inspection additionally accepts the required set `--lock-token TOKEN --expected-status wishlist --expected-updated-at ISO_TIMESTAMP`; supplying only part of this set is invalid. It verifies the active database-keyed lock before opening SQLite and returns an error unless status/version match in the same read snapshot.
- Inspection opens SQLite with `{ readonly: true, fileMustExist: true }`, executes no schema helper or migration, and never writes.
- Produces `{ schemaVersion: 1, opportunity, inactive, complete, tailoredResumeUrl, requirements }`.
- `tailoredResumeUrl` is `null` because the current schema stores only local artifact paths; the coordinating workflow carries any Google Docs URL separately.
- Requirements, in this order: `resume`/any title, `fit_analysis`/any title, `cover_letter`/any title, `outreach_message`/any title, and `other`/exact title `Submission Guide`.
- Each requirement is `{ key, type, requiredTitle, registered, artifact, absolutePath, exists, regularFile, valid }`. `artifact` is the newest valid candidate, or newest registered candidate when none is valid.
- A requirement is valid only if a matching registration exists, its stored path is absolute, the path exists, and it is a regular file. `complete` is true only when all five are valid.
- `inactive` is true for `archived` or `rejected`; completeness is still reported independently.
- Missing database, schema, opportunity, or non-job opportunity exits 1 with no mutation.
- Automated artifact registration additionally requires `--lock-token TOKEN --expected-status wishlist`; both options must appear together. It verifies the active lock, then rechecks the opportunity's current status inside the same transaction before the artifact write. A rejected/archived/status-mismatched record receives no artifact, opportunity timestamp, activity, or schema mutation.
- `register-application-artifact.mjs` exports `registerApplicationArtifact(options, dependencies?)` and does not execute its CLI when imported. Automated mode validates the already-current schema and never invokes schema creation or legacy migration helpers; manual mode preserves the existing migration behavior.
- `commit-job-dossier.mjs` requires `--db`, `--opportunity-id`, `--applications-dir`, `--lock-token`, `--expected-status wishlist`, `--expected-updated-at`, and `--manifest-json <path|->`.
- The manifest root is `{ schemaVersion: 1, entries }`; each entry is `{ key, stagedFile, destinationFile, contentType }`. Keys are limited to the five fixed requirements. Staged files must resolve under `<applications-dir>/.staging/`; destinations must be absolute, remain under the configured applications directory but outside `.staging`, and not exist. Symlinked sources/destinations that escape those roots are rejected.
- Commit runs a guarded dossier inspection first. A manifest entry for an already-valid requirement is rejected before any file/DB mutation. Every missing/invalid requirement needs exactly one valid staged entry; no extra/duplicate keys are accepted.
- For each required repair in stable requirement order, copy with `COPYFILE_EXCL` to prevent overwrite, register through the guarded imported function with the fixed type/title, reconcile the exact artifact row after any exception, and remove only the successfully committed staged source. A destination is removed only after reconciliation proves no row committed; earlier valid/committed outputs remain for a later repair.
- Commit calls the imported `registerApplicationArtifact` function. On any thrown/ambiguous result after invocation, it queries for the exact opportunity/type/title/destination artifact row before cleanup. If the row exists, retain the destination and treat the iteration as committed; if absent, remove only the destination this iteration created. Preflight rejects a destination path already referenced by any artifact row, so a row found after an exception proves this invocation committed.
- Commit reruns guarded inspection and returns success only with `complete: true`. It never authors document content or submits an application.

- [ ] **Step 1: Add failing artifact-path regression tests**

Extend `scripts/register-application-artifact.test.ts` with a helper that detects schema creation and two tests:

```ts
function tableExists(name: string) {
  const db = new Database(dbPath);
  try {
    return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
  } finally {
    db.close();
  }
}

it("rejects a missing artifact path before database mutation", () => {
  job();
  const result = spawnSync(process.execPath, [
    "scripts/register-application-artifact.mjs", "--db", dbPath,
    "--opportunity-id", "job-id", "--type", "resume", "--title", "Resume",
    "--file", path.join(tempDir, "missing.pdf")
  ], { cwd: path.resolve(__dirname, ".."), encoding: "utf8" });
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/artifact file not found/i);
  expect(tableExists("opportunity_artifacts")).toBe(false);
});

it("rejects a directory before database mutation", () => {
  job();
  const directory = path.join(tempDir, "resume.pdf");
  mkdirSync(directory);
  // Invoke as above; expect /regular file/i and no opportunity_artifacts table.
});
```

Add guarded registration cases using a real acquired temporary lock:

```ts
it("registers for the matching active lock and wishlist status", () => { /* expect registered */ });
it.each(["rejected", "archived"])("does not mutate a concurrently %s opportunity", status => {
  // Acquire, change the status before registration, invoke with expected wishlist,
  // then prove zero artifact rows, unchanged opportunity updated_at, byte-identical
  // sqlite_schema rows, and unchanged schema_metadata after the status change.
});
it("rejects a wrong or expired lock token before registration", () => { /* zero artifacts */ });
it("requires lock-token and expected-status together", () => { /* each partial form exits 1 */ });
it("does not run schema creation or legacy migration in automated mode", () => {
  // Use a legacy/incomplete fixture, expect a current-schema error and identical schema.
});
```

- [ ] **Step 2: Write real dossier commit/repair tests**

Create `scripts/commit-job-dossier.test.ts` using a temporary initialized tracker, applications directory, acquired lock, and real staged files. Register any pre-existing valid artifact through the normal command, then cover:

```ts
it("commits and registers five staged files for a new dossier", () => {
  // Expect five destination files, five registrations, staged sources removed,
  // and final inspector complete=true.
});
it("repairs only missing outputs and preserves valid files byte-for-byte", () => {
  // Pre-register valid resume/fit/outreach/submission guide, hash bytes+mtime,
  // stage only cover letter, commit, and prove all four originals unchanged.
});
it("rejects a manifest that attempts to replace an already-valid artifact before mutation", () => {
  // Hash DB/files and expect unchanged.
});
it("rejects missing staged files, duplicate/extra keys, escaped paths, symlink escapes, and existing destinations", () => {
  // Table-driven, no copy or registration.
});
it.each(["rejected", "archived"])("rolls back a newly copied file when status becomes %s before registration", status => {
  // Use a test hook immediately before guarded registration, change status,
  // expect created destination removed, staged source retained, zero new artifact.
});
it("leaves earlier successfully committed files valid when a later registration fails", () => {
  // Inject the status change before the second registration, expect first retained,
  // second destination removed, final complete=false for later repair.
});
it("retains a copied file when registration committed before an ambiguous exception", () => {
  // Inject a wrapper that calls the real imported registration and then throws.
  // Reconciliation must find the exact new row, retain the destination, remove the
  // staged source, and continue/finalize without a dangling artifact.
});
```

The test-only hook is an injected callback on the exported pure coordinator function; the CLI uses the default real dependency and exposes no hook option.

- [ ] **Step 3: Write the dossier-inspection tests**

Create `scripts/inspect-job-dossier.test.ts`. In `beforeEach`, call the existing `ensureOpportunitySchema` helper to create the complete current seven-table schema with all required foreign keys, uniqueness, and named indexes, then insert one `wishlist` job and create five real files. Invoke the new CLI via `spawnSync`. Malformed-lookalike cases start from that complete fixture and rebuild or corrupt exactly one structural descriptor while leaving the other required structures valid.

Add exact behavioral cases:

```ts
it("reports a complete five-file dossier without changing database bytes or mtime", () => {
  // Register resume, fit_analysis, cover_letter, outreach_message, and
  // type=other/title="Submission Guide" using absolute paths.
  // Capture statSync(dbPath).mtimeMs and readFileSync(dbPath) before invocation.
  // Expect complete true, inactive false, tailoredResumeUrl null, all valid true,
  // then compare bytes and mtime after invocation.
});

it("reports an unregistered requirement as incomplete", () => { /* omit cover_letter */ });
it("reports a registered missing file as invalid", () => { /* delete outreach file after insertion */ });
it("reports a relative registered path as invalid even when cwd could resolve it", () => { /* raw SQL relative path */ });
it.each(["rejected", "archived"])("reports %s as inactive without changing status", status => { /* expect inactive true */ });
it("chooses a valid older artifact when the newest matching registration is invalid", () => { /* two resume rows */ });
it("requires the exact Submission Guide title for the other artifact", () => { /* title Application Notes */ });
it("rejects a missing opportunity", () => { /* exit 1 */ });
it("rejects a connection opportunity", () => { /* exit 1 */ });
it("rejects a missing database without creating it", () => { /* file remains absent */ });
it("rejects a named-table lookalike through the shared structural validator", () => {
  // Give opportunities/artifacts the expected names but corrupt a required column,
  // foreign key, unique key, or index direction; expect exit 1 and unchanged schema.
});
it("accepts an exact guarded wishlist status/version snapshot", () => { /* active lock */ });
it("rejects a stale expected version after a concurrent status change", () => { /* read-only, no mutation */ });
it("rejects an expired or mismatched lock token", () => { /* no mutation */ });
```

- [ ] **Step 4: Run focused tests and confirm RED**

Run:

```bash
npm test -- scripts/register-application-artifact.test.ts scripts/inspect-job-dossier.test.ts scripts/commit-job-dossier.test.ts
```

Expected: new registration tests fail because missing/directory paths are accepted, and inspector/commit tests fail because the commands do not exist.

- [ ] **Step 5: Make artifact registration validate the local file before opening SQLite**

In `scripts/register-application-artifact.mjs`, import `statSync` and validate immediately after `path.resolve(...)`, before checking/opening the database:

```js
if (!existsSync(filePath)) throw new Error(`Artifact file not found: ${filePath}`);
let fileStat;
try {
  fileStat = statSync(filePath);
} catch (error) {
  throw new Error(`Artifact file could not be inspected: ${filePath}`);
}
if (!fileStat.isFile()) throw new Error(`Artifact path is not a regular file: ${filePath}`);
```

Do not change accepted artifact types, deduplication, legacy migration, output aliases, or successful registration output.

- [ ] **Step 6: Implement the read-only dossier inspector**

Use this fixed requirement definition:

```js
const REQUIREMENTS = [
  { key: "resume", type: "resume", requiredTitle: null },
  { key: "fit_analysis", type: "fit_analysis", requiredTitle: null },
  { key: "cover_letter", type: "cover_letter", requiredTitle: null },
  { key: "outreach_message", type: "outreach_message", requiredTitle: null },
  { key: "submission_guide", type: "other", requiredTitle: "Submission Guide" }
];
```

Validate the exact CLI options and absolute database path. When guard options are supplied, call `verifyDailyJobPrepLock(databasePath, token)` before opening, then open:

```js
const db = new Database(databasePath, { readonly: true, fileMustExist: true });
```

Call shared `assertCurrentOpportunitySchema(db)` immediately after opening; do not replace it with table-name checks and do not call `ensureOpportunitySchema` or `migrateLegacyApplications`. Load the opportunity, require `type === "job"`, and load artifacts ordered by `updated_at DESC, created_at DESC, id DESC`.

For each requirement, filter by type and exact required title when present, assess each candidate without throwing on inaccessible paths, select the first valid candidate or first registered candidate, and return:

```js
{
  key,
  type,
  requiredTitle,
  registered: candidates.length > 0,
  artifact: selected ? {
    id: selected.id,
    title: selected.title,
    filePath: selected.file_path,
    contentType: selected.content_type,
    updatedAt: selected.updated_at
  } : null,
  absolutePath: selected ? path.isAbsolute(selected.file_path) : false,
  exists: selectedAssessment.exists,
  regularFile: selectedAssessment.regularFile,
  valid: selectedAssessment.valid
}
```

When expected status/version are supplied, compare them against the loaded opportunity in this read snapshot before assessing artifacts. Include `updatedAt` in the returned opportunity. Catch executable errors, write one message to stderr, and exit 1. Close the database in `finally`.

Refactor artifact registration into exported `registerApplicationArtifact(options, dependencies?)` plus a guarded CLI entrypoint. For automated options, validate the already-current required tables/index/metadata shape without calling `ensureOpportunitySchema` or `migrateLegacyApplications`; inside the existing transaction verify the run lock through the already-open database connection, reload the opportunity, and require its current status to equal the expected status before inserting/updating the artifact or opportunity timestamp. Manual mode retains the current schema/migration calls and output aliases.

- [ ] **Step 7: Implement no-overwrite dossier commit**

Export `commitJobDossier(options, dependencies = realDependencies)` and guard CLI execution so tests can inject the one pre-registration race callback without exposing it as a CLI option. Parse and validate the exact interface before mutation. Use `realpathSync` on existing staged inputs and nearest existing destination parents to enforce applications/staging boundaries without following an escaping symlink.

Call the inspector with exact status/version/lock preconditions, compute only invalid requirements, and validate the complete manifest before the first copy. Use:

```js
copyFileSync(stagedFile, destinationFile, constants.COPYFILE_EXCL);
```

Then invoke the imported guarded registration function with the requirement's fixed mapping. If it throws, query the exact artifact identity using a fresh read-only connection. A matching row means commit occurred: retain the destination, remove the staged source, refresh `updated_at`, and continue. No matching row means proven pre-commit failure: remove only `destinationFile` created by this iteration, retain the staged source, and stop. Do not remove a pre-existing file or an earlier successfully registered output. Refresh expected `updated_at` after each committed registration because registration updates the opportunity timestamp. Finish with guarded inspection and require `complete === true`.

- [ ] **Step 8: Run GREEN and database-safety checks**

Run:

```bash
npm test -- scripts/register-application-artifact.test.ts scripts/inspect-job-dossier.test.ts scripts/commit-job-dossier.test.ts
npm test -- scripts/daily-job-prep-lock.test.ts
npm test -- scripts/upsert-job-posting.test.ts scripts/backfill-application-artifacts.test.ts
git diff --check
```

Expected: all focused and related regression tests pass and `git diff --check` is silent.

- [ ] **Step 9: Commit the task**

```bash
git add scripts/inspect-job-dossier.mjs scripts/inspect-job-dossier.test.ts scripts/commit-job-dossier.mjs scripts/commit-job-dossier.test.ts scripts/register-application-artifact.mjs scripts/register-application-artifact.test.ts
git commit -m "feat: validate application dossier completeness"
```

**Task evidence:** Preserve RED/GREEN summaries, read-only bytes/mtime assertion, real repair hashes, collision/path rejection, and guarded inactive/status-version failures. The reviewer checks fail-before-mutation ordering, non-writing inspection, exact five requirements, executable missing-only repair, no-overwrite copy, rollback of only newly created files, active-lock enforcement, and transaction-local status checks.

---

### Task 4 (`INTAKE-004`): Executable Score-First Automated Intake

**Risk:** High. This task owns the scheduled mutation boundary and must preserve manual upsert compatibility while preventing sub-threshold, inactive, raced, or overlapping automated writes.

**Spec contracts:** Deterministic Qualification Gate; Repeat-Run and Duplicate Controls; Executable Automated Intake Decisions; acceptance criteria 8–11, 15–16, 23–26.

**Files:**
- Create: `scripts/prepare-qualified-job.mjs`
- Create: `scripts/prepare-qualified-job.test.ts`
- Modify: `scripts/upsert-job-posting.mjs`
- Modify: `scripts/upsert-job-posting.test.ts`

**Interfaces:**
- `prepare-qualified-job.mjs` requires `--db ABSOLUTE_PATH --expected-database-id UUID --lock-token TOKEN --input-json <path|->` and accepts no other options.
- Input has exactly `{ assessment, posting }`. `posting` is limited to the existing upsert allowlist (`company`, `role`, `url`, `source`, `location`, `contact`, `summary`, `note`, `posting_state`); company/role/url and required `posting_state` must exactly match the assessment organization/role/url/state after whitespace trimming and URL normalization through `new URL(...)` with the fragment removed. Unknown root or posting keys, including submit/apply/credentials fields, are invalid.
- The command verifies database identity and lock, calls imported `evaluateJobMatch(assessment)`, and returns `skip_ineligible` before any posting command unless `eligible === true`.
- For eligible candidates it invokes the upsert CLI with the same JSON/database/lock and `--dry-run --automation-mode`, parses the result, then follows exactly one decision: `skip_inactive`, `skip_complete`, `repair_dossier`, or guarded real upsert followed by `prepare_dossier`.
- Automated dry-run output adds `precondition: { existed, opportunityId, status, updatedAt }` without changing the six-key output of existing manual mode.
- Automated real upsert requires the active lock token and either `--expect-new` or all of `--expected-opportunity-id ID --expected-status STATUS --expected-updated-at ISO`. Inside the same SQLite transaction, before any update/activity/task, it repeats duplicate lookup and requires the supplied condition. Current rejected/archived state always aborts.
- Automated upsert mode requires the current tracker schema already exists and never calls schema creation or legacy migration helpers. Manual mode retains existing initialization/migration compatibility.
- `prepare-qualified-job` returns `{ schemaVersion: 1, decision, evaluation, opportunity, dossier, preparationPrecondition }`; fields not applicable to a skip decision are `null`. `preparationPrecondition` is `{ opportunityId, status: 'wishlist', updatedAt }` and is consumed immediately before materials.
- The coordinator creates no application files and exposes no submit/send/authenticated action.

- [ ] **Step 1: Add failing automated upsert compare-and-set tests**

Extend `scripts/upsert-job-posting.test.ts` with a helper that acquires a temporary run lock and invokes automated flags. Keep all existing manual-mode assertions unchanged. Add:

```ts
it("returns an existing pre-mutation snapshot from automated dry-run", () => {
  // Create a wishlist job manually, capture its current updated_at, dry-run automated,
  // and expect existed=true plus exact id/status/updatedAt while live bytes remain unchanged.
});
it("creates only when expect-new is still true", () => {
  // Dry-run new, insert a duplicate before real call, expect conflict and one row total.
});
it("updates only the exact existing id/status/version", () => {
  // Matching CAS succeeds; each mismatched field fails in independent fixtures.
});
it.each(["rejected", "archived"])("never mutates an automated %s duplicate", status => {
  // Dry-run may report it; real call fails with unchanged details, updated_at,
  // activity count, task count, artifact count, sqlite_schema, and schema_metadata.
});
it("rejects automated mode without a valid active lock", () => { /* no mutation */ });
it("rejects an incomplete or legacy schema in automated mode without migrating it", () => { /* schema byte-for-byte */ });
it("preserves the canonical six manual output keys", () => { /* existing compatibility */ });
```

- [ ] **Step 2: Write failing temporary-fixture intake scenarios**

Create `scripts/prepare-qualified-job.test.ts` using a separate temporary SQLite database, transactional metadata lock row, and applications directory for every test. Initialize the tracker identity through the new command and acquire the lock. Build assessments from the evaluator fixture and posting JSON from matching facts.

Cover the complete branch behavior:

```ts
it("returns skip_ineligible before dry-run and leaves tracker state unchanged", () => {
  // Use a valid identity database schema, snapshot activities/opportunities,
  // submit an exact-79 assessment, expect no row/content mutation.
});
it.each(["rejected", "archived"])("returns skip_inactive without touching a %s record", status => {
  // Prove details, updated_at, activities, tasks, artifacts, and application files unchanged.
});
it("returns skip_complete for an unchanged valid five-file dossier", () => {
  // Register five absolute files, hash each plus database bytes/mtime, expect no changes.
});
it("returns repair_dossier for an unchanged incomplete dossier and preserves valid files", () => {
  // Omit cover letter, expect no upsert note/timestamp/file change and a wishlist
  // preparationPrecondition identifying only an incomplete dossier. Actual missing-only
  // file commit/preservation is exercised by commit-job-dossier.test.ts.
});
it("returns prepare_dossier and creates one wishlist row for a new eligible posting", () => {
  // Expect verified organization/role/url, action/activity ids, and precondition.
});
it("returns prepare_dossier through guarded CAS for a materially changed active posting", () => {
  // URL/location change and exact old version; one note only.
});
it("fails without mutation when the live database identity differs", () => { /* mismatch */ });
it("fails without mutation when the run token is wrong or expired", () => { /* lock */ });
it("rejects posting facts that differ from the assessed opportunity", () => { /* no dry-run */ });
it("rejects evaluated open with intake closed or unknown before dry-run", () => {
  // Preserve all rows/schema/metadata and expect a posting-state mismatch error.
});
it("rejects submit-style input or CLI options before mutation", () => {
  // root submit:true and --submit each exit 1; no rows/files change.
});
```

- [ ] **Step 3: Run focused tests and confirm RED**

Run:

```bash
npm test -- scripts/upsert-job-posting.test.ts scripts/prepare-qualified-job.test.ts
```

Expected: compare-and-set/automated-output tests fail and the coordinator module is missing.

- [ ] **Step 4: Add automated-mode dry-run snapshots and transactional preconditions**

Refactor argument parsing in `scripts/upsert-job-posting.mjs` only enough to support boolean `--dry-run`, `--automation-mode`, and `--expect-new` plus valued automated options. Manual invocations must preserve defaults and output.

When `--automation-mode` is present:

1. Require `--lock-token`, validate the already-current schema without creation/migration, and validate the token against the exact `--db` database.
2. Capture the duplicate's original ID/status/updated_at before applying dry-run changes and add the documented `precondition` only to automated output.
3. For non-dry-run, require `expect-new` or the complete expected-existing tuple.
4. After `BEGIN` and duplicate lookup but before any helper that writes, compare the current snapshot. For expected-existing, require exact ID/status/updated_at and reject inactive status. For expect-new, require no duplicate.
5. Throw on conflict so the existing rollback path leaves all rows untouched.

- [ ] **Step 5: Implement the automated decision coordinator**

Use direct imports for `evaluateJobMatch`, `verifyDatabaseIdentity`, and `verifyDailyJobPrepLock`. Use `spawnSync(process.execPath, ...)` for upsert and dossier CLIs so their executable contracts are exercised. Pass posting JSON through stdin and parse stdout only on exit 0.

Decision algorithm:

```text
validate exact input and posting/assessment organization, role, canonical URL, and state identity
verify database UUID and active run token
evaluate assessment
if ineligible → skip_ineligible
automated upsert --dry-run
if existing rejected/archived → skip_inactive
if existing → read-only dossier inspection
if no posting changes and dossier complete → skip_complete
if no posting changes and dossier incomplete → repair_dossier with current precondition
if new → guarded real upsert --expect-new → prepare_dossier
if changed active → guarded real upsert with exact dry-run precondition → prepare_dossier
```

For real-upsert results, use the committed opportunity's returned `updatedAt` as the material precondition. For repair, use the inspector's current status/version. Never create the applications directory, generate a file, invoke a browser, or accept a submission option.

- [ ] **Step 6: Run GREEN, race, and compatibility checks**

Run:

```bash
npm test -- scripts/upsert-job-posting.test.ts scripts/prepare-qualified-job.test.ts
npm test -- scripts/evaluate-job-match.test.ts scripts/jobtracker-database-identity.test.ts scripts/daily-job-prep-lock.test.ts scripts/inspect-job-dossier.test.ts scripts/commit-job-dossier.test.ts scripts/register-application-artifact.test.ts
git diff --check
```

Expected: all tests pass, manual output compatibility remains, temporary files/DBs are cleaned, and diff check is silent.

- [ ] **Step 7: Commit the task**

```bash
git add scripts/prepare-qualified-job.mjs scripts/prepare-qualified-job.test.ts scripts/upsert-job-posting.mjs scripts/upsert-job-posting.test.ts
git commit -m "feat: enforce score-first automated job intake"
```

**Task evidence:** Preserve RED/GREEN output, exact-79 no-mutation proof, inactive full-row/activity proof, complete-skip no-change proof, CAS race output, lock failure, submit-option rejection, and manual compatibility. The real repair/preservation evidence belongs to reviewed `DOSSIER-003` rather than this decision-only command.

---

### Task 5 (`WORKFLOW-005`): Daily Workflow and Complete-Dossier Skill Contracts

**Risk:** High. These instructions control external research and writes to the live tracker/materials directories.

**Spec contracts:** Daily Discovery; Pre-Score Exclusions; scoring mutation boundary; Repeat-Run and Duplicate Controls; Executable Automated Intake Decisions; Complete Application Dossier; Tracker Review Workflow; Daily Run Summary; Security and Privacy; acceptance criteria 1–4, 9–18, and 21–27.

**Files:**
- Modify: `skills/job-application-workflow/SKILL.md`
- Modify: `skills/job-tracker-add-posting/SKILL.md`
- Modify: `skills/job-application-resume/SKILL.md`
- Modify: `.claude/skills/job-application-workflow/SKILL.md`
- Modify: `.claude/skills/job-tracker-add-posting/SKILL.md`
- Modify: `.claude/skills/job-application-resume/SKILL.md`
- Modify: `scripts/application-workflow-contract.test.ts`
- Modify: `scripts/install-skills.test.ts`

**Interfaces:**
- The repository `skills/**` files are authoritative; `.claude/skills/**` are byte-identical generated mirrors.
- Daily mode starts in the saved local project root, parses readiness, and carries its exact `projectRoot`, `database.path`, and `applicationsDirectory.path` for the complete run.
- Coordinator order is readiness → database identity verify → run lock acquire → public discovery/pre-score exclusions → executable `prepare-qualified-job` decision → guarded material precondition/work → summary → lock release in `finally`.
- The posting skill routes automated candidates through the executable coordinator; it never performs an unguarded real upsert or makes its own optimistic eligibility decision.
- The resume skill accepts the verified opportunity ID plus the assessment and eligible evaluator result, uses the score matrix in fit analysis, creates/registers all five local outputs, and leaves unknown answers to the human.

- [ ] **Step 1: Add failing coordinator ordering and safety assertions**

Extend `scripts/application-workflow-contract.test.ts` with ordered-token helpers:

```ts
function expectInOrder(content: string, tokens: string[]) {
  let cursor = -1;
  for (const token of tokens) {
    const next = content.indexOf(token, cursor + 1);
    expect(next, `missing or out-of-order token: ${token}`).toBeGreaterThan(cursor);
    cursor = next;
  }
}
```

Add tests requiring the coordinator to contain and order these exact command fragments:

```ts
expectInOrder(workflow, [
  "check-application-readiness.mjs",
  "jobtracker-database-identity.mjs verify",
  "daily-job-prep-lock.mjs acquire",
  "public discovery",
  "prepare-qualified-job.mjs",
  "job-application-resume",
  "daily-job-prep-lock.mjs release"
]);
```

Add assertions for:

```ts
for (const required of [
  "08:00 <configured-timezone>",
  "executionEnvironment=local",
  "saved local project checkout",
  "database.path",
  "jobtracker_instance_id",
  "six-hour",
  "applicationsDirectory.path",
  "never start a second server",
  "employer career page",
  "overallScore >= 80",
  "mandatoryMatch >= 80",
  "seniorityMatch >= 75",
  "eligible: true",
  "skip_ineligible",
  "skip_inactive",
  "skip_complete",
  "repair_dossier",
  "prepare_dossier",
  "never pass `--reactivate`",
  "rejected or archived",
  "wishlist",
  "Needs Your Answer",
  "never submit"
]) expect(workflow).toContain(required);
```

Require all five artifact type/title contracts across the coordinator and resume skill, and assert that score-before-mutation language says intake and materials are forbidden until the executable coordinator returns an eligible `repair_dossier` or `prepare_dossier` decision. Require a `finally` release instruction and a stop-on-identity/lock-failure instruction.

- [ ] **Step 2: Add failing posting and materials assertions**

In the same test file, require `postingSkill` to contain:

```ts
for (const required of [
  "automated discovery mode",
  "prepare-qualified-job.mjs",
  "expected-database-id",
  "lock-token",
  "transactional precondition",
  "never pass `--reactivate`",
  "skip rejected or archived",
  "preserve existing valid files",
  "wishlist"
]) expect(postingSkill).toContain(required);
```

Require `resumeSkill` to contain:

```ts
for (const required of [
  "overallScore",
  "mandatoryMatch",
  "seniorityMatch",
  "criterion-by-criterion evidence matrix",
  "cover_letter",
  "outreach_message",
  "Submission Guide",
  "--type other",
  "Needs Your Answer",
  "local PDF snapshot",
  "expected-status wishlist",
  "expected-updated-at",
  "lock-token",
  "commit-job-dossier.mjs",
  ".staging",
  "preserve every already-valid artifact",
  "user—not the automation—must review and submit"
]) expect(resumeSkill).toContain(required);
```

Also assert that the resume's company-neutral rule remains, the existing ordered fit-analysis headings remain, and no skill contains authorization to sign in, upload, attest, or submit.

- [ ] **Step 3: Strengthen mirror packaging assertions**

Extend `scripts/install-skills.test.ts` so the `job-application-workflow` source and mirror both include database identity, lock acquire/release, executable coordinator, live-path, and no-submit tokens, and the `job-application-resume` pair both include guarded preconditions, all five dossier outputs, and `Needs Your Answer`. Keep the existing recursive file-list and byte-equality checks unchanged.

- [ ] **Step 4: Run focused contract tests and confirm RED**

Run:

```bash
npm test -- scripts/application-workflow-contract.test.ts scripts/install-skills.test.ts
```

Expected: FAIL on the new identity, lock, executable coordinator, guarded material, complete-dossier, and scheduled-mode tokens.

- [ ] **Step 5: Update the source coordinator**

Add a `## Daily Qualified Discovery Mode` section to `skills/job-application-workflow/SKILL.md` with these executable phases:

1. Run only as local automation at the privately configured time from the saved local project checkout; never use a feature worktree.
2. Parse readiness and bind every `--db` and `--applications-dir` from the returned paths; lack of localhost port 3000 does not authorize a new server or fallback database.
3. Verify the deployment-provided `jobtracker_instance_id` with `jobtracker-database-identity.mjs verify`; never initialize during a scheduled run.
4. Acquire one six-hour run lock, retain its token locally, require it for all automated commands, and release it in `finally` even when a candidate fails.
5. Discover only complete public postings; prioritize employer pages; use the private confirmed target/seniority/location policies; enforce the pre-score exclusions.
6. Construct `{ assessment, posting }` and invoke `prepare-qualified-job.mjs` with the exact database, expected database identity, and lock token. That command owns evaluator-before-dry-run and guarded real intake.
7. Stop for `skip_ineligible`, `skip_inactive`, or `skip_complete`; invoke the resume skill only for `repair_dossier` or `prepare_dossier` with the returned exact material precondition.
8. Produce the counts and per-candidate summary required by the spec without reproducing private resume content, then release the lock.

Integrate the same deterministic evaluator gate into the existing supplied-link path before its intake step. Preserve current manual readiness/database behavior for ordinary one-off requests; scheduled database identity and run-lock prerequisites apply only to Daily Qualified Discovery Mode. Keep the exact no-link ready sentence and exact successful next-link sentence unchanged and unique.

- [ ] **Step 6: Update automated posting intake**

Add an `## Automated Discovery Mode` section to `skills/job-tracker-add-posting/SKILL.md` that routes automated work through:

```text
same canonical assessment/posting + exact readiness database.path
    → prepare-qualified-job.mjs with expected database UUID + active lock token
    → executable evaluator before any posting command
    → automated dry-run + duplicate/dossier decision
    → transactional expect-new or exact ID/status/version real write when needed
    → no real write for inactive, unchanged-complete, or unchanged-incomplete
    → return verified wishlist identity and material precondition only for prepare/repair
```

Remove `--reactivate` from the default example. Retain support in the underlying CLI for explicitly requested manual reactivation, but state that automation never passes it and never restores a rejected or archived record.

- [ ] **Step 7: Update the complete dossier workflow**

Revise `skills/job-application-resume/SKILL.md` so material work requires the score input/output and creates these role-slugged files under the exact applications directory:

```text
<role-slug>-resume.pdf
<role-slug>-fit-analysis.md
<role-slug>-cover-letter.md
<role-slug>-outreach-message.md
<role-slug>-submission-guide.md
```

The fit analysis retains its existing headings and adds overall/mandatory/seniority scores plus the criterion-by-criterion evidence matrix. The submission guide contains canonical URL/status, upload-field mapping, manual steps ending before final submission, supported suggested answers, qualification caveats, an attachment checklist, and a separate `Needs Your Answer` section. Require registration as:

```bash
--type resume --title "Tailored Resume"
--type fit_analysis --title "Fit Analysis"
--type cover_letter --title "Cover Letter"
--type outreach_message --title "Outreach Message"
--type other --title "Submission Guide"
```

Immediately before creating files, require a guarded `inspect-job-dossier.mjs` call with the returned `lock-token`, `expected-status wishlist`, and `expected-updated-at`. Preserve every already-valid artifact and generate only invalid/missing outputs into `<applications-dir>/.staging/<run-token>/...`. Pass an exact missing-only manifest to `commit-job-dossier.mjs`; do not copy or register automated outputs directly. Parse the commit response and final guarded inspection. Completion is allowed only when it returns `complete: true`. Preserve the company-neutral resume rule and explicitly state that the user—not the automation—must review and submit.

- [ ] **Step 8: Regenerate exact Claude mirrors**

Mechanically copy each final source skill file to its matching repository mirror without changing content:

```bash
cp skills/job-application-workflow/SKILL.md .claude/skills/job-application-workflow/SKILL.md
cp skills/job-tracker-add-posting/SKILL.md .claude/skills/job-tracker-add-posting/SKILL.md
cp skills/job-application-resume/SKILL.md .claude/skills/job-application-resume/SKILL.md
```

These exact, resolved file targets are the only generated repository files changed in this step.

- [ ] **Step 9: Run GREEN and contract regression checks**

Run:

```bash
npm test -- scripts/application-workflow-contract.test.ts scripts/install-skills.test.ts
diff -qr skills .claude/skills
npm test -- scripts/evaluate-job-match.test.ts scripts/jobtracker-database-identity.test.ts scripts/daily-job-prep-lock.test.ts scripts/inspect-job-dossier.test.ts scripts/commit-job-dossier.test.ts scripts/prepare-qualified-job.test.ts scripts/upsert-job-posting.test.ts scripts/register-application-artifact.test.ts
git diff --check
```

Expected: all tests pass, `diff -qr` and `git diff --check` are silent, and the two exact completion sentences still satisfy their existing uniqueness tests.

- [ ] **Step 10: Commit the task**

```bash
git add skills/job-application-workflow/SKILL.md skills/job-tracker-add-posting/SKILL.md skills/job-application-resume/SKILL.md .claude/skills/job-application-workflow/SKILL.md .claude/skills/job-tracker-add-posting/SKILL.md .claude/skills/job-application-resume/SKILL.md scripts/application-workflow-contract.test.ts scripts/install-skills.test.ts
git commit -m "feat: enforce qualified daily application workflow"
```

**Task evidence:** Preserve RED/GREEN output, mirror diff result, and a token-order summary. The reviewer checks exact path/identity propagation, lock lifecycle, executable score-before-mutation routing, no automatic reactivation, guarded material preconditions, complete dossier semantics, manual-answer separation, and non-submission language.

---

### Task 6 (`DEPLOY-006`): Saved-Checkout Integration and Daily Automation

**Risk:** High. This step changes the repository used by the live app, refreshes personal skill copies, and creates recurring automation state. It must not write a test or sample opportunity to the live database.

**Spec contracts:** Daily Discovery schedule; live-database identity and overlap binding; Tracker Review Workflow; Daily Run Summary; Security and Privacy; acceptance criteria 1, 19–27.

**Files/state:**
- Merge the reviewed feature branch into the saved checkout returned by the existing local Codex JobTracker project after confirming that checkout has no overlapping user changes.
- Initialize one identity row in the already-existing verified live database and retain the returned UUID only in external automation/controller state.
- Refresh the three personal Codex/Claude application-skill copies from the merged saved checkout after inventorying the exact source/targets.
- Update or create exactly one Codex automation attached to that existing project with `executionEnvironment=local`.
- Do not add a cron file, daemon, service, alternative database, test opportunity, or generated dossier to the repository.

**Interfaces:**
- Automation name: `Daily qualified job preparation`.
- Stable automation key: exact name `Daily qualified job preparation` plus the existing local JobTracker `projectId` returned by the app.
- Project root: the absolute `projectRoot` returned by readiness from that same existing Codex project; no personal path is committed in this plan.
- Cadence: daily at `08:00`, timezone `<configured-timezone>`.
- Status: enabled/active.
- Execution: local, against the saved checkout.
- Model/reasoning: `gpt-5.6-sol` with `high` reasoning for qualification and document judgment.
- Prompt: the template in Step 7 below, with the deployment database UUID interpolated only into external automation state.
- Controller capability preflight has confirmed both required app tools are exposed in the primary runtime: `codex_app__list_projects({})` returns project IDs, and `codex_app__automation_update(...)` supports `view`, local cron create/update with project/model/reasoning/recurrence/status/prompt fields, and `delete`. These controller-only tools are not delegated to implementation or review subagents.

- [ ] **Step 1: Run full branch verification before integration**

From the feature worktree:

```bash
npm test -- scripts/evaluate-job-match.test.ts scripts/jobtracker-database-identity.test.ts scripts/daily-job-prep-lock.test.ts scripts/inspect-job-dossier.test.ts scripts/commit-job-dossier.test.ts scripts/prepare-qualified-job.test.ts scripts/application-workflow-contract.test.ts scripts/upsert-job-posting.test.ts scripts/register-application-artifact.test.ts scripts/install-skills.test.ts
npm run verify
npm run build
diff -qr skills .claude/skills
git diff --check
git status --short
```

Expected: tests, lint, typecheck, and build pass; both diff checks are silent; the worktree is clean after committed implementation.

- [ ] **Step 2: Obtain pre-deployment branch review**

Dispatch a fresh `sol-reviewer` with the spec, implementation plan, complete branch diff, test evidence, privacy constraints, and live-database deployment contract. Resolve any blocking findings and repeat the relevant verification before proceeding. This is the code-readiness gate, not the final whole-goal review.

- [ ] **Step 3: Integrate without overwriting user work**

Resolve the saved checkout from the existing Codex JobTracker project and confirm readiness returns that same absolute `projectRoot`. From that resolved root, verify status first. If clean and still on the expected base branch, merge `codex/daily-job-prep-automation` with a non-interactive merge. If unrelated user changes exist, preserve them and stop only if they overlap this branch's exact write set.

After integration, run:

```bash
npm run verify
npm run build
node scripts/check-application-readiness.mjs
git diff --check
```

Parse readiness and confirm:

- `projectRoot` is exactly the saved checkout.
- `database.path` is the same working SQLite database already configured for the tracker.
- `applicationsDirectory.path` is the same ignored working applications directory.
- The master resume remains configured and unmodified.

- [ ] **Step 4: Initialize and verify the existing live database identity**

Using the exact readiness `database.path`, first confirm the file exists, is a regular file, is Git-ignored, and can be opened read-only with the existing tracker tables. Assign that parsed absolute value to the task-specific shell variable `READINESS_DATABASE_PATH`. Then run exactly once:

```bash
node scripts/jobtracker-database-identity.mjs initialize --db "$READINESS_DATABASE_PATH"
```

Capture the returned `instanceId` as controller variable `databaseIdentity.instanceId` and assign that exact value to the task-specific shell variable `DATABASE_INSTANCE_ID`; do not commit it or print database contents. Immediately verify:

```bash
node scripts/jobtracker-database-identity.mjs verify --db "$READINESS_DATABASE_PATH" --expected-id "$DATABASE_INSTANCE_ID"
```

Expected: initialize reports `initialized` or `existing`, verify reports `verified`, both paths equal readiness exactly, and the UUIDs match. Do not proceed if the file/schema/identity check fails.

- [ ] **Step 5: Refresh exactly the installed application skills**

Inventory repository skill directories before replacement and confirm the set is exactly `job-application-resume`, `job-application-workflow`, and `job-tracker-add-posting`. Inventory the corresponding personal Codex and Claude targets, then run from the resolved saved checkout:

```bash
npm run skills:install
```

Then recursively compare every source skill directory in that inventory to both installed targets. Because the repository source set contains exactly those three application skills, this verifies the complete destructive-copy scope rather than a subset. This refresh does not expose private files or change the tracker database.

- [ ] **Step 6: Reconcile the stable automation key before mutation**

Use the Codex app's automation interface, not a cron file or hand-written directive:

1. Resolve the existing local JobTracker `projectId` with `codex_app__list_projects({})` and require exactly one returned project whose root equals readiness `projectRoot`.
2. Inspect the local automation registry and collect entries whose exact name is `Daily qualified job preparation` and whose project ID is that resolved ID.
3. View every match through `codex_app__automation_update` with `mode="view"`.
4. If there is one match, retain its ID for a full update.
5. If there are multiple matches from a prior ambiguous attempt, retain the lexicographically smallest ID as the stable keeper and delete only the other exact name/project duplicates through `mode="delete"` before updating the keeper.
6. If there is no match, create one. If creation returns an ambiguous error, do not retry immediately: repeat steps 2–3 and create only when the registry still proves absence.

This reconciliation is idempotent: every retry converges to exactly one matching automation rather than adding another daily run.

- [ ] **Step 7: Update or create the local daily automation with this prompt template**

Call the selected provider's local scheduler update capability with the retained ID or create mode when absent. Supply the exact name, saved project, local execution, active status, and the privately configured schedule. The prompt is provider-neutral and contains no personal values, machine paths, database identity, or notification preferences.

```text
Use the repository's job-application-workflow skill in Daily Qualified Discovery Mode. Begin with node scripts/check-daily-discovery-readiness.mjs --include-private-config and follow the repository coordinator exactly. Use only the returned existing database and ignored applications directory, prepare only eligible dossiers, and never submit an application.
```

- [ ] **Step 8: Verify exactly one returned automation and live-data safety**

View the created automation and confirm its returned configuration shows:

- name `Daily qualified job preparation`;
- the existing local JobTracker project;
- enabled/active status;
- local execution;
- daily 08:00 `<configured-timezone>` cadence;
- the complete prompt safety contract above.
- exactly one enabled registry entry with the stable exact name/project key and no duplicate matching entry.

If the update/create response is ambiguous, re-read the registry and view matches before retrying. Resolve extras through the same deterministic keeper rule, then view the final keeper again.

Do not force-run the automation as a deployment test because that could discover and write real eligible opportunities. Use only read-only live checks: readiness, database path identity, Git-ignore status for database/materials, and—when an existing job ID is available—dossier inspection. Port 3000 may remain offline.

- [ ] **Step 9: Obtain post-deployment final acceptance review**

Write a sanitized deployment-evidence report in the controller-owned orchestration directory outside the repository. Include:

- merge/commit identities and clean saved-checkout status;
- full test, lint, typecheck, build, mirror-diff, and diff-check results;
- readiness project/database/applications path identity as pass/fail assertions without the paths;
- database identity initialize/verify action and equality as pass/fail without the UUID;
- exact three-skill installed/source comparisons;
- automation tool call outcomes, final automation ID, enabled/local/project/cadence/model checks, duplicate-match count exactly one, and prompt-safety token checks;
- confirmation that no discovery run, sample live opportunity, document submission, authenticated action, or master-resume edit occurred.

Generate the final whole-branch review package from merge base through the deployed commit. Dispatch a fresh `sol-final-reviewer` with the approved spec/plan, review package, task reports/reviews, and sanitized deployment-evidence path. The reviewer must assess both code and completed deployment acceptance. Resolve any blocking finding; if a code fix is required, implement/review/merge it and repeat affected deployment checks. Do not complete the native goal until this post-deployment review is approved.

- [ ] **Step 10: Record final evidence and handoff**

Record the one automation ID, schedule, project identity, readiness-confirmed live database identity verification (without printing the private path, UUID, lock token, or DB contents), full test/build results, post-deployment final review result, commit/merge identity, and that no application was submitted. Tell the user that new eligible dossiers will appear in Wishlist for manual review and that rejected/archived records remain untouched.

---

## Plan Self-Review

- **Spec coverage:** `MATCH-001` covers the executable schema, weights, evidence credit, exact 79/79.5/80 boundaries, rounding, and fail-closed validation. `GUARD-002` covers existing-database identity and overlap prevention. `DOSSIER-003` covers read-only dossier proof and guarded registration. `INTAKE-004` behaviorally covers score-first branching, inactive/complete/repair cases, compare-and-set races, and submit-option rejection. `WORKFLOW-005` covers discovery, guarded ordering, five materials, manual answers, summaries, and non-submission. `DEPLOY-006` covers saved-checkout integration, identity initialization, exact skill-refresh scope, idempotent scheduler reconciliation, and non-mutating deployment verification.
- **Placeholder scan:** Every code-changing step names exact files, interfaces, commands, expected failure/pass behavior, and concrete assertions or implementation rules. No deferred implementation markers remain.
- **Type consistency:** Category names, assessment properties, reason shapes, artifact types/titles, and live-path field names match across tasks and the specification.
- **Privacy check:** The plan never commits a personal path, database UUID, lock token, private resume content, database content, or generated application file. Machine-specific project, database, and applications paths plus the database UUID are resolved only at deployment and retained in ignored/external state.
