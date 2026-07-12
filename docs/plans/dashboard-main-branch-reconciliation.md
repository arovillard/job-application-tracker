# Dashboard Main-Branch Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconcile the opportunity dashboard with main's polished visual and interaction system without losing job/connection functionality.

**Architecture:** First complete the creation-menu accessibility contract, then implement dashboard chrome/filter and mixed-table contracts in parallel-safe component slices. Finish with one serialized global CSS integration task and full automated acceptance.

**Tech Stack:** Next.js 16, React 19, TypeScript 5.9, Vitest 4, jsdom 29, existing global CSS.

## Global Constraints

- Main branch is the visual baseline; Opportunity Tracker branding and mixed job/connection semantics remain.
- No database, migration, API, persistence, status-model, date-contract, dependency, detail-page, or creation-form changes.
- No Codex browser verification; the user performs final visual acceptance.
- No `transition: all`, scale-from-zero, ease-in UI feedback, or keyboard-triggered motion.
- Hover transforms and press scaling must be fine-pointer-only; existing reduced-motion protection remains.
- Every behavior or CSS contract change begins with a failing deterministic test.

## Dependency waves and write ownership

- Wave 1: DMR-1 creation-menu semantics.
- Wave 2: DMR-2 dashboard chrome/filters and DMR-3 mixed table/loading may run concurrently; write sets do not overlap.
- Wave 3: DMR-4 shared CSS integration is serialized after all component class contracts stabilize.

---

### Task 1 [DMR-1]: Complete the creation-menu interaction contract

**Outcome:** ARIA menu semantics match keyboard and focus behavior.

**Dependencies:** None. Wave 1.

**Risk:** Medium; keyboard/focus behavior is user-visible and reused in two dashboard states.

**Write set:**

- Modify `src/components/NewOpportunityMenu.tsx`.
- Modify `src/components/NewOpportunityMenu.test.tsx`.

**Spec:** Interaction and motion; acceptance criteria 5 and 7.

- [ ] **Step 1: Write failing keyboard-model tests**

Mount the menu in jsdom and assert this exact contract:

```tsx
document.dispatchEvent(new KeyboardEvent("keydown", { key: "n", bubbles: true }));
expect(jobItem).toBe(document.activeElement);

jobItem.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
expect(connectionItem).toBe(document.activeElement);

connectionItem.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
expect(jobItem).toBe(document.activeElement);

jobItem.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
expect(connectionItem).toBe(document.activeElement);

connectionItem.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
expect(jobItem).toBe(document.activeElement);

jobItem.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
expect(connectionItem).toBe(document.activeElement);

connectionItem.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
expect(jobItem).toBe(document.activeElement);
```

Retain Escape focus restoration, outside dismissal, editable-target protection, modified-`N` protection, and exact destinations.

Add tests for repeated `N`, Tab, Shift+Tab, outside dismissal, and activation:

```tsx
document.dispatchEvent(new KeyboardEvent("keydown", { key: "n", bubbles: true }));
document.dispatchEvent(new KeyboardEvent("keydown", { key: "n", bubbles: true }));
expect(jobItem).toBe(document.activeElement);

const tabEvent = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
jobItem.dispatchEvent(tabEvent);
expect(button.getAttribute("aria-expanded")).toBe("false");
expect(tabEvent.defaultPrevented).toBe(false);
```

Repeat with Shift+Tab. Assert outside pointer dismissal does not restore trigger focus, item activation closes without restoration, and Escape remains the only dismissal that restores trigger focus.

Test keyboard activation explicitly by attaching a click spy to the focused job item, dispatching a cancelable Enter keydown, and asserting one activation plus menu closure:

```tsx
const activation = vi.fn((event: Event) => event.preventDefault());
jobItem.addEventListener("click", activation);
jobItem.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
expect(activation).toHaveBeenCalledTimes(1);
expect(button.getAttribute("aria-expanded")).toBe("false");
```

- [ ] **Step 2: Verify RED**

```bash
npm test -- src/components/NewOpportunityMenu.test.tsx
```

Expected: focus and Arrow/Home/End assertions fail against the current menu.

- [ ] **Step 3: Implement the minimal menu behavior**

Add refs for both menu items and a menu key handler that cycles two items with ArrowDown/ArrowUp, handles Home/End, activates the focused item on Enter, closes on Tab without preventing default, and preserves Escape restoration. Track whether open was keyboard initiated so pointer opening does not unexpectedly move focus. Repeated `N` focuses the first item. Do not add animation.

- [ ] **Step 4: Verify and commit**

```bash
npm test -- src/components/NewOpportunityMenu.test.tsx
npm run typecheck
git add src/components/NewOpportunityMenu.tsx src/components/NewOpportunityMenu.test.tsx
git commit -m "fix: complete opportunity menu keyboard behavior"
```

Expected: focused tests and typecheck pass.

---

### Task 2 [DMR-2]: Restore main-aligned dashboard chrome and filter hierarchy

**Outcome:** Dashboard framing, search affordance, filter grouping, theme naming, and attention loading match main's standard.

