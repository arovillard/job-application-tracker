# Attention Banner Cancel Action Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the active task attention banner’s ineffective Review options control with a direct Cancel action while preserving all existing rescheduling and resolved-state navigation.

**Architecture:** Extend the banner’s task-action interface with `onCancel(task)` and route it through the controller’s existing `taskAction` mutation path. Reuse the current pending lock, error handling, status copy, attention revalidation, and resolved-focus lifecycle; no API or task-model change is needed.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, React DOM test utilities.

## Global Constraints

- Active-task attention banners show **Complete** followed by **Cancel** and never show **Review options**.
- Complete remains the primary action; Cancel remains a secondary button.
- Both buttons use the matching task’s existing pending lock.
- Successful banner cancellation uses the existing task PATCH endpoint with `{ action: "cancel" }`, announces `Action cancelled`, resolves the attention context, and focuses the resolved banner.
- Failed cancellation leaves the active banner and task intact, announces the existing page error, and re-enables both actions.
- Actions-card More options, rescheduling, Actions-card Cancel, non-primary tasks, missing-next-action banners, and resolved Review current actions remain unchanged.
- No animation, confirmation dialog, database, schema, storage, API, URL, dependency, authentication, or authorization change.

---

### Task 1: Replace banner review navigation with direct cancellation

**Files:**

- Modify: `src/components/OpportunityAttentionBanner.tsx:6-34`
- Modify: `src/components/OpportunityAttentionBanner.test.tsx:18-51`
- Modify: `src/components/OpportunityDetailPage.tsx:119-135`
- Modify: `src/components/OpportunityDetailPage.test.tsx:84-125`

**Interfaces:**

- Consumes: existing `OpportunityTask`, `ResolvedAttentionContext`, `pendingTaskId`, and `taskAction(task, action, dueDate?, focusResolvedOnSuccess?)` contracts.
- Produces: `OpportunityAttentionBannerProps.onCancel: (task: OpportunityTask) => void`.
- Preserves: `onReview: () => void` for the resolved attention branch only.

- [ ] **Step 1: Write the failing banner rendering and pending-lock assertions**

In `src/components/OpportunityAttentionBanner.test.tsx`, add `onCancel` to the shared callbacks:

```tsx
const callbacks = {
  pendingTaskId: null,
  onComplete: vi.fn(),
  onCancel: vi.fn(),
  onReview: vi.fn(),
  onSetNextAction: vi.fn()
};
```

Replace the active-task test with:

```tsx
it("renders Complete and Cancel as the direct due-task decisions", () => {
  const markup = renderToStaticMarkup(<OpportunityAttentionBanner
    {...callbacks}
    context={{ state: "active_task", task, isOverdue: false }}
  />);
  const pending = renderToStaticMarkup(<OpportunityAttentionBanner
    {...callbacks}
    context={{ state: "active_task", task, isOverdue: false }}
    pendingTaskId={task.id}
  />);

  expect(markup).toContain("Needs attention today");
  expect(markup).toContain("Investigate unanswered email");
  expect(markup).toContain(">Complete</button>");
  expect(markup).toContain(">Cancel</button>");
  expect(markup).not.toContain("Review options");
  expect(pending.match(/disabled=""/g)).toHaveLength(2);
  expect(markup).toContain('aria-labelledby="attention-context-title"');
  expect(markup).toContain('id="attention-context-title"');
  expect(markup).toContain('tabindex="-1"');
});
```

Keep the missing/resolved-state test unchanged so it continues to require `Set next action` and `Review current actions`.

- [ ] **Step 2: Write failing controller integration coverage**

In `src/components/OpportunityDetailPage.test.tsx`, replace the current Review options focus test with:

```tsx
it("focuses an active attention arrival and exposes direct task decisions", async () => {
  const due = { ...connection.tasks[0], dueDate: "2026-07-13" };
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ ...connection, tasks: [due] }));
  const { container, root } = mountDetail({ attentionTarget: { kind: "task", taskId: due.id } });
  await flush();

  const banner = container.querySelector<HTMLElement>(".attention-context--active")!;
  expect(document.activeElement).toBe(banner);
  expect(banner.textContent).toContain("Send portfolio");
  expect([...banner.querySelectorAll("button")].map((button) => button.textContent)).toEqual([
    "Complete",
    "Cancel"
  ]);
  act(() => root.unmount());
});
```

Add the successful cancellation test beside the existing Complete test:

```tsx
it("cancels from the attention banner, announces resolution, and preserves focus", async () => {
  let resolveCancel!: (value: Response) => void;
  const cancelRequest = new Promise<Response>((resolve) => { resolveCancel = resolve; });
  const due = { ...connection.tasks[0], dueDate: "2026-07-13" };
  const cancelled = { ...due, state: "cancelled" as const };
  const fetchMock = vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(jsonResponse({ ...connection, tasks: [due] }))
    .mockReturnValueOnce(cancelRequest);
  const { container, root } = mountDetail({ attentionTarget: { kind: "task", taskId: due.id } });
  await flush();

  const banner = container.querySelector<HTMLElement>(".attention-context--active")!;
  const buttons = [...banner.querySelectorAll<HTMLButtonElement>("button")];
  const complete = buttons.find((button) => button.textContent === "Complete")!;
  const cancel = buttons.find((button) => button.textContent === "Cancel");
  expect(cancel).toBeDefined();
  if (!cancel) {
    act(() => root.unmount());
    return;
  }

  act(() => { cancel.click(); cancel.click(); });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(complete.disabled).toBe(true);
  expect(cancel.disabled).toBe(true);
  expect(fetchMock.mock.calls[1]?.[0]).toBe(`/api/opportunities/opportunity-1/tasks/${due.id}`);
  expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ action: "cancel" });

  await act(async () => { resolveCancel(jsonResponse({ ...connection, tasks: [cancelled] })); });
  expect(container.querySelector('[role="status"]')?.textContent).toBe("Action cancelled");
  expect(container.textContent).toContain("This attention item is no longer active");
  expect(document.activeElement).toBe(container.querySelector(".attention-context--resolved"));
  act(() => root.unmount());
});
```

