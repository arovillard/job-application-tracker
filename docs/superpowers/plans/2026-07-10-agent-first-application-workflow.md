# Agent-First Application Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Apply with Agent the trustworthy primary application path through bounded host retrieval, semantic preview gating, visible activity, restartable terminal states, and agent-first dashboard actions.

**Architecture:** The worker securely retrieves and extracts public posting content before provider invocation, passes only bounded untrusted text into an isolated preview process, and rejects unusable previews before approval. The existing drawer gains a current-stage activity surface, elapsed time, numeric usage, and deterministic local reset behavior; the dashboard and manual-entry copy make agent use primary and manual creation secondary.

**Tech Stack:** Next.js 16, React 19, TypeScript 5.9, SQLite/better-sqlite3, Vitest/jsdom, Cheerio 1.2.0, native Fetch/AbortController, Codex and Claude CLIs.

## Global Constraints

- Preserve the existing SQLite state machine and API-only enqueue/approve/cancel/read architecture.
- Follow at most 5 manually handled redirects and revalidate every redirect destination.
- Use a 15-second total retrieval timeout, a 2 MiB response-byte ceiling, and a 32,000 UTF-8-character extracted-context ceiling.
- Accept only `text/html`, `application/xhtml+xml`, and `text/plain` posting responses.
- Never use browser cookies, credentials, authenticated sessions, raw response headers, or private environment values.
- Never persist raw HTML, raw network/provider errors, cookies, resolved addresses, or unsanitized content.
- Preview failures must never expose approval; active and approval-pending runs remain resumable after close.
- Terminal reset is local UI state only and never deletes SQLite history.
- Respect `prefers-reduced-motion: reduce` while retaining textual activity feedback.
- Manual creation remains functional but is visibly and verbally secondary to Apply with Agent.
- Use strict red-green TDD, preserve pre-existing working-tree changes, and do not push or open a pull request.

---

### Task 1: Implement the corrective agent-first workflow

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/lib/agent-workflow/retrieval.ts`
- Create: `src/lib/agent-workflow/retrieval.test.ts`
- Modify: `src/lib/agent-workflow/types.ts`
- Modify: `src/lib/agent-workflow/prompts.ts`
- Modify: `src/lib/agent-workflow/providers.ts`
- Modify: `src/lib/agent-workflow/providers.test.ts`
- Modify: `src/lib/agent-workflow/orchestrator.ts`
- Modify: `src/lib/agent-workflow/orchestrator.test.ts`
- Modify: `src/lib/agent-workflow/integration.test.ts`
- Modify: `src/components/ApplyWithAgentDrawer.tsx`
- Modify: `src/components/ApplyWithAgentDrawer.test.tsx`
- Modify: `src/components/Dashboard.tsx`
- Modify: `src/components/Dashboard.test.tsx`
- Modify: `src/components/ApplicationTable.tsx`
- Modify: `src/components/NewApplicationPage.tsx`
- Modify: `src/app/globals.css`
- Modify: `docs/agent-workflow.md`

**Interfaces:**
- Produce in `retrieval.ts`:

```ts
export type RetrievedPosting = {
  requestedUrl: string;
  finalUrl: string;
  context: string;
};

export type PostingRetrievalOptions = {
  fetchImpl?: typeof fetch;
  validateUrl?: (url: string) => Promise<string>;
  timeoutMs?: number;
  maximumBytes?: number;
  maximumCharacters?: number;
  maximumRedirects?: number;
};

export class PostingRetrievalError extends Error {
  readonly code: "posting_retrieval_failed";
}

