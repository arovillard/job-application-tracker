# Repository-Local Applications Directory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `<project-root>/applications` the safe default, preserve deliberate overrides, reject `/applications`, document existing-install moves, and repair this workspace's misplaced Example Company materials.

**Architecture:** Centralize applications-directory interpretation in `scripts/lib/application-readiness.mjs`, with readers defaulting missing values and writers normalizing portable repository-local values before atomic persistence. Setup consumes the shared resolver, readiness blocks dangerous manually entered values, and artifact backfill removes missing local links before registering moved files. Documentation and both packaged agent skill copies describe the same contract.

**Tech Stack:** Node.js ESM, TypeScript/Vitest tests, SQLite via `better-sqlite3`, npm scripts, Markdown documentation.

## Global Constraints

- The default application-materials directory is `<project-root>/applications`.
- Relative paths resolve from the repository root; non-ambiguous absolute custom paths remain supported.
- Reject `/applications` before creating a directory or modifying `.env.local`.
- Preserve unrelated `.env.local` entries, comments, and restrictive permissions.
- Do not touch the master resume, macOS applications, or unrelated `/Applications` contents.
- Do not overwrite an existing `applications/Example Company` destination during local migration.

---

### Task 1: Centralize Defaulting, Normalization, and Dangerous-Path Validation

**Files:**
- Modify: `scripts/lib/application-readiness.mjs`
- Test: `scripts/application-readiness.test.ts`
- Test: `scripts/configure-application-profile.test.ts`

**Interfaces:**
- Produces: `resolveApplicationsDirectory(projectRoot: string, value?: string): string`, returning an absolute safe path or throwing for `/applications`.
- Produces: normalized `JOBTRACKER_APPLICATIONS_DIR` persistence through existing `updateApplicationConfig` and `updateSetupConfig`.
- Consumes: existing `resolveConfigPath`, `replaceDotenvValues`, and atomic `.env.local` writer.

- [ ] **Step 1: Add failing reader/readiness tests**

Add tests showing absent and explicitly blank settings resolve to the repository default, while a manually persisted `/applications` value blocks readiness:

```ts
it.each([undefined, ""])('defaults applications directory for %s', (configured) => {
  const root = fixture();
  if (configured !== undefined) {
    writeFileSync(path.join(root, ".env.local"), 'JOBTRACKER_APPLICATIONS_DIR=""\n');
  }
  expect(readApplicationConfig(root, {}).applicationsDirectory)
    .toBe(path.join(root, "applications"));
});

it("blocks an ambiguous root applications directory", () => {
  const root = fixture();
  writeFileSync(path.join(root, ".env.local"), 'JOBTRACKER_APPLICATIONS_DIR="/applications"\n');
  const result = evaluateApplicationReadiness({ projectRoot: root, processEnv: {} });
  expect(result.status).toBe("blocked");
  expect(result.blockingIssues).toContain("applications_directory_ambiguous");
});
```

Update the existing readiness expectations that currently require `applications_directory_unconfigured`: a missing or blank setting must now report `{ path: path.join(root, "applications"), exists: true, writable: true }` and must not include that blocker.

- [ ] **Step 2: Add failing configuration-writer tests**

Cover portable relative persistence, absolute overrides, blank-to-default normalization, and no-write rejection:

```ts
it.each(["applications", "./applications", ""])("stores %p as the portable default", (value) => {
  const root = fixture();
  const result = updateApplicationConfig(root, { applicationsDirectory: value });
  expect(readFileSync(path.join(root, ".env.local"), "utf8"))
    .toContain('JOBTRACKER_APPLICATIONS_DIR="./applications"');
  expect(result.applicationsDirectory).toEqual({ configured: true, path: path.join(root, "applications") });
});

it("preserves a custom absolute applications directory", () => {
  const root = fixture();
  const target = path.join(os.tmpdir(), "jobtracker-custom-applications");
  updateApplicationConfig(root, { applicationsDirectory: target });
  expect(readFileSync(path.join(root, ".env.local"), "utf8"))
    .toContain(`JOBTRACKER_APPLICATIONS_DIR="${target}"`);
});

it("rejects /applications before writing", () => {
  const root = fixture();
  expect(() => updateApplicationConfig(root, { applicationsDirectory: "/applications" }))
    .toThrow(/\.\/applications/);
  expect(existsSync(path.join(root, ".env.local"))).toBe(false);
});
```

- [ ] **Step 3: Run the focused tests and confirm RED**

Run:

```bash
npx vitest run scripts/application-readiness.test.ts scripts/configure-application-profile.test.ts
```

Expected: failures for missing/blank defaulting, portable persistence, and `/applications` rejection.

- [ ] **Step 4: Implement shared path behavior**

