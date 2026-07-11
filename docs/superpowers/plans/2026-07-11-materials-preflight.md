# Application Materials Preflight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent materials execution without a readable resume and complete the lululemon package with all three required artifacts.

**Architecture:** Validate the selected resume at the approval boundary, pass its parent directory into the Codex materials sandbox, and enforce the skill's three-artifact contract during host reconciliation. Configure the selected resume in ignored local state and prove the real workflow end to end.

**Tech Stack:** Next.js route handlers, TypeScript, Vitest, Codex CLI, SQLite

## Global Constraints

- Implement directly without workers or reviewers.
- Do not push or open a pull request.
- Never commit `.env.local`, databases, generated materials, or the selected resume.
- Preserve existing `README.md`, `next-env.d.ts`, `.codex/`, and `docs/goals/` changes.
- Do not expose raw filesystem errors or private resume paths in public API responses.

---

### Task 1: Block unsafe approval

**Files:**
- Modify: `src/app/api/agent-runs/[id]/approve/route.ts`
- Test: `src/app/api/agent-runs/route.test.ts`

**Interfaces:**
- Consumes: `process.env.JOBTRACKER_BASE_RESUME_PATH`
- Produces: approval HTTP 409 with the fixed safe error when the configured path is absent or invalid

- [ ] Write a route test that places a run in `awaiting_approval`, removes `JOBTRACKER_BASE_RESUME_PATH`, and requires status 409 while state remains unchanged.
- [ ] Run `npx vitest run src/app/api/agent-runs/route.test.ts` and confirm the new assertion fails because approval currently succeeds.
- [ ] Add a readable-regular-file preflight before `approveAgentRunAndGetPublic`.
- [ ] Re-run the route suite and confirm it passes.

### Task 2: Grant resume access and require the complete package

**Files:**
- Modify: `src/lib/agent-workflow/providers.ts`
- Test: `src/lib/agent-workflow/providers.test.ts`
- Modify: `src/lib/agent-workflow/orchestrator.ts`
- Test: `src/lib/agent-workflow/orchestrator.test.ts`
- Test: `src/lib/agent-workflow/integration.test.ts`

**Interfaces:**
- Consumes: `ProviderFactoryOptions.baseResumePath`
- Produces: materials invocation with the external resume parent in `--add-dir`; reconciliation requires `fit_analysis`, `outreach_message`, and `resume`

- [ ] Update exact invocation expectations to require the resume parent only for materials and run the provider suite RED.
- [ ] Add `baseResumePath` to `CodexInvocationInput`, pass it from `runCodex`, and append its parent with `--add-dir` for materials.
- [ ] Add a reconciliation test whose fit-only manifest fails, then replace the integration fixture with all three required artifacts including a non-empty PDF fixture.
- [ ] Run provider, orchestrator, and integration suites until GREEN.

### Task 3: Configure and prove the real workflow

**Files:**
- Create ignored local file: `.env.local`

**Interfaces:**
- Produces: `JOBTRACKER_DB_PATH`, `JOBTRACKER_APPLICATIONS_DIR`, and `JOBTRACKER_BASE_RESUME_PATH` for the web and worker processes

- [ ] Write `.env.local` with absolute paths and verify it is ignored.
- [ ] Run `npm run verify` and `npm run build`.
- [ ] Restart `npm run dev -- --port 3001` and verify combined readiness and online health.
- [ ] Queue and approve the lululemon URL, wait for `succeeded`, capture the returned application ID in `application_id`, inspect registered artifacts, and run `node scripts/verify-application-package.mjs --application-id "$application_id"`.
- [ ] Commit only tracked source, test, spec, and plan changes with `fix: preflight complete application materials`.