export async function retrievePublicPosting(
  canonicalUrl: string,
  options?: PostingRetrievalOptions
): Promise<RetrievedPosting>;
```

- Extend `AgentProviderRequest` with `postingContext?: string` and `postingFinalUrl?: string`.
- Extend `AgentOrchestratorDependencies` with `retrievePosting?: typeof retrievePublicPosting` for deterministic tests.
- Add `export function isUsablePreview(preview: AgentPreview): boolean` in `orchestrator.ts` or a focused schema helper imported by it.
- Preserve all existing API response types and SQLite columns.

- [ ] **Step 1: Install the parser dependency**

Run:

```bash
npm install cheerio@^1.2.0
```

Expected: `package.json` and `package-lock.json` add Cheerio without changing unrelated dependencies.

- [ ] **Step 2: Write retrieval RED tests**

Create `src/lib/agent-workflow/retrieval.test.ts` with real streamed `Response` fixtures and an injected fetch function. Cover the exact limits and error boundaries:

```ts
it("extracts bounded context from a LinkedIn-like guest posting", async () => {
  const html = `<!doctype html><html><head>
    <link rel="canonical" href="https://ca.linkedin.com/jobs/view/technical-director-4437590390">
    <meta property="og:title" content="Technical Director at Thrillworks">
    <meta name="description" content="Lead technical strategy and delivery.">
    <script type="application/ld+json">${JSON.stringify({
      "@type": "JobPosting",
      title: "Technical Director",
      hiringOrganization: { name: "Thrillworks" },
      jobLocationType: "TELECOMMUTE",
      description: "Lead architecture and engineering delivery."
    })}</script>
  </head><body><main>Technical Director Thrillworks Lead architecture.</main></body></html>`;
  const result = await retrievePublicPosting("https://www.linkedin.com/jobs/view/4437590390", {
    fetchImpl: async () => new Response(html, { status: 200, headers: { "content-type": "text/html" } }),
    validateUrl: async (url) => url
  });
  expect(result.finalUrl).toContain("linkedin.com/jobs/view");
  expect(result.context).toContain("Technical Director");
  expect(result.context).toContain("Thrillworks");
  expect(result.context).not.toContain("<script");
  expect(result.context.length).toBeLessThanOrEqual(32_000);
});
```

Add cases for plain text, a valid redirect, private redirect rejection, sixth redirect rejection, redirect loop, timeout, non-2xx, unsupported content type, empty extraction, a stream exceeding `2 * 1024 * 1024`, malformed JSON-LD tolerance, duplicate-text removal, and forbidden raw values absent from the thrown safe error.

Run:

```bash
npx vitest run src/lib/agent-workflow/retrieval.test.ts
```

Expected: RED because `retrieval.ts` does not exist.

- [ ] **Step 3: Implement bounded retrieval and extraction**

Implement `retrievePublicPosting` with these exact defaults:

```ts
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAXIMUM_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAXIMUM_CHARACTERS = 32_000;
const DEFAULT_MAXIMUM_REDIRECTS = 5;
const USER_AGENT = "JobTracker/0.1 local-agent-preview";
const ACCEPTED_CONTENT_TYPES = new Set(["text/html", "application/xhtml+xml", "text/plain"]);
```

Use one `AbortController` for the total deadline, `redirect: "manual"`, and `validatePublicJobUrl` by default. Resolve relative `Location` values against the current URL, validate before the next fetch, track visited canonical destinations, and throw only `new PostingRetrievalError()` externally.

Read `response.body` with a reader, count bytes before concatenation, cancel and fail once the ceiling is crossed, and decode only after the stream completes. For HTML, use Cheerio to remove `script` after separately parsing valid `application/ld+json`, plus `style`, `nav`, `form`, `noscript`, `[hidden]`, and `[aria-hidden="true"]`. Build labeled sections from canonical URL, title/meta fields, `JobPosting` title/company/location/description, and readable body text. Collapse whitespace, discard duplicate normalized sections, join with newlines, and truncate by Unicode code points to the character ceiling.

Run:

```bash
npx vitest run src/lib/agent-workflow/retrieval.test.ts
```

Expected: all retrieval tests GREEN.

- [ ] **Step 4: Write provider isolation and prompt RED tests**

Update provider tests to require:

```ts
expect(invocation.args).toContain("--ignore-user-config");
expect(invocation.cwd).toBe(temporaryPreviewDirectory);
expect(invocation.stdin).toContain("UNTRUSTED_RETRIEVED_POSTING");
expect(invocation.stdin).toContain("Technical Director at Thrillworks");
```

Also assert the materials invocation does not gain `--ignore-user-config`, retains the project cwd and applications directory, and still requests `job-application-resume`.

Run:

```bash
npx vitest run src/lib/agent-workflow/providers.test.ts
```

Expected: RED because preview request/context and invocation isolation are missing.

- [ ] **Step 5: Implement provider context and isolated preview invocation**

Extend the request type and preview prompt:

```text
<UNTRUSTED_RETRIEVED_POSTING_FINAL_URL>
"https://public.example/final"
</UNTRUSTED_RETRIEVED_POSTING_FINAL_URL>
<UNTRUSTED_RETRIEVED_POSTING>
"bounded extracted posting text"
</UNTRUSTED_RETRIEVED_POSTING>
```

For Codex preview only, set `cwd` and `--cd` to the already-created temporary directory and add `--ignore-user-config`. Keep `--ephemeral`, `--json`, `--sandbox read-only`, explicit model, schema, output file, safe environment allowlist, and no additional writable directory. Do not change materials invocation or Claude’s explicit preview tool restrictions except to pass the retrieved context in its prompt.

Run:

```bash
npx vitest run src/lib/agent-workflow/providers.test.ts
```

Expected: provider suite GREEN.

- [ ] **Step 6: Write orchestration quality-gate RED tests**

Add focused tests proving:

```ts
it("retrieves before provider preview and passes only bounded context", async () => {
  const retrievePosting = vi.fn(async () => ({
    requestedUrl: run.canonicalJobUrl,
    finalUrl: run.canonicalJobUrl,
    context: "Technical Director at Thrillworks"
  }));
  // Process preview and assert retrievePosting precedes provider.preview.
  // Assert the provider receives postingContext and postingFinalUrl.
});