Add a default constant, dangerous-path predicate, exported resolver, writer normalization, and readiness blocker:

```js
const DEFAULT_APPLICATIONS_DIRECTORY = "./applications";

function isAmbiguousApplicationsDirectory(target) {
  const normalized = path.normalize(target);
  return path.dirname(normalized) === path.parse(normalized).root
    && path.basename(normalized).toLowerCase() === "applications";
}

export function resolveApplicationsDirectory(projectRoot, value = "") {
  const selected = String(value ?? "").trim() || DEFAULT_APPLICATIONS_DIRECTORY;
  const resolved = resolveConfigPath(path.resolve(projectRoot), selected);
  if (isAmbiguousApplicationsDirectory(resolved)) {
    throw new Error('applicationsDirectory cannot be "/applications". Use "./applications" for the repository folder or choose a different absolute path.');
  }
  return resolved;
}

function normalizeApplicationsDirectory(projectRoot, value) {
  const selected = String(value ?? "").trim() || DEFAULT_APPLICATIONS_DIRECTORY;
  const resolved = resolveApplicationsDirectory(projectRoot, selected);
  return resolved === path.join(path.resolve(projectRoot), "applications")
    ? DEFAULT_APPLICATIONS_DIRECTORY
    : path.isAbsolute(selected) ? path.normalize(selected) : selected;
}
```

Use `DEFAULT_APPLICATIONS_DIRECTORY` as the fallback in `readApplicationConfig`. In `updateConfig`, validate the input object first, normalize `applicationsDirectory` before mapping it to dotenv keys, and remove the old rejection of an explicitly blank applications directory. In `evaluateApplicationReadiness`, add `applications_directory_ambiguous` before ordinary directory availability checks when the resolved target is the root-level applications path.

- [ ] **Step 5: Run focused tests and confirm GREEN**

Run:

```bash
npx vitest run scripts/application-readiness.test.ts scripts/configure-application-profile.test.ts
```

Expected: both test files pass with zero failures.

- [ ] **Step 6: Commit the configuration boundary**

```bash
git add scripts/lib/application-readiness.mjs scripts/application-readiness.test.ts scripts/configure-application-profile.test.ts
git commit -m "fix: default application materials to repository"
```

---

### Task 2: Make Interactive and Non-Interactive Setup Persist the Portable Default

**Files:**
- Modify: `scripts/setup-user.mjs`
- Test: `scripts/setup-user.test.ts`

**Interfaces:**
- Consumes: `resolveApplicationsDirectory(projectRoot, value)` from Task 1.
- Produces: `runSetup` that creates the absolute resolved folder while persisting `./applications` for the default.

- [ ] **Step 1: Add failing setup tests**

Import `existsSync` and add:

```ts
it("creates and stores the repository-local applications default", async () => {
  const root = fixture();
  await runSetup({
    projectRoot: root,
    answers: {
      dbPath: "./data/jobtracker.sqlite",
      applicationsDir: "applications",
      googleDocUrl: "",
      localPath: "",
      linkedInUrl: "",
      aiProvider: ""
    },
    installSkills: false
  });
  expect(existsSync(path.join(root, "applications"))).toBe(true);
  expect(readFileSync(path.join(root, ".env.local"), "utf8"))
    .toContain('JOBTRACKER_APPLICATIONS_DIR="./applications"');
});

it("rejects /applications without changing setup files", async () => {
  const root = fixture();
  await expect(runSetup({
    projectRoot: root,
    answers: { dbPath: "./data/jobtracker.sqlite", applicationsDir: "/applications", googleDocUrl: "", localPath: "", linkedInUrl: "", aiProvider: "" },
    installSkills: false
  })).rejects.toThrow(/\.\/applications/);
  expect(existsSync(path.join(root, ".env.local"))).toBe(false);
});
```

- [ ] **Step 2: Run the setup tests and confirm RED**

Run: `npx vitest run scripts/setup-user.test.ts`

Expected: the default is stored as an absolute path or the dangerous path is not rejected before side effects.

- [ ] **Step 3: Consume the shared resolver and preserve the raw configured value**

Update imports and `runSetup`:

```js
import { resolveApplicationsDirectory, updateSetupConfig } from "./lib/application-readiness.mjs";

const applicationsInput = String(answers.applicationsDir ?? "").trim() || "./applications";
const applicationsDir = resolveApplicationsDirectory(root, applicationsInput);
// mkdirSync uses applicationsDir
// updateSetupConfig receives applicationsDirectory: applicationsInput
```

Change `setupDefaults(projectRoot).applicationsDir` to `"./applications"` and expand the prompt to `Application materials directory (relative paths use the project folder)` so the displayed default is unambiguous.

- [ ] **Step 4: Run the setup tests and confirm GREEN**

