# Attention Context Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the exact reason an opportunity needs attention from the dashboard into a clear, actionable, and accessible detail-page arrival surface.

**Architecture:** Add a pure attention-domain module for explicit task-aware URLs and fresh-detail validation. Keep the dashboard, server route, client detail orchestration, contextual presentation, and task-list focus targets separate; reuse the existing task PATCH and dialog flows without persistence changes.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Vitest/jsdom, CSS, existing SQLite-backed opportunity APIs.

## Global Constraints

- Implement `docs/specs/attention-context-handoff.md` exactly; later scope, architecture, acceptance, or task-boundary changes require artifact revision and renewed approval.
- No database schema, migration, storage, API route, dependency, authentication, or authorization change.
- No dedicated triage queue and no permanent redesign of ordinary detail visits.
- No task title in URL; search parameters carry only attention kind and opaque record/task IDs.
- Fresh fetched detail data is authoritative; navigation never mutates data.
- Ordinary `/opportunities/:id` visits retain current behavior.
- All new pressable controls and attention links are at least 44px tall.
- No attention animation, keyboard-triggered animation, `transition: all`, scale-from-zero, or ungated hover transform.
- Preserve existing modal focus, task ordering, pending-lock, error, responsive, dark-theme, and reduced-motion contracts.
- Serialize all implementation writers. Every task gets focused deterministic checks and a fresh `sol-reviewer` pass before its dependent task begins.

---

## File responsibility map

- `src/lib/opportunity-attention.ts`: pure target type, URL build/parse, forward-motion rule, and fresh-detail resolver.
- `src/lib/opportunity-attention.test.ts`: target parsing/building and active/resolved rule matrix.
- `src/lib/dashboard.ts` / `src/lib/dashboard.test.ts`: explicit `taskId` derivation and existing attention ordering.
- `src/components/AttentionQueue.tsx` / `src/components/AttentionQueue.test.tsx`: action-first attention copy and target-aware links.
- `src/components/OpportunityAttentionBanner.tsx` / `src/components/OpportunityAttentionBanner.test.tsx`: contextual active/missing/resolved presentation.
- `src/components/OpportunityTaskList.tsx` / `src/components/OpportunityTaskList.test.tsx`: stable Actions/task focus targets and targeted-row state.
- `src/app/opportunities/[id]/page.tsx` / `src/app/opportunities/[id]/page.test.tsx`: sanitize asynchronous App Router search parameters and verify the route boundary.
- `src/components/OpportunityDetailPage.tsx` / `src/components/OpportunityDetailPage.test.tsx`: fetch-authoritative resolution, arrival focus, shared mutations, and status feedback.
- `src/app/globals.css` / `src/app/globals.test.ts`: compact action-first pills, contextual surface, target highlight, responsive layout, touch size, and focus contracts.

## Dependency waves

- **Wave 1:** ACH-1 attention domain and dashboard navigation.
- **Wave 2:** ACH-2 contextual presentation and task focus targets; depends on ACH-1.
- **Wave 3:** ACH-3 route/detail orchestration; depends on ACH-1 and ACH-2.
- **Wave 4:** ACH-4 responsive visual integration and full acceptance checks; depends on ACH-2 and ACH-3.

No tasks are dispatched concurrently because all implementation writers are serialized by the orchestration contract.

### ACH-1: Attention domain and action-first dashboard navigation

**Outcome:** Attention items carry explicit task identity, render the required action first, and produce safe bookmarkable target URLs.

**Dependencies:** None. Wave 1.

**Risk:** Medium — introduces a shared cross-module attention contract. Run focused checks, inspect the diff immediately, and obtain a fresh Sol review before ACH-2.

**Write set:**

- Create: `src/lib/opportunity-attention.ts`
- Create: `src/lib/opportunity-attention.test.ts`
- Modify: `src/lib/dashboard.ts`
- Modify: `src/lib/dashboard.test.ts`
- Modify: `src/components/AttentionQueue.tsx`
- Modify: `src/components/AttentionQueue.test.tsx`

No later task writes these files.

**Relevant specification:** “Action-first dashboard items,” “Explicit attention navigation contract,” “Authoritative attention resolution,” acceptance criteria 1–2 and 9–10.

**Interfaces:**

- Consumes: existing `OpportunityDetail`, `OpportunityTask`, `OpportunityStatus`, `OpportunityType`, and `DashboardAttentionItem` contracts.
- Produces:

```ts
export type AttentionTarget =
  | { kind: "task"; taskId: string }
  | { kind: "missing_next_action" };

export type AttentionLinkTarget =
  | { kind: "task"; opportunityId: string; taskId: string }
  | { kind: "missing_next_action"; opportunityId: string; taskId: null };

export type AttentionSearchParams = Record<string, string | string[] | undefined>;

export type ResolvedAttentionContext =
  | { state: "active_task"; task: OpportunityTask; isOverdue: boolean }
  | { state: "missing_next_action" }
  | { state: "resolved" };

export function opportunityRequiresForwardMotion(
  opportunity: Pick<Opportunity, "type" | "status">
): boolean;

export function opportunityIsAttentionEligible(
  opportunity: Pick<Opportunity, "type" | "status">
): boolean;

export function buildAttentionHref(item: AttentionLinkTarget): string;

export function parseAttentionTarget(
  searchParams: AttentionSearchParams
): AttentionTarget | null;

export function resolveAttentionContext(
  detail: OpportunityDetail,
  target: AttentionTarget,
  today: string
): ResolvedAttentionContext;
```

- Replaces `DashboardAttentionItem` with a common metadata base intersected with a discriminated task/missing-action union, so task kind requires `taskId: string` and missing kind requires `taskId: null`.

- [ ] **Step 1: Write failing attention-domain and dashboard tests**

Create `src/lib/opportunity-attention.test.ts` with concrete URL, parser, and resolution cases:

```ts
import { describe, expect, it } from "vitest";

import type { OpportunityDetail, OpportunityTask } from "../types";
import {
  buildAttentionHref,
  opportunityIsAttentionEligible,
  parseAttentionTarget,
  resolveAttentionContext
} from "./opportunity-attention";

const task = (overrides: Partial<OpportunityTask> = {}): OpportunityTask => ({
  id: overrides.id ?? "task/1",
  opportunityId: overrides.opportunityId ?? "opportunity 1",
  title: overrides.title ?? "Send follow-up",
  dueDate: overrides.dueDate ?? "2026-07-13",
  state: overrides.state ?? "open",
  sourceActivityId: null,
  completedAt: null,
  createdAt: "2026-07-01T12:00:00.000Z",
  updatedAt: "2026-07-01T12:00:00.000Z"
});

const detail = (tasks: OpportunityTask[]): OpportunityDetail => ({
  id: "opportunity 1",
  type: "job",
  label: "Engineering Manager",
  organization: "Acme",
  status: "applied",
  priority: "medium",
  summary: null,
  originOpportunityId: null,
  url: null,
  source: null,
  location: null,
  contact: null,
  appliedDate: null,
  createdAt: "2026-07-01T12:00:00.000Z",
  updatedAt: "2026-07-01T12:00:00.000Z",
  activities: [],
  tasks,
  artifacts: [],
  origin: null,
  originatedJobs: []
});

describe("opportunity attention", () => {
  it("builds encoded task and missing-action URLs", () => {
    expect(buildAttentionHref({ kind: "task", opportunityId: "opportunity 1", taskId: "task/1" }))
      .toBe("/opportunities/opportunity%201?attention=task&taskId=task%2F1");
    expect(buildAttentionHref({ kind: "missing_next_action", opportunityId: "opportunity 1", taskId: null }))
      .toBe("/opportunities/opportunity%201?attention=missing_next_action");
    expect(() => buildAttentionHref({ kind: "task", opportunityId: "opportunity 1", taskId: "" }))
      .toThrow("Task attention requires a task ID");
  });

  it("parses only unambiguous supported targets", () => {
    expect(parseAttentionTarget({ attention: "task", taskId: "task-1" }))
      .toEqual({ kind: "task", taskId: "task-1" });
    expect(parseAttentionTarget({ attention: "missing_next_action" }))
      .toEqual({ kind: "missing_next_action" });
    expect(parseAttentionTarget({ attention: "task" })).toBeNull();
    expect(parseAttentionTarget({ attention: "task", taskId: "" })).toBeNull();
    expect(parseAttentionTarget({ attention: "task", taskId: ["task-1"] })).toBeNull();
    expect(parseAttentionTarget({ attention: ["task"], taskId: "task-1" })).toBeNull();
    expect(parseAttentionTarget({ attention: "missing_next_action", taskId: "task-1" })).toBeNull();
    expect(parseAttentionTarget({ attention: "missing_next_action", taskId: ["task-1"] })).toBeNull();
    expect(parseAttentionTarget({ attention: "unknown", taskId: "task-1" })).toBeNull();
  });

  it("resolves task attention from fresh detail", () => {
    const due = task();
    expect(resolveAttentionContext(detail([due]), { kind: "task", taskId: due.id }, "2026-07-13"))
      .toEqual({ state: "active_task", task: due, isOverdue: false });
    expect(resolveAttentionContext(detail([{ ...due, dueDate: "2026-07-12" }]), { kind: "task", taskId: due.id }, "2026-07-13"))
      .toMatchObject({ state: "active_task", isOverdue: true });
    expect(resolveAttentionContext(detail([{ ...due, state: "completed" }]), { kind: "task", taskId: due.id }, "2026-07-13"))
      .toEqual({ state: "resolved" });
    expect(resolveAttentionContext(detail([{ ...due, state: "cancelled" }]), { kind: "task", taskId: due.id }, "2026-07-13"))
      .toEqual({ state: "resolved" });
    expect(resolveAttentionContext(detail([{ ...due, dueDate: null }]), { kind: "task", taskId: due.id }, "2026-07-13"))
      .toEqual({ state: "resolved" });
    expect(resolveAttentionContext(detail([{ ...due, dueDate: "2026-07-14" }]), { kind: "task", taskId: due.id }, "2026-07-13"))
      .toEqual({ state: "resolved" });
    expect(resolveAttentionContext(detail([{ ...due, opportunityId: "another-opportunity" }]), { kind: "task", taskId: due.id }, "2026-07-13"))
      .toEqual({ state: "resolved" });
    expect(resolveAttentionContext(detail([]), { kind: "task", taskId: due.id }, "2026-07-13"))
      .toEqual({ state: "resolved" });
    expect(resolveAttentionContext({ ...detail([due]), status: "rejected" }, { kind: "task", taskId: due.id }, "2026-07-13"))
      .toEqual({ state: "resolved" });
  });

  it("shares terminal attention eligibility across task and dashboard rules", () => {
    expect(opportunityIsAttentionEligible({ type: "job", status: "applied" })).toBe(true);
    expect(opportunityIsAttentionEligible({ type: "job", status: "rejected" })).toBe(false);
    expect(opportunityIsAttentionEligible({ type: "job", status: "archived" })).toBe(false);
    expect(opportunityIsAttentionEligible({ type: "connection", status: "dormant" })).toBe(false);
    expect(opportunityIsAttentionEligible({ type: "connection", status: "closed" })).toBe(false);
    expect(opportunityIsAttentionEligible({ type: "connection", status: "archived" })).toBe(false);
  });

  it("resolves missing-next-action attention only for forward-moving records with no open task", () => {
    expect(resolveAttentionContext(detail([]), { kind: "missing_next_action" }, "2026-07-13"))
      .toEqual({ state: "missing_next_action" });
    expect(resolveAttentionContext(detail([task()]), { kind: "missing_next_action" }, "2026-07-13"))
      .toEqual({ state: "resolved" });
    expect(resolveAttentionContext({ ...detail([]), status: "archived" }, { kind: "missing_next_action" }, "2026-07-13"))
      .toEqual({ state: "resolved" });
  });
});
```

