# In-App Agent Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify a local-only preview-before-run job-application workflow driven by host-controlled SQLite orchestration and fixed Codex/Claude CLI adapters.

**Architecture:** Next.js routes only mutate/read a SQLite run queue. A separate TypeScript worker process claims runs, invokes schema-constrained providers with `spawn(command, args)`, performs deterministic tracker and artifact verification, and exposes only sanitized progress to a dashboard drawer.

**Tech Stack:** Next.js 16, React 19, TypeScript 5.9, better-sqlite3, Zod 4, Node child processes, Vitest 4.

## Global Constraints

- Work in `<user-home>/.codex/worktrees/c966/JobTracker`, which is already an isolated Codex-managed linked worktree.
- Preserve pre-existing changes in `README.md`, `next-env.d.ts`, `.codex/`, and `docs/goals/`; never stage or revert them unless a task explicitly owns one of those files.
- Every production edit, test edit, and repair is made by `terra-worker`; every task review and final review is performed by a fresh `sol-reviewer`.
- Use TDD: add a focused failing test, run it and capture the expected failure, implement the minimum behavior, then rerun focused tests.
- Never use a shell for provider or workflow subprocesses. Always use `spawn(command, args, { shell: false })` and write JSON/prompts to stdin.
- Never persist or display reasoning, raw environment values, raw prompts, raw stderr, or unsanitized provider events.
- Never store API keys. Host CLI authentication is the only credential source.
- Process at most one mutating execution at a time. Interrupted work is not retried automatically.
- Do not push or open a pull request.

---

### Task 1: Run domain and SQLite state machine

**Files:**
- Create: `src/lib/agent-workflow/types.ts`
- Create: `src/lib/agent-workflow/storage.ts`
- Create: `src/lib/agent-workflow/storage.test.ts`

**Interfaces:**
- Produces `AGENT_RUN_STATES`, `AgentRunState`, `AgentProviderName`, `AgentRun`, `AgentRunEvent`, `AgentPreview`, `ArtifactManifestEntry`, `PublicAgentRun`.
- Produces `createAgentRun`, `getAgentRun`, `getPublicAgentRun`, `appendAgentRunEvent`, `claimNextPreview`, `approveAgentRun`, `requestAgentRunCancellation`, `claimNextExecution`, `transitionAgentRun`, `recoverAbandonedAgentRuns`, and `resetAgentRunStorageForTests`.

- [ ] **Step 1: Define state-machine tests first.** Cover all ten exact states, legal compare-and-set edges, illegal transitions, approval idempotency rejection, queued/approval cancellation, active cancellation requests, monotonic event sequence, preview persistence, and public-view serialization.
- [ ] **Step 2: Run `npx vitest run src/lib/agent-workflow/storage.test.ts` and confirm failure because the module does not exist.**
- [ ] **Step 3: Implement typed tables and atomic storage.** Use `agent_runs`, `agent_run_events`, and `agent_worker_leases`; share `JOBTRACKER_DB_PATH`; use transactions and conditional `UPDATE ... WHERE state = ?`; serialize only validated JSON fields.
- [ ] **Step 4: Add lease/recovery tests.** Prove only one worker claims a preview, only one mutating execution lease is active, expired/foreign active work becomes `interrupted`, queued/approval work remains untouched, and interrupted rows are never requeued.
- [ ] **Step 5: Run the focused test and `npm run typecheck`; both must pass.**
- [ ] **Step 6: Report RED/GREEN evidence and the exact diff; do not touch files outside this task.**

### Task 2: Local configuration, URL validation, path containment, and diagnostics

**Files:**
- Create: `src/lib/agent-workflow/config.ts`
- Create: `src/lib/agent-workflow/config.test.ts`
- Create: `src/lib/agent-workflow/security.ts`
- Create: `src/lib/agent-workflow/security.test.ts`
- Create: `jobtracker.agent.example.json`
- Modify: `.gitignore`

**Interfaces:**
- Consumes `AgentProviderName` from Task 1.
- Produces `loadAgentConfig()`, `resolveProviderModel()`, `diagnoseProviderExecutable()`, `validatePublicJobUrl()`, `sanitizeProviderEvent()`, and `verifyArtifactPath()`.
- `validatePublicJobUrl(input, resolver?)` returns a canonical URL only after A/AAAA validation.
- `verifyArtifactPath(root, candidate)` returns the canonical real path of an existing regular file inside the real root.