it.each([
  { company: "Unknown", role: "Engineer", summary: "Valid" },
  { company: "Acme", role: "N/A", summary: "Valid" },
  { company: "Acme", role: "Engineer", summary: "The public posting could not be retrieved." }
])("fails an unusable preview without exposing approval", async (candidate) => {
  // Assert failed/preview_unusable and no awaiting_approval transition.
});
```

Add retrieval rejection asserting provider preview is never called, final state is `failed`, failure code is `posting_retrieval_failed`, safe failure message is exact, and events contain only the four approved stage strings as applicable. Update all existing fake providers/dependencies to supply deterministic retrieval so tests never access the network.

Run:

```bash
npx vitest run src/lib/agent-workflow/orchestrator.test.ts src/lib/agent-workflow/integration.test.ts
```

Expected: RED for missing retrieval and semantic gate.

- [ ] **Step 7: Implement orchestration retrieval, stages, and quality gate**

In `processPreview`:

1. append `Validating public job URL.`;
2. call `validatePublicJobUrl` again or rely on the retriever’s mandatory validation boundary;
3. append `Retrieving public job posting.`;
4. call injected/default `retrievePublicPosting` inside `activePhase`;
5. map `PostingRetrievalError` to `posting_retrieval_failed` and the exact safe message;
6. append `Analyzing job posting.`;
7. pass transient context/final URL to the provider inside `activePhase`;
8. reject an unusable preview with `SafeWorkflowError("preview_unusable", exactMessage)`;
9. transition to approval and append `Preview ready for approval.` only on success.

Make failure classification preserve these two safe workflow codes instead of replacing them with `preview_failed`. Keep lease ownership, cancellation, and cleanup semantics unchanged.

Run:

```bash
npx vitest run src/lib/agent-workflow/orchestrator.test.ts src/lib/agent-workflow/integration.test.ts
```

Expected: orchestration and integration suites GREEN with no network calls.

- [ ] **Step 8: Write drawer activity and restart RED tests**

In `ApplyWithAgentDrawer.test.tsx`, use fake timers to prove:

- active state displays an element with accessible name **Agent work in progress**, exact current-stage copy, `Working…`, and elapsed values `0:00`, then `0:01`, then `1:05`;
- events render human-readable timestamps without exposing metadata;
- usage `{ input_tokens: 208992, output_tokens: 1241, cached_input_tokens: 150784 }` renders `208,992 input`, `1,241 output`, and `150,784 cached`;
- `preview_unusable` and `posting_retrieval_failed` never render approval and show **Try another URL**;
- all four terminal states show **Start another application**;
- terminal → close → reopen produces one blank required URL input and no old event timeline;
- active or awaiting approval → close → reopen preserves the run;
- **Start another application** resets local fields but does not call a delete endpoint;
- all timer chains and in-flight requests are cleared during reset/unmount.

Run:

```bash
npx vitest run src/components/ApplyWithAgentDrawer.test.tsx
```

Expected: RED for missing activity and reset behavior.

- [ ] **Step 9: Implement activity, safe failure, and reset UI**

Add derived helpers for active/terminal states, stage labels, elapsed formatting, event time formatting, and usage formatting. Use a single one-second client timer only while the drawer is open and the run is active. The current activity region must include:

```tsx
<div className="agent-activity" role="status" aria-label="Agent work in progress">
  <span className="agent-activity__spinner" aria-hidden="true" />
  <div><strong>{currentStage}</strong><span>Working… · {formatElapsed(elapsedSeconds)}</span></div>
