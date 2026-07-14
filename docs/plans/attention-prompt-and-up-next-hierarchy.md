# Attention Prompt and Up Next Hierarchy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Distinguish system-derived planning prompts from persisted tasks and make the primary Up next task a clear, accessible, single-surface action hierarchy.

**Architecture:** Preserve the existing attention eligibility, ordering, URL, and mutation contracts. Strengthen the dashboard discriminated union so only real tasks expose `actionLabel`, then render each variant with type-specific presentation. Refine the shared primary-task component and CSS so the Actions card owns one surface, urgency is attached to the due state, Complete is primary, and secondary maintenance controls use native progressive disclosure.

**Tech Stack:** Next.js 16, React 19, TypeScript, CSS, Vitest, React DOM test utilities, SQLite (unchanged).

## Global Constraints

- Implement `docs/specs/attention-prompt-and-up-next-hierarchy.md` exactly; later scope, architecture, acceptance, or task-boundary changes require artifact revision and renewed approval.
- Keep missing-next-action eligibility, sorting, counts, filtering, fresh-detail revalidation, and `attention=missing_next_action` URLs unchanged.
- Do not create a task, due date, activity, migration, schema change, API change, dependency, authentication/authorization change, private-file change, application submission, or master-resume change.
- No animation, keyboard-triggered animation, `transition: all`, scale-from-zero, or ungated hover transform.
- Every interactive target introduced or restyled by this plan remains at least 44px tall.
- Preserve native task mutation callbacks, pending locks, error alerts, date drafts, and focus lifecycle.

---

## File map and task waves

| Wave | Task | Outcome | Write set | Risk |
| --- | --- | --- | --- | --- |
| 1 | `APH-1` | Type-truthful, visually complete planning prompts in the dashboard strip | `src/lib/dashboard.ts`, `src/lib/dashboard.test.ts`, `src/components/AttentionQueue.tsx`, `src/components/AttentionQueue.test.tsx`, `src/components/Dashboard.test.tsx`, `src/app/globals.css`, `src/app/globals.test.ts` | Medium |
| 2 | `APH-2` | Single-surface, status-led Up next hierarchy and responsive/accessibility contracts | `src/components/OpportunityTaskList.tsx`, `src/components/OpportunityTaskList.test.tsx`, `src/components/OpportunityDetailPage.test.tsx`, `src/app/globals.css`, `src/app/globals.test.ts` | Medium |

Writers are serialized. `APH-1` and `APH-2` intentionally share `src/app/globals.css` and `src/app/globals.test.ts`; `APH-2` starts only after the `APH-1` CSS commit is reviewed and approved, so there is no concurrent overlap. All other write sets are disjoint.

---

### Task APH-1: Make derived planning prompts type-truthful

**Outcome:** Missing-next-action remains a Needs attention reason but no longer has a task/action field or task-like dashboard copy.

**Dependencies:** None.
**Dependency wave:** 1.
**Risk:** Medium — changes a shared discriminated union and its rendering consumer. Run focused checks, inspect the diff immediately, and obtain a fresh Sol review before `APH-2`.

**Files:**

- Modify: `src/lib/dashboard.ts:9-33,57-100`
- Modify: `src/lib/dashboard.test.ts:64-113`
- Modify: `src/components/AttentionQueue.tsx:1-38`
- Modify: `src/components/AttentionQueue.test.tsx:31-75`
- Modify: `src/components/Dashboard.test.tsx:70-315`
- Modify: `src/app/globals.css:299-316`
- Modify: `src/app/globals.test.ts:236-247`

**Relevant specification:** “Truthful attention model,” “Dashboard presentation,” acceptance criteria 1–4 and 12.

**Interfaces:**

- Consumes: `OpportunitySummary.nextOpenTask`, existing attention eligibility/forward-motion rules, and `buildAttentionHref`.
- Produces:

```ts
export type DashboardAttentionItem = DashboardAttentionBase & (
  | {
      kind: "task";
      taskId: string;
      actionLabel: string;
      dueDate: string;
      isOverdue: boolean;
    }
  | {
      kind: "missing_next_action";
      taskId: null;
      reasonLabel: "No next action planned";
      dueDate: null;
      isOverdue: false;
    }
);
```