- [ ] **Step 1: Write failing configuration tests.** Accept only `{ codex: { executablePath, defaultModel }, claude: { executablePath, defaultModel } }`; reject unknown keys, arguments in executable paths, credential-like keys, environment maps, blank/unsafe models, and control characters. Prove run overrides are values, not arguments.
- [ ] **Step 2: Write failing URL tests.** Reject non-HTTP schemes, credentials, missing hosts, `localhost` variants, IPv4/IPv6 loopback, RFC1918, link-local, unique-local, multicast/reserved addresses, and DNS answers containing a forbidden address; accept a normalized public HTTPS URL.
- [ ] **Step 3: Write failing path/event tests.** Reject `..` escape, prefix collisions, nonexistent paths, directories, and symlinks escaping the applications root. Prove sanitizer drops reasoning, tool inputs, environment values, unknown keys, secret/token patterns, and raw stderr while retaining bounded progress and numeric usage.
- [ ] **Step 4: Run both focused tests and confirm they fail for missing modules.**
- [ ] **Step 5: Implement the minimum validated config/security functions.** Use Zod strict objects, `dns.promises.resolve4/resolve6`, `net.isIP`, `fs.realpath`, `fs.stat`, and segment-safe `path.relative` containment. Resolve executable basenames from `PATH` without persisting `PATH`; invoke only `--version` for diagnostics.
- [ ] **Step 6: Add `jobtracker.agent.local.json` to `.gitignore` and add a tracked example with Codex `gpt-5.6-terra` plus a documented Claude default.** No credential or argument fields are allowed.
- [ ] **Step 7: Run focused tests and `npm run typecheck`; both must pass.**

### Task 3: Fixed Codex and Claude adapters

**Files:**
- Create: `src/lib/agent-workflow/schemas.ts`
- Create: `src/lib/agent-workflow/prompts.ts`
- Create: `src/lib/agent-workflow/providers.ts`
- Create: `src/lib/agent-workflow/providers.test.ts`

**Interfaces:**
- Consumes config resolution, sanitized events, preview/manifest domain types.
- Produces `AgentProvider` with `diagnose(): Promise<ProviderDiagnostic>`, `preview(request, hooks): Promise<AgentPreviewResult>`, and `createMaterials(request, hooks): Promise<MaterialsResult>`.
- Produces `createCodexProvider`, `createClaudeProvider`, `buildCodexInvocation`, and `buildClaudeInvocation` for deterministic command testing.

- [ ] **Step 1: Write failing command-construction tests.** Assert exact argument arrays, `shell: false`, stdin prompt use, no job URL/model interpolation into command text, Codex preview `read-only`, Codex execution `workspace-write` plus applications root, Claude preview `plan`, and Claude execution `acceptEdits` with narrow tools.
- [ ] **Step 2: Add shell-injection cases.** Use URLs/models containing spaces, quotes, semicolons, `$()`, newlines, and leading dashes; invalid models must be rejected and valid URL data must only appear in stdin prompt content.
- [ ] **Step 3: Add output tests.** Parse Codex JSONL/final output and Claude stream JSON/`structured_output`; accept only schema-valid preview/manifest values; surface safe usage; ignore reasoning/tool payloads; convert nonzero exit, malformed JSON, timeout, and cancellation into stable safe errors.
- [ ] **Step 4: Run `npx vitest run src/lib/agent-workflow/providers.test.ts` and confirm the expected missing-module failure.**
- [ ] **Step 5: Implement schemas, prompts, and adapters.** Use temporary schema/result files with cleanup in `finally`; use `spawn` injection for tests; never persist raw stdout/stderr. Preview prompts call the URL untrusted and allow no writes. Materials prompts explicitly require `job-application-resume`, forbid tracker/registration writes, and return a structured manifest.
- [ ] **Step 6: Run focused tests and `npm run typecheck`; both must pass.**

### Task 4: Worker orchestration and deterministic reconciliation

