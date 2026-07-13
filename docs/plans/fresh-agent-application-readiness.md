# Fresh-Agent Application Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every fresh Codex or Claude application-intent session verify user readiness, prefer a protected Google Docs master resume, and preserve tracker-before-materials ordering.

**Architecture:** A shared Node library owns `.env.local` parsing, allowlisted updates, and local readiness evaluation. Thin JSON CLIs expose the contract to a coordinating skill. Google Docs access remains a host-agent probe; tailored Docs receive a local registered snapshot so the SQLite artifact model remains unchanged.

**Tech Stack:** Node.js ESM scripts, Vitest, Markdown skills, YAML agent metadata, Next.js repository conventions.

## Global Constraints

- Trigger only on application intent; never interrupt unrelated repository development.
- Never submit applications, use credentials, make a Google Doc public, or modify the master resume.
- Require a resume for tailored materials; treat the public profile as recommended and nonblocking.
- Prefer Google Doc, then DOCX, PDF, and Markdown/text; warn about PDF formatting reliability.
- Keep `.env.local` private and preserve existing `JOBTRACKER_BASE_RESUME_PATH` installations.
- Complete verified tracker intake before material generation.
- Register a Google Docs resume only after a local PDF or DOCX snapshot exists.
- Do not add a database migration or remote artifact URL contract.

## Task Map

| ID | Outcome | Wave | Dependencies | Write set | Risk / review |
|---|---|---:|---|---|---|
| AR-1 | Configuration/readiness library and CLIs | 1 | None | Readiness scripts/tests, `.env.example`, `package.json` | High; immediate review |
| AR-2 | Setup wizard prefers Google Docs | 2 | AR-1 | `setup-user.mjs` and its test | Medium; review after focused test |
| AR-3 | Coordinator skill and fresh-session routing | 2 | AR-1 | Skills, root agent files, install test | Medium; review after focused test |
| AR-4 | Nontechnical docs | 3 | AR-2, AR-3 | `README.md`, `docs/agent-setup.md` | Low; wave review |
| AR-5 | Integrated acceptance | 4 | AR-1–AR-4 | No planned writes | Medium; final review |

AR-2 and AR-3 may run concurrently because their write sets are disjoint. All other work is serialized.

---

### AR-1: Configuration and Readiness Contract

**Outcome:** Add machine-readable commands that safely persist application references and report local readiness without leaking contents or credentials.

**Relevant spec:** Two-Stage Readiness; Resume Source Policy; Safe Configuration; Security and Privacy.

**Dependencies / wave:** None; wave 1.

**Risk:** High. Review before any dependent task because this writes private configuration references and defines a shared JSON contract.

**Files:**

- Create: `scripts/lib/application-readiness.mjs`
- Create: `scripts/check-application-readiness.mjs`
- Create: `scripts/configure-application-profile.mjs`
- Create: `scripts/application-readiness.test.ts`
- Create: `scripts/configure-application-profile.test.ts`
- Modify: `.env.example`
- Modify: `package.json`

**Interfaces:**

- `readApplicationConfig(projectRoot, processEnv): ApplicationConfig`
- `evaluateApplicationReadiness({ projectRoot, processEnv, codexHome, claudeHome }): ReadinessResult`
- `updateApplicationConfig(projectRoot, input): RedactedConfigSummary` is the restricted agent-facing writer.
- `updateSetupConfig(projectRoot, input): RedactedConfigSummary` is the trusted setup-only writer and may additionally update database path and provider note.
- `node scripts/check-application-readiness.mjs [--project-root PATH]`
- `node scripts/configure-application-profile.mjs [--project-root PATH] --input-json FILE_OR_DASH`
- JSON output uses `schemaVersion: 1` and the exact fields in the specification.

- [ ] **Step 1: Write failing readiness tests**

Create temporary-project tests covering missing resume, optional profile, explicit status mapping, Google URL precedence, DOCX, PDF warning, text, missing file, unsupported extension, process-env override, writable destinations, repository skills, unignored repository-local source/output paths, isolated personal skill homes, and redacted output. Use this core shape:

```ts
it("blocks without a resume but only warns without a profile", () => {
  const result = evaluateApplicationReadiness({ projectRoot: root, processEnv: {} });
  expect(result).toMatchObject({ schemaVersion: 1, status: "needs_input" });
  expect(result.resume.kind).toBe("none");
  expect(result.blockingIssues).toContain("resume_missing");
  expect(result.warnings).toContain("profile_missing");
});

it("prefers Google Docs and requires a host access check", () => {
  writeFileSync(path.join(root, ".env.local"), [
    'JOBTRACKER_BASE_RESUME_URL="https://docs.google.com/document/d/document-id/edit"',
    'JOBTRACKER_BASE_RESUME_PATH="/tmp/older.docx"'
  ].join("\n"));
  const result = evaluateApplicationReadiness({ projectRoot: root, processEnv: {} });
  expect(result.resume).toMatchObject({
    kind: "google_doc",
    locallyValid: true,
    requiresExternalAccessCheck: true
  });
  expect(result.warnings).toContain("multiple_resume_sources");
});
```

- [ ] **Step 2: Write failing safe-update tests**

Cover comment/unrelated-key preservation, URL/path mutual exclusion, unknown-key rejection, invalid Google URL rejection, `0600` file mode, restrictive-permission preservation, temporary-file cleanup after injected rename failure, atomic output, and redaction:

```ts
it("preserves unrelated values and makes Google Docs the sole resume source", () => {
  writeFileSync(path.join(root, ".env.local"), [
    "# keep this comment",
    'JOBTRACKER_DB_PATH="/tmp/jobs.sqlite"',
    'JOBTRACKER_BASE_RESUME_PATH="/tmp/resume.docx"',
    'UNRELATED_SETTING="keep-me"'
  ].join("\n"));
  const result = updateApplicationConfig(root, {
    baseResumeUrl: "https://docs.google.com/document/d/document-id/edit"
  });
  const written = readFileSync(path.join(root, ".env.local"), "utf8");
  expect(written).toContain("# keep this comment");
  expect(written).toContain('UNRELATED_SETTING="keep-me"');
  expect(written).toContain('JOBTRACKER_BASE_RESUME_PATH=""');
  expect(result.resume.kind).toBe("google_doc");
});

it("rejects credential-like keys", () => {
  expect(() => updateApplicationConfig(root, { apiKey: "secret" } as never))
    .toThrow(/unsupported configuration key/i);
});

it("rejects two nonempty resume sources and clears both when both are empty", () => {
  expect(() => updateApplicationConfig(root, {
    baseResumeUrl: "https://docs.google.com/document/d/id/edit",
    baseResumePath: "/tmp/resume.docx"
  })).toThrow(/one resume source/i);
  updateApplicationConfig(root, { baseResumeUrl: "", baseResumePath: "" });
  expect(readFileSync(path.join(root, ".env.local"), "utf8"))
    .toContain('JOBTRACKER_BASE_RESUME_URL=""');
});
```

- [ ] **Step 3: Confirm RED**

Run:

```bash
npm test -- scripts/application-readiness.test.ts scripts/configure-application-profile.test.ts
```

Expected: FAIL because `scripts/lib/application-readiness.mjs` is absent.

- [ ] **Step 4: Implement the shared library**

Create these exact exports:

```js
export const APPLICATION_CONFIG_KEYS = Object.freeze({
  applicationsDirectory: "JOBTRACKER_APPLICATIONS_DIR",
  baseResumeUrl: "JOBTRACKER_BASE_RESUME_URL",
  baseResumePath: "JOBTRACKER_BASE_RESUME_PATH",
  profileUrl: "JOBTRACKER_LINKEDIN_URL"
});

export function readApplicationConfig(projectRoot, processEnv = process.env) {}
export function evaluateApplicationReadiness({ projectRoot, processEnv = process.env, codexHome, claudeHome }) {}
export function updateApplicationConfig(projectRoot, input) {}
export function updateSetupConfig(projectRoot, input) {}
```

Implement the bodies so they:

- Parse quoted/unquoted dotenv values without shell evaluation.
- Apply known process-environment overrides and resolve relative paths against `projectRoot`.
- Accept only `docs.google.com/document/d/<id>` URLs and `.docx`, `.pdf`, `.md`, `.markdown`, or `.txt` files.
- Check local file read access and destination/database-parent write access.
- Use `git check-ignore` for every configured repository-local resume and applications directory; return `blocked` when either is unignored.
- Check the three repository skill folders; report Codex/Claude personal copies separately.
- Return stable issue codes and safe locations, never file contents or arbitrary environment data.
- Map missing/invalid user values to `needs_input`, repository/permission/privacy failures to `blocked`, and warnings to no status change.
- Restrict the agent writer to the four spec keys; allow database path and provider note only through `updateSetupConfig`.
- Atomically replace `.env.local` through a `0600` same-directory temporary file, preserve restrictive existing permissions, and clean up on failure.
- Reject two nonempty resume sources; clear the other source when one nonempty source is supplied; clear both when both explicit values are empty.

- [ ] **Step 5: Implement thin CLI wrappers**

The read-only wrapper must be equivalent to:

```js
#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateApplicationReadiness } from "./lib/application-readiness.mjs";

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const index = process.argv.indexOf("--project-root");
const projectRoot = index === -1 ? defaultRoot : path.resolve(process.argv[index + 1]);
process.stdout.write(`${JSON.stringify(evaluateApplicationReadiness({ projectRoot }), null, 2)}\n`);
```

The write wrapper must strictly parse `--project-root` and `--input-json`, read `-` from stdin, call `updateApplicationConfig`, emit only redacted JSON to stdout, emit errors to stderr, and exit 1 on failure.

- [ ] **Step 6: Add package and example contracts**

Add:

```json
"application:readiness": "node scripts/check-application-readiness.mjs",
"application:configure": "node scripts/configure-application-profile.mjs"
```

Add before the existing resume path:

```dotenv
# Preferred: private Google Docs master URL. Access stays in the host agent.
JOBTRACKER_BASE_RESUME_URL=""
```

- [ ] **Step 7: Confirm GREEN and inspect the sensitive diff**

```bash
npm test -- scripts/application-readiness.test.ts scripts/configure-application-profile.test.ts
git diff --check
git diff -- .env.example package.json scripts/lib/application-readiness.mjs scripts/check-application-readiness.mjs scripts/configure-application-profile.mjs
```

Expected: tests PASS and no content, token, credential field, or non-allowlisted write appears.

- [ ] **Step 8: Commit**

```bash
git add .env.example package.json scripts/lib/application-readiness.mjs scripts/check-application-readiness.mjs scripts/configure-application-profile.mjs scripts/application-readiness.test.ts scripts/configure-application-profile.test.ts
git commit -m "feat: add application readiness preflight"
```

---

### AR-2: Setup Wizard Resume-Source Flow

**Outcome:** First-run setup recommends Google Docs while retaining local-file and noninteractive compatibility.

**Relevant spec:** Resume Source Policy; Safe Configuration; Compatibility and Migration.

**Dependencies / wave:** AR-1; wave 2, concurrent with AR-3.

**Risk:** Medium; review after the focused setup test.

**Files:** Modify `scripts/setup-user.mjs`; create `scripts/setup-user.test.ts`.

**Interfaces:** Consume trusted `updateSetupConfig`; produce mutually exclusive URL/path keys; preserve `npm run setup -- --yes`. Export `runSetup({ projectRoot, answers, installSkills })` so the complete noninteractive write path is testable without starting readline.

- [ ] **Step 1: Write failing pure-helper tests**

