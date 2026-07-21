# Dashboard Next-Action CTA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep missing planning choices out of Needs attention and let users create an entity-identified next action directly from the dashboard row.

**Architecture:** Dashboard insights become task-only, while the opportunity table owns the contextual row trigger. A shared controlled `TaskComposer` renders opportunity identity for both dashboard and detail-page entry points; each controller continues to own its request and reconciliation state. The existing task endpoint remains authoritative and the dashboard converts its returned detail into a summary.

**Tech Stack:** Next.js 16, React 19, TypeScript 5.9, Vitest 4, jsdom, CSS

## Global Constraints

- Needs attention contains only persisted open tasks with a due date on or before today.
- Missing next actions never render in or increment Needs attention.
- Eligible missing-task rows use the exact visible CTA copy `Set next action`.
- The task modal title is `Add next action` and its identity eyebrow is `Creating task for`.
- Rejected, archived, dormant, and closed opportunities never show the CTA.
- Task due dates remain optional.
- No database schema, API contract, dependency, or animation change is allowed.
- Existing `attention=missing_next_action` parsing remains compatible, but the dashboard stops generating such links.
- Implementation uses a failing test before each production behavior change.

---

### Task 1: Make dashboard attention task-only

**Files:**
- Modify: `src/lib/dashboard.test.ts`
- Modify: `src/lib/dashboard.ts`
- Modify: `src/components/AttentionQueue.test.tsx`
- Modify: `src/components/AttentionQueue.tsx`
- Modify: `src/app/globals.test.ts`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: `OpportunitySummary.nextOpenTask` and `opportunityIsAttentionEligible(opportunity)`.
- Produces: task-only `DashboardAttentionItem` with `kind: "task"`, non-null `taskId`, `actionLabel`, `dueDate`, and `isOverdue`.

- [ ] **Step 1: Write the failing attention-domain test**

Replace the synthesized-planning expectation in `src/lib/dashboard.test.ts` with a test that includes a due task, a future task, and missing-task opportunities, then asserts only the due task is returned:

```ts
it("returns only persisted due work and ignores missing next actions", () => {
  const insights = getDashboardInsights([
    connection({ id: "connection-missing", nextOpenTask: null }),
    job({
      id: "job-due",
      nextOpenTask: task({ id: "job-task", opportunityId: "job-due", dueDate: "2026-07-09" })
    }),
    job({
      id: "job-future",
      nextOpenTask: task({ id: "future-task", opportunityId: "job-future", dueDate: "2026-07-12" })
    })
  ], "2026-07-09");

  expect(insights.attention).toEqual([
    expect.objectContaining({
      opportunityId: "job-due",
      kind: "task",
      taskId: "job-task",
      actionLabel: "Follow up",
      dueDate: "2026-07-09"
    })
  ]);
});
```

- [ ] **Step 2: Run the focused domain test and confirm RED**

Run: `npm test -- src/lib/dashboard.test.ts`

Expected: FAIL because `connection-missing` is still emitted as `missing_next_action`.

- [ ] **Step 3: Remove synthesized planning items from dashboard insights**

Change `src/lib/dashboard.ts` to import only `opportunityIsAttentionEligible` and use this task-only shape:

```ts
export type DashboardAttentionItem = DashboardAttentionBase & {
  kind: "task";
  taskId: string;
  actionLabel: string;
  dueDate: string;
  isOverdue: boolean;
};
```

The loop must contain only the persisted due-task branch:

```ts
for (const opportunity of opportunities) {
  if (!opportunityIsAttentionEligible(opportunity)) continue;
  const task = opportunity.nextOpenTask;
  if (!task?.dueDate || task.dueDate > today) continue;
  attention.push({
    id: `task-${task.id}`,
    opportunityId: opportunity.id,
    type: opportunity.type,
    label: opportunity.label,
    organization: opportunity.organization,
    status: opportunity.status,
    priority: opportunity.priority,
    kind: "task",
    taskId: task.id,
    actionLabel: task.title,
    dueDate: task.dueDate,
    isOverdue: task.dueDate < today
  });
}
```

- [ ] **Step 4: Simplify the attention strip test and presentation**