- Produces and styles the complete queue contracts `attention-strip__item--planning`, `attention-list__marker--planning`, and `attention-strip__due--planning`.

- [ ] **Step 1: Write failing dashboard-domain tests**

In `src/lib/dashboard.test.ts`, extend the first insights test after the existing ordered equality check:

```ts
const planning = insights.attention.find((item) => item.kind === "missing_next_action");
expect(planning).toMatchObject({
  kind: "missing_next_action",
  taskId: null,
  reasonLabel: "No next action planned",
  dueDate: null,
  isOverdue: false
});
expect(planning).not.toHaveProperty("actionLabel");
```

Keep the existing due-task assertions unchanged so the test proves that persisted tasks still carry their task ID, title, and date.

- [ ] **Step 2: Write failing queue presentation tests**

Replace the missing-next-action fixture and assertions in `src/components/AttentionQueue.test.tsx` with:

```tsx
it("presents a missing next action as a planning prompt rather than a stored action", () => {
  document.body.innerHTML = renderToStaticMarkup(<AttentionQueue items={[{
    id: "missing-next-action-opportunity-1",
    opportunityId: "opportunity-1",
    taskId: null,
    type: "job",
    label: "Engineering Manager",
    organization: "Acme",
    status: "applied",
    priority: "high",
    kind: "missing_next_action",
    reasonLabel: "No next action planned",
    dueDate: null,
    isOverdue: false
  }]} onViewAll={() => undefined} />);

  const link = document.querySelector<HTMLAnchorElement>(".attention-strip__item--planning")!;
  expect(link.href).toContain("/opportunities/opportunity-1?attention=missing_next_action");
  expect(link.href).not.toContain("taskId=");
  expect(link.getAttribute("aria-label")).toBe(
    "No next action planned for Engineering Manager. Open planning prompt."
  );
  expect(link.querySelector("strong")?.textContent).toBe("No next action planned");
  expect(link.textContent).toContain("Engineering Manager");
  expect(link.textContent).toContain("Planning");
  expect(link.querySelector(".attention-list__marker--planning")).not.toBeNull();
  expect(link.textContent).not.toContain("Set a next action");
  expect(link.textContent).not.toContain("Plan next move");
});
```

Keep the real-task test and add:

```ts
expect(link.classList.contains("attention-strip__item--planning")).toBe(false);
expect(link.querySelector(".attention-list__marker--medium")).not.toBeNull();
```

In `src/components/Dashboard.test.tsx`, add this interaction test using the existing `job`, `connection`, `jsonResponse`, `mountDashboard`, and `flushDashboard` helpers:

```tsx
it("keeps the attention count stable while View all resets type and selects Needs attention", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse([job, connection]));
  const { container, root } = mountDashboard();
  await flushDashboard();

  const queue = container.querySelector<HTMLElement>(".attention-strip")!;
  const active = [...container.querySelectorAll<HTMLButtonElement>(".status-filter__button")]
    .find((button) => button.textContent?.trim() === "Active")!;
  const needsAttention = [...container.querySelectorAll<HTMLButtonElement>(".status-filter__button")]
    .find((button) => button.textContent?.includes("Needs attention"))!;
  const typeGroup = container.querySelector<HTMLElement>('[aria-label="Filter opportunities by type"]')!;
  const allTypes = [...typeGroup.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.trim() === "All")!;
  const jobs = [...typeGroup.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.trim() === "Jobs")!;
  const viewAll = [...queue.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent === "View all")!;

  expect(queue.textContent).toContain("2 to review");
  expect(active.getAttribute("aria-pressed")).toBe("true");
  expect(needsAttention.getAttribute("aria-pressed")).toBe("false");
  act(() => jobs.click());
  expect(allTypes.getAttribute("aria-pressed")).toBe("false");
  expect(jobs.getAttribute("aria-pressed")).toBe("true");

  act(() => viewAll.click());

  expect(queue.textContent).toContain("2 to review");
  expect(active.getAttribute("aria-pressed")).toBe("false");
  expect(needsAttention.getAttribute("aria-pressed")).toBe("true");
  expect(allTypes.getAttribute("aria-pressed")).toBe("true");
  expect(jobs.getAttribute("aria-pressed")).toBe("false");
  expect(container.textContent).toContain("Platform Engineer");
  expect(container.textContent).toContain("Maya Chen");
  act(() => root.unmount());
});
```