Run: `npx vitest run scripts/setup-user.test.ts`

Expected: all setup tests pass.

- [ ] **Step 5: Commit setup behavior**

```bash
git add scripts/setup-user.mjs scripts/setup-user.test.ts
git commit -m "fix: persist portable applications setup path"
```

---

### Task 3: Make Artifact Backfill Safe After Moving Material Files

**Files:**
- Modify: `scripts/backfill-application-artifacts.mjs`
- Test: `scripts/backfill-application-artifacts.test.ts`

**Interfaces:**
- Produces: backfill JSON field `removedMissing`, the count of stale local artifact records removed.
- Consumes: existing `opportunity_artifacts.file_path` rows and selected `--applications-dir` scan root.

- [ ] **Step 1: Add a failing moved-directory regression test**

Extend the test result type with `removedMissing: number`, then add:

```ts
it("removes missing artifact links before registering moved files", () => {
  const dir = path.join(applicationsDir, "Acme");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "frontend-engineer-resume.pdf"), "new path");
  const db = new Database(dbPath);
  try {
    db.exec("CREATE TABLE opportunity_artifacts (id TEXT PRIMARY KEY, opportunity_id TEXT NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL, file_path TEXT NOT NULL, content_type TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(opportunity_id, type, file_path), FOREIGN KEY(opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE)");
    db.prepare("INSERT INTO opportunity_artifacts VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("old", "job-id", "resume", "Old Resume", path.join(tempDir, "old-applications", "Acme", "frontend-engineer-resume.pdf"), "application/pdf", "2026-01-01", "2026-01-01");
  } finally { db.close(); }
  expect(run()).toMatchObject({ removedMissing: 1, registered: 1 });
  const verified = new Database(dbPath);
  try {
    expect(verified.prepare("SELECT file_path FROM opportunity_artifacts").all())
      .toEqual([{ file_path: path.join(dir, "frontend-engineer-resume.pdf") }]);
  } finally { verified.close(); }
});
```

- [ ] **Step 2: Run the backfill tests and confirm RED**

Run: `npx vitest run scripts/backfill-application-artifacts.test.ts`

Expected: `removedMissing` is absent and the stale row remains.

- [ ] **Step 3: Prune only missing local artifact paths during the backfill transaction**

Before scanning registrations inside the transaction, load visible artifact rows and delete only those whose `file_path` no longer exists:

```js
let removedMissing = 0;
db.transaction(() => {
  const existing = db.prepare(`SELECT id, file_path FROM opportunity_artifacts WHERE type IN (${VISIBLE.map(() => "?").join(",")})`).all(...VISIBLE);
  const remove = db.prepare("DELETE FROM opportunity_artifacts WHERE id = ?");
  for (const row of existing) {
    if (!existsSync(row.file_path)) {
      remove.run(row.id);
      removedMissing += 1;
    }
  }
  // existing registration loop
})();
```

Include `removedMissing` in stdout JSON. Do not remove records for files that still exist, even if they are outside the selected scan root.

- [ ] **Step 4: Run backfill tests and confirm GREEN**

Run: `npx vitest run scripts/backfill-application-artifacts.test.ts`

Expected: all backfill tests pass and moved paths replace broken links.

- [ ] **Step 5: Commit migration support**

```bash
git add scripts/backfill-application-artifacts.mjs scripts/backfill-application-artifacts.test.ts
git commit -m "fix: refresh missing artifact links during backfill"
```

---

### Task 4: Align README, Setup Guide, and Packaged Agent Workflows

**Files:**
- Modify: `README.md`
- Modify: `docs/agent-setup.md`
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`
- Modify: `skills/job-application-workflow/SKILL.md`
- Modify: `.claude/skills/job-application-workflow/SKILL.md`
- Test: `scripts/application-workflow-contract.test.ts`
- Test: `scripts/install-skills.test.ts`

**Interfaces:**
- Produces: one documented configuration contract shared by humans, Codex, and Claude.
- Consumes: `npm run application:configure`, `npm run artifacts:backfill`, and readiness output from earlier tasks.

- [ ] **Step 1: Add failing documentation and workflow contract tests**

Assert the README and setup guide contain `./applications`, `relative to the repository`, `npm run artifacts:backfill`, `--applications-dir`, and restart guidance. Assert both root instruction files and the source workflow say the default needs no user input, relative values must remain relative, and `applications` must not become `/applications`.

```ts
it("documents the repository-local default and existing-install migration", () => {
  const readme = readFileSync(path.join(projectRoot, "README.md"), "utf8");
  for (const required of ["./applications", "relative to the repository", "npm run artifacts:backfill", "--applications-dir", "restart"]) {
    expect(readme.toLowerCase()).toContain(required.toLowerCase());
  }
});