Extend `src/lib/dashboard.test.ts` so the existing ordered projection includes `taskId`:

```ts
expect(insights.attention.map((item) => ({
  opportunityId: item.opportunityId,
  kind: item.kind,
  taskId: item.taskId,
  dueDate: item.dueDate
}))).toEqual([
  { opportunityId: "connection-due", kind: "task", taskId: "connection-task", dueDate: "2026-07-08" },
  { opportunityId: "job-due", kind: "task", taskId: "job-task", dueDate: "2026-07-09" },
  { opportunityId: "connection-new", kind: "missing_next_action", taskId: null, dueDate: null }
]);
```

Extend `src/components/AttentionQueue.test.tsx` with explicit populated items:

```tsx
it("leads with the required action and carries an explicit task target", () => {
  document.body.innerHTML = renderToStaticMarkup(<AttentionQueue items={[{
    id: "task-task-1",
    opportunityId: "opportunity-1",
    taskId: "task-1",
    type: "job",
    label: "Lead AI Strategy",
    organization: "Acme",
    status: "applied",
    priority: "medium",
    kind: "task",
    actionLabel: "Investigate unanswered email",
    dueDate: "2026-07-13",
    isOverdue: false
  }]} onViewAll={() => undefined} />);

  const link = document.querySelector<HTMLAnchorElement>(".attention-strip__item")!;
  expect(link.href).toContain("/opportunities/opportunity-1?attention=task&taskId=task-1");
  expect(link.getAttribute("aria-label")).toBe("Investigate unanswered email for Lead AI Strategy. Due today · 2026-07-13");
  expect(link.querySelector("strong")?.textContent).toBe("Investigate unanswered email");
  expect(link.textContent).toContain("Lead AI Strategy");
  expect(link.textContent).toContain("Due today");
});

it("carries missing-next-action context without a task id", () => {
  const markup = renderToStaticMarkup(<AttentionQueue items={[{
    id: "missing-next-action-opportunity-1",
    opportunityId: "opportunity-1",
    taskId: null,
    type: "connection",
    label: "Maya Chen",
    organization: "Acme",
    status: "new",
    priority: "medium",
    kind: "missing_next_action",
    actionLabel: "Set a next action",
    dueDate: null,
    isOverdue: false
  }]} onViewAll={() => undefined} />);

  expect(markup).toContain("Set a next action");
  expect(markup).toContain("Maya Chen");
  expect(markup).toContain("attention=missing_next_action");
  expect(markup).not.toContain("taskId=");
});
```

- [ ] **Step 2: Run the focused tests and confirm the red state**

Run:

```bash
npm test -- --run src/lib/opportunity-attention.test.ts src/lib/dashboard.test.ts src/components/AttentionQueue.test.tsx
```

Expected: FAIL because `opportunity-attention.ts` does not exist, `DashboardAttentionItem` has no `taskId`, and populated attention markup still leads with the record label and generic URL.

- [ ] **Step 3: Implement the pure attention domain, explicit task ID, and action-first queue**

Create `src/lib/opportunity-attention.ts`:

```ts
import type { Opportunity, OpportunityDetail, OpportunityTask } from "../types";

export type AttentionTarget =
  | { kind: "task"; taskId: string }
  | { kind: "missing_next_action" };

export type AttentionLinkTarget =
  | { kind: "task"; opportunityId: string; taskId: string }
  | { kind: "missing_next_action"; opportunityId: string; taskId: null };

export type AttentionSearchParams = Record<string, string | string[] | undefined>;

export type ResolvedAttentionContext =
  | { state: "active_task"; task: OpportunityTask; isOverdue: boolean }
  | { state: "missing_next_action" }
  | { state: "resolved" };

const JOB_FORWARD_STATUSES = new Set(["applied", "interviewing", "offer"]);
const CONNECTION_FORWARD_STATUSES = new Set(["new", "outreach_planned", "waiting", "in_conversation", "opportunity_identified"]);
const TERMINAL_STATUSES = new Set(["rejected", "archived", "dormant", "closed"]);

export function opportunityIsAttentionEligible(opportunity: Pick<Opportunity, "type" | "status">) {
  return !TERMINAL_STATUSES.has(opportunity.status);
}

export function opportunityRequiresForwardMotion(opportunity: Pick<Opportunity, "type" | "status">) {
  return opportunity.type === "job"
    ? JOB_FORWARD_STATUSES.has(opportunity.status)
    : CONNECTION_FORWARD_STATUSES.has(opportunity.status);
}

export function buildAttentionHref(item: AttentionLinkTarget) {
  if (item.kind === "task" && !item.taskId) throw new Error("Task attention requires a task ID");
  const search = new URLSearchParams({ attention: item.kind });
  if (item.kind === "task") search.set("taskId", item.taskId);
  return `/opportunities/${encodeURIComponent(item.opportunityId)}?${search.toString()}`;
}

export function parseAttentionTarget(searchParams: AttentionSearchParams): AttentionTarget | null {
  const attention = searchParams.attention;
  if (typeof attention !== "string") return null;
  if (attention === "missing_next_action") {
    return searchParams.taskId === undefined ? { kind: "missing_next_action" } : null;
  }
  if (attention !== "task" || typeof searchParams.taskId !== "string" || !searchParams.taskId) return null;
  return { kind: "task", taskId: searchParams.taskId };
}

export function resolveAttentionContext(
  detail: OpportunityDetail,
  target: AttentionTarget,
  today: string
): ResolvedAttentionContext {
  if (target.kind === "missing_next_action") {
    const hasOpenTask = detail.tasks.some((task) => task.state === "open");
    return opportunityIsAttentionEligible(detail) && !hasOpenTask && opportunityRequiresForwardMotion(detail)
      ? { state: "missing_next_action" }
      : { state: "resolved" };
  }

  if (!opportunityIsAttentionEligible(detail)) return { state: "resolved" };
  const task = detail.tasks.find((candidate) => candidate.id === target.taskId);
  if (!task || task.opportunityId !== detail.id || task.state !== "open" || !task.dueDate || task.dueDate > today) return { state: "resolved" };
  return { state: "active_task", task, isOverdue: task.dueDate < today };
}
```

In `src/lib/dashboard.ts`, import `opportunityIsAttentionEligible` and `opportunityRequiresForwardMotion`, remove the duplicated forward-status and terminal-status sets/functions, extend the type, and populate it:

```ts
import { opportunityIsAttentionEligible, opportunityRequiresForwardMotion } from "./opportunity-attention";

type DashboardAttentionBase = {
  id: string;
  opportunityId: string;
  type: OpportunityType;
  label: string;
  organization: string | null;
  status: OpportunityStatus;
  priority: OpportunityPriority;
};

export type DashboardAttentionItem = DashboardAttentionBase & ({
  kind: "task";
  taskId: string;
  actionLabel: string;
  dueDate: string;
  isOverdue: boolean;
} | {
  kind: "missing_next_action";
  taskId: null;
  actionLabel: string;
  dueDate: null;
  isOverdue: false;
});
```