</div>
```

Centralize local reset so it invalidates requests, clears polling/timer state, and resets `run`, URL, model, error, and pending while retaining diagnostics and a valid selected provider. On close, preserve active/approval states; mark terminal state to reset on the next open. Add **Start another application** to terminal screens and **Try another URL** for the two safe preview failure codes. Never display `failureMessage` unless it equals an approved safe UI message.

Run:

```bash
npx vitest run src/components/ApplyWithAgentDrawer.test.tsx
```

Expected: drawer suite GREEN.

- [ ] **Step 10: Write agent-first dashboard RED tests**

Update `Dashboard.test.tsx` and add focused `ApplicationTable` markup assertions if needed:

```ts
expect(markup.indexOf("Apply with Agent")).toBeLessThan(markup.indexOf("Add existing application"));
expect(markup).toContain("Start your next application");
expect(markup).toContain("Already applied? Add it manually");
```

Render the interactive dashboard with an empty API response, click the empty-state **Apply with Agent**, and assert the drawer opens. Assert the secondary manual action links to `/applications/new`. For a populated response, assert **Apply with Agent** uses primary-button styling and **Add existing application** is secondary.

Run:

```bash
npx vitest run src/components/Dashboard.test.tsx
```

Expected: RED because manual creation is currently primary and the empty agent CTA is absent.

- [ ] **Step 11: Implement dashboard and manual-path hierarchy**

In the dashboard header, render **Apply with Agent** as `button button--primary agent-drawer-trigger` before the secondary manual link. Rename the link **Add existing application** and remove primary styling. Preserve the `N` shortcut for manual entry.

Extend `ApplicationTable` with an optional agent-first empty-action contract:

```ts
type EmptyActions = {
  onApplyWithAgent(): void;
  manualHref: string;
};
```

When this contract is supplied, render the exact approved empty-state heading/body and primary/secondary actions. Do not render those actions for filtered/search-empty states. Update `NewApplicationPage` eyebrow/heading/support copy to identify manual entry as the already-applied path without changing form fields or persistence.

Run:

```bash
npx vitest run src/components/Dashboard.test.tsx
```

Expected: dashboard suite GREEN.

- [ ] **Step 12: Add activity and hierarchy styling**

Add focused CSS for `.agent-activity`, `.agent-activity__spinner`, `.agent-usage`, `.agent-event-time`, `.application-table__empty-actions`, and secondary manual actions. Use a transform/opacity spinner keyframe and include:

```css
@media (prefers-reduced-motion: reduce) {
  .agent-activity__spinner { animation: none; }
}
```

Preserve the existing global reduced-motion rule, 440px desktop drawer, 100vw mobile drawer, keyboard focus styles, and no-horizontal-overflow behavior.

- [ ] **Step 13: Update operational documentation**

Update `docs/agent-workflow.md` to document host retrieval limits, transient extracted context, preview failure semantics, isolated Codex preview cwd/config, activity stages, restart behavior, and agent-first/manual-backup positioning. Do not add credentials or machine-specific paths.

- [ ] **Step 14: Run focused and complete verification**

Run:

```bash
npx vitest run \
  src/lib/agent-workflow/retrieval.test.ts \
  src/lib/agent-workflow/providers.test.ts \
  src/lib/agent-workflow/orchestrator.test.ts \
  src/lib/agent-workflow/integration.test.ts \
  src/components/ApplyWithAgentDrawer.test.tsx \
  src/components/Dashboard.test.tsx
npm run verify
npm run build
```

Expected: all focused tests, lint, typecheck, the complete suite, and production build pass. The already-documented nonfatal Turbopack NFT warning may remain; no new warning is acceptable.

- [ ] **Step 15: Perform privacy and diff review**

Run:

```bash
git diff --check
git status --short
git check-ignore -v jobtracker.agent.local.json .env.local data/jobtracker.sqlite applications/example/output.md .superpowers/sdd/progress.md
```

Expected: no whitespace errors; only the explicit task write set is changed; existing `README.md`, `next-env.d.ts`, `.codex/`, and `docs/goals/` user changes remain untouched; private/generated paths remain ignored.

- [ ] **Step 16: Commit the implementation**

```bash
git add package.json package-lock.json \
  src/lib/agent-workflow/retrieval.ts src/lib/agent-workflow/retrieval.test.ts \
  src/lib/agent-workflow/types.ts src/lib/agent-workflow/prompts.ts \
  src/lib/agent-workflow/providers.ts src/lib/agent-workflow/providers.test.ts \
  src/lib/agent-workflow/orchestrator.ts src/lib/agent-workflow/orchestrator.test.ts \
  src/lib/agent-workflow/integration.test.ts \
  src/components/ApplyWithAgentDrawer.tsx src/components/ApplyWithAgentDrawer.test.tsx \
  src/components/Dashboard.tsx src/components/Dashboard.test.tsx \
  src/components/ApplicationTable.tsx src/components/NewApplicationPage.tsx \
  src/app/globals.css docs/agent-workflow.md
git commit -m "feat: make agent workflow trustworthy and primary"
```

Expected: one implementation commit containing only the explicit write set.