**Files:**
- Create: `src/lib/agent-workflow/process.ts`
- Create: `src/lib/agent-workflow/orchestrator.ts`
- Create: `src/lib/agent-workflow/orchestrator.test.ts`
- Create: `scripts/agent-worker.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes Tasks 1-3 and existing `scripts/upsert-job-posting.mjs` plus `scripts/register-application-artifact.mjs`.
- Produces `processNextAgentRun(dependencies)`, `runAgentWorker(options)`, `runJsonCommand(command, args, input, options)`, and CLI script `npm run agent:worker`.

- [ ] **Step 1: Write a failing end-to-end orchestrator unit test with a fake provider and temporary DB/applications directory.** Prove `queued_preview → previewing → awaiting_approval`, no tracker mutation before approval, then `queued_execution → executing → verifying → succeeded` with verified application id and artifact links.
- [ ] **Step 2: Add deterministic upsert tests.** Assert JobTracker invokes `process.execPath` with `scripts/upsert-job-posting.mjs --input-json - --reactivate`, parses JSON, accepts only `created|updated`, requires matching company/role/canonical URL/status, note ids and changes, and confirms SQLite readback before materials invocation.
- [ ] **Step 3: Add artifact reconciliation tests.** A fake manifest containing a missing file, wrong extension/type, duplicate entry, traversal, or symlink escape must fail before registration. Valid entries invoke the registration script with `--application-id`, then require artifact SQLite readback.
- [ ] **Step 4: Add cancellation and restart tests.** Cancellation before execution must create no application; cancellation while a child runs must terminate it and end `cancelled`; startup recovery must mark abandoned active rows `interrupted` and never automatically rerun them.
- [ ] **Step 5: Run the focused test and confirm expected missing-module failures.**
- [ ] **Step 6: Implement the worker.** Poll with an abortable short interval, recover once on startup, claim previews independently, guard execution with the global lease, heartbeat active leases, stop children on cancellation, append only sanitized events, and release leases in `finally`.
- [ ] **Step 7: Add `"agent:worker": "tsx scripts/agent-worker.ts"` to `package.json`.** The route layer must never import or invoke the worker loop.
- [ ] **Step 8: Run focused tests and `npm run typecheck`; both must pass.**

### Task 5: Run and diagnostics API

**Files:**
- Create: `src/app/api/agent-runs/route.ts`
- Create: `src/app/api/agent-runs/route.test.ts`
- Create: `src/app/api/agent-runs/[id]/route.ts`
- Create: `src/app/api/agent-runs/[id]/approve/route.ts`
- Create: `src/app/api/agent-runs/[id]/cancel/route.ts`
- Create: `src/app/api/agent-providers/route.ts`

**Interfaces:**
- Consumes Tasks 1-2 only; API routes must not import provider execution or worker modules.
- `POST /api/agent-runs` accepts `{ jobUrl, provider, model? }` and returns `202` with a public run.
- `GET /api/agent-runs/:id`, `POST /approve`, `POST /cancel`, and `GET /api/agent-providers` return only public/sanitized data.

- [ ] **Step 1: Write failing route tests.** Cover valid enqueue, malformed JSON, extra/multiple URLs, forbidden/private URLs, unavailable provider, unsafe model override, missing run, illegal approval state, cancellation semantics, and diagnostics shape.
- [ ] **Step 2: Assert routes never invoke a model.** Mock/guard child process creation and prove every handler only validates, reads, or changes SQLite state.
- [ ] **Step 3: Run the route test and confirm failure because routes do not exist.**
- [ ] **Step 4: Implement strict request validation and stable status codes.** Use `400` invalid input, `404` missing run, `409` illegal transition/unavailable provider, `202` enqueue, and `200` for reads/actions. Do not return stack traces or raw provider/config errors.
- [ ] **Step 5: Run focused tests and `npm run typecheck`; both must pass.**

### Task 6: Apply-with-agent drawer and polling workflow

**Files:**
- Create: `src/components/ApplyWithAgentDrawer.tsx`
- Create: `src/components/ApplyWithAgentDrawer.test.tsx`
- Modify: `src/components/Dashboard.tsx`
- Modify: `src/components/Dashboard.test.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes the Task 5 API and `PublicAgentRun`/diagnostic types.
- Produces an accessible dashboard drawer whose polling stops at `awaiting_approval` and all terminal states.