Delete the missing-next-action test in `src/components/AttentionQueue.test.tsx`. Replace `attentionPresentation` in `src/components/AttentionQueue.tsx` with task-only logic:

```ts
function attentionPresentation(item: DashboardAttentionItem): AttentionPresentation {
  const status = item.isOverdue
    ? `Overdue · ${item.dueDate}`
    : `Due today · ${item.dueDate}`;
  return {
    title: item.actionLabel,
    status,
    ariaLabel: `${item.actionLabel} for ${item.label}. ${status}`,
    itemClassName: "attention-strip__item",
    markerClassName: `attention-list__marker attention-list__marker--${item.priority}`,
    statusClassName: item.isOverdue
      ? "attention-strip__due attention-strip__due--overdue"
      : "attention-strip__due"
  };
}
```

Build each link explicitly as a task target:

```tsx
href={buildAttentionHref({
  kind: "task",
  opportunityId: item.opportunityId,
  taskId: item.taskId
})}
```

Remove `.attention-list__marker--planning` and `.attention-strip__due--planning` rules from `src/app/globals.css`, and remove their assertions from `src/app/globals.test.ts`.

- [ ] **Step 5: Verify the attention slice is GREEN**

Run: `npm test -- src/lib/dashboard.test.ts src/components/AttentionQueue.test.tsx src/app/globals.test.ts`

Expected: all selected files pass with zero failures.

- [ ] **Step 6: Commit the task-only attention model**

```bash
git add src/lib/dashboard.ts src/lib/dashboard.test.ts src/components/AttentionQueue.tsx src/components/AttentionQueue.test.tsx src/app/globals.css src/app/globals.test.ts
git commit -m "fix: reserve attention for due tasks"
```

---

### Task 2: Extract an identity-aware task composer and pending-safe modal

**Files:**
- Create: `src/components/TaskComposer.tsx`
- Create: `src/components/TaskComposer.test.tsx`
- Modify: `src/components/Modal.tsx`
- Modify: `src/components/Modal.test.tsx`
- Modify: `src/app/globals.css`
- Modify: `src/app/globals.test.ts`

**Interfaces:**
- Consumes: `Opportunity`, controlled task draft values, error state, and pending state.
- Produces: `TaskComposer(props: TaskComposerProps)` and `Modal` prop `dismissDisabled?: boolean`.

- [ ] **Step 1: Write failing shared-composer tests**

Create `src/components/TaskComposer.test.tsx` with job and connection fixtures and these assertions:

```tsx
// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ConnectionOpportunity, JobOpportunity } from "../types";
import { TaskComposer } from "./TaskComposer";

const common = {
  id: "opportunity-1", priority: "medium" as const, summary: null,
  originOpportunityId: null, createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z"
};

const job: JobOpportunity = {
  ...common, type: "job", label: "Platform Engineer", organization: "Acme",
  status: "applied", url: null, source: null, location: null, contact: null, appliedDate: null
};

const connection: ConnectionOpportunity = {
  ...common, type: "connection", label: "Kara Melton", organization: null,
  status: "in_conversation", roleContext: "Design leader", contactInfo: null,
  meetingContext: null, relationshipStrength: "familiar", lastInteractionAt: null
};

const props = {
  taskTitle: "", taskDueDate: "", onTaskTitleChange: vi.fn(),
  onTaskDueDateChange: vi.fn(), onSubmit: vi.fn(), onCancel: vi.fn()
};

describe("TaskComposer", () => {
  it("names the selected job and its organization", () => {
    const markup = renderToStaticMarkup(<TaskComposer {...props} opportunity={job} />);
    expect(markup).toContain("Creating task for");
    expect(markup).toContain("Platform Engineer");
    expect(markup).toContain("Acme");
    expect(markup).toContain("Job");
  });

  it("uses connection role context and disables dismissal controls while saving", () => {
    const markup = renderToStaticMarkup(<TaskComposer {...props} opportunity={connection} isSubmitting />);
    expect(markup).toContain("Kara Melton");
    expect(markup).toContain("Design leader");
    expect(markup).toContain("Connection");
    expect(markup).toContain("Saving…");
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Cancel<\/button>/);
  });
});
```

- [ ] **Step 2: Write the failing modal dismissal test**