Add the failure/retry-state test:

```tsx
it("keeps banner actions available after cancellation fails", async () => {
  const due = { ...connection.tasks[0], dueDate: "2026-07-13" };
  vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(jsonResponse({ ...connection, tasks: [due] }))
    .mockResolvedValueOnce(jsonResponse({ error: "Cancel rejected" }, false));
  const { container, root } = mountDetail({ attentionTarget: { kind: "task", taskId: due.id } });
  await flush();

  const banner = container.querySelector<HTMLElement>(".attention-context--active")!;
  const cancel = [...banner.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent === "Cancel");
  expect(cancel).toBeDefined();
  if (!cancel) {
    act(() => root.unmount());
    return;
  }

  act(() => cancel.click());
  await flush();

  expect(container.querySelector('[role="alert"]')?.textContent).toBe("Cancel rejected");
  expect(container.querySelector(".attention-context--active")).not.toBeNull();
  const retryButtons = [...container.querySelectorAll<HTMLButtonElement>(
    ".attention-context--active button"
  )];
  expect(retryButtons.map((button) => button.textContent)).toEqual(["Complete", "Cancel"]);
  expect(retryButtons.every((button) => !button.disabled)).toBe(true);
  act(() => root.unmount());
});
```

- [ ] **Step 3: Run the focused tests and confirm RED**

Run:

```bash
npm test -- --run src/components/OpportunityAttentionBanner.test.tsx src/components/OpportunityDetailPage.test.tsx
```

Expected: FAIL because the active banner still renders Review options, does not render Cancel, and has no banner cancellation callback. The tests must fail on these behavioral assertions rather than a syntax or setup error.

- [ ] **Step 4: Add the banner cancellation callback and UI**

In `src/components/OpportunityAttentionBanner.tsx`, extend the props and destructuring:

```tsx
export type OpportunityAttentionBannerProps = {
  context: ResolvedAttentionContext;
  pendingTaskId: string | null;
  onComplete: (task: OpportunityTask) => void;
  onCancel: (task: OpportunityTask) => void;
  onReview: () => void;
  onSetNextAction: (trigger: HTMLButtonElement) => void;
};
```

```tsx
export const OpportunityAttentionBanner = forwardRef<HTMLElement, OpportunityAttentionBannerProps>(function OpportunityAttentionBanner({
  context,
  pendingTaskId,
  onComplete,
  onCancel,
  onReview,
  onSetNextAction
}, ref) {
```

Replace only the active-task action group with:

```tsx
<div className="attention-context__actions">
  <button
    className="button button--primary"
    disabled={pendingTaskId === context.task.id}
    type="button"
    onClick={() => onComplete(context.task)}
  >Complete</button>
  <button
    className="button"
    disabled={pendingTaskId === context.task.id}
    type="button"
    onClick={() => onCancel(context.task)}
  >Cancel</button>
</div>
```

Do not change the missing-next-action or resolved branches.

- [ ] **Step 5: Route banner Cancel through the existing task mutation**

In `src/components/OpportunityDetailPage.tsx`, keep `reviewAttention` unchanged for the resolved branch and update the `attentionBanner` construction to:

```tsx
const attentionBanner = attentionContext ? <OpportunityAttentionBanner
  context={attentionContext}
  onCancel={(task) => void taskAction(task, "cancel", undefined, true)}
  onComplete={(task) => void taskAction(task, "complete", undefined, true)}
  onReview={reviewAttention}
  onSetNextAction={(trigger) => { trigger.focus(); open({ kind: "task" }); }}
  pendingTaskId={pendingTaskId}
  ref={attentionRef}
/> : null;
```

Do not modify `taskAction`, endpoints, status constants, or the Actions card.

- [ ] **Step 6: Run focused GREEN checks**

Run:

```bash
npm test -- --run src/components/OpportunityAttentionBanner.test.tsx src/components/OpportunityDetailPage.test.tsx src/components/OpportunityTaskList.test.tsx
npm run typecheck
git diff --check
```

Expected: all commands exit `0`; the banner and controller tests pass, and existing Actions-card rescheduling tests remain green.

- [ ] **Step 7: Run full acceptance and inspect scope**

Run:

```bash
npm run verify
npm run build
git diff --check
git diff -- src/components/OpportunityAttentionBanner.tsx src/components/OpportunityAttentionBanner.test.tsx src/components/OpportunityDetailPage.tsx src/components/OpportunityDetailPage.test.tsx
```

Expected: lint, typecheck, all tests, and production build pass. The product diff is limited to the four approved files and contains no Actions-card rescheduling change.

- [ ] **Step 8: Perform a live browser check**

Against the feature worktree on port `3001`, open a task attention link and verify:

- The banner shows Complete and Cancel, with no Review options.
- The Actions card still shows More options and rescheduling.
- Clicking neither action during this visual check avoids mutating the configured user database.
- At desktop and narrow widths, both banner actions remain visible and at least 44px tall.

- [ ] **Step 9: Commit the implementation**

```bash
git add src/components/OpportunityAttentionBanner.tsx src/components/OpportunityAttentionBanner.test.tsx src/components/OpportunityDetailPage.tsx src/components/OpportunityDetailPage.test.tsx
git commit -m "fix: add cancel to attention banner"
```