- [ ] **Step 1: Write failing component tests with fake timers/fetch.** Cover open/close, one URL field, provider/default-model display, optional override, provider unavailability, enqueue, sanitized progress, preview rendering, explicit approval, cancellation, failure, success links, and no model call from UI.
- [ ] **Step 2: Prove polling behavior.** Poll while queued/active, stop exactly at `awaiting_approval`, resume only after a successful approve response, and stop at `succeeded|failed|cancelled|interrupted`. Unmount must clear timers and abort fetches.
- [ ] **Step 3: Run the component tests and confirm missing-component/markup failures.**
- [ ] **Step 4: Implement the drawer and dashboard trigger.** Use a dialog-labeled fixed drawer, chat-like messages, live progress region, form labels, focus restoration, preview card, approval/cancel actions, provider/model controls, and completion links to `/applications/:id` and artifact fragments.
- [ ] **Step 5: Add responsive styles.** Desktop uses a right-side drawer; at `max-width: 760px` it fills the viewport width and keeps controls at least 44px high.
- [ ] **Step 6: Run both component tests, `npm run typecheck`, and `npm run lint`; all must pass.**

### Task 7: Full integration harness and operator documentation

**Files:**
- Create: `src/lib/agent-workflow/integration.test.ts`
- Create: `scripts/smoke-agent-workflow.ts`
- Create: `docs/agent-workflow.md`
- Modify: `.env.example`

**Interfaces:**
- Consumes the completed workflow.
- Produces `npm exec tsx scripts/smoke-agent-workflow.ts -- --provider codex --model gpt-5.6-terra --job-url <public-url>` and equivalent optional Claude invocation.

- [ ] **Step 1: Add a failing fake-provider integration test.** Use temporary SQLite, applications root, and synthetic resume. Exercise API-equivalent enqueue/approve plus the real worker orchestration, real upsert script, real register script, application/artifact readback, and final public links.
- [ ] **Step 2: Run the integration test and confirm the intended failure before completing the harness.**
- [ ] **Step 3: Implement the smoke harness.** Create temporary private inputs, set temporary `JOBTRACKER_DB_PATH`, `JOBTRACKER_APPLICATIONS_DIR`, and `JOBTRACKER_BASE_RESUME_PATH`, run preview, print the safe preview, require explicit `--approve` for execution, then verify terminal success, application detail data, artifact files, and registrations. Always remove temporary state unless `--keep-temp` is passed.
- [ ] **Step 4: Document setup and operations.** Explain the ignored local JSON config, `npm run agent:worker`, provider diagnostics, preview/approval/cancel flow, restart interruption semantics, privacy boundaries, fake integration command, real smoke command, and optional Claude smoke rule. `.env.example` may document paths already used by the workflow but must not add API-key fields.
- [ ] **Step 5: Run `npx vitest run src/lib/agent-workflow/integration.test.ts`, then `npm run verify` and `npm run build`; all must pass.**

## Controller verification and completion

- [ ] Run the fake-provider integration test in a fresh temporary directory.
- [ ] Confirm `/opt/homebrew/bin/codex` is current enough to accept `gpt-5.6-terra`; run one authenticated Codex smoke with a public job URL, temporary database/applications directory, and synthetic resume; require preview, approval, successful materials, file containment, registration, and application-detail readback.
- [ ] Run a real Claude smoke only if `claude` is installed and diagnostics show it authenticated; otherwise record the allowed limitation.
- [ ] Start `npm run dev` and `npm run agent:worker`; use browser checks at desktop and mobile widths to verify opening, preview, approval stop, cancellation, success, and artifact links.
- [ ] Run `git status --short --ignored` and confirm `.env.local`, `jobtracker.agent.local.json`, `data/*.sqlite*`, resumes, `.superpowers/`, and `applications/*` remain ignored/uncommitted.
- [ ] Run `npm run verify` and `npm run build` again after browser verification.
- [ ] Generate a complete review package from the original merge base and dispatch one fresh `sol-reviewer`. Send all blocking findings in one batch to one `terra-worker` fixer and re-review until no blocking findings remain.
- [ ] Mark the persistent goal complete only after all checks above pass.

## Plan self-review

- Spec coverage: every required state, process boundary, provider control, security condition, API action, UI behavior, and verification item maps to a task.
- Placeholder scan: no `TBD`, deferred implementation, or unspecified error-handling step remains.
- Type consistency: Tasks 2-7 consume the Task 1 domain names; route/UI shapes use `PublicAgentRun`; worker/provider boundaries use `AgentPreview` and `ArtifactManifestEntry`.
- Ownership: each task has an explicit write set, tasks execute sequentially, and reviewers never edit.
