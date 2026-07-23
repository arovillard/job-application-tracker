# Private Daily Discovery Setup Implementation Plan

> Implement the approved design in `docs/superpowers/specs/2026-07-22-private-daily-discovery-setup-design.md` using test-driven development. Keep all examples generic and never copy local private values into tracked files.

**Goal:** Package a Codex/Claude setup skill that stores job-discovery preferences privately, configures one local scheduler against the existing JobTracker database, documents an exact invocation prompt, and prevents or removes repository-content PII.

**Architecture:** Deterministic Node scripts validate and persist an ignored JSON profile, combine it with existing application readiness, and scan repository content for privacy regressions. A canonical setup skill coordinates resume-derived suggestions and provider scheduling; the existing daily application workflow consumes the private profile. Repository instructions and documentation route users to the skill for both Codex and Claude.

**Stack:** Node.js ESM, TypeScript/Vitest tests, existing SQLite/readiness commands, Markdown skills, Git history rewriting.

---

## Task 1: Establish profile and privacy contracts with failing tests

**Files:**

- Create: `scripts/daily-discovery-config.test.ts`
- Create: `scripts/privacy-check.test.ts`
- Modify: `package.json`

1. Add profile tests covering valid Codex, valid Claude, both installed with one owner, malformed schedules/timezones, thresholds below 80, contradictory targeting, unknown keys, invalid database identity, atomic-write preservation, and owner-only permissions.
2. Add privacy tests covering macOS/Linux/Windows home paths, controller/worktree/desktop paths, forbidden tracked private-state files, known realistic fixture regressions, placeholders, repository URLs, license attribution, and clean generic fixtures.
3. Run the focused tests and confirm they fail because implementation modules and commands do not exist.
4. Commit only after the RED evidence has been captured.

## Task 2: Implement private profile validation and readiness

**Files:**

- Create: `scripts/lib/daily-discovery-config.mjs`
- Create: `scripts/configure-daily-discovery.mjs`
- Create: `scripts/check-daily-discovery-readiness.mjs`
- Modify: `scripts/lib/application-readiness.mjs`
- Modify: `package.json`
- Modify: `.gitignore`

1. Implement an allowlisted schema with `schemaVersion`, enabled state, schedule, agents, targets, location policy, qualification policy, thresholds, and database identity.
2. Require one scheduler owner, valid IANA timezone/local time, a nonempty coherent targeting policy, UUID database identity, overall/qualification thresholds of at least 80, and the existing seniority floor.
3. Atomically write `data/job-discovery.json` with owner-only permissions. Refuse an unignored target and preserve the previous valid file on failure.
4. Implement redacted and full local read modes needed by setup and scheduled execution.
5. Combine application readiness, profile validity, exact existing database identity, and source/mirror skill status in the readiness command. Never create or select a fallback database.
6. Run focused tests until green, then run application-readiness regressions.

## Task 3: Implement the repository privacy guard

**Files:**

- Create: `scripts/lib/privacy-check.mjs`
- Create: `scripts/privacy-check.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/pull_request_template.md`

1. Scan Git-tracked text for non-placeholder home paths, controller/worktree/desktop paths, private-state files, and known realistic fixture values.
2. Provide current-tree and full-history modes with machine-readable failure output and useful remediation messages.
3. Explicitly exclude Git author/committer metadata, license attribution, GitHub usernames, and repository URLs from content-identity rules.
4. Add the current-tree privacy check to `npm run verify` and CI/release verification through the existing script.
5. Run focused tests until green and prove representative bad fixtures fail.

## Task 4: Baseline-test and create the setup skill

**Files:**

- Create: `skills/daily-job-discovery-setup/SKILL.md`
- Create: `skills/daily-job-discovery-setup/agents/openai.yaml`
- Create: `skills/daily-job-discovery-setup/references/schedulers.md`
- Create: `.claude/skills/daily-job-discovery-setup/**`
- Create: `scripts/daily-job-discovery-setup-skill.test.ts`
- Modify: `scripts/lib/application-readiness.mjs`

1. Capture fresh baseline-agent failures without the skill for privacy, cross-agent scheduling, database reuse, and no-submit scenarios.
2. Add contract tests for setup ordering, resume-derived suggestions requiring confirmation, private persistence, one scheduler owner, existing database identity, generic scheduled prompt, provider fallback honesty, verification, and no-submit rules.
3. Initialize the skill using the skill-creator tooling and generated UI metadata.
4. Write the minimal canonical skill and scheduler reference that address observed baseline gaps.
5. Mirror the complete folder to `.claude/skills` and include it in readiness/install expectations.
6. Validate the skill folder and run contract tests until green.
7. Forward-test the completed skill in fresh agent contexts; close any identified gaps and re-run validation.