Use `taskId: task.id` in the task branch, `taskId: null` in the missing branch, replace the terminal `Set` check with `opportunityIsAttentionEligible(opportunity)`, and replace `requiresForwardMotion(opportunity)` with `opportunityRequiresForwardMotion(opportunity)`.

In `src/components/AttentionQueue.tsx`, import `buildAttentionHref` and replace the populated link body:

```tsx
import { buildAttentionHref } from "../lib/opportunity-attention";

{visibleItems.map((item) => <Link
  aria-label={`${item.actionLabel} for ${item.label}. ${dueCopy(item)}`}
  className="attention-strip__item"
  href={buildAttentionHref(item)}
  key={item.id}
>
  <span className={`attention-list__marker attention-list__marker--${item.priority}`} aria-hidden="true" />
  <span className="attention-strip__content">
    <strong>{item.actionLabel}</strong>
    <span className="attention-strip__meta">
      <span>{item.label}</span>
      <span aria-hidden="true">·</span>
      <span className={item.isOverdue ? "attention-strip__due attention-strip__due--overdue" : "attention-strip__due"}>{dueCopy(item)}</span>
    </span>
  </span>
</Link>)}
```

- [ ] **Step 4: Run focused tests and inspect the task-ID/navigation diff**

Run:

```bash
npm test -- --run src/lib/opportunity-attention.test.ts src/lib/dashboard.test.ts src/components/AttentionQueue.test.tsx
git diff --check
git diff -- src/lib/opportunity-attention.ts src/lib/dashboard.ts src/components/AttentionQueue.tsx
```

Expected: all focused tests PASS; diff shows no persistence/API change, no composite-ID parsing, and no task title in the URL.

- [ ] **Step 5: Commit ACH-1**

```bash
git add src/lib/opportunity-attention.ts src/lib/opportunity-attention.test.ts src/lib/dashboard.ts src/lib/dashboard.test.ts src/components/AttentionQueue.tsx src/components/AttentionQueue.test.tsx
git commit -m "feat: preserve dashboard attention targets"
```

Expected evidence: commit contains only the ACH-1 write set and is ready for its fresh Sol review.

### ACH-2: Contextual presentation and targetable task rows

**Outcome:** Pure presentation renders active task, missing-action, and resolved states; the Actions card exposes stable keyboard focus targets.

**Dependencies:** ACH-1 approved. Wave 2.

**Risk:** Low — isolated presentation and local task-list semantics. Run focused tests and obtain a fresh Sol review before ACH-3.

**Write set:**

- Create: `src/components/OpportunityAttentionBanner.tsx`
- Create: `src/components/OpportunityAttentionBanner.test.tsx`
- Modify: `src/components/OpportunityTaskList.tsx`
- Modify: `src/components/OpportunityTaskList.test.tsx`

No later task writes these files.

**Relevant specification:** “Contextual attention surface,” “Targeted Actions card,” “Resolved or stale target,” accessibility requirements, acceptance criteria 5–6 and 8–9.

**Interfaces:**

- Consumes: `ResolvedAttentionContext` from ACH-1 and existing `OpportunityTask` / `TaskAction` contracts.
- Produces:

```ts
export type OpportunityAttentionBannerProps = {
  context: ResolvedAttentionContext;
  pendingTaskId: string | null;
  onComplete: (task: OpportunityTask) => void;
  onReview: () => void;
  onSetNextAction: (trigger: HTMLButtonElement) => void;
};
```

- Extends `OpportunityTaskList` with `attentionTaskId?: string | null`.
- Produces DOM focus IDs `opportunity-actions` and `opportunity-task-<taskId>`.

- [ ] **Step 1: Write failing banner and task-target tests**

Create `src/components/OpportunityAttentionBanner.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { OpportunityTask } from "../types";
import { OpportunityAttentionBanner } from "./OpportunityAttentionBanner";

const task: OpportunityTask = {
  id: "task-1",
  opportunityId: "opportunity-1",
  title: "Investigate unanswered email",
  dueDate: "2026-07-13",
  state: "open",
  sourceActivityId: null,
  completedAt: null,
  createdAt: "2026-07-01T12:00:00.000Z",
  updatedAt: "2026-07-01T12:00:00.000Z"
};

const callbacks = {
  pendingTaskId: null,
  onComplete: vi.fn(),
  onReview: vi.fn(),
  onSetNextAction: vi.fn()
};

describe("OpportunityAttentionBanner", () => {
  it("renders an actionable due-task arrival", () => {
    const markup = renderToStaticMarkup(<OpportunityAttentionBanner
      {...callbacks}
      context={{ state: "active_task", task, isOverdue: false }}
    />);
    expect(markup).toContain("Needs attention today");
    expect(markup).toContain("Investigate unanswered email");
    expect(markup).toContain("Complete");
    expect(markup).toContain("Review options");
    expect(markup).toContain('aria-labelledby="attention-context-title"');
    expect(markup).toContain('id="attention-context-title"');
    expect(markup).toContain('tabindex="-1"');
  });

  it("renders missing and resolved states with explicit explanations", () => {
    const missing = renderToStaticMarkup(<OpportunityAttentionBanner {...callbacks} context={{ state: "missing_next_action" }} />);
    const resolved = renderToStaticMarkup(<OpportunityAttentionBanner {...callbacks} context={{ state: "resolved" }} />);
    expect(missing).toContain("No next action is planned");
    expect(missing).toContain("Set next action");
    expect(resolved).toContain("This attention item is no longer active");
    expect(resolved).toContain("Review current actions");
    expect(resolved).toContain('tabindex="-1"');
  });
});
```

Extend `src/components/OpportunityTaskList.test.tsx`:

```tsx
it("marks an attention-targeted task and exposes stable focus targets", () => {
  const markup = renderToStaticMarkup(<OpportunityTaskList
    attentionTaskId="target"
    tasks={[
      task("primary", "Earlier task", "2026-07-13"),
      task("target", "Targeted task", "2026-07-13")
    ]}
    today="2026-07-13"
    onAction={vi.fn()}
  />);

  expect(markup).toContain('id="opportunity-actions"');
  expect(markup).toContain('id="opportunity-task-target"');
  expect(markup).toContain('task-item--attention');
  expect(markup).toContain('tabindex="-1"');
  expect(markup.match(/task-item--attention/g)).toHaveLength(1);
});
```

- [ ] **Step 2: Run focused tests and confirm the red state**

Run:

```bash
npm test -- --run src/components/OpportunityAttentionBanner.test.tsx src/components/OpportunityTaskList.test.tsx
```

Expected: FAIL because the banner module and target-row props/DOM contracts do not exist.

- [ ] **Step 3: Implement the pure banner and focusable task targets**

Create `src/components/OpportunityAttentionBanner.tsx`:

```tsx
import { forwardRef } from "react";

import type { ResolvedAttentionContext } from "../lib/opportunity-attention";
import type { OpportunityTask } from "../types";

export type OpportunityAttentionBannerProps = {
  context: ResolvedAttentionContext;
  pendingTaskId: string | null;
  onComplete: (task: OpportunityTask) => void;
  onReview: () => void;
  onSetNextAction: (trigger: HTMLButtonElement) => void;
};

export const OpportunityAttentionBanner = forwardRef<HTMLElement, OpportunityAttentionBannerProps>(function OpportunityAttentionBanner({
  context,
  pendingTaskId,
  onComplete,
  onReview,
  onSetNextAction
}, ref) {
  if (context.state === "active_task") {
    const due = context.isOverdue ? `Overdue · ${context.task.dueDate}` : `Due today · ${context.task.dueDate}`;
    return <section className="attention-context attention-context--active" aria-labelledby="attention-context-title" ref={ref} tabIndex={-1}>
      <div className="attention-context__copy">
        <p className="panel-heading__eyebrow">{context.isOverdue ? "Needs attention · Overdue" : "Needs attention today"}</p>
        <h2 id="attention-context-title">{context.task.title}</h2>
        <p>{due}</p>
      </div>
      <div className="attention-context__actions">
        <button className="button button--primary" disabled={pendingTaskId === context.task.id} type="button" onClick={() => onComplete(context.task)}>Complete</button>
        <button className="button" type="button" onClick={onReview}>Review options</button>
      </div>
    </section>;
  }

  if (context.state === "missing_next_action") {
    return <section className="attention-context attention-context--active" aria-labelledby="attention-context-title" ref={ref} tabIndex={-1}>
      <div className="attention-context__copy">
        <p className="panel-heading__eyebrow">Needs attention</p>
        <h2 id="attention-context-title">No next action is planned</h2>
        <p>Decide what should happen next.</p>
      </div>
      <div className="attention-context__actions">
        <button className="button button--primary" type="button" onClick={(event) => onSetNextAction(event.currentTarget)}>Set next action</button>
      </div>
    </section>;
  }

  return <section className="attention-context attention-context--resolved" aria-labelledby="attention-context-title" ref={ref} tabIndex={-1}>
    <div className="attention-context__copy">
      <p className="panel-heading__eyebrow">Attention updated</p>
      <h2 id="attention-context-title">This attention item is no longer active</h2>
      <p>It may have been completed, cancelled, or rescheduled.</p>
    </div>
    <div className="attention-context__actions">
      <button className="button" type="button" onClick={onReview}>Review current actions</button>
    </div>
  </section>;
});
```