Add to `src/components/Modal.test.tsx` a mounted test that renders `<Modal dismissDisabled title="Saving task" onClose={onClose}>`, dispatches Escape, clicks the backdrop and close button, and expects `onClose` not to run and `.modal__close.disabled` to be `true`.

- [ ] **Step 3: Run shared UI tests and confirm RED**

Run: `npm test -- src/components/TaskComposer.test.tsx src/components/Modal.test.tsx`

Expected: FAIL because `TaskComposer` and `dismissDisabled` do not exist.

- [ ] **Step 4: Create the shared controlled composer**

Create `src/components/TaskComposer.tsx` exporting `TaskComposerProps` and `TaskComposer`. Its opportunity context helper must return organization first, then connection role context, then `Independent connection` or `Organization not set`:

```tsx
"use client";

import type { FormEvent } from "react";
import type { Opportunity } from "../types";

export type TaskComposerProps = {
  opportunity: Opportunity;
  taskTitle: string;
  taskDueDate: string;
  error?: string | null;
  isSubmitting?: boolean;
  onTaskTitleChange: (value: string) => void;
  onTaskDueDateChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
};

function contextLabel(opportunity: Opportunity) {
  if (opportunity.organization) return opportunity.organization;
  if (opportunity.type === "connection") return opportunity.roleContext ?? "Independent connection";
  return "Organization not set";
}

export function TaskComposer({ opportunity, taskTitle, taskDueDate, error, isSubmitting = false, onTaskTitleChange, onTaskDueDateChange, onSubmit, onCancel }: TaskComposerProps) {
  return <form className="application-form task-composer-form" onSubmit={onSubmit}>
    <div className="application-form__body">
      {error ? <p role="alert">{error}</p> : null}
      <section className="task-composer-form__context" aria-label={`Creating task for ${opportunity.label}`}>
        <div className="task-composer-form__context-heading">
          <span className="panel-heading__eyebrow">Creating task for</span>
          <span className={`type-badge type-badge--${opportunity.type}`}>{opportunity.type === "job" ? "Job" : "Connection"}</span>
        </div>
        <strong>{opportunity.label}</strong>
        <p>{contextLabel(opportunity)}</p>
      </section>
      <div className="application-form__grid">
        <label className="application-form__field"><span className="application-form__label">What needs to happen?</span><input className="application-form__input" data-autofocus disabled={isSubmitting} required placeholder="e.g. Send a thoughtful follow-up" value={taskTitle} onChange={(event) => onTaskTitleChange(event.target.value)} /></label>
        <label className="application-form__field"><span className="application-form__label">Due date</span><input className="application-form__input" disabled={isSubmitting} type="date" value={taskDueDate} onChange={(event) => onTaskDueDateChange(event.target.value)} /></label>
      </div>
    </div>
    <div className="application-form__actions"><button className="button" disabled={isSubmitting} type="button" onClick={onCancel}>Cancel</button><button className="button button--primary" disabled={isSubmitting} type="submit">{isSubmitting ? "Saving…" : "Add task"}</button></div>
  </form>;
}
```

- [ ] **Step 5: Add pending-safe modal dismissal**

Extend `ModalProps` with `dismissDisabled?: boolean`. Keep a ref synchronized with the prop so changing pending state does not rerun the focus effect:

```ts
const dismissDisabledRef = useRef(dismissDisabled);
dismissDisabledRef.current = dismissDisabled;
```

Escape and backdrop handlers call `onClose()` only when the ref is false. Render the close control as:

```tsx
<button className="modal__close" disabled={dismissDisabled} type="button" onClick={onClose}>
  <span aria-hidden="true">×</span><span className="sr-only">Close</span>
</button>
```

- [ ] **Step 6: Replace generic task-intro styles with identity styles**

Replace `.task-composer-form__intro` rules with `.task-composer-form__context`, `.task-composer-form__context-heading`, and child typography rules. The context uses the existing accent-soft surface, wraps long text, and keeps the current 12px radius. Add `.modal__close:disabled { cursor: wait; opacity: 0.55; }`. Update `src/app/globals.test.ts` to assert these exact selectors and remove the old intro assertion.

- [ ] **Step 7: Verify the shared UI slice is GREEN**