In `src/app/globals.test.ts`, add the planning-presentation contracts to the existing attention style test:

```ts
expect(css).toMatch(/\.attention-list__marker--planning\s*\{[^}]*border:\s*2px solid var\(--warning\);/s);
expect(css).toMatch(/\.attention-strip__due--planning\s*\{[^}]*background:[^;]+;[^}]*color:\s*var\(--warning\);/s);
```

- [ ] **Step 3: Run the focused tests and confirm RED**

Run:

```bash
npm test -- --run src/lib/dashboard.test.ts src/components/AttentionQueue.test.tsx src/components/Dashboard.test.tsx src/app/globals.test.ts
```

Expected: FAIL because the missing variant still exposes `actionLabel`, lacks `reasonLabel`, the queue has no planning-specific presentation or accessible name, View all/count behavior is not explicitly covered, and the planning marker/status styles do not exist.

- [ ] **Step 4: Strengthen the dashboard union and derivation**

In `src/lib/dashboard.ts`, replace the current union with the interface shown above. Replace the missing-next-action object field:

```ts
reasonLabel: "No next action planned",
```

Delete this field from that branch only:

```ts
actionLabel: "Set a next action",
```

Do not change the task branch, eligibility, ordering, IDs, due dates, or priority.

- [ ] **Step 5: Render type-specific queue presentation**

Replace `dueCopy` in `src/components/AttentionQueue.tsx` with:

```ts
type AttentionPresentation = {
  title: string;
  status: string;
  ariaLabel: string;
  itemClassName: string;
  markerClassName: string;
  statusClassName: string;
};

function attentionPresentation(item: DashboardAttentionItem): AttentionPresentation {
  if (item.kind === "missing_next_action") {
    return {
      title: item.reasonLabel,
      status: "Planning",
      ariaLabel: `${item.reasonLabel} for ${item.label}. Open planning prompt.`,
      itemClassName: "attention-strip__item attention-strip__item--planning",
      markerClassName: "attention-list__marker attention-list__marker--planning",
      statusClassName: "attention-strip__due attention-strip__due--planning"
    };
  }

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

Inside the queue map, derive and render the presentation without changing the link target:

```tsx
{visibleItems.map((item) => {
  const presentation = attentionPresentation(item);
  return <Link
    aria-label={presentation.ariaLabel}
    className={presentation.itemClassName}
    href={buildAttentionHref(item)}
    key={item.id}
  >
    <span className={presentation.markerClassName} aria-hidden="true" />
    <span className="attention-strip__content">
      <strong>{presentation.title}</strong>
      <span className="attention-strip__meta">
        <span>{item.label}</span>
        <span aria-hidden="true">·</span>
        <span className={presentation.statusClassName}>{presentation.status}</span>
      </span>
    </span>
  </Link>;
})}
```

In `src/app/globals.css`, add the complete planning treatment next to the existing attention marker and due rules:

```css
.attention-list__marker--planning {
  background: transparent;
  border: 2px solid var(--warning);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--warning) 12%, transparent);
}
.attention-strip__due--planning {
  background: color-mix(in srgb, var(--warning-soft) 76%, var(--surface));
  border-radius: 999px;
  color: var(--warning);
  padding: 2px 6px;
}
```

- [ ] **Step 6: Run focused checks and inspect the diff**

Run:

```bash
npm test -- --run src/lib/dashboard.test.ts src/components/AttentionQueue.test.tsx src/components/Dashboard.test.tsx src/lib/opportunity-attention.test.ts src/app/globals.test.ts
npm run typecheck
git diff --check
git diff -- src/lib/dashboard.ts src/lib/dashboard.test.ts src/components/AttentionQueue.tsx src/components/AttentionQueue.test.tsx src/components/Dashboard.test.tsx src/app/globals.css src/app/globals.test.ts
```

Expected: all commands exit 0; the diff contains no eligibility, sorting, URL, or persisted-task behavior change.

- [ ] **Step 7: Commit APH-1**

```bash
git add src/lib/dashboard.ts src/lib/dashboard.test.ts src/components/AttentionQueue.tsx src/components/AttentionQueue.test.tsx src/components/Dashboard.test.tsx src/app/globals.css src/app/globals.test.ts
git commit -m "fix: distinguish planning prompts from tasks"
```

- [ ] **Step 8: Obtain the required task review**

Route one fresh `sol-reviewer` with the approved spec/plan paths, `APH-1` report, exact commit diff, focused verification output, routing receipt, events/stderr/usage paths, and normalized usage record. Resolve at most one consolidated Terra fix pass and one Sol re-review before `APH-2`.

---

### Task APH-2: Rebuild the Up next hierarchy as one responsive surface

**Outcome:** The Actions card uses precise due-state emphasis, a real primary Complete action, accessible focus semantics, and closed-by-default secondary controls without nested-card styling.

**Dependencies:** `APH-1` approved and committed.
**Dependency wave:** 2.
**Risk:** Medium — changes a shared task component, keyboard semantics, and global responsive CSS. Run focused checks, inspect the diff immediately, and obtain a fresh Sol review before final acceptance.

**Files:**

- Modify: `src/components/OpportunityTaskList.tsx:1-47`
- Modify: `src/components/OpportunityTaskList.test.tsx:13-92`
- Modify: `src/components/OpportunityDetailPage.test.tsx:202-215`
- Modify: `src/app/globals.css:98-103,299-316,638-663,694-704,781-799`
- Modify: `src/app/globals.test.ts:200-253`

**Relevant specification:** “Actions card structure,” “Progressive disclosure,” “Focus and semantics,” “Responsive behavior,” acceptance criteria 5–14.

**Interfaces:**

- Consumes unchanged `OpportunityTask`, `TaskAction`, `onAction`, `pendingTaskId`, `attentionTaskId`, and `onAddTask` contracts.
- Produces stable IDs `opportunity-task-title-<taskId>` and `opportunity-task-due-<taskId>`.
- Produces a named attention group with `role="group"`, `aria-labelledby`, and `aria-describedby` while retaining `id="opportunity-task-<taskId>"` and `tabIndex={-1}`.
- Keys the primary `TaskRow` by `primary.id` so a reordered task cannot inherit another task’s due-date draft.
- Consumes the reviewed planning-marker styles from `APH-1` and produces the native `.task-item__more` disclosure plus status-led task styles.

- [ ] **Step 1: Write failing component semantics and disclosure tests**

Replace the final attention-target test in `src/components/OpportunityTaskList.test.tsx` with:

```tsx
it("names the attention target and progressively discloses secondary primary-task actions", () => {
  document.body.innerHTML = renderToStaticMarkup(<OpportunityTaskList
    attentionTaskId="target"
    tasks={[task("target", "Targeted task", "2026-07-13")]}
    today="2026-07-13"
    onAction={vi.fn()}
  />);

  const section = document.querySelector("#opportunity-actions")!;
  const heading = document.querySelector("#opportunity-actions-title")!;
  const row = document.querySelector("#opportunity-task-target")!;
  const details = row.querySelector("details.task-item__more")!;

  expect(section.getAttribute("aria-labelledby")).toBe(heading.id);
  expect(row.getAttribute("role")).toBe("group");
  expect(row.getAttribute("aria-labelledby")).toBe("opportunity-task-title-target");
  expect(row.getAttribute("aria-describedby")).toBe("opportunity-task-due-target");
  expect(row.getAttribute("tabindex")).toBe("-1");
  expect(row.querySelector(".task-item__due--today")?.textContent).toBe("Due today · 2026-07-13");
  expect(row.querySelector(".task-item__action--complete")?.textContent).toBe("Complete");
  expect(details.hasAttribute("open")).toBe(false);
  expect(details.querySelector("summary")?.textContent).toBe("More options");
  expect(details.textContent).toContain("Move due date");
  expect(details.textContent).toContain("Reschedule");
  expect(details.textContent).toContain("Cancel");
});
```

Extend the due-semantics test with:

```ts
expect(overdue).toContain("task-item__due--overdue");
expect(dueToday).toContain("task-item__due--today");
expect(noDate).toContain("task-item__due--none");
```

Keep the existing ordering, Other tasks, history, and empty-action assertions.

In `src/components/OpportunityDetailPage.test.tsx`, extend “keeps a failed reschedule draft and active attention context” immediately after `await flush()`:

```ts
const details = container.querySelector<HTMLDetailsElement>(
  `#opportunity-task-${due.id} details.task-item__more`
)!;
act(() => { details.open = true; });
```

After the existing failure assertions, add:

```ts
expect(details.open).toBe(true);
const retryReschedule = [...details.querySelectorAll<HTMLButtonElement>("button")]
  .find((button) => button.textContent === "Reschedule")!;