```ts
import { describe, expect, it } from "vitest";
import { buildResumeConfig, runSetup } from "./setup-user.mjs";

it("prefers a Google Doc", () => {
  expect(buildResumeConfig({
    googleDocUrl: "https://docs.google.com/document/d/id/edit",
    localPath: "/tmp/resume.docx"
  })).toEqual({
    baseResumeUrl: "https://docs.google.com/document/d/id/edit",
    baseResumePath: ""
  });
});

it("falls back to a local file", () => {
  expect(buildResumeConfig({ googleDocUrl: "", localPath: "/tmp/resume.docx" }))
    .toEqual({ baseResumeUrl: "", baseResumePath: "/tmp/resume.docx" });
});

it("writes the complete trusted setup contract without exposing credential fields", async () => {
  await runSetup({
    projectRoot: root,
    answers: {
      dbPath: path.join(root, "data", "custom.sqlite"),
      applicationsDir: path.join(root, "private-output"),
      googleDocUrl: "https://docs.google.com/document/d/id/edit",
      localPath: "",
      linkedInUrl: "https://www.linkedin.com/in/example",
      aiProvider: "Configured in host"
    },
    installSkills: false
  });
  const written = readFileSync(path.join(root, ".env.local"), "utf8");
  expect(written).toContain("JOBTRACKER_DB_PATH=");
  expect(written).toContain("JOBTRACKER_BASE_RESUME_URL=");
  expect(written).toContain("JOBTRACKER_AI_PROVIDER=");
  expect(written).not.toMatch(/API_KEY|TOKEN|SECRET/);
});
```

- [ ] **Step 2: Confirm RED**

Run `npm test -- scripts/setup-user.test.ts`.

Expected: FAIL because `buildResumeConfig` is not exported.

- [ ] **Step 3: Refactor setup**

Export the pure helper and dependency-injected `runSetup` without starting readline on import. Display the exact recommendation from the spec, ask for the Google Doc URL first, ask for DOCX/PDF path only when blank, use trusted `updateSetupConfig`, and preserve database path, applications directory, profile URL, provider note, skill install, and noninteractive defaults. The agent-facing CLI must remain unable to write database/provider fields.

- [ ] **Step 4: Confirm GREEN and no worktree `.env.local` leak**

```bash
npm test -- scripts/setup-user.test.ts scripts/application-readiness.test.ts scripts/configure-application-profile.test.ts
test ! -f .env.local
git diff --check
```

Expected: PASS, no interactive import side effect, no private file created.

- [ ] **Step 5: Commit**

```bash
git add scripts/setup-user.mjs scripts/setup-user.test.ts
git commit -m "feat: prefer Google Docs during setup"
```

---

### AR-3: Coordinator Skill and Fresh-Session Routing

**Outcome:** Package one orchestration entrypoint for both agents and route application intent through readiness before component skills.

**Relevant spec:** Triggering; Coordinating Skill; Fresh Local Versus Cloud Sessions; Failure Paths.

**Dependencies / wave:** AR-1; wave 2, concurrent with AR-2.

**Risk:** Medium; review after skill validation and packaging tests.

**Files:**

- Create: `skills/job-application-workflow/SKILL.md`
- Create: `skills/job-application-workflow/agents/openai.yaml`
- Create exact mirror under `.claude/skills/job-application-workflow/`
- Modify both provider copies of `job-tracker-add-posting` and `job-application-resume`
- Create: `scripts/application-workflow-contract.test.ts`
- Modify: `AGENTS.md`, `CLAUDE.md`, `scripts/install-skills.test.ts`

**Interfaces:** Consume readiness schema v1; invoke and verify the existing tracker JSON; pass verified opportunity ID to the resume skill; expose `$job-application-workflow` and `/job-application-workflow`.

- [ ] **Step 1: Make packaging test fail for the missing coordinator**

Change the expected list to:

```ts
const skillNames = [
  "job-application-resume",
  "job-application-workflow",
  "job-tracker-add-posting"
];
```

Assert the coordinator contains `check-application-readiness.mjs`, both component skill names, and master-resume protection. Run `npm test -- scripts/install-skills.test.ts`; expect FAIL because the folder is missing.

Create `scripts/application-workflow-contract.test.ts` to make ordering and path propagation acceptance-gated:

```ts
const workflow = readFileSync(path.join(projectRoot, "skills/job-application-workflow/SKILL.md"), "utf8");

it("orders readiness before intake before materials", () => {
  const readiness = workflow.indexOf("check-application-readiness.mjs");
  const intake = workflow.indexOf("job-tracker-add-posting");
  const materials = workflow.indexOf("job-application-resume");
  expect(readiness).toBeGreaterThan(-1);
  expect(intake).toBeGreaterThan(readiness);
  expect(materials).toBeGreaterThan(intake);
});

it("propagates resolved database and applications paths", () => {
  expect(workflow).toContain("database.path");
  expect(workflow).toContain("applicationsDirectory.path");
  expect(workflow).toContain("--db");
  expect(workflow).toContain("--applications-dir");
});

it("real tracker commands stay on the supplied custom database", () => {
  const customDb = path.join(tempDir, "custom", "jobs.sqlite");
  const defaultDb = path.join(tempDir, "data", "jobtracker.sqlite");
  const created = JSON.parse(execFileSync(process.execPath, [
    path.join(projectRoot, "scripts/upsert-job-posting.mjs"),
    "--db", customDb,
    "--company", "Fixture Co",
    "--role", "Fixture Role",
    "--url", "https://example.com/jobs/fixture"
  ], { cwd: tempDir, encoding: "utf8" }));
  const snapshot = path.join(tempDir, "external-applications", "Fixture Co", "fixture-role-resume.pdf");
  mkdirSync(path.dirname(snapshot), { recursive: true });
  writeFileSync(snapshot, "fixture snapshot");
  execFileSync(process.execPath, [
    path.join(projectRoot, "scripts/register-application-artifact.mjs"),
    "--db", customDb,
    "--opportunity-id", created.opportunity.id,
    "--type", "resume",
    "--title", "Resume",
    "--file", snapshot
  ]);
  expect(existsSync(customDb)).toBe(true);
  expect(existsSync(defaultDb)).toBe(false);
});
```

- [ ] **Step 2: Initialize the skill using the packaged generator**

```bash
python <user-home>/.codex/skills/.system/skill-creator/scripts/init_skill.py job-application-workflow --path skills --interface display_name="Job Application Workflow" --interface short_description="Get ready and apply from a job link" --interface default_prompt='Use $job-application-workflow to check my application readiness and help me apply for a job.'
```

Replace generated placeholders. The frontmatter description must cover application intent with or without a link and a supplied job URL.

- [ ] **Step 3: Write the coordinator instructions**

Implement the spec's ten-step sequence. Include these commands:

```bash
node scripts/check-application-readiness.mjs
printf '%s\n' '<allowlisted-json>' | node scripts/configure-application-profile.mjs --input-json -
```

Require one-at-a-time collection, two-stage Google access checks, readiness-enforced Git ignore safety for repository-local resume/output paths, exact ready copy, verified tracker JSON, verified local snapshot existence, and verified artifact registration. Pass readiness `database.path` as `--db` to upsert and registration, and pass `applicationsDirectory.path` to material generation. Prohibit submission, credentials, public sharing, and master edits.

- [ ] **Step 4: Narrow component triggers and add resume rules**

Keep “add this posting” in the intake skill but remove broad ownership of “help me apply.” Add to the resume skill:

```markdown
- Prefer `JOBTRACKER_BASE_RESUME_URL` when it identifies an accessible Google Doc.
- Treat the configured source as a read-only master and create a role-specific copy.
- Fall back to `JOBTRACKER_BASE_RESUME_PATH`; prefer DOCX and warn for PDF reconstruction.
- For a tailored Google Doc, save/export a local PDF or DOCX snapshot before registering the `resume` artifact. Return the Docs link separately.
- Pass the readiness result's absolute database path as `--db` to every tracker/artifact command and use the exact absolute applications directory; do not rely on process defaults.
```

- [ ] **Step 5: Mirror all skill changes to Claude**

Replace only the matching `.claude/skills/<name>` directories from `skills/<name>`. Never edit mirror copies independently.

- [ ] **Step 6: Route root instructions**

Make application intent with or without a link invoke the repository source coordinator first, even when the personal installed copy is absent. The coordinator may then offer to refresh personal skills. Preserve setup/privacy rules and exclude unrelated repository tasks. Include exactly:

```text
Your application workspace is ready. Your master resume is configured and will not be modified. Send me a job-posting link when you're ready.
```

- [ ] **Step 7: Validate and confirm GREEN**

```bash
python <user-home>/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/job-application-workflow
diff -qr skills .claude/skills
npm test -- scripts/install-skills.test.ts
npm test -- scripts/application-workflow-contract.test.ts
rg -n "job-application-workflow|check-application-readiness|master resume" AGENTS.md CLAUDE.md skills .claude/skills
```

Expected: validator success, no mirror differences, packaging PASS.

- [ ] **Step 8: Commit**

```bash
git add AGENTS.md CLAUDE.md skills .claude/skills scripts/install-skills.test.ts scripts/application-workflow-contract.test.ts
git commit -m "feat: coordinate fresh job application sessions"
```

---

### AR-4: Nontechnical Documentation

**Outcome:** Explain what fresh sessions remember, why Google Docs is preferred, and how local/cloud behavior differs.

**Relevant spec:** User Outcomes; Fresh Local Versus Cloud Sessions; Security and Privacy; Material Decisions.

**Dependencies / wave:** AR-2 and AR-3; wave 3.

**Risk:** Low; batch wave review.

**Files:** Modify `README.md`, `docs/agent-setup.md`, and the documentation assertion section of `scripts/install-skills.test.ts`.

**Interfaces:** Consume final command names and user copy from AR-1–AR-3.

- [ ] **Step 1: Add a failing documentation assertion**

```ts
it("documents fresh-session readiness and Google Docs preference", () => {
  const readme = readFileSync(path.join(projectRoot, "README.md"), "utf8");
  const setup = readFileSync(path.join(projectRoot, "docs", "agent-setup.md"), "utf8");
  for (const content of [readme, setup]) {
    expect(content).toContain("JOBTRACKER_BASE_RESUME_URL");
    expect(content).toContain("Google Doc");
    expect(content.toLowerCase()).toContain("fresh session");
  }
});
```

Run the focused test and expect FAIL.

- [ ] **Step 2: Update README**

Revise requirements, agent-managed setup prompt, configuration, and skill list. Add “Starting A Fresh Agent Session”: open the repo, say “help me apply,” explain that repository instructions—not memory—drive the flow, distinguish local `.env.local` from cloud checkouts, recommend private connected Google Docs, and state that the original is never edited.

- [ ] **Step 3: Update agent setup guide**

Document readiness/configuration CLIs, Google access probe, DOCX/PDF fallbacks, optional profile warning, local snapshot registration, and the exact ready message. Do not present npm as the primary application entrypoint.

- [ ] **Step 4: Confirm GREEN and commit**

```bash
npm test -- scripts/install-skills.test.ts
rg -n "JOBTRACKER_BASE_RESUME_URL|Google Doc|fresh session|will not be modified" README.md docs/agent-setup.md
git diff --check
git add README.md docs/agent-setup.md scripts/install-skills.test.ts
git commit -m "docs: explain fresh application onboarding"
```

Expected: focused test PASS and all required concepts present.

---

### AR-5: Integrated Acceptance

**Outcome:** Prove the change is consistent, compatible, private, and buildable before final review.

**Relevant spec:** All acceptance criteria.

**Dependencies / wave:** AR-1 through AR-4; wave 4.

**Risk:** Medium. No planned writes; failures return to the owning task's write set and review path.

**Write set:** None during verification.

- [ ] **Step 1: Run focused feature tests**

```bash
npm test -- scripts/application-readiness.test.ts scripts/configure-application-profile.test.ts scripts/setup-user.test.ts scripts/install-skills.test.ts scripts/application-workflow-contract.test.ts
```

Expected: all named tests PASS.

- [ ] **Step 2: Validate skill trees**

```bash
python <user-home>/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/job-application-workflow
diff -qr skills .claude/skills
```

Expected: validation succeeds and mirrors are identical.

- [ ] **Step 3: Run full acceptance**