**Dependencies:** DMR-1 for the shared creation control. Wave 2; parallel-safe with DMR-3.

**Risk:** Medium; changes shared dashboard semantics and filter presentation without changing filter state behavior.

**Write set:**

- Modify `src/components/Dashboard.tsx`.
- Modify `src/components/Dashboard.test.tsx`.
- Modify `src/components/AttentionQueue.tsx`.
- Modify `src/components/AttentionQueue.test.tsx`.

**Spec:** Dashboard chrome; Filter hierarchy; acceptance criteria 1, 2, 4, 6, and 9.

- [ ] **Step 1: Write failing dashboard chrome tests**

Render Dashboard and require:

```tsx
expect(markup).toContain("Pipeline");
expect(markup).toContain("Your opportunities");
expect(markup).toContain('class="search-field__icon"');
expect(markup).toContain('aria-label="Filter opportunities"');
expect(markup).not.toContain("Workspace");
```

Mount with light and dark theme mocks and assert `Switch to dark theme` / `Switch to light theme`. Preserve editable shortcut regression tests.

Add mounted dashboard non-regression tests with fetch fixtures:

```tsx
expect(labelsInRenderedOrder()).toEqual(["Most recently updated", "Older opportunity"]);
changeType("connection");
expect(activeStatus()).toBe("all");
changeType("all");
expect(activeStatus()).toBe("active");
```

Trigger one stage change and assert:

```tsx
expect(fetch).toHaveBeenCalledWith(`/api/opportunities/${id}/status`, expect.objectContaining({
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ status: "interviewing" })
}));
```

- [ ] **Step 2: Write failing attention loading test**

```tsx
const markup = renderToStaticMarkup(<AttentionQueue items={[]} loading onViewAll={() => undefined} />);
expect(markup).toContain('aria-label="Loading attention queue"');
```

- [ ] **Step 3: Verify RED**

```bash
npm test -- src/components/Dashboard.test.tsx src/components/AttentionQueue.test.tsx
```

Expected: hierarchy, icon, filter label, dynamic theme name, and loading label assertions fail.

- [ ] **Step 4: Implement dashboard hierarchy without state changes**

- Keep `Opportunity Tracker` and `O` branding.
- Change eyebrow to `Pipeline`, heading to `<h2>Your opportunities</h2>`.
- Restore pending update text in the count.
- Restore `<span className="search-field__icon" aria-hidden="true">⌕</span>`.
- Keep search/sort in `pipeline-controls__filters`.
- Add `<div className="pipeline-filter-rail" role="region" aria-label="Filter opportunities">` containing the unchanged type and status filter components.
- Preserve existing type/status reset behavior and option generation.
- Use destination-specific theme labels.
- Add the attention loading label.

- [ ] **Step 5: Verify and commit**

```bash
npm test -- src/components/Dashboard.test.tsx src/components/AttentionQueue.test.tsx
npm run typecheck
git add src/components/Dashboard.tsx src/components/Dashboard.test.tsx src/components/AttentionQueue.tsx src/components/AttentionQueue.test.tsx
git commit -m "fix: restore dashboard hierarchy and filters"
```

---

### Task 3 [DMR-3]: Reconcile mixed opportunity table density and states

**Outcome:** Mixed rows regain main's scan order, recency, loading quality, empty-state creation behavior, and accessible links.

**Dependencies:** None at runtime; scheduled in Wave 2 for review clarity and parallel-safe with DMR-2.

**Risk:** Medium; shared table markup changes across job, connection, loading, empty, desktop, and mobile states.

**Write set:**

- Modify `src/components/OpportunityTable.tsx`.
- Create `src/components/OpportunityTable.test.tsx`.

**Spec:** Mixed opportunity table; acceptance criteria 3, 4, 5, 6, 8, and 9.

- [ ] **Step 1: Write failing mixed-row tests**

Render one job and one connection fixture into jsdom. Find each `<tbody>` row by its scoped `.application-table__primary` text, then inspect that row's `.application-table__company` children. Assert:

```tsx
expect(document.querySelector("th:nth-child(5)")?.textContent).toBe("Updated");
expect(jobRow.querySelector('[data-label="Updated"]')).not.toBeNull();
expect(jobRow.querySelector('[aria-label="Open Platform Engineer"]')).not.toBeNull();
expect(connectionRow.querySelector('[aria-label="Open Maya Chen"]')).not.toBeNull();
expect(identityClasses(jobRow)).toEqual([
  "application-table__identity-row",
  "application-table__secondary",
  "application-table__tertiary"
]);
```

Within `application-table__identity-row`, assert the primary label precedes the restrained type marker. Require connection relationship strength as tertiary text, not `relationship-chip`. Assert job and connection status labels separately, pending disabling, exact detail routes, exact next-task `dateTime`, and Updated formatting from `updatedAt`.

- [ ] **Step 2: Write failing loading and empty tests**

