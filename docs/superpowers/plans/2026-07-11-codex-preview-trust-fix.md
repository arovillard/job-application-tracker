# Codex Preview Trust Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow isolated Codex preview invocations to run from JobTracker's temporary directory and prove the supplied LinkedIn posting reaches approval.

**Architecture:** Keep the existing temporary-directory security boundary and add Codex's explicit non-Git execution flag only for preview operations. For validated LinkedIn job-view pages lacking JSON-LD, derive evidence from LinkedIn's exact public title convention and visible page text, while every other host retains the complete schema.org requirement. Lock both contracts in unit tests, then verify with the actual configured Codex executable and live JobTracker worker.

**Tech Stack:** TypeScript, Vitest, Next.js, Codex CLI, SQLite

## Global Constraints

- Implement directly in the current session; do not delegate to a worker or reviewer.
- Do not push or open a pull request.
- Preserve existing `README.md`, `next-env.d.ts`, `.codex/`, and `docs/goals/` working-tree changes.
- Do not weaken the read-only preview sandbox or expose raw provider stderr in the UI.

---

### Task 1: Correct and verify the Codex preview invocation

**Files:**
- Modify: `src/lib/agent-workflow/providers.test.ts:38-97`
- Modify: `src/lib/agent-workflow/providers.ts:154-183`

**Interfaces:**
- Consumes: `buildCodexInvocation(input: CodexInvocationInput): ProviderInvocation`
- Produces: the same `ProviderInvocation` shape with `--skip-git-repo-check` present only when `input.operation === "preview"`

- [ ] **Step 1: Write the failing invocation-contract test**

Update the exact preview expectation so `args` contains `--skip-git-repo-check` after `--ignore-user-config`, and add a materials assertion proving the flag is absent.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run src/lib/agent-workflow/providers.test.ts`

Expected: the preview invocation test fails because the new flag is missing.

- [ ] **Step 3: Implement the minimal command change**

Insert `...(input.operation === "preview" ? ["--skip-git-repo-check"] : [])` into the Codex argument list immediately after the existing preview-only `--ignore-user-config` option.

- [ ] **Step 4: Write the failing LinkedIn evidence test**

Add a retrieval fixture with no JSON-LD, a title matching `lululemon hiring Principal AI/ML Applied Scientist in Example City, British Columbia, Example Country | LinkedIn`, and non-empty visible responsibility text. Require `structuredJobPosting` to contain the parsed company, role, and visible text. Add a non-LinkedIn control proving the same markup remains unstructured.

- [ ] **Step 5: Implement the LinkedIn-only evidence fallback**

Pass the validated final URL into HTML extraction. When no complete schema.org evidence exists, require a `linkedin.com` hostname, a `/jobs/view/` path, the exact LinkedIn title convention, and non-empty visible body text before constructing `StructuredJobPosting`. Do not infer evidence for any other host or page shape.

- [ ] **Step 6: Run focused and full automated verification**

Run:

```bash
npx vitest run src/lib/agent-workflow/providers.test.ts
npx vitest run src/lib/agent-workflow/retrieval.test.ts src/lib/agent-workflow/orchestrator.test.ts
npm run verify
npm run build
```

Expected: all commands exit 0; build may emit only the existing Turbopack NFT tracing warning.

- [ ] **Step 7: Run the real acceptance test**

Queue `https://www.linkedin.com/jobs/view/4427875246` against the live local API with provider `codex`, poll the returned run ID, and require state `awaiting_approval`, a non-empty company, a non-empty role, and no failure code.

- [ ] **Step 8: Commit the scoped correction**

Stage only the spec, plan, provider implementation/test, and retrieval implementation/test. Commit with `fix: support real LinkedIn Codex previews`.