In `src/components/OpportunityTaskList.tsx`, extend `TaskRow` with `attention = false`, add the target DOM attributes, thread `attentionTaskId`, and name the Actions section:

```tsx
function TaskRow({ task, pendingTaskId, onAction, today, primary = false, attention = false }: {
  task: OpportunityTask;
  pendingTaskId: string | null;
  onAction: (task: OpportunityTask, action: TaskAction, dueDate?: string | null) => void | Promise<void>;
  today: string;
  primary?: boolean;
  attention?: boolean;
}) {
  const [dueDate, setDueDate] = useState(task.dueDate ?? "");
  const pending = pendingTaskId === task.id;
  return <div
    className={`task-item${primary ? " task-item--primary" : ""}${attention ? " task-item--attention" : ""}`}
    id={`opportunity-task-${task.id}`}
    tabIndex={attention ? -1 : undefined}
  >
    <div className="task-item__content">
      {primary ? <span className="task-item__eyebrow">Up next</span> : null}
      <strong>{task.title}</strong>
      <span className="task-item__due">{dueState(task, today)}</span>
    </div>
    <div className="task-item__actions">
      {task.state === "open" ? <>
        <button className="task-item__action task-item__action--complete" disabled={pending} type="button" onClick={() => void onAction(task, "complete")}>Complete</button>
        <button className="task-item__action" disabled={pending} type="button" onClick={() => void onAction(task, "cancel")}>Cancel</button>
        <div className="task-item__reschedule">
          <label>
            <span>Move due date</span>
            <input aria-label={`Reschedule ${task.title}`} type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
          </label>
          <button className="task-item__action" disabled={pending} type="button" onClick={() => void onAction(task, "reschedule", dueDate || null)}>Reschedule</button>
        </div>
      </> : <button className="task-item__action" disabled={pending} type="button" onClick={() => void onAction(task, "reopen")}>Reopen</button>}
    </div>
  </div>;
}
```

Replace the exported component with this complete target-aware version:

```tsx
export function OpportunityTaskList({ tasks, pendingTaskId = null, onAction, onAddTask, today = getLocalCalendarDate(), attentionTaskId = null }: {
  tasks: OpportunityTask[];
  pendingTaskId?: string | null;
  onAction: (task: OpportunityTask, action: TaskAction, dueDate?: string | null) => void | Promise<void>;
  onAddTask?: (trigger: HTMLButtonElement) => void;
  today?: string;
  attentionTaskId?: string | null;
}) {
  const primary = selectPrimaryTask(tasks);
  const open = tasks.filter((task) => task.state === "open" && task.id !== primary?.id);
  const history = tasks.filter((task) => task.state !== "open");
  const row = (task: OpportunityTask) => <TaskRow
    attention={task.id === attentionTaskId}
    key={task.id}
    task={task}
    pendingTaskId={pendingTaskId}
    onAction={onAction}
    today={today}
  />;
  return <section className="next-action-card actions-card" id="opportunity-actions" tabIndex={-1}>
    <header className="tracker-panel__header">
      <div><p className="panel-heading__eyebrow">Momentum</p><h2 className="tracker-panel__title">Actions</h2></div>
      <span className="tracker-panel__meta">{tasks.filter((task) => task.state === "open").length}</span>
    </header>
    <div className="actions-card__primary">
      {primary ? <TaskRow
        attention={primary.id === attentionTaskId}
        task={primary}
        primary
        pendingTaskId={pendingTaskId}
        onAction={onAction}
        today={today}
      /> : <div className="actions-card__empty">
        <p>No next action planned.</p>
        <button className="button button--primary" type="button" onClick={(event) => onAddTask?.(event.currentTarget)}>Set a next action</button>
      </div>}
    </div>
    {open.length ? <section className="actions-card__other">
      <header><h3>Other tasks</h3><span>{open.length}</span></header>
      {open.map(row)}
    </section> : null}
    {history.length ? <details className="actions-card__history">
      <summary>Completed and cancelled ({history.length})</summary>
      {history.map(row)}
    </details> : null}
  </section>;
}
```

- [ ] **Step 4: Run focused tests and inspect the presentation-only diff**

Run:

```bash
npm test -- --run src/components/OpportunityAttentionBanner.test.tsx src/components/OpportunityTaskList.test.tsx
git diff --check
git diff -- src/components/OpportunityAttentionBanner.tsx src/components/OpportunityTaskList.tsx
```

Expected: tests PASS; existing task action markup remains intact; exactly one matching task row is targetable; no network, routing, or persistence code appears.

- [ ] **Step 5: Commit ACH-2**

```bash
git add src/components/OpportunityAttentionBanner.tsx src/components/OpportunityAttentionBanner.test.tsx src/components/OpportunityTaskList.tsx src/components/OpportunityTaskList.test.tsx
git commit -m "feat: add contextual attention presentation"
```

Expected evidence: commit contains only the ACH-2 write set and is ready for its fresh Sol review.

### ACH-3: Route and detail-page attention orchestration

**Outcome:** App Router search parameters reach the client safely; fresh detail controls active/resolved state, focus, mutations, and announcements.

**Dependencies:** ACH-1 and ACH-2 approved. Wave 3.

**Risk:** High — changes shared detail concurrency guards, destructive-navigation safety, and cross-module focus behavior. Run the complete ACH-3 adversarial matrix, typecheck, inspect the diff immediately, and obtain a fresh Sol review before ACH-4.

**Write set:**

- Modify: `src/app/opportunities/[id]/page.tsx`
- Create: `src/app/opportunities/[id]/page.test.tsx`
- Modify: `src/components/OpportunityDetailPage.tsx`
- Modify: `src/components/OpportunityDetailPage.test.tsx`

No later task writes these files.

**Relevant specification:** “Authoritative attention resolution,” “Contextual attention surface,” “Resolved or stale target,” “Mutation feedback,” “Navigation lifecycle,” failure paths, acceptance criteria 4 and 7–13.

**Interfaces:**

- Consumes: `AttentionTarget`, `parseAttentionTarget`, `resolveAttentionContext`, `OpportunityAttentionBanner`, `attentionTaskId`, and the existing task mutation/dialog callbacks.
- Produces:

```ts
export function OpportunityDetailPage({
  opportunityId,
  attentionTarget = null,
  today = getLocalCalendarDate()
}: {
  opportunityId: string;
  attentionTarget?: AttentionTarget | null;
  today?: string;
}) {
```

- Extends `OpportunityDetailContent` with `attentionBanner?: ReactNode` and `attentionTaskId?: string | null`.

- [ ] **Step 1: Write failing detail-arrival integration tests**

Extend the existing component import with `TASK_ACTION_STATUS`, keep the `useRouter` mock unchanged, and replace `mountDetail` with this helper so tests can inject explicit date/target state:

```tsx
import {
  InteractionComposer,
  OpportunityDetailContent,
  OpportunityDetailPage,
  OpportunitySnapshot,
  TASK_ACTION_STATUS,
  TaskComposer,
  TrackerPanel
} from "./OpportunityDetailPage";
```

```tsx
function mountDetail(props: Partial<ComponentProps<typeof OpportunityDetailPage>> = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(<OpportunityDetailPage
      opportunityId="opportunity-1"
      today="2026-07-13"
      {...props}
    />);
  });
  return { container, root: root! };
}
```

Add these concrete tests to `src/components/OpportunityDetailPage.test.tsx`:

```tsx
it("focuses an active attention arrival and moves review focus to its task", async () => {
  const due = { ...connection.tasks[0], dueDate: "2026-07-13" };
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ ...connection, tasks: [due] }));
  const { container, root } = mountDetail({ attentionTarget: { kind: "task", taskId: due.id } });
  await flush();

  const banner = container.querySelector<HTMLElement>(".attention-context--active")!;
  expect(document.activeElement).toBe(banner);
  expect(banner.textContent).toContain("Send portfolio");
  act(() => [...banner.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Review options")!.click());
  expect(document.activeElement?.id).toBe(`opportunity-task-${due.id}`);
  expect(document.activeElement?.classList.contains("task-item--attention")).toBe(true);
  act(() => root.unmount());
});

it("completes from the attention surface, announces resolution, and preserves focus", async () => {
  let resolveComplete!: (value: Response) => void;
  const completeRequest = new Promise<Response>((resolve) => { resolveComplete = resolve; });
  const due = { ...connection.tasks[0], dueDate: "2026-07-13" };
  const completed = { ...due, state: "completed" as const, completedAt: "2026-07-13T12:00:00.000Z" };
  const fetchMock = vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(jsonResponse({ ...connection, tasks: [due] }))
    .mockReturnValueOnce(completeRequest);
  const { container, root } = mountDetail({ attentionTarget: { kind: "task", taskId: due.id } });
  await flush();
  const complete = container.querySelector<HTMLButtonElement>(".attention-context .button--primary")!;
  act(() => { complete.click(); complete.click(); });

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(complete.disabled).toBe(true);
  expect(fetchMock.mock.calls[1]?.[0]).toBe(`/api/opportunities/opportunity-1/tasks/${due.id}`);
  await act(async () => { resolveComplete(jsonResponse({ ...connection, tasks: [completed] })); });
  expect(container.querySelector('[role="status"]')?.textContent).toBe("Action completed");
  expect(container.textContent).toContain("This attention item is no longer active");
  expect(document.activeElement).toBe(container.querySelector(".attention-context--resolved"));
  act(() => root.unmount());
});

it("opens the existing task dialog for a missing-next-action arrival", async () => {
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { callback(0); return 1; });
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ ...connection, tasks: [] }));
  const { container, root } = mountDetail({ attentionTarget: { kind: "missing_next_action" } });
  await flush();
  const trigger = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Set next action")!;
  act(() => trigger.click());
  expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  expect(document.activeElement).toBe(container.querySelector<HTMLInputElement>('input[required]'));
  act(() => container.querySelector<HTMLButtonElement>(".modal__close")!.click());
  expect(document.activeElement).toBe(trigger);
  act(() => root.unmount());
});

it("shows a neutral notice for stale targets and no banner for direct visits", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(connection));
  const stale = mountDetail({ attentionTarget: { kind: "task", taskId: "missing-task" } });
  await flush();
  expect(stale.container.textContent).toContain("This attention item is no longer active");
  expect(document.activeElement).not.toBe(stale.container.querySelector(".attention-context--resolved"));
  act(() => [...stale.container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Review current actions")!.click());
  expect(document.activeElement?.id).toBe("opportunity-actions");
  act(() => stale.root.unmount());

  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(connection));
  const direct = mountDetail();
  await flush();
  expect(direct.container.querySelector(".attention-context")).toBeNull();
  act(() => direct.root.unmount());
});

it("keeps an attention-specific initial fetch failure out of the contextual surface", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ error: "Unable to load opportunity" }, false));
  const { container, root } = mountDetail({ attentionTarget: { kind: "task", taskId: "task-1" } });
  await flush();
  expect(container.textContent).toContain("Unable to load opportunity");
  expect(container.querySelector(".attention-context")).toBeNull();
  act(() => root.unmount());
});

it("does not focus a consumed stale target if it later becomes active", async () => {
  const open = { ...connection.tasks[0], dueDate: "2026-07-13" };
  const completed = { ...open, state: "completed" as const, completedAt: "2026-07-12T12:00:00.000Z" };
  vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(jsonResponse({ ...connection, tasks: [completed] }))
    .mockResolvedValueOnce(jsonResponse({ ...connection, tasks: [open] }));
  const { container, root } = mountDetail({ attentionTarget: { kind: "task", taskId: open.id } });
  await flush();
  expect(document.activeElement).not.toBe(container.querySelector(".attention-context--resolved"));
  act(() => [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Reopen")!.click());
  await flush();
  const active = container.querySelector(".attention-context--active");
  expect(active).not.toBeNull();
  expect(document.activeElement).not.toBe(active);
  act(() => root.unmount());
});

it("keeps every task action success message explicit", () => {
  expect(TASK_ACTION_STATUS).toEqual({
    complete: "Action completed",
    cancel: "Action cancelled",
    reschedule: "Action rescheduled",
    reopen: "Action reopened"
  });
});

it("keeps a failed reschedule draft and active attention context", async () => {
  const due = { ...connection.tasks[0], dueDate: "2026-07-13" };
  vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(jsonResponse({ ...connection, tasks: [due] }))
    .mockResolvedValueOnce(jsonResponse({ error: "Reschedule rejected" }, false));
  const { container, root } = mountDetail({ attentionTarget: { kind: "task", taskId: due.id } });
  await flush();
  const input = container.querySelector<HTMLInputElement>(`#opportunity-task-${due.id} input[type="date"]`)!;
  act(() => change(input, "2026-07-20"));
  act(() => [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Reschedule")!.click());
  await flush();
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("Reschedule rejected");
  expect(input.value).toBe("2026-07-20");
  expect(container.querySelector(".attention-context--active")).not.toBeNull();
  act(() => root.unmount());
});

it("treats the same attention target as a new arrival after it disappears", async () => {
  const due = { ...connection.tasks[0], dueDate: "2026-07-13" };
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ ...connection, tasks: [due] }));
  const { container, root } = mountDetail({ attentionTarget: { kind: "task", taskId: due.id } });
  await flush();
  act(() => root.render(<OpportunityDetailPage opportunityId="opportunity-1" attentionTarget={null} today="2026-07-13" />));
  await flush();
  act(() => root.render(<OpportunityDetailPage opportunityId="opportunity-1" attentionTarget={{ kind: "task", taskId: due.id }} today="2026-07-13" />));
  await flush();
  expect(document.activeElement).toBe(container.querySelector(".attention-context--active"));
  act(() => root.unmount());
});

it.each(["success", "failure"] as const)("ignores a late detail %s when opportunity id changes", async (outcome) => {
  let resolveDetail!: (value: Response) => void;
  const detailRequest = new Promise<Response>((resolve) => { resolveDetail = resolve; });
  const nextOpportunity = { ...connection, id: "opportunity-2", label: "Jordan Lee", status: "new" as const, tasks: [] };
  vi.spyOn(globalThis, "fetch")
    .mockReturnValueOnce(detailRequest)
    .mockResolvedValueOnce(jsonResponse(nextOpportunity));
  const { container, root } = mountDetail();
  act(() => root.render(<OpportunityDetailPage opportunityId="opportunity-2" today="2026-07-13" />));
  await flush();
  expect(container.textContent).toContain("Jordan Lee");
  await act(async () => {
    resolveDetail(outcome === "success"
      ? jsonResponse({ ...connection, label: "Late detail result" })
      : jsonResponse({ error: "Late detail failure" }, false));
  });
  expect(container.textContent).toContain("Jordan Lee");
  expect(container.textContent).not.toContain("Late detail result");
  expect(container.querySelector('[role="alert"]')).toBeNull();
  act(() => root.unmount());
});

it.each(["success", "failure"] as const)("clears stale detail and ignores a late task %s when opportunity id changes", async (outcome) => {
  let resolveTask!: (value: Response) => void;
  const taskRequest = new Promise<Response>((resolve) => { resolveTask = resolve; });
  const due = { ...connection.tasks[0], dueDate: "2026-07-13" };
  const nextOpportunity = { ...connection, id: "opportunity-2", label: "Jordan Lee", tasks: [{ ...due, id: "task-2", opportunityId: "opportunity-2" }] };
  vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(jsonResponse({ ...connection, tasks: [due] }))
    .mockReturnValueOnce(taskRequest)
    .mockResolvedValueOnce(jsonResponse(nextOpportunity));
  const { container, root } = mountDetail({ attentionTarget: { kind: "task", taskId: due.id } });
  await flush();
  act(() => container.querySelector<HTMLButtonElement>(".attention-context .button--primary")!.click());
  act(() => root.render(<OpportunityDetailPage opportunityId="opportunity-2" today="2026-07-13" />));
  expect(container.textContent).toContain("Loading opportunity");
  await flush();
  expect(container.textContent).toContain("Jordan Lee");
  await act(async () => {
    resolveTask(outcome === "success"
      ? jsonResponse({ ...connection, label: "Late task result", tasks: [] })
      : jsonResponse({ error: "Late task failure" }, false));
  });
  expect(container.textContent).toContain("Jordan Lee");
  expect(container.textContent).not.toContain("Late task result");
  expect(container.querySelector('[role="status"]')).toBeNull();
  expect(container.querySelector('[role="alert"]')).toBeNull();
  act(() => root.unmount());
});