it("keeps agents from reinterpreting the default as a root path", () => {
  const agents = readFileSync(path.join(projectRoot, "AGENTS.md"), "utf8");
  const claude = readFileSync(path.join(projectRoot, "CLAUDE.md"), "utf8");
  for (const content of [agents, claude, workflow]) {
    expect(content).toContain("./applications");
    expect(content).toContain("do not ask");
    expect(content).toContain("/applications");
  }
});
```

- [ ] **Step 2: Run contract tests and confirm RED**

Run:

```bash
npx vitest run scripts/application-workflow-contract.test.ts scripts/install-skills.test.ts
```

Expected: failures for missing default, override, and migration language.

- [ ] **Step 3: Update human-facing documentation**

In README:

- make application-materials folder optional because `./applications` is the default;
- show `JOBTRACKER_APPLICATIONS_DIR="./applications"`, `JOBTRACKER_APPLICATIONS_DIR="./private-output"`, and an absolute custom example;
- explain that relative paths are relative to the repository;
- add an “Changing the folder after setup” sequence: stop app, move contents, update `.env.local` or pipe `{"applicationsDirectory":"..."}` to `npm run application:configure -- --input-json -`, run `npm run artifacts:backfill -- --applications-dir "/absolute/new/path"`, restart `npm run dev`;
- state that backfill removes broken local links and registers moved files.

Mirror agent-operational details in `docs/agent-setup.md`. Update new-user setup lists in `AGENTS.md` and `CLAUDE.md` so agents accept the repository default unless an override is requested.

- [ ] **Step 4: Update and mirror the workflow skill**

In `skills/job-application-workflow/SKILL.md`, require:

```markdown
Use `./applications` by default; it resolves to the repository's `applications/` folder. Do not ask for an application-materials path unless the human wants an override. Preserve relative input exactly as relative input, and never reinterpret `applications` as `/applications`.
```

Copy the complete updated file to `.claude/skills/job-application-workflow/SKILL.md` so packaging equality remains exact.

- [ ] **Step 5: Run contract tests and confirm GREEN**

Run:

```bash
npx vitest run scripts/application-workflow-contract.test.ts scripts/install-skills.test.ts
```

Expected: both test files pass.

- [ ] **Step 6: Commit documentation and workflow guidance**

```bash
git add README.md docs/agent-setup.md AGENTS.md CLAUDE.md skills/job-application-workflow/SKILL.md .claude/skills/job-application-workflow/SKILL.md scripts/application-workflow-contract.test.ts scripts/install-skills.test.ts
git commit -m "docs: explain applications directory defaults and moves"
```

---

### Task 5: Repair the Current Workspace and Verify the Complete Change

**Files:**
- Modify ignored local file: `.env.local`
- Move ignored private folder: `/Applications/Example Company` to `<user-home>/Documents/JobTracker/applications/Example Company`

**Interfaces:**
- Consumes: safe configuration writer and backfill behavior from Tasks 1–3.
- Produces: current workspace readiness points at `<user-home>/Documents/JobTracker/applications` and no generated Example Company folder remains in `/Applications`.

- [ ] **Step 1: Verify migration preconditions**

Run:

```bash
test -d /Applications/Example Company
test ! -e <user-home>/Documents/JobTracker/applications/Example Company
```

Expected: both commands exit zero. If the destination exists, stop without overwriting it.

- [ ] **Step 2: Move only the misplaced generated folder**

Run:

```bash
mv /Applications/Example Company <user-home>/Documents/JobTracker/applications/Example Company
```

Expected: the source is absent, the destination contains the three Example Company material files, and all `.app` bundles under `/Applications` remain untouched.

- [ ] **Step 3: Safely rewrite the ignored local setting**

Run:

```bash
printf '%s\n' '{"applicationsDirectory":"./applications"}' | npm run application:configure -- --input-json -
```

Expected: redacted JSON reports `applicationsDirectory.path` as `<user-home>/Documents/JobTracker/applications` and `.env.local` contains `JOBTRACKER_APPLICATIONS_DIR="./applications"`.

- [ ] **Step 4: Refresh moved artifact links**

Run:

```bash
npm run artifacts:backfill -- --applications-dir <user-home>/Documents/JobTracker/applications
```

Expected: JSON reports the repository applications directory, scans existing materials, removes any missing `/Applications/Example Company` links, and registers recognized Example Company files.

- [ ] **Step 5: Run fresh full verification**

Run:

```bash
npm run verify
npm run build
node scripts/check-application-readiness.mjs
git diff --check
git status --short
```

Expected: lint, typecheck, all tests, and build exit zero; readiness returns the repository applications path without an applications-directory blocker; Git reports only intentional tracked changes or is clean, while `.env.local` and generated materials remain ignored.