## Task 5: Make daily discovery profile-driven

**Files:**

- Modify: `skills/job-application-workflow/SKILL.md`
- Modify: `.claude/skills/job-application-workflow/SKILL.md`
- Modify: `skills/job-application-workflow/agents/openai.yaml` if generated metadata changes
- Modify: `.claude/skills/job-application-workflow/agents/openai.yaml` if generated metadata changes
- Modify: existing daily-workflow contract tests

1. Add failing tests proving the workflow rejects missing private discovery readiness and contains no candidate-specific names, locations, paths, roles, timezone, or schedule defaults.
2. Replace hardcoded targeting with the validated profile returned by discovery readiness.
3. Preserve exact live-database binding, lock, evaluator, 80/80 gates, seniority gate, dossier completeness, duplicate/inactive handling, isolated failure handling, sanitized summaries, and no-submit behavior.
4. Keep Codex and Claude mirrors byte-identical and run all daily-workflow tests.

## Task 6: Route and document the setup flow

**Files:**

- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`
- Modify: `README.md`
- Modify: `docs/agent-setup.md`
- Modify: setup/readiness/install tests

1. Add repository-source routing for setup intent before personal skill installation.
2. Add a concise “Optional daily discovery” section with the exact approved copy-and-paste prompt.
3. Explain that one agent owns the active schedule, both agent skills may be installed, local schedules require the computer and selected desktop app, the UI server may be offline, and no application is submitted.
4. Explain private storage and verify that example commands use relative paths or explicit placeholders.
5. Test skill installation and readiness for Codex-only, Claude-only, and both-agent scenarios.

## Task 7: Sanitize the tracked tree

**Files:**

- Modify: affected retained files reported by `privacy:check`
- Modify: affected fixtures and historical product documentation

1. Replace machine-specific paths with relative paths or `<project-root>`/`<skill-root>` placeholders.
2. Remove orchestration telemetry and ephemeral controller/report paths that provide no durable product value.
3. Replace realistic resume filenames, application examples, names, and personal-associated locations with clearly fictional fixtures.
4. Generalize daily specifications/plans so all targeting comes from private configuration.
5. Run `npm run privacy:check` until the current tree is clean.

## Task 8: Migrate the current private setup and scheduler

**Private local state only; do not stage or commit these values.**

1. Read the current application readiness and existing database identity.
2. Write the current user's confirmed/previously authorized preferences to ignored `data/job-discovery.json` through the configuration command.
3. Refresh installed personal Codex and Claude skills.
4. Update the existing local ChatGPT Scheduled task so its prompt is generic and loads the private profile; preserve the intended daily schedule.
5. Verify exactly one active scheduler owner and run non-mutating readiness checks.

## Task 9: Verify implementation before history rewriting

1. Run focused profile, privacy, skill, readiness, installer, daily workflow, evaluator, database identity, lock, and dossier tests.
2. Run skill validation against both repository skill copies.
3. Run `npm run verify` and `npm run build` from a clean working tree.
4. Inspect the complete diff and current-tree privacy report.
5. Commit the implementation intentionally.

## Task 10: Rewrite and publish sanitized public history

1. Inventory the exact public heads and tags and record their old object IDs locally.
2. Rewrite repository blobs using narrowly scoped replacements for private home-path prefixes, personal-associated locations/preferences, realistic resume/application fixtures, and obsolete private deployment prompt text.
3. Do not rewrite author/committer identity, license attribution, GitHub username, or repository URLs.
4. Remove rewrite backup refs and expire/prune unreachable local objects after verification.
5. Run current-tree and full-history privacy scans against every rewritten public ref.
6. Re-run `npm ci` if necessary, `npm run verify`, and `npm run build` on the rewritten checkout.
7. Force-push the rewritten default branch and rewritten public tags only after all checks pass.
8. Fetch the public remote into fresh refs, verify object IDs and privacy scans, and inspect the GitHub repository state.

## Task 11: Final acceptance

1. Confirm the working tree is clean and the public default branch contains the implementation.
2. Confirm ignored private profile/database/application materials are present locally but absent from Git objects.
3. Confirm the exact README prompt, Codex/Claude setup routing, one active local scheduler, and the existing JobTracker database binding.
4. Report the implementation, tests, history rewrite, public update, local-runtime requirement, and any unavoidable cache/fork limitation.