Run: `npm test -- src/components/TaskComposer.test.tsx src/components/Modal.test.tsx src/app/globals.test.ts`

Expected: all selected files pass with zero failures.

- [ ] **Step 8: Commit the shared composer**

```bash
git add src/components/TaskComposer.tsx src/components/TaskComposer.test.tsx src/components/Modal.tsx src/components/Modal.test.tsx src/app/globals.css src/app/globals.test.ts
git commit -m "feat: add context-aware task composer"
```

---

### Task 3: Add the contextual Next move CTA

**Files:**
- Modify: `src/components/OpportunityTable.test.tsx`
- Modify: `src/components/OpportunityTable.tsx`
- Modify: `src/app/globals.css`
- Modify: `src/app/globals.test.ts`

**Interfaces:**
- Consumes: `opportunityIsAttentionEligible(opportunity)`.
- Produces: optional callback `onAddTask?: (opportunity: OpportunitySummary, trigger: HTMLButtonElement) => void` and stable focus ID `opportunity-next-move-${opportunity.id}`.

- [ ] **Step 1: Write failing CTA behavior tests**

Add tests to `src/components/OpportunityTable.test.tsx` that assert:

```tsx
it("offers an entity-named next-action CTA only for eligible rows", () => {
  const wishlist = { ...job, id: "wishlist-job", status: "wishlist" as const, nextOpenTask: null };
  const rejected = { ...job, id: "rejected-job", label: "Closed Role", status: "rejected" as const, nextOpenTask: null };
  renderTable([connection, wishlist, rejected]);
  expect(rowFor("Maya Chen")?.querySelector('button[aria-label="Set next action for Maya Chen"]')?.textContent).toBe("Set next action");
  expect(rowFor("Platform Engineer")?.querySelector('button[aria-label="Set next action for Platform Engineer"]')).not.toBeNull();
  expect(rowFor("Closed Role")?.querySelector("button")).toBeNull();
  expect(rowFor("Closed Role")?.querySelector(".next-move__label")?.textContent).toBe("No next action");
});
```

Update the test render helper to pass `onAddTask={() => undefined}`. Add a mounted interaction test that clicks Maya Chen’s CTA and expects the callback to receive `connection` and that exact button.

- [ ] **Step 2: Run the table test and confirm RED**

Run: `npm test -- src/components/OpportunityTable.test.tsx`

Expected: FAIL because the Next move cell contains inert text and no callback.

- [ ] **Step 3: Implement the conditional CTA and stable focus target**

Add `onAddTask` to the table props and import `opportunityIsAttentionEligible`. Render the Next move cell with this branching:

```tsx
<div className="next-move" id={`opportunity-next-move-${opportunity.id}`} tabIndex={-1}>
  {opportunity.nextOpenTask ? <>
    <span className="next-move__label">{opportunity.nextOpenTask.title}</span>
    <time className="next-move__date" dateTime={opportunity.nextOpenTask.dueDate ?? undefined}>{formatDate(opportunity.nextOpenTask.dueDate)}</time>
  </> : opportunityIsAttentionEligible(opportunity) && onAddTask ?
    <button aria-label={`Set next action for ${opportunity.label}`} className="next-move__cta" type="button" onClick={(event) => onAddTask(opportunity, event.currentTarget)}>Set next action</button> :
    <span className="next-move__label next-move__label--empty">No next action</span>}
</div>
```

- [ ] **Step 4: Style and verify the CTA**

Add a touch-safe `.next-move__cta` with accent text, transparent background, explicit border, 44px minimum height, visible focus, and a fine-pointer hover rule. Add CSS assertions for the target size and focus selector.

Run: `npm test -- src/components/OpportunityTable.test.tsx src/app/globals.test.ts`

Expected: both files pass with zero failures.

- [ ] **Step 5: Commit the row CTA**

```bash
git add src/components/OpportunityTable.tsx src/components/OpportunityTable.test.tsx src/app/globals.css src/app/globals.test.ts
git commit -m "feat: add next-action row CTA"
```

---

### Task 4: Wire dashboard task creation and reuse the shared composer

**Files:**
- Modify: `src/components/Dashboard.test.tsx`
- Modify: `src/components/Dashboard.tsx`
- Modify: `src/components/OpportunityDetailPage.test.tsx`
- Modify: `src/components/OpportunityDetailPage.tsx`