const retryCancel = [...details.querySelectorAll<HTMLButtonElement>("button")]
  .find((button) => button.textContent === "Cancel")!;
expect(retryReschedule.disabled).toBe(false);
expect(retryCancel.disabled).toBe(false);
```

Add this successful-reordering regression beside the failed-reschedule test:

```tsx
it("resets the due-date draft when rescheduling promotes a different primary task", async () => {
  const first = {
    ...connection.tasks[0],
    id: "task-first",
    title: "First task",
    dueDate: "2026-07-13"
  };
  const second = {
    ...connection.tasks[0],
    id: "task-second",
    title: "Second task",
    dueDate: "2026-07-14",
    createdAt: "2026-07-11T18:00:00.000Z"
  };
  const rescheduled = { ...first, dueDate: "2026-07-20" };
  vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(jsonResponse({ ...connection, tasks: [first, second] }))
    .mockResolvedValueOnce(jsonResponse({ ...connection, tasks: [rescheduled, second] }));
  const { container, root } = mountDetail();
  await flush();

  const firstDetails = container.querySelector<HTMLDetailsElement>(
    "#opportunity-task-task-first details.task-item__more"
  )!;
  act(() => { firstDetails.open = true; });
  const firstInput = firstDetails.querySelector<HTMLInputElement>('input[type="date"]')!;
  act(() => change(firstInput, "2026-07-20"));
  act(() => [...firstDetails.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent === "Reschedule")!.click());
  await flush();

  const primary = container.querySelector<HTMLElement>(".actions-card__primary")!;
  expect(primary.querySelector("strong")?.textContent).toBe("Second task");
  expect(primary.querySelector<HTMLInputElement>('input[type="date"]')?.value).toBe("2026-07-14");
  act(() => root.unmount());
});
```

- [ ] **Step 2: Write failing CSS hierarchy and responsive tests**

In `src/app/globals.test.ts`, extend the task/attention style tests with:

```ts
expect(css).toMatch(/\.actions-card\s*\{[^}]*container-type:\s*inline-size;[^}]*padding:\s*0;/s);
expect(css).toMatch(/\.task-item--primary\s*\{[^}]*border-bottom:\s*0;[^}]*padding:\s*0;/s);
expect(css).toMatch(/\.task-item__actions \.task-item__action--complete\s*\{[^}]*background:\s*var\(--accent\);[^}]*color:\s*white;/s);
expect(css).toMatch(/\.task-item--attention\s*\{[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/s);
expect(css).toContain(".task-item--attention .task-item__due--today");
expect(css).toContain(".task-item--attention .task-item__due--overdue");
expect(css).toMatch(/\.task-item__more > summary\s*\{[^}]*min-height:\s*44px;/s);
expect(css).toMatch(/@media \(hover:\s*hover\) and \(pointer:\s*fine\)\s*\{[\s\S]*?\.task-item__actions \.task-item__action--complete:hover\s*\{[^}]*background:\s*var\(--accent-strong\);[^}]*color:\s*white;/s);
expect(css).toMatch(/@container actions-card \(max-width:\s*340px\)\s*\{[\s\S]*?\.task-item__reschedule\s*\{[^}]*grid-template-columns:\s*1fr;/s);
```

Replace the old expectation that `.task-item--attention` merely exists with the explicit transparent/no-halo contract above.

- [ ] **Step 3: Run the focused tests and confirm RED**

Run:

```bash
npm test -- --run src/components/OpportunityTaskList.test.tsx src/components/OpportunityDetailPage.test.tsx src/app/globals.test.ts
```

Expected: FAIL because task rows lack named group semantics and due modifiers, secondary controls are always expanded, primary identity can leak its date draft after reordering, retry disclosure/enabled controls are unproved, Actions retains inherited padding, the highlight is a filled halo, and Complete loses the default/hover specificity contests.

- [ ] **Step 4: Return structured due-state data**

In `src/components/OpportunityTaskList.tsx`, replace `dueState` with:

```ts
type TaskDueTone = "none" | "upcoming" | "today" | "overdue";

function dueState(task: OpportunityTask, today: string): { copy: string; tone: TaskDueTone } {
  if (!task.dueDate) return { copy: "No due date", tone: "none" };
  if (task.dueDate < today) return { copy: `Overdue · ${task.dueDate}`, tone: "overdue" };
  if (task.dueDate === today) return { copy: `Due today · ${task.dueDate}`, tone: "today" };
  return { copy: `Due ${task.dueDate}`, tone: "upcoming" };
}
```

- [ ] **Step 5: Replace TaskRow with named semantics and primary-task disclosure**

Replace `TaskRow` with:

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
  const due = dueState(task, today);
  const titleId = `opportunity-task-title-${task.id}`;
  const dueId = `opportunity-task-due-${task.id}`;
  const className = `task-item${primary ? " task-item--primary" : ""}${attention ? " task-item--attention" : ""}`;
  const reschedule = <div className="task-item__reschedule">
    <label>
      <span>Move due date</span>
      <input
        aria-label={`Reschedule ${task.title}`}
        type="date"
        value={dueDate}
        onChange={(event) => setDueDate(event.target.value)}
      />
    </label>
    <button
      className="task-item__action"
      disabled={pending}
      type="button"
      onClick={() => void onAction(task, "reschedule", dueDate || null)}
    >Reschedule</button>
  </div>;

  return <div
    aria-describedby={attention ? dueId : undefined}
    aria-labelledby={attention ? titleId : undefined}
    className={className}
    id={`opportunity-task-${task.id}`}
    role={attention ? "group" : undefined}
    tabIndex={attention ? -1 : undefined}
  >
    <div className="task-item__content">
      {primary ? <span className="task-item__eyebrow">Up next</span> : null}
      <strong id={titleId}>{task.title}</strong>
      <span className={`task-item__due task-item__due--${due.tone}`} id={dueId}>{due.copy}</span>
    </div>
    <div className="task-item__actions">
      {task.state === "open" ? primary ? <>
        <button
          className="task-item__action task-item__action--complete"
          disabled={pending}
          type="button"
          onClick={() => void onAction(task, "complete")}
        >Complete</button>
        <details className="task-item__more">
          <summary>More options</summary>
          <div className="task-item__more-content">
            {reschedule}
            <button
              className="task-item__action task-item__action--cancel"
              disabled={pending}
              type="button"
              onClick={() => void onAction(task, "cancel")}
            >Cancel</button>
          </div>
        </details>
      </> : <>
        <button
          className="task-item__action task-item__action--complete"
          disabled={pending}
          type="button"
          onClick={() => void onAction(task, "complete")}
        >Complete</button>
        <button
          className="task-item__action"
          disabled={pending}
          type="button"
          onClick={() => void onAction(task, "cancel")}
        >Cancel</button>
        {reschedule}
      </> : <button
        className="task-item__action"
        disabled={pending}
        type="button"
        onClick={() => void onAction(task, "reopen")}
      >Reopen</button>}
    </div>
  </div>;
}
```

Replace `OpportunityTaskList` with the complete named-section implementation below:

```tsx
export function OpportunityTaskList({
  tasks,
  pendingTaskId = null,
  onAction,
  onAddTask,
  today = getLocalCalendarDate(),
  attentionTaskId = null
}: {
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
    onAction={onAction}
    pendingTaskId={pendingTaskId}
    task={task}
    today={today}
  />;

  return <section
    aria-labelledby="opportunity-actions-title"
    className="next-action-card actions-card"
    id="opportunity-actions"
    tabIndex={-1}
  >
    <header className="tracker-panel__header">
      <div>
        <p className="panel-heading__eyebrow">Momentum</p>
        <h2 className="tracker-panel__title" id="opportunity-actions-title">Actions</h2>
      </div>
      <span className="tracker-panel__meta">{tasks.filter((task) => task.state === "open").length}</span>
    </header>
    <div className="actions-card__primary">
      {primary ? <TaskRow
        attention={primary.id === attentionTaskId}
        key={primary.id}
        onAction={onAction}
        pendingTaskId={pendingTaskId}
        primary
        task={primary}
        today={today}
      /> : <div className="actions-card__empty">
        <p>No next action planned.</p>
        <button
          className="button button--primary"
          type="button"
          onClick={(event) => onAddTask?.(event.currentTarget)}
        >Set a next action</button>
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

- [ ] **Step 6: Implement the single-surface and status-led CSS**

In `src/app/globals.css`, add or replace the affected rules with:

```css
.actions-card {
  container-name: actions-card;
  container-type: inline-size;
  padding: 0;
}
.actions-card .tracker-panel__header { padding: 17px 20px 14px; }
.actions-card__primary { padding: 18px 20px 20px; }

.task-item--primary {
  align-items: stretch;
  border-bottom: 0;
  display: grid;
  gap: 16px;
  padding: 0;
}
.task-item--primary .task-item__actions {
  display: grid;
  gap: 8px;
  grid-template-columns: 1fr;
}
.task-item__actions .task-item__action--complete {
  background: var(--accent);
  border-color: var(--accent);
  color: white;
  font-weight: 780;
  width: 100%;
}
@media (hover: hover) and (pointer: fine) {
  .task-item__actions .task-item__action--complete:hover {
    background: var(--accent-strong);
    border-color: var(--accent-strong);
    color: white;
  }
}
.task-item__more { display: grid; gap: 10px; }
.task-item__more > summary {
  align-items: center;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 999px;
  color: var(--ink-muted);
  cursor: pointer;
  display: flex;
  font-size: 0.82rem;
  font-weight: 720;
  justify-content: center;
  list-style: none;
  min-height: 44px;
  padding: 7px 12px;
}
.task-item__more > summary::-webkit-details-marker { display: none; }
.task-item__more > summary:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--accent) 38%, transparent);
  outline-offset: 2px;
}
.task-item__more-content { display: grid; gap: 10px; padding-top: 10px; }
.task-item__action--cancel { justify-self: start; }