```tsx
expect(loadingMarkup).toContain('aria-label="Loading opportunities"');
expect((loadingMarkup.match(/application-table__loading-row/g) ?? []).length).toBe(3);
expect(emptyMarkup).toContain("Use New opportunity above");
expect(emptyMarkup).not.toContain("new-opportunity-menu");
expect(emptyMarkup).not.toContain('href="/opportunities/new"');
```

- [ ] **Step 3: Verify RED**

```bash
npm test -- src/components/OpportunityTable.test.tsx
```

Expected: missing test file/contracts fail.

- [ ] **Step 4: Implement the main-aligned table**

- Restore three skeleton rows with `aria-busy` and accessible label.
- Keep one creation menu in Dashboard. The table empty state renders no trigger and directs users to `New opportunity` above.
- Render six columns including Updated.
- Format `updatedAt` as the main branch does, without altering stored values.
- Lead identity with label, then organization/context, then restrained metadata.
- Keep one type marker; render relationship strength as tertiary text.
- Give each visible `Open →` link a unique aria-label.
- Preserve status options, pending disabling, next-task date format, routes, and callbacks.

- [ ] **Step 5: Verify and commit**

```bash
npm test -- src/components/OpportunityTable.test.tsx
npm run typecheck
git add src/components/OpportunityTable.tsx src/components/OpportunityTable.test.tsx
git commit -m "fix: reconcile opportunity table fidelity"
```

---

### Task 4 [DMR-4]: Integrate main-aligned dashboard CSS and motion safeguards

**Outcome:** Component contracts render with main's density and responsive behavior, with pointer-safe motion.

**Dependencies:** DMR-2 and DMR-3. Wave 3, serialized central CSS integration.

**Risk:** Medium; central stylesheet controls dashboard desktop/mobile presentation.

**Write set:**

- Modify `src/app/globals.css`.
- Modify `src/app/globals.test.ts`.

**Spec:** Interaction and motion; acceptance criteria 1, 2, 3, 7, and 8.

- [ ] **Step 1: Write failing CSS contract tests**

Require:

```ts
expect(css).toContain(".pipeline-filter-rail");
expect(css).toContain("overflow-x: auto");
expect(css).toContain("flex-wrap: nowrap");
expect(css).toContain("@media (hover: hover) and (pointer: fine)");
expect(css).toContain("@media (prefers-reduced-motion: reduce)");
expect(css).not.toContain("transition: all");
expect(css).not.toMatch(/transform:\s*scale\(0\)/);
```

Require Updated/mobile table selectors and skeleton geometry matching six columns.

Use bounded main baseline `f1855f3c8f86f42188a172dfc01058af1e2e24dd` and assert:

```ts
expect(css).toContain("grid-template-columns: minmax(220px, 1fr) auto");
expect(css).toContain("padding: 22px 24px 18px");
expect(css).toContain("min-width: 770px");
expect(css).toContain("padding: 16px 18px");
```

Extract the fine-pointer media block and remove it from a copy of the stylesheet. Assert `.icon-button:hover`, shared button hover transforms, `.application-table__open:hover span`, and pointer `:active` transforms occur inside that block, while the remaining CSS has no `:hover` or `:active` rule whose declaration contains `transform:`.

- [ ] **Step 2: Verify RED**

```bash
npm test -- src/app/globals.test.ts
```

Expected: filter-rail, nowrap, fine-pointer motion, and six-column contracts fail.

- [ ] **Step 3: Reconcile dashboard and table CSS**

- Restore main's pipeline heading, search icon, primary control row, table density, skeleton, and Updated column treatment.
- Style `pipeline-filter-rail` as a labelled flex row with restrained type/status separation.
- Keep the rail single-line and horizontally scrollable at 760px and below.
- Keep mobile table cards and add Updated labels/spacing.
- Preserve existing mobile header/menu containment rules. The user verifies 320px overflow visually; static tests do not claim to prove viewport geometry.

- [ ] **Step 4: Apply motion safeguards**

- Keep menu open/close instant.
- Move transform-only hover and pointer press rules into `@media (hover: hover) and (pointer: fine)`.
- Keep color/border hover feedback outside that query when useful.
- Preserve explicit transition properties and the reduced-motion block.

- [ ] **Step 5: Run focused and full checks, then commit**

```bash
npm test -- src/components/NewOpportunityMenu.test.tsx src/components/Dashboard.test.tsx src/components/OpportunityTable.test.tsx src/components/AttentionQueue.test.tsx src/app/globals.test.ts
npm run lint
npm run typecheck
npm run build
git add src/app/globals.css src/app/globals.test.ts
git commit -m "style: reconcile dashboard with main"
```

Expected: all focused checks, lint, typecheck, and production build pass.

---

## Final acceptance

```bash
npm run verify
npm run build
```

After Goal activation, Root Sol creates `docs/goals/dashboard-main-branch-reconciliation.md` and records objective, approved artifacts, worktree, branch, owners, write sets, checks, reviews, decisions, blockers, and final evidence. Root Sol invokes one fresh `sol-final-reviewer` with the approved spec, plan, ledger, complete Goal diff package, deterministic output, and browser-verification boundary. Mark the native Goal complete only after final approval. Then start localhost and return the URL for user-owned visual acceptance.
