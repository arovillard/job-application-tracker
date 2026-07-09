# Workspace-First Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the opportunity list the first working surface on the dashboard, with attention, creation, and progress in supporting positions.

**Architecture:** Keep the existing dashboard state, filters, shortcuts, and insight calculations. Recompose `Dashboard` around the application table, convert `AttentionQueue` into a compact workspace strip, move `PipelineOverview` after the list, and remove the redundant quick-capture feature.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, CSS custom properties.

## Global Constraints

- Do not change SQLite schema, API routes, or application data contracts.
- Preserve `N`, `/`, and Cmd/Ctrl+K shortcuts.
- Keep saved views, sorting, search, status filters, and metric filtering intact.
- Keep the desktop table and existing mobile card layout.
- Do not add runtime dependencies.

---

### Task 1: Turn the attention panel into a compact workspace strip

**Files:**
- Modify: `src/components/AttentionQueue.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- `AttentionQueue` continues to consume `DashboardAttentionItem[]`.
- Add `onViewAll: () => void` to activate the dashboard's existing `Needs attention` view.
- The component returns `null` when attention is empty and it is not loading.

- [ ] **Step 1: Confirm the due-work insight contract**

Run: `npm test -- src/lib/dashboard.test.ts`

Expected: both dashboard insight tests pass, including overdue, due-today, and missing-next-action items.

- [ ] **Step 2: Replace the panel markup with compact strip markup**

```tsx
if (!loading && items.length === 0) return null;

return (
  <section className="attention-strip" aria-label="Opportunities needing attention">
    <div className="attention-strip__summary">
      <strong>Needs attention</strong>
      <span>{loading ? "Checking your next moves" : `${items.length} to review`}</span>
    </div>
    <div className="attention-strip__items">{visibleItems.map((item) => <Link key={item.id} href={`/applications/${item.applicationId}`}>...</Link>)}</div>
    {!loading ? <button className="text-button" type="button" onClick={onViewAll}>View all</button> : null}
  </section>
);
```

Render at most three linked items; preserve priority markers and due wording.

- [ ] **Step 3: Replace card styling with responsive strip styling**

```css
.attention-strip {
  align-items: center;
  background: var(--warning-soft);
  border-bottom: 1px solid color-mix(in srgb, var(--warning) 25%, var(--line));
  display: grid;
  gap: 12px;
  grid-template-columns: auto minmax(0, 1fr) auto;
  padding: 12px 20px;
}
```

Use horizontal truncated links on desktop and a compact stacked layout below 760px. Remove CSS used only by the former attention card and quick-capture grid.

- [ ] **Step 4: Re-run the focused behavior test**

Run: `npm test -- src/lib/dashboard.test.ts`

Expected: 2 tests pass.

- [ ] **Step 5: Commit the task**

```bash
git add src/components/AttentionQueue.tsx src/app/globals.css
git commit -m "refactor: compact dashboard attention"
```

### Task 2: Recompose the dashboard around opportunities

**Files:**
- Modify: `src/components/Dashboard.tsx`
- Delete: `src/components/QuickCapture.tsx`

**Interfaces:**
- `Dashboard` passes `onViewAll={() => setSavedView("attention")}` to `AttentionQueue`.
- `PipelineOverview` keeps its current `onSelect` contract and still filters the list.
- `ApplicationTable` remains the first substantial dashboard content.

- [ ] **Step 1: Remove duplicate capture state and landing-page content**

Delete the `QuickCapture` and `ApplicationInput` imports, the `createApplication` callback, and the `dashboard-intro` section containing `Make your next move obvious.`.

- [ ] **Step 2: Place the workspace immediately after the header**

```tsx
<header className="dashboard-header">...</header>
{error ? <div className="notice notice--error" role="alert">{error}</div> : null}
<section className="pipeline-workspace" ref={workspaceRef}>
  <div className="pipeline-workspace__header">...</div>
  <div className="pipeline-controls">...</div>
  <AttentionQueue items={insights.attention} loading={loading} onViewAll={() => setSavedView("attention")} />
  <ApplicationTable ... />
</section>
<section className="dashboard-progress" aria-label="Pipeline progress">
  <PipelineOverview metrics={insights.metrics} onSelect={selectPipelineView} />
</section>
```

Retain the `Your opportunities` heading, count, existing controls, and `workspaceRef` metric behavior.

- [ ] **Step 3: Define the active empty state without an inline form**

Pass an explicit empty message telling an unfiltered user to select `New application`. Do not add another creation form or route.

- [ ] **Step 4: Verify behavior and types**

Run: `npm run verify`

Expected: lint reports no warnings/errors, TypeScript completes, and all tests pass.

- [ ] **Step 5: Commit the task**

```bash
git add src/components/Dashboard.tsx src/components/QuickCapture.tsx src/app/globals.css
git commit -m "feat: prioritize dashboard opportunities"
```

### Task 3: Verify production and responsive presentation

**Files:**
- Modify only if browser verification finds a concrete responsive issue: `src/app/globals.css`

**Interfaces:**
- No data or interface changes.

- [ ] **Step 1: Build the production application**

Run: `npm run build`

Expected: build completes and lists the dashboard route with the existing application and API routes.

- [ ] **Step 2: Inspect desktop and mobile layouts**

Run: `npm run dev`

Verify the first viewport contains the header, opportunity controls, attention strip when needed, and the beginning of the list; progress appears after the list; no hero copy or quick-capture form remains.

- [ ] **Step 3: Verify interactions**

Confirm `N`, `/`, and Cmd/Ctrl+K retain existing behavior. Confirm strip items open their record, `View all` activates `Needs attention`, and a progress metric filters the table and returns focus to the workspace.

- [ ] **Step 4: Commit any final responsive adjustment**

```bash
git add src/app/globals.css
git commit -m "fix: refine dashboard workspace layout"
```