**Interfaces:**
- Consumes: `TaskComposer`, `Modal.dismissDisabled`, `OpportunityTable.onAddTask`, `POST /api/opportunities/:id/tasks`, and `detailToSummary`.
- Produces: in-dashboard task creation with entity-specific status copy and meaningful success focus; detail-page task creation uses the same shared composer.

- [ ] **Step 1: Update dashboard attention expectations and write failing task-creation tests**

Change existing dashboard tests that use missing-task fixtures to expect zero attention, an absent attention strip, and `0 Needs attention` in the pipeline pulse.

Add an integration test using one loaded `job`, an authoritative returned `OpportunityDetail` containing one open task, and these checks:

```ts
const createdTask = {
  id: "task-1", opportunityId: job.id, title: "Send portfolio", dueDate: null,
  state: "open" as const, sourceActivityId: null, completedAt: null,
  createdAt: "2026-07-21T12:00:00.000Z", updatedAt: "2026-07-21T12:00:00.000Z"
};
const updated: OpportunityDetail = {
  ...job, tasks: [createdTask], activities: [], artifacts: [], origin: null, originatedJobs: []
};
```

After clicking `Set next action`, assert the dialog title is `Add next action`, the dialog contains `Platform Engineer` and `Acme Corp`, submit `Send portfolio`, and verify:

```ts
expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/opportunities/job-1/tasks", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ title: "Send portfolio", dueDate: null })
});
expect(container.querySelector('[role="dialog"]')).toBeNull();
expect(container.querySelector(".next-move__label")?.textContent).toBe("Send portfolio");
expect(toastState.props?.message).toBe("Next action added for Platform Engineer.");
expect(document.activeElement?.id).toBe("opportunity-next-move-job-1");
```

Add a failure test returning `{ error: "Task rejected" }` with `ok: false`; assert the same modal, entity, title draft, and dialog-scoped alert remain.

Add a second success case whose returned task uses today’s local date. Compute that value with the same local calendar construction used by the product:

```ts
function localDateKey(value = new Date()) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}
```

After submission, assert `.attention-strip` contains `Send portfolio` and `1 to review`. The undated success case must continue to assert that no attention strip appears.

- [ ] **Step 2: Write failing detail-page shared-composer assertions**

Update the task-composer markup test in `src/components/OpportunityDetailPage.test.tsx` to expect `Creating task for`, the fixture’s label and context, and no `Make the next move concrete`. Update modal title expectations from `Add task` to `Add next action` where they refer to the dialog heading rather than the trigger button.

- [ ] **Step 3: Run controller tests and confirm RED**

Run: `npm test -- src/components/Dashboard.test.tsx src/components/OpportunityDetailPage.test.tsx`

Expected: FAIL because the dashboard has no task modal and the detail page still owns the generic composer.

- [ ] **Step 4: Add dashboard task surface state and request lifecycle**

Import `useLayoutEffect`, `Modal`, and `TaskComposer`. Add controlled state:

```ts
const [taskTarget, setTaskTarget] = useState<OpportunitySummary | null>(null);
const [taskDraft, setTaskDraft] = useState({ title: "", dueDate: "" });
const [taskError, setTaskError] = useState<string | null>(null);
const [isTaskSubmitting, setIsTaskSubmitting] = useState(false);
const [nextMoveFocusId, setNextMoveFocusId] = useState<string | null>(null);
const taskRequestRef = useRef(0);
const taskSubmittingRef = useRef(false);
```

Use a layout effect to focus `opportunity-next-move-${nextMoveFocusId}` after the summary updates, then clear the request:

```ts
useLayoutEffect(() => {
  if (!nextMoveFocusId) return;
  const nextMove = document.getElementById(`opportunity-next-move-${nextMoveFocusId}`);
  if (!nextMove) return;
  nextMove.focus({ preventScroll: true });
  setNextMoveFocusId(null);
}, [nextMoveFocusId, opportunities]);
```

Add a stable close callback and a request function with target and generation guards:

```ts
const closeTask = useCallback(() => {
  if (taskSubmittingRef.current) return;
  taskRequestRef.current += 1;
  setTaskTarget(null);
  setTaskDraft({ title: "", dueDate: "" });
  setTaskError(null);
}, []);

const submitTask = async () => {
  if (!taskTarget || taskSubmittingRef.current) return;
  const target = taskTarget;
  const generation = ++taskRequestRef.current;
  taskSubmittingRef.current = true;
  setIsTaskSubmitting(true);
  setTaskError(null);
  try {
    const response = await fetch(`/api/opportunities/${target.id}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: taskDraft.title, dueDate: taskDraft.dueDate || null })
    });
    if (!response.ok) throw new Error(await readError(response));
    const detail = await response.json() as OpportunityDetail;
    if (!mountedRef.current || generation !== taskRequestRef.current) return;
    if (detail.id !== target.id) throw new Error("Task response did not match the selected opportunity");
    const updated = detailToSummary(detail);
    setOpportunities((current) => current.map((item) => item.id === updated.id ? updated : item));
    setTaskTarget(null);
    setTaskDraft({ title: "", dueDate: "" });
    setToast({ message: `Next action added for ${target.label}.` });
    setNextMoveFocusId(target.id);
  } catch (caught) {
    if (mountedRef.current && generation === taskRequestRef.current) {
      setTaskError(caught instanceof Error ? caught.message : "Unable to add next action");
    }
  } finally {
    if (mountedRef.current && generation === taskRequestRef.current) {
      taskSubmittingRef.current = false;
      setIsTaskSubmitting(false);
    }
  }
};
```

Pass this callback to the table:

```tsx
onAddTask={(opportunity, trigger) => {
  trigger.focus();
  taskRequestRef.current += 1;
  setTaskTarget(opportunity);
  setTaskDraft({ title: "", dueDate: "" });
  setTaskError(null);
}}
```

Render the shared modal after the workspace:

```tsx
{taskTarget ? <Modal dismissDisabled={isTaskSubmitting} title="Add next action" onClose={closeTask}>
  <TaskComposer
    error={taskError}
    isSubmitting={isTaskSubmitting}
    opportunity={taskTarget}
    taskDueDate={taskDraft.dueDate}
    taskTitle={taskDraft.title}
    onCancel={closeTask}
    onSubmit={(event) => { event.preventDefault(); void submitTask(); }}
    onTaskDueDateChange={(dueDate) => setTaskDraft((current) => ({ ...current, dueDate }))}
    onTaskTitleChange={(title) => setTaskDraft((current) => ({ ...current, title }))}
  />
</Modal> : null}
```

- [ ] **Step 5: Reuse the composer on the detail page**

Delete the local `TaskComposer` function from `OpportunityDetailPage.tsx`, import the shared component, pass `opportunity={detail}`, change the modal title to `Add next action`, and set `dismissDisabled={isSubmitting}`. Keep the existing detail controller’s draft, request generation, error preservation, and mutation endpoint unchanged.

- [ ] **Step 6: Verify controller behavior is GREEN**

Run: `npm test -- src/components/Dashboard.test.tsx src/components/OpportunityDetailPage.test.tsx`

Expected: both files pass with zero failures.

- [ ] **Step 7: Run full verification**

Run: `npm run verify`

Expected: lint, typecheck, and all Vitest files pass with zero errors.

Run: `npm run build`

Expected: Next.js production build exits successfully.

- [ ] **Step 8: Commit the completed interaction**

```bash
git add src/components/Dashboard.tsx src/components/Dashboard.test.tsx src/components/OpportunityDetailPage.tsx src/components/OpportunityDetailPage.test.tsx
git commit -m "feat: create next actions from dashboard"
```

---

## Final Review Checklist

- [ ] Needs attention contains due and overdue persisted tasks only.
- [ ] Eligible missing-task rows show `Set next action`; terminal rows do not.
- [ ] Dashboard task creation stays on the dashboard and identifies the target.
- [ ] Detail-page task creation shows the same identity surface.
- [ ] Success updates the row and moves focus to it; failure preserves target and draft.
- [ ] Dismissal is unavailable only while task submission is pending.
- [ ] No schema, API, dependency, or animation change was introduced.
- [ ] Focused tests, full verification, and production build all pass.