```bash
npm run verify
npm run build
```

Expected: lint, typecheck, all tests, and production build PASS.

- [ ] **Step 4: Check privacy and hygiene**

```bash
git diff --check
git status --short
git check-ignore -v .env.local data/jobtracker.sqlite applications/example-resume.pdf
git ls-files | rg '(^|/)(\.env\.local|.*\.(docx|pdf)|data/.*\.sqlite)$' && exit 1 || true
```

Also create a custom repository-local output fixture that is not ignored and assert readiness returns `blocked`; add an exact temporary ignore rule and assert the privacy issue clears. Expected: only intentional changes, private examples ignored, no private artifacts tracked, and unsafe custom paths cannot report ready.

- [ ] **Step 5: Exercise CLI acceptance in a temporary root**

Seed `$TEMP_ROOT` with writable `data/` and external applications directories, `.env.example`, all three `skills/<name>/SKILL.md` stubs, and isolated empty `CODEX_HOME`/`CLAUDE_HOME`. Then run:

```bash
CODEX_HOME="$TEMP_ROOT/codex-home" CLAUDE_HOME="$TEMP_ROOT/claude-home" node scripts/check-application-readiness.mjs --project-root "$TEMP_ROOT"
printf '%s\n' '{"applicationsDirectory":"/tmp/jobtracker-acceptance-output","baseResumeUrl":"https://docs.google.com/document/d/test-id/edit","profileUrl":"https://www.linkedin.com/in/test"}' | CODEX_HOME="$TEMP_ROOT/codex-home" CLAUDE_HOME="$TEMP_ROOT/claude-home" node scripts/configure-application-profile.mjs --project-root "$TEMP_ROOT" --input-json -
CODEX_HOME="$TEMP_ROOT/codex-home" CLAUDE_HOME="$TEMP_ROOT/claude-home" node scripts/check-application-readiness.mjs --project-root "$TEMP_ROOT"
```

Expected: first result `needs_input`; write output redacted; second result locally `ready` with `google_doc`, `requiresExternalAccessCheck=true`, and warnings—not blockers—for missing personal copies.

- [ ] **Step 6: Prove custom path propagation through real tracker commands**

Create a temporary custom SQLite path and external applications directory. Execute `upsert-job-posting.mjs --db "$CUSTOM_DB"`, create a snapshot under `$CUSTOM_APPS`, execute `register-application-artifact.mjs --db "$CUSTOM_DB" --opportunity-id ...`, and query that same DB. Assert the default worktree DB was untouched, the opportunity/artifact share the verified ID, and the registered file exists under `$CUSTOM_APPS`.

- [ ] **Step 7: Run mandatory fresh-context workflow gates**

Use fresh subagents with only the coordinator skill path, repository path, and scenario fixture—never the intended answer. Require pass/fail evidence for: no-link readiness, supplied-link readiness, custom resolved paths, accessible/inaccessible Google access results, DOCX, PDF warning, missing resume, missing profile, unchanged master hash, copied document identity, intake-before-materials, and snapshot-before-registration. Any failed ordering or safety scenario blocks completion and returns to AR-3 for one fix pass.

When a connected Google Docs host and private test document are callable, additionally create/read back/export a real role-specific copy and prove the master identity/content is unchanged. If that capability is unavailable, record the limitation explicitly and do not label the fixture forward-test as live connector verification.

- [ ] **Step 8: Final review package**

Provide the final reviewer the spec, this plan, exact diff range, focused/full verification, privacy output, and residual manual host checks. Require no blocking requirements or quality findings before Goal completion.

## Plan Self-Review

- AR-1–AR-5 cover every acceptance criterion.
- High-risk configuration work is serialized and reviewed before dependents.
- The only concurrent tasks have disjoint write sets.
- Shared files have one owner; AR-4's test edit occurs after AR-3 completes.
- Function names, CLI names, schema version, and environment variables are consistent.
- No migration, UI change, remote-link persistence, or credential handling is introduced.
- Each task has test-first steps, exact checks, expected evidence, and a commit boundary.
