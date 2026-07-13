# Persistent Application Profile Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure profile-only requests persist every supplied resume and public-profile reference so fresh tasks in the same checkout do not ask for valid values again.

**Architecture:** Keep the existing private `.env.local` writer and readiness reader unchanged. Strengthen repository and packaged-skill routing so profile-configuration requests invoke the coordinator, then document the one-message setup prompt and the local-versus-cloud persistence boundary. Contract tests enforce the behavior across Codex and Claude copies.

**Tech Stack:** Markdown repository instructions and skills, Node.js, TypeScript, Vitest.

## Global Constraints

- Store personal resume/profile references only in ignored `.env.local` or host-configured environment variables, never in committed user-specific files.
- Continue using `scripts/configure-application-profile.mjs`; do not broaden its allowlist.
- Preserve unspecified `.env.local` values and persist all supplied allowlisted fields from one message together.
- Keep `skills/job-application-workflow` and `.claude/skills/job-application-workflow` byte-identical.
- Do not add credentials, public-sharing instructions, an account system, database fields, or a web settings page.

---

### Task 1: Route and document persistent application profiles

**Files:**
- Modify: `scripts/application-workflow-contract.test.ts`
- Modify: `scripts/install-skills.test.ts`
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`
- Modify: `skills/job-application-workflow/SKILL.md`
- Modify: `.claude/skills/job-application-workflow/SKILL.md`
- Modify: `README.md`
- Modify: `docs/agent-setup.md`

**Interfaces:**
- Consumes: `node scripts/configure-application-profile.mjs --input-json -`, which accepts `applicationsDirectory`, `baseResumeUrl`, `baseResumePath`, and `profileUrl` while preserving unspecified values.
- Produces: durable repository routing and coordinator instructions for profile-only requests, plus nontechnical setup guidance for local and cloud tasks.

- [ ] **Step 1: Write the failing workflow contract test**

Add this test inside `describe("job application workflow contract", ...)` in `scripts/application-workflow-contract.test.ts`:

```ts
it("persists profile-only input for reuse by fresh tasks", () => {
  const agents = readFileSync(path.join(projectRoot, "AGENTS.md"), "utf8");
  const claude = readFileSync(path.join(projectRoot, "CLAUDE.md"), "utf8");

  for (const instructions of [agents, claude]) {
    expect(instructions).toContain("configure, save, remember, or update");
    expect(instructions).toContain("resume or public professional-profile references");
  }
  expect(workflow).toContain("configure, save, remember, or update");
  expect(workflow).toContain("persist every supplied allowlisted field together");
  expect(workflow).toContain("Omit fields the user did not supply");
  expect(workflow).toContain("Rerun readiness after the combined update");
});
```

Extend the existing documentation test in `scripts/install-skills.test.ts` with:

```ts
expect(content).toContain("Configure my reusable application profile");
expect(content).toContain("JOBTRACKER_LINKEDIN_URL");
expect(content).toContain("cloud environment variables");
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
npm test -- scripts/application-workflow-contract.test.ts scripts/install-skills.test.ts
```

Expected: FAIL because the current root instructions and coordinator do not mention profile-only routing or combined persistence, and the documentation lacks the reusable-profile prompt/cloud-variable wording.

- [ ] **Step 3: Add profile-only routing to both root instruction files**

Change the first workflow sentence in both `AGENTS.md` and `CLAUDE.md` to:

```md
When the user expresses application intent—with or without a job link—primarily sends a public job-posting URL, or asks to configure, save, remember, or update resume or public professional-profile references for job applications:
```

Keep each file's existing provider-specific coordinator path and invocation syntax unchanged.

- [ ] **Step 4: Strengthen the coordinator contract and mirror it**

Update the `description` in `skills/job-application-workflow/SKILL.md` so it explicitly includes requests to configure, save, remember, or update application-profile references.

Replace the beginning of required-sequence step 3 with this behavior while retaining the current command and safety text:

```md
3. If status is `needs_input`, or the user asks to configure, save, remember, or update application-profile references, use any allowlisted values already present in the user's message before asking another question. When the message supplies more than one of `applicationsDirectory`, `baseResumeUrl`, `baseResumePath`, or `profileUrl`, persist every supplied allowlisted field together in one update. Omit fields the user did not supply so existing values remain unchanged. Prefer a private Google Doc, then DOCX, then PDF with a formatting warning. Persist through:
```

After the configuration command, add:

```md
   Rerun readiness after the combined update. Then collect only the next missing or invalid value, one at a time.
```

Copy the completed Codex skill file byte-for-byte to `.claude/skills/job-application-workflow/SKILL.md` using `apply_patch`.

- [ ] **Step 5: Add the nontechnical one-message setup prompt and cloud boundary**

In `README.md` and `docs/agent-setup.md`, add this reusable prompt near the fresh-session entrypoint:

```text
Configure my reusable application profile for this project.
Master resume Google Doc: https://docs.google.com/document/d/EXAMPLE_DOCUMENT_ID/edit
LinkedIn profile: https://www.linkedin.com/in/example
Save these in the project's private local configuration, verify readiness, and tell me when I am ready to provide a job link.
```

Explain immediately afterward that the agent saves local values under `JOBTRACKER_BASE_RESUME_URL` or `JOBTRACKER_BASE_RESUME_PATH` and `JOBTRACKER_LINKEDIN_URL` in ignored `.env.local`. State that fresh local tasks reuse these values. For Codex Cloud, instruct the user to configure the same names as cloud environment variables because `.env.local` is not cloned. State that saving the URL does not replace Google Drive authorization.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run:

```bash
npm test -- scripts/application-workflow-contract.test.ts scripts/install-skills.test.ts scripts/configure-application-profile.test.ts scripts/application-readiness.test.ts
```

Expected: all focused tests pass, including the existing safe-writer and readiness coverage.

- [ ] **Step 7: Verify skill parity and repository hygiene**

Run:

```bash
diff -qr skills .claude/skills
git diff --check
git status --short
```

Expected: no skill-tree differences, no whitespace errors, and only the intended plan, tests, instructions, skill, and documentation changes.

- [ ] **Step 8: Commit the implementation**

Stage only the files listed in this task and commit:

```bash
git commit -m "fix: persist application profile links across tasks"
```

### Task 2: Verify and merge the branch

**Files:**
- No source files expected.

**Interfaces:**
- Consumes: the completed `codex/application-readiness-agent` branch.
- Produces: a verified `main` containing the application-readiness workflow and persistence fix.

- [ ] **Step 1: Run full feature-branch verification**

Run:

```bash
npm run verify
npm run build
git diff --check
git status --short --branch
```

Expected: verification and build exit successfully; the feature worktree is clean.

- [ ] **Step 2: Merge locally into `main`**

From `<user-home>/Documents/JobTracker`, confirm `main` is clean and merge:

```bash
git merge codex/application-readiness-agent
```

Do not pull or push unless separately authorized.

- [ ] **Step 3: Verify the merged result on `main`**

Run from `<user-home>/Documents/JobTracker`:

```bash
npm run verify
npm run build
git diff --check
git status --short --branch
```

Expected: verification and build exit successfully and `main` is clean.

- [ ] **Step 4: Clean up the merged feature worktree and branch**

From `<user-home>/Documents/JobTracker`, remove the owned worktree, prune registrations, and delete the merged branch:

```bash
git worktree remove <isolated-worktree>/application-readiness-agent
git worktree prune
git branch -d codex/application-readiness-agent
```

Expected: the feature worktree and merged local branch are removed; `main` retains all commits.