.task-item--attention { background: transparent; box-shadow: none; }
.task-item--attention .task-item__due--today,
.task-item--attention .task-item__due--overdue {
  border-radius: 999px;
  font-weight: 760;
  justify-self: start;
  padding: 4px 8px;
}
.task-item--attention .task-item__due--today {
  background: color-mix(in srgb, var(--warning-soft) 78%, var(--surface));
  color: var(--warning);
}
.task-item--attention .task-item__due--overdue {
  background: var(--danger-soft);
  color: var(--danger);
}

@container actions-card (max-width: 340px) {
  .task-item__reschedule { grid-template-columns: 1fr; }
  .task-item__reschedule .task-item__action { width: 100%; }
}
```

Delete the old `.task-item--attention` background/halo rule and the lower-specificity standalone `.task-item__action--complete` rule. Keep the existing mobile viewport rules where they still cover the full-width detail layout.

- [ ] **Step 7: Run focused component, CSS, and integration checks**

Run:

```bash
npm test -- --run src/components/OpportunityTaskList.test.tsx src/components/OpportunityAttentionBanner.test.tsx src/components/OpportunityDetailPage.test.tsx src/components/AttentionQueue.test.tsx src/app/globals.test.ts
npm run typecheck
git diff --check
git diff -- src/components/OpportunityTaskList.tsx src/components/OpportunityTaskList.test.tsx src/components/OpportunityDetailPage.test.tsx src/app/globals.css src/app/globals.test.ts
```

Expected: all commands exit 0; existing task ordering, focus IDs, mutation callbacks, arrival behavior, and queue links remain covered.

- [ ] **Step 8: Perform live responsive and keyboard verification**

Run the feature worktree against the configured local database and verify:

- 1440px and 1280px: no nested amber card, no double outer padding, blue Complete, More options closed.
- 980px, 768px, and 760px: detail transition preserves hierarchy and no clipping.
- 390px and 320px: reschedule input/button stack inside the Actions container.
- Keyboard: dashboard planning/task chip → active arrival banner → Review options → named task group; Tab reaches Complete and More options; Enter/Space toggles the native disclosure.
- Accessibility snapshot: after Review options, the active `role="group"` entry includes the task title as its name and due state as its description.
- Fine-pointer hover: move the pointer over Complete and record computed `background-color`/`color`; the button remains accent/white rather than adopting the generic pale hover.

Record screenshots, the accessibility-aware DOM snapshot excerpt, and measured computed styles in the task report. Verify the failed-reschedule retry path only through the deterministic mocked-fetch integration test; do not induce a failure against the configured user database or mutate unrelated opportunity data.

- [ ] **Step 9: Commit APH-2**

```bash
git add src/components/OpportunityTaskList.tsx src/components/OpportunityTaskList.test.tsx src/components/OpportunityDetailPage.test.tsx src/app/globals.css src/app/globals.test.ts
git commit -m "style: clarify the up next action hierarchy"
```

- [ ] **Step 10: Obtain the required task review**

Route one fresh `sol-reviewer` with the approved spec/plan paths, `APH-2` report, exact commit diff, focused verification output, routing receipt, events/stderr/usage paths, and normalized usage record. Resolve at most one consolidated Terra fix pass and one Sol re-review before final acceptance.

---

## Controller acceptance after APH-1 and APH-2

The root controller performs this only after both task reviews approve their exact diffs:

```bash
npm test -- --run src/lib/dashboard.test.ts src/components/AttentionQueue.test.tsx src/components/OpportunityTaskList.test.tsx src/components/OpportunityAttentionBanner.test.tsx src/components/OpportunityDetailPage.test.tsx src/app/globals.test.ts
npm run verify
npm run build
git diff --check
```

Then repeat the live-browser matrix from the specification, inspect the cumulative approved commit range, and route one fresh high-effort `sol-final-reviewer`. Complete the native Goal only after all 15 acceptance criteria are covered, every approved task is complete, normalized usage is summarized, and the final reviewer has no blocking findings.

## Acceptance coverage map

| Criteria | Primary owner | Executable evidence |
| --- | --- | --- |
| 1–3 | `APH-1` | Domain/queue RED-GREEN tests for union shape, copy, marker, accessible name, task ID, and URL |
| 4 | `APH-1` | Dashboard View all/count/filter interaction plus existing eligibility, ordering, future-task, and resolver suites |
| 5–8 | `APH-2` | Task/CSS tests plus desktop computed layout, default/hover color, disclosure, and touch-target checks |
| 9 | `APH-2` | Mocked-fetch failed-reschedule retry test and successful-reorder primary-key regression |
| 10 | `APH-2` | ARIA component assertions, existing focus integration, and live accessibility-aware DOM snapshot |
| 11 | `APH-2` | Container-query CSS assertion and 980–320px live matrix |
| 12 | Both plus controller | Global constraints, exact per-task/cumulative diff inspection, and `git diff --check` |
| 13 | Controller | Focused suite, `npm run verify`, `npm run build`, and `git diff --check` |
| 14 | Controller | Recorded desktop/narrow screenshots, computed styles, keyboard path, and DOM snapshot |
| 15 | Controller | Fresh deterministic high-effort `sol-final-reviewer` with no blocking findings |