it.each(["success", "failure"] as const)("clears a pending dialog and ignores its late %s when opportunity id changes", async (outcome) => {
  let resolveDialog!: (value: Response) => void;
  const dialogRequest = new Promise<Response>((resolve) => { resolveDialog = resolve; });
  const nextOpportunity = { ...connection, id: "opportunity-2", label: "Jordan Lee", tasks: [] };
  vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(jsonResponse(connection))
    .mockReturnValueOnce(dialogRequest)
    .mockResolvedValueOnce(jsonResponse(nextOpportunity));
  const { container, root } = mountDetail();
  await flush();
  act(() => [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Add task")!.click());
  act(() => change(container.querySelector<HTMLInputElement>('input[required]')!, "Old record task"));
  act(() => container.querySelector<HTMLFormElement>("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  act(() => root.render(<OpportunityDetailPage opportunityId="opportunity-2" today="2026-07-13" />));
  await flush();
  expect(container.textContent).toContain("Jordan Lee");
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => {
    resolveDialog(outcome === "success"
      ? jsonResponse({ ...connection, label: "Late dialog result" })
      : jsonResponse({ error: "Late dialog failure" }, false));
  });
  expect(container.textContent).toContain("Jordan Lee");
  expect(container.textContent).not.toContain("Late dialog result");
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(container.querySelector('[role="status"]')).toBeNull();
  expect(container.querySelector('[role="alert"]')).toBeNull();
  act(() => root.unmount());
});

it.each(["success", "failure"] as const)("ignores a late status %s when opportunity id changes", async (outcome) => {
  let resolveStatus!: (value: Response) => void;
  const statusRequest = new Promise<Response>((resolve) => { resolveStatus = resolve; });
  const nextOpportunity = { ...connection, id: "opportunity-2", label: "Jordan Lee", status: "new" as const, tasks: [] };
  vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(jsonResponse(connection))
    .mockReturnValueOnce(statusRequest)
    .mockResolvedValueOnce(jsonResponse(nextOpportunity));
  const { container, root } = mountDetail();
  await flush();
  act(() => change(container.querySelector<HTMLSelectElement>(".stage-select select")!, "waiting"));
  act(() => root.render(<OpportunityDetailPage opportunityId="opportunity-2" today="2026-07-13" />));
  await flush();
  await act(async () => {
    resolveStatus(outcome === "success"
      ? jsonResponse({ ...connection, status: "waiting" })
      : jsonResponse({ error: "Late status failure" }, false));
  });
  expect(container.textContent).toContain("Jordan Lee");
  expect(container.querySelector<HTMLSelectElement>(".stage-select select")?.value).toBe("new");
  expect(container.querySelector('[role="status"]')).toBeNull();
  expect(container.querySelector('[role="alert"]')).toBeNull();
  act(() => root.unmount());
});

it.each(["success", "failure"] as const)("ignores a late archive %s when opportunity id changes", async (outcome) => {
  let resolveArchive!: (value: Response) => void;
  const archiveRequest = new Promise<Response>((resolve) => { resolveArchive = resolve; });
  const nextOpportunity = { ...connection, id: "opportunity-2", label: "Jordan Lee", status: "new" as const, tasks: [] };
  vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(jsonResponse(connection))
    .mockReturnValueOnce(archiveRequest)
    .mockResolvedValueOnce(jsonResponse(nextOpportunity));
  const { container, root } = mountDetail();
  await flush();
  act(() => container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click());
  act(() => [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((button) => button.textContent === "Archive")!.click());
  act(() => container.querySelector<HTMLFormElement>("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  act(() => root.render(<OpportunityDetailPage opportunityId="opportunity-2" today="2026-07-13" />));
  await flush();
  await act(async () => {
    resolveArchive(outcome === "success"
      ? jsonResponse({ ...connection, status: "archived" })
      : jsonResponse({ error: "Late archive failure" }, false));
  });
  expect(container.textContent).toContain("Jordan Lee");
  expect(container.querySelector<HTMLSelectElement>(".stage-select select")?.value).toBe("new");
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(container.querySelector('[role="status"]')).toBeNull();
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(routerState.push).not.toHaveBeenCalled();
  act(() => root.unmount());
});

it.each(["success", "failure"] as const)("ignores a late delete %s and redirect when opportunity id changes", async (outcome) => {
  let resolveDelete!: (value: Response) => void;
  const deleteRequest = new Promise<Response>((resolve) => { resolveDelete = resolve; });
  const nextOpportunity = { ...connection, id: "opportunity-2", label: "Jordan Lee", tasks: [] };
  vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(jsonResponse(connection))
    .mockReturnValueOnce(deleteRequest)
    .mockResolvedValueOnce(jsonResponse(nextOpportunity));
  const { container, root } = mountDetail();
  await flush();
  act(() => container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click());
  act(() => [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((button) => button.textContent === "Delete permanently")!.click());
  act(() => container.querySelector<HTMLFormElement>("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  act(() => root.render(<OpportunityDetailPage opportunityId="opportunity-2" today="2026-07-13" />));
  await flush();
  expect(container.textContent).toContain("Jordan Lee");
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => {
    resolveDelete(outcome === "success"
      ? jsonResponse({})
      : jsonResponse({ error: "Late delete failure" }, false));
  });
  expect(routerState.push).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Jordan Lee");
  expect(container.querySelector('[role="status"]')).toBeNull();
  expect(container.querySelector('[role="alert"]')).toBeNull();
  act(() => root.unmount());
});
```

Create `src/app/opportunities/[id]/page.test.tsx` to cover the asynchronous route boundary:

```tsx
import { describe, expect, it } from "vitest";

import OpportunityDetailRoute from "./page";

describe("OpportunityDetailRoute", () => {
  it("passes a valid task target to the client page", async () => {
    const element = await OpportunityDetailRoute({
      params: Promise.resolve({ id: "opportunity-1" }),
      searchParams: Promise.resolve({ attention: "task", taskId: "task-1" })
    });
    expect(element.props).toMatchObject({
      opportunityId: "opportunity-1",
      attentionTarget: { kind: "task", taskId: "task-1" }
    });
  });

  it("passes a valid missing-next-action target to the client page", async () => {
    const element = await OpportunityDetailRoute({
      params: Promise.resolve({ id: "opportunity-1" }),
      searchParams: Promise.resolve({ attention: "missing_next_action" })
    });
    expect(element.props).toMatchObject({
      opportunityId: "opportunity-1",
      attentionTarget: { kind: "missing_next_action" }
    });
  });

  it("drops malformed and extraneous targets", async () => {
    const malformed = await OpportunityDetailRoute({
      params: Promise.resolve({ id: "opportunity-1" }),
      searchParams: Promise.resolve({ attention: "task", taskId: ["task-1"] })
    });
    const extraneous = await OpportunityDetailRoute({
      params: Promise.resolve({ id: "opportunity-1" }),
      searchParams: Promise.resolve({ attention: "missing_next_action", taskId: "task-1" })
    });
    expect(malformed.props.attentionTarget).toBeNull();
    expect(extraneous.props.attentionTarget).toBeNull();
  });
});
```

- [ ] **Step 2: Run the detail tests and confirm the red state**

Run:

```bash
npm test -- --run src/components/OpportunityDetailPage.test.tsx 'src/app/opportunities/[id]/page.test.tsx'
```

Expected: FAIL because the route test does not exist yet, the page does not accept or resolve an attention target, and focus/lifecycle/status contracts are not implemented.

- [ ] **Step 3: Parse route search parameters and pass the optional target**

Replace `src/app/opportunities/[id]/page.tsx` with:

```tsx
import { OpportunityDetailPage } from "../../../components/OpportunityDetailPage";
import { parseAttentionTarget, type AttentionSearchParams } from "../../../lib/opportunity-attention";

export default async function OpportunityDetailRoute({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<AttentionSearchParams>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  return <OpportunityDetailPage opportunityId={id} attentionTarget={parseAttentionTarget(query)} />;
}
```

- [ ] **Step 4: Wire authoritative attention state, focus, task actions, and the banner slot**

Add imports in `src/components/OpportunityDetailPage.tsx`:

```tsx
import { type AttentionTarget, resolveAttentionContext } from "../lib/opportunity-attention";
import { OpportunityAttentionBanner } from "./OpportunityAttentionBanner";
import { getLocalCalendarDate, OpportunityTaskList, type TaskAction } from "./OpportunityTaskList";
```

Replace `OpportunityDetailContent` with this complete slot-aware version:

```tsx
export function OpportunityDetailContent({
  detail,
  attentionBanner = null,
  attentionTaskId = null,
  pendingTaskId = null,
  onTaskAction,
  onStatusChange,
  onRecordInteraction,
  onAddTask,
  onCreateJob,
  onEdit,
  onArchive,
  onDelete,
  statusMutationPending = false
}: {
  detail: OpportunityDetail;
  attentionBanner?: ReactNode;
  attentionTaskId?: string | null;
  pendingTaskId?: string | null;
  onTaskAction: (task: OpportunityTask, action: TaskAction, dueDate?: string | null) => void | Promise<void>;
  onStatusChange?: (status: OpportunityStatus) => void;
  onRecordInteraction?: (trigger: HTMLButtonElement) => void;
  onAddTask?: (trigger: HTMLButtonElement) => void;
  onCreateJob?: () => void;
  onEdit?: () => void;
  onArchive?: () => void;
  onDelete?: () => void;
  statusMutationPending?: boolean;
}) {
  const statuses = (detail.type === "job" ? JOB_STATUSES : CONNECTION_STATUSES).filter((status) => status !== "archived" || detail.status === "archived");
  return <>
    <div className="detail-command">
      <div className="detail-command__top">
        <nav className="detail-nav"><Link className="detail-nav__back" href="/">← Opportunities</Link></nav>
        <p className="app-header__eyebrow">{detail.type === "job" ? "Job" : "Connection"}</p>
      </div>
      <header className="app-header">
        <div className="detail-command__identity">
          <h1 className="app-header__title">{detail.label}</h1>
          <p>{detail.organization ?? "Independent connection"} · Priority: {detail.priority}</p>
        </div>
        <div className="detail-command__controls">
          <div className="detail-action-bar">
            <button className="button button--primary" type="button" onClick={(event) => onRecordInteraction?.(event.currentTarget)}>Record interaction</button>
            <button className="button" type="button" onClick={(event) => onAddTask?.(event.currentTarget)}>Add task</button>
            <DetailActionsMenu disabled={statusMutationPending} hasLinkedJob={detail.type === "connection"} onArchive={() => onArchive?.()} onCreateLinkedJob={() => onCreateJob?.()} onDelete={() => onDelete?.()} onEdit={() => onEdit?.()} />
          </div>
          <label className="stage-select" data-status={detail.status}>
            <span className="sr-only">Opportunity stage</span>
            <select disabled={statusMutationPending} value={detail.status} onChange={(event) => onStatusChange?.(event.target.value as OpportunityStatus)}>
              {statuses.map((status) => <option disabled={status === "archived"} key={status} value={status}>{detail.type === "job" ? JOB_STATUS_LABELS[status as keyof typeof JOB_STATUS_LABELS] : CONNECTION_STATUS_LABELS[status as keyof typeof CONNECTION_STATUS_LABELS]}</option>)}
            </select>
          </label>
        </div>
      </header>
    </div>
    {attentionBanner}
    <section className="detail-grid" aria-label="Opportunity workspace">
      <div className="detail-main">
        <section className="tracker-panel">
          <header className="tracker-panel__header"><h2 className="tracker-panel__title">Activity history</h2><span className="tracker-panel__meta">{detail.activities.length}</span></header>
          <OpportunityActivityTimeline activities={detail.activities} />
        </section>
        {detail.type === "job" ? <section className="tracker-panel">
          <header className="tracker-panel__header"><h2 className="tracker-panel__title">Application materials</h2><span className="tracker-panel__meta">{detail.artifacts.length}</span></header>
          <OpportunityArtifactViewer opportunityId={detail.id} artifacts={detail.artifacts} />
        </section> : null}
      </div>
      <aside className="detail-side">
        <OpportunityTaskList
          attentionTaskId={attentionTaskId}
          tasks={detail.tasks}
          pendingTaskId={pendingTaskId}
          onAction={onTaskAction}
          onAddTask={onAddTask}
        />
        <OpportunitySnapshot detail={detail} onEdit={onEdit} />
      </aside>
    </section>
  </>;
}
```

Change the client page signature exactly to:

```tsx
export function OpportunityDetailPage({ opportunityId, attentionTarget = null, today = getLocalCalendarDate() }: {
  opportunityId: string;
  attentionTarget?: AttentionTarget | null;
  today?: string;
}) {
```

Immediately after the current `statusSubmitting` ref declaration, add:

```tsx
const attentionRef = useRef<HTMLElement>(null);
const focusedAttentionKey = useRef<string | null>(null);
const focusResolvedAfterMutation = useRef(false);
```

Replace the current detail-fetch effect with this opportunity-change-safe version:

```tsx
useEffect(() => {
  mounted.current = true;
  const generation = ++detailGeneration.current;
  dialogGeneration.current += 1;
  taskGeneration.current += 1;
  statusGeneration.current += 1;
  submitting.current = false;
  taskSubmitting.current = false;
  destructiveSubmitting.current = false;
  statusSubmitting.current = false;
  focusedAttentionKey.current = null;
  focusResolvedAfterMutation.current = false;
  setDetail(null);
  setPageError(null);
  setDialogError(null);
  setStatus(null);
  setPendingTaskId(null);
  setIsSubmitting(false);
  setIsDestructivePending(false);
  setIsStatusMutationPending(false);
  setSurface(null);
  setInteraction(emptyInteraction);
  setTask(emptyTask);
  fetch(`/api/opportunities/${opportunityId}`, { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) throw new Error(await readError(response));
      return response.json() as Promise<OpportunityDetail>;
    })
    .then((next) => {
      if (mounted.current && generation === detailGeneration.current) setDetail(next);
    })
    .catch((caught) => {
      if (mounted.current && generation === detailGeneration.current) {
        setPageError(caught instanceof Error ? caught.message : "Unable to load opportunity");
      }
    });
}, [opportunityId]);
```

Immediately after that effect and before mutation helpers, add:

```tsx
const attentionContext = detail?.id === opportunityId && attentionTarget
  ? resolveAttentionContext(detail, attentionTarget, today)
  : null;
const activeAttentionTaskId = attentionContext?.state === "active_task" ? attentionContext.task.id : null;
const attentionKey = attentionTarget?.kind === "task"
  ? `${opportunityId}:task:${attentionTarget.taskId}`
  : attentionTarget
    ? `${opportunityId}:${attentionTarget.kind}`
    : null;

useEffect(() => {
  if (!attentionKey) {
    focusedAttentionKey.current = null;
    return;
  }
  if (!attentionContext) return;
  if (focusedAttentionKey.current === attentionKey) return;
  focusedAttentionKey.current = attentionKey;
  if (attentionContext.state !== "resolved") attentionRef.current?.focus({ preventScroll: true });
}, [attentionContext, attentionKey]);

useEffect(() => {
  if (!focusResolvedAfterMutation.current || attentionContext?.state !== "resolved") return;
  focusResolvedAfterMutation.current = false;
  attentionRef.current?.focus({ preventScroll: true });
}, [attentionContext]);

const reviewAttention = () => {
  const id = activeAttentionTaskId ? `opportunity-task-${activeAttentionTaskId}` : "opportunity-actions";
  document.getElementById(id)?.focus();
};
```

At module scope immediately after `mergeStatusResult`, add the exported status contract:

```ts
export const TASK_ACTION_STATUS: Record<TaskAction, string> = {
  complete: "Action completed",
  cancel: "Action cancelled",
  reschedule: "Action rescheduled",
  reopen: "Action reopened"
};
```

Then replace `taskAction` inside `OpportunityDetailPage` so it clears prior status, guards late opportunity results, and requests resolved-state focus only for contextual completion:

```ts
const taskAction = async (
  task: OpportunityTask,
  action: TaskAction,
  dueDate?: string | null,
  focusResolvedOnSuccess = false
) => {
  if (taskSubmitting.current) return;
  taskSubmitting.current = true;
  const generation = ++taskGeneration.current;
  setPendingTaskId(task.id);
  setPageError(null);
  setStatus(null);
  try {
    const next = await mutate(`/api/opportunities/${opportunityId}/tasks/${task.id}`, "PATCH", {
      action,
      ...(action === "reschedule" ? { dueDate } : {})
    });
    if (mounted.current && generation === taskGeneration.current) {
      focusResolvedAfterMutation.current = Boolean(
        focusResolvedOnSuccess &&
        attentionTarget &&
        resolveAttentionContext(next, attentionTarget, today).state === "resolved"
      );
      setDetail((current) => current ? mergeTaskResult(current, next) : current);
      setStatus(TASK_ACTION_STATUS[action]);
    }
  } catch (caught) {
    if (mounted.current && generation === taskGeneration.current) {
      setPageError(caught instanceof Error ? caught.message : "Unable to update task");
    }
  } finally {
    if (mounted.current && generation === taskGeneration.current) {
      taskSubmitting.current = false;
      setPendingTaskId(null);
    }
  }
};
```

Replace `requestStatusMutation` so a response invalidated by an opportunity change does not escape to `changeStatus` and announce success against the new record:

```ts
const requestStatusMutation = async (nextStatus: OpportunityStatus) => {
  if (statusSubmitting.current) return undefined;
  statusSubmitting.current = true;
  setIsStatusMutationPending(true);
  const generation = ++statusGeneration.current;
  try {
    const next = await mutate(`/api/opportunities/${opportunityId}/status`, "PATCH", { status: nextStatus });
    if (mounted.current && generation === statusGeneration.current) {
      setDetail((current) => current ? mergeStatusResult(current, next) : current);
      return next;
    }
    return undefined;
  } catch (caught) {
    if (mounted.current && generation === statusGeneration.current) throw caught;
    return undefined;
  } finally {
    if (mounted.current && generation === statusGeneration.current) {
      statusSubmitting.current = false;
      setIsStatusMutationPending(false);
    }
  }
};
```

Change the loading guard to prevent an old record from rendering during an in-place opportunity-ID change:

```tsx
if (!detail || detail.id !== opportunityId) return <main className="app-shell"><p>Loading opportunity…</p></main>;
```

After that loading guard, build the banner:

```tsx
const attentionBanner = attentionContext ? <OpportunityAttentionBanner
  context={attentionContext}
  onComplete={(task) => void taskAction(task, "complete", undefined, true)}
  onReview={reviewAttention}
  onSetNextAction={(trigger) => { trigger.focus(); open({ kind: "task" }); }}
  pendingTaskId={pendingTaskId}
  ref={attentionRef}
/> : null;
```

Replace only the existing `OpportunityDetailContent` invocation with this exact invocation; keep its following page-error, status, and modal siblings unchanged:

```tsx
<OpportunityDetailContent
  attentionBanner={attentionBanner}
  attentionTaskId={activeAttentionTaskId}
  detail={detail}
  pendingTaskId={pendingTaskId}
  statusMutationPending={isStatusMutationPending}
  onTaskAction={taskAction}
  onStatusChange={changeStatus}
  onRecordInteraction={(trigger) => { trigger.focus(); open({ kind: "interaction" }); }}
  onAddTask={(trigger) => { trigger.focus(); open({ kind: "task" }); }}
  onEdit={() => open({ kind: "edit" })}
  onArchive={() => open({ kind: "archive" })}
  onDelete={() => open({ kind: "delete" })}
  onCreateJob={() => open({ kind: "linked-job" })}
/>
```

- [ ] **Step 5: Run focused tests, type checks, and inspect the orchestration diff**

Run:

```bash
npm test -- --run src/lib/opportunity-attention.test.ts src/components/OpportunityAttentionBanner.test.tsx src/components/OpportunityTaskList.test.tsx src/components/OpportunityDetailPage.test.tsx 'src/app/opportunities/[id]/page.test.tsx'
npm run typecheck
git diff --check
git diff -- 'src/app/opportunities/[id]/page.tsx' 'src/app/opportunities/[id]/page.test.tsx' src/components/OpportunityDetailPage.tsx src/components/OpportunityDetailPage.test.tsx
```

Expected: focused tests and typecheck PASS; direct visits have no focus movement; stale targets never call PATCH; task success uses the existing mutation path and status region; opportunity changes clear every pending lane and ignore late successes, failures, and redirects.

- [ ] **Step 6: Commit ACH-3**

```bash
git add 'src/app/opportunities/[id]/page.tsx' 'src/app/opportunities/[id]/page.test.tsx' src/components/OpportunityDetailPage.tsx src/components/OpportunityDetailPage.test.tsx
git commit -m "feat: explain attention on opportunity arrival"
```

Expected evidence: commit contains only the ACH-3 write set and is ready for its fresh Sol review.

### ACH-4: Responsive visual integration and acceptance suite

**Outcome:** The action-first pills and contextual surface are visually coherent, responsive, touch-safe, focus-visible, and fully verified.

**Dependencies:** ACH-2 and ACH-3 approved. Wave 4.

**Risk:** Low — scoped presentation/CSS contracts with no runtime data effect. Run focused and full checks, then obtain a fresh Sol task review.

**Write set:**

- Modify: `src/app/globals.css`
- Modify: `src/app/globals.test.ts`

No other task writes these files.

**Relevant specification:** action-first pill layout, contextual surface, accessibility/input methods, acceptance criteria 3, 14, and 16.

**Interfaces:** Consumes the classes and IDs created by ACH-1 through ACH-3. Produces no TypeScript API.

- [ ] **Step 1: Write failing static CSS contracts**

Add to `src/app/globals.test.ts`:

```ts
it("styles action-first attention links and contextual arrivals with touch-safe focus", () => {
  expect(css).toMatch(/\.attention-strip__item\s*\{[^}]*min-height:\s*44px;[^}]*\}/s);
  expect(css).toMatch(/\.attention-strip__item:focus-visible\s*\{[^}]*box-shadow:\s*inset 0 0 0 2px var\(--accent\);[^}]*outline:\s*none;[^}]*\}/s);
  expect(css).toMatch(/\.attention-strip__content\s*\{[^}]*display:\s*grid;[^}]*\}/s);
  expect(css).toContain(".attention-strip__meta {");
  expect(css).toContain(".attention-context {");
  expect(css).toContain(".attention-context--active {");
  expect(css).toContain(".attention-context--resolved {");
  expect(css).toMatch(/\.attention-context__actions \.button\s*\{[^}]*min-height:\s*44px;[^}]*\}/s);
  expect(css).toContain(".attention-context:focus-visible");
  expect(css).toContain(".task-item--attention");
});

it("stacks contextual attention content on narrow screens without adding motion", () => {
  expect(css).toMatch(/\/\* Attention context mobile \*\/\s*@media \(max-width: 760px\)\s*\{[\s\S]*?\.attention-context\s*\{[^}]*grid-template-columns:\s*1fr;[^}]*\}[\s\S]*?\.attention-context__actions\s*\{[^}]*width:\s*100%;[^}]*\}/s);
  expect(css).not.toMatch(/\.attention-context[^}]*animation:/s);
  expect(css).not.toMatch(/\.attention-context[^}]*transition:/s);
});
```

- [ ] **Step 2: Run the static CSS test and confirm the red state**

Run:

```bash
npm test -- --run src/app/globals.test.ts
```

Expected: FAIL because the new action-first and contextual selectors do not exist.

- [ ] **Step 3: Implement compact, responsive, motion-free styling**

Replace the existing attention-strip content rules and add the contextual rules in `src/app/globals.css`:

```css
.attention-strip__item {
  align-items: center;
  background: color-mix(in srgb, var(--surface) 74%, transparent);
  border: 1px solid color-mix(in srgb, var(--warning) 15%, var(--line));
  border-radius: 14px;
  color: var(--ink);
  display: inline-flex;
  gap: 9px;
  max-width: min(100%, 360px);
  min-height: 44px;
  min-width: 0;
  padding: 7px 11px;
  text-decoration: none;
}
.attention-strip__item:focus-visible { border-color: var(--accent); box-shadow: inset 0 0 0 2px var(--accent); outline: none; }
.attention-strip__content { display: grid; gap: 2px; min-width: 0; }
.attention-strip__content strong { font-size: 0.77rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.attention-strip__meta { align-items: baseline; color: var(--ink-muted); display: flex; font-size: 0.7rem; gap: 5px; min-width: 0; }
.attention-strip__meta > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.attention-strip__due { color: var(--ink-muted); font-size: 0.7rem; font-weight: 700; white-space: nowrap; }

.attention-context {
  align-items: center;
  border: 1px solid var(--line-strong);
  border-radius: 16px;
  display: grid;
  gap: 20px;
  grid-template-columns: minmax(0, 1fr) auto;
  margin-bottom: 20px;
  padding: 18px 20px;
}
.attention-context--active { background: color-mix(in srgb, var(--warning-soft) 72%, var(--surface)); border-color: color-mix(in srgb, var(--warning) 34%, var(--line)); }
.attention-context--resolved { background: var(--surface-subtle); }
.attention-context__copy { min-width: 0; }
.attention-context__copy .panel-heading__eyebrow { color: var(--warning); margin-bottom: 5px; }
.attention-context--resolved .panel-heading__eyebrow { color: var(--ink-muted); }
.attention-context__copy h2 { font-size: 1.08rem; letter-spacing: -0.025em; line-height: 1.3; margin: 0 0 4px; }
.attention-context__copy p:last-child { color: var(--ink-muted); font-size: 0.82rem; margin: 0; }
.attention-context__actions { align-items: center; display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
.attention-context__actions .button { min-height: 44px; }
.attention-context:focus-visible, .task-item--attention:focus-visible, #opportunity-actions:focus-visible { outline: 3px solid color-mix(in srgb, var(--accent) 38%, transparent); outline-offset: 3px; }
.task-item--attention { background: color-mix(in srgb, var(--warning-soft) 48%, transparent); border-radius: 10px; box-shadow: 0 0 0 6px color-mix(in srgb, var(--warning-soft) 48%, transparent); }
```

Immediately after those attention-context base rules, add a dedicated, uniquely marked breakpoint block rather than modifying one of the stylesheet's several existing 760px blocks:

```css
/* Attention context mobile */
@media (max-width: 760px) {
  .attention-context { align-items: stretch; grid-template-columns: 1fr; padding: 16px; }
  .attention-context__actions { justify-content: stretch; width: 100%; }
  .attention-context__actions .button { flex: 1 1 150px; }
}
```

Do not add transitions or animations to `.attention-context` or `.task-item--attention`.

- [ ] **Step 4: Run focused tests and the complete deterministic suite**

Run:

```bash
npm test -- --run src/lib/dashboard.test.ts src/lib/opportunity-attention.test.ts src/components/AttentionQueue.test.tsx src/components/OpportunityAttentionBanner.test.tsx src/components/OpportunityTaskList.test.tsx src/components/OpportunityDetailPage.test.tsx 'src/app/opportunities/[id]/page.test.tsx' src/app/globals.test.ts
npm run verify
npm run build
git diff --check
```

Expected: every command exits 0; the focused suite proves attention behavior, `verify` passes lint/type/all-test contracts, and production build succeeds. Record the actual Vitest file/test counts from command output in the orchestration ledger rather than asserting a hard-coded count.

- [ ] **Step 5: Inspect privacy, scope, and responsive acceptance evidence**

Run:

```bash
git diff --name-only main...HEAD
git diff --stat main...HEAD
git status --short
```

Expected: only approved source/test/spec/plan files are present; no `.env.local`, `data/*.sqlite`, resume, generated `applications/*`, dependency, migration, API route, or master-resume file appears. Record the manual desktop/760px/320px/light/dark/reduced-motion checklist from the specification for user verification.

- [ ] **Step 6: Commit ACH-4**

```bash
git add src/app/globals.css src/app/globals.test.ts
git commit -m "style: emphasize attention context"
```

Expected evidence: commit contains only the ACH-4 write set and is ready for its fresh Sol review.

## Final Goal acceptance sequence

After all four task reviews are approved, the root controller must:

1. Invoke `superpowers:verification-before-completion`.
2. Re-run exactly:

```bash
npm test -- --run src/lib/dashboard.test.ts src/lib/opportunity-attention.test.ts src/components/AttentionQueue.test.tsx src/components/OpportunityAttentionBanner.test.tsx src/components/OpportunityTaskList.test.tsx src/components/OpportunityDetailPage.test.tsx 'src/app/opportunities/[id]/page.test.tsx' src/app/globals.test.ts
npm run verify
npm run build
git diff --check
git status --short
```

3. Dispatch one freshly routed `sol-final-reviewer` with `docs/specs/attention-context-handoff.md`, this plan, the full Goal diff range, verification output, and known residual visual risk.
4. Resolve any blocking finding under the one-fix-pass policy.
5. Mark the native Goal complete only after all acceptance commands pass and the Sol final reviewer reports no blocking findings.

## Plan self-review

- Spec coverage: ACH-1 covers attention identity/copy/URLs and pure resolution; ACH-2 covers presentation/focus targets; ACH-3 covers route/fetch/mutation/focus orchestration; ACH-4 covers responsive visual/accessibility contracts and full verification.
- Task boundaries: each task has a non-overlapping write set, explicit dependency wave, focused check, commit, and required review timing.
- Type consistency: `AttentionLinkTarget`, `AttentionTarget`, `ResolvedAttentionContext`, `opportunityIsAttentionEligible`, `attentionTarget`, `attentionTaskId`, `attentionBanner`, `TASK_ACTION_STATUS`, and DOM focus IDs use the same names across all tasks.
- Scope: no persistence, API, dependency, security boundary, or unrelated refactor is included.
