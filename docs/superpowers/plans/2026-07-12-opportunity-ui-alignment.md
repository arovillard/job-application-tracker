# Opportunity UI Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the established JobTracker visual structure for jobs and connections while replacing the intermediate creation chooser with one dashboard menu button.

**Architecture:** Add a focused dashboard menu component, simplify the creation route to render a typed form directly, restructure opportunity details around the existing main/sidebar panel system, and finish with one serialized CSS integration pass. Existing API and persistence behavior remain unchanged.

**Tech Stack:** Next.js 16, React 19, TypeScript 5.9, Vitest 4, jsdom 29, existing global CSS design system.

## Global Constraints

- The supplied original application screenshots are the visual source of truth.
- No database, API, migration, dependency, status-model, or persistence changes.
- Preserve all native `input[type="date"]` behavior and date payload formats.
- Do not introduce a new visual language, component library, color system, or breakpoint.
- Codex does not perform browser verification; the user performs final visual acceptance.
- Every behavior or styling-hook change begins with a failing deterministic test.

## Task map and dependency waves

- Wave 1, Task OUI-1: dashboard creation menu. Write set is isolated to the menu and dashboard files.
- Wave 2, Task OUI-2: direct typed creation route. Depends on OUI-1 destinations.
- Wave 3, Task OUI-3: detail layout and styled inline-form markup.
- Wave 4, Task OUI-4: shared CSS integration. Depends on all component class contracts and is serialized because `globals.css` is central wiring.

---

### Task 1 [OUI-1]: Replace direct creation navigation with an accessible menu

**Risk:** Medium. Changes dashboard navigation and global keyboard behavior.

**Files:**

- Create: `src/components/NewOpportunityMenu.tsx`
- Create: `src/components/NewOpportunityMenu.test.tsx`
- Modify: `src/components/Dashboard.tsx`
- Modify: `src/components/Dashboard.test.tsx`

**Interfaces:**

- Produces: `NewOpportunityMenu(): JSX.Element`.
- Menu destinations: `/opportunities/new?type=job` and `/opportunities/new?type=connection`.
- Dashboard retains the existing `N` shortcut, but it opens the menu instead of navigating to an untyped route.

- [ ] **Step 1: Write failing menu behavior tests**

Use jsdom, `createRoot`, and React `act` to mount `NewOpportunityMenu`. Assert:

```tsx
expect(button.getAttribute("aria-haspopup")).toBe("menu");
expect(button.getAttribute("aria-expanded")).toBe("false");

button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
expect(button.getAttribute("aria-expanded")).toBe("true");
expect(container.querySelector('[href="/opportunities/new?type=job"]')).not.toBeNull();
expect(container.querySelector('[href="/opportunities/new?type=connection"]')).not.toBeNull();

document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
expect(button.getAttribute("aria-expanded")).toBe("false");
```

Add a second assertion that pointer-down outside the menu closes it and a third that `N` opens it when focus is not in an input, textarea, select, or contenteditable element.

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```bash
npm test -- src/components/NewOpportunityMenu.test.tsx
```

Expected: failure because `NewOpportunityMenu` does not exist.

- [ ] **Step 3: Implement the focused menu component**

`NewOpportunityMenu.tsx` must:

- Own only `open` state.
- Use a root ref for outside-pointer detection and a button ref for focus restoration.
- Render a button with `aria-haspopup="menu"`, `aria-expanded`, and `aria-controls="new-opportunity-menu"`.
- Render the two exact destination links only while open.
- Close on Escape, outside pointer-down, and menu-item activation.
- Open on unmodified `N` unless the event target is an editable control.
- Remove all document/window listeners during effect cleanup.

Use this menu content:

```tsx
<Link role="menuitem" href="/opportunities/new?type=job" onClick={() => setOpen(false)}>
  <strong>Job posting</strong>
  <span>Track a specific role and application process.</span>
</Link>
<Link role="menuitem" href="/opportunities/new?type=connection" onClick={() => setOpen(false)}>
  <strong>Connection</strong>
  <span>Track a person, interaction history, and follow-up.</span>
</Link>
```

- [ ] **Step 4: Wire the menu into Dashboard**

Replace the current New opportunity `<Link>` with `<NewOpportunityMenu />`, remove the unused `Link` import, and remove the Dashboard-level `N` navigation branch so only the menu owns that shortcut.

Extend `Dashboard.test.tsx` to assert the rendered dashboard contains `New opportunity` and no bare `href="/opportunities/new"`.

- [ ] **Step 5: Run focused checks and commit**

```bash
npm test -- src/components/NewOpportunityMenu.test.tsx src/components/Dashboard.test.tsx
npm run typecheck
git add src/components/NewOpportunityMenu.tsx src/components/NewOpportunityMenu.test.tsx src/components/Dashboard.tsx src/components/Dashboard.test.tsx
git commit -m "feat: add opportunity creation menu"
```

Expected: menu and dashboard tests pass; TypeScript exits without diagnostics.

---

### Task 2 [OUI-2]: Render typed creation forms without an intermediate chooser

**Risk:** Low. Local route rendering and copy change only.

**Dependencies:** OUI-1 menu destinations are fixed.

**Files:**

- Modify: `src/components/NewOpportunityPage.tsx`
- Modify: `src/components/NewOpportunityPage.test.tsx`

**Interfaces:**

- Produces: `resolveOpportunityType(value: string | null): OpportunityType`.
- Returns `"connection"` only for the exact connection query value; otherwise returns `"job"`.

- [ ] **Step 1: Replace chooser expectations with failing direct-route expectations**

Add deterministic tests:

```tsx
expect(resolveOpportunityType(null)).toBe("job");
expect(resolveOpportunityType("job")).toBe("job");
expect(resolveOpportunityType("connection")).toBe("connection");
expect(resolveOpportunityType("unknown")).toBe("job");
```

Update the default static-render test to expect `Add a job`, `Role`, and `Organization`, and to reject `What kind of opportunity are you adding?`.

- [ ] **Step 2: Run the focused test and confirm RED**

```bash
npm test -- src/components/NewOpportunityPage.test.tsx
```

Expected: failure because `resolveOpportunityType` and direct default rendering do not exist.

- [ ] **Step 3: Simplify NewOpportunityPage**

- Export `resolveOpportunityType` with the contract above.
- Replace nullable type state with `const type = resolveOpportunityType(params.get("type"))`.
- Remove `setType`, the chooser section, and the Change opportunity type button.
- Always render one `tracker-panel` containing either `JobOpportunityForm` or `ConnectionOpportunityForm`.
- Preserve existing POST behavior, errors, loading state, and return navigation.

- [ ] **Step 4: Run focused checks and commit**

```bash
npm test -- src/components/NewOpportunityPage.test.tsx
npm run typecheck
git add src/components/NewOpportunityPage.tsx src/components/NewOpportunityPage.test.tsx
git commit -m "refactor: open typed opportunity forms directly"
```

---

### Task 3 [OUI-3]: Align detail layout and inline forms with the established application UI

**Risk:** Medium. Restructures shared job/connection presentation while preserving mutations.

**Dependencies:** None on runtime behavior; sequenced after creation changes for review clarity.

**Files:**

- Modify: `src/components/OpportunityDetailPage.tsx`
- Modify: `src/components/OpportunityDetailPage.test.tsx`

**Interfaces:**

- `OpportunityDetailContent` retains its current public props and callbacks.
- Activity/task API payloads and mutation URLs remain byte-for-byte equivalent.
- Produces styling hooks: `detail-nav__back`, `detail-main`, `detail-side`, `tracker-panel__header`, `tracker-panel__meta`, `next-action-card`, `detail-list`, and application-form classes for inline forms.

- [ ] **Step 1: Write failing detail structure assertions**

Extend the static-render tests to require:

```tsx
expect(markup).toContain('class="detail-nav__back"');
expect(markup).toContain('class="detail-main"');
expect(markup).toContain('class="detail-side"');
expect(markup).toContain('class="next-action-card"');
expect(markup).toContain('class="tracker-panel__header"');
expect(markup).toContain('class="detail-list"');
```

Assert activity appears before application materials in the job main column, and that the next-action card and details list are in the sidebar markup.

- [ ] **Step 2: Add failing inline-form styling assertions**

Extract presentational `InteractionComposer` and `TaskComposer` components from the current inline branches without changing their payloads. Static-render each component and assert:

```tsx
expect(markup).toContain('class="application-form"');
expect(markup).toContain('class="application-form__input"');
expect(markup).toContain('class="application-form__select"');
expect(markup).toContain('class="application-form__textarea"');
expect(markup).toContain('class="application-form__actions"');
expect(markup).toContain('type="date"');
```

- [ ] **Step 3: Run focused tests and confirm RED**

```bash
npm test -- src/components/OpportunityDetailPage.test.tsx
```

Expected: missing class hooks and composer exports.

- [ ] **Step 4: Rebuild OpportunityDetailContent structure**

- Apply `detail-nav__back` to the back link.
- Main column contains Activity history and, for jobs, Application materials.
- Sidebar contains a `next-action-card` followed by the Details tracker panel.
- Use tracker panel headers with activity/artifact counts.
- Replace connection/job `<p><strong>…` details with semantic `<dl className="detail-list">` rows.
- Keep every existing action button and callback.

- [ ] **Step 5: Extract and style inline composers**

- Extract interaction and task forms as controlled presentational components in the same file.
- Use existing application-form class names on every label/control/action wrapper.
- Preserve required fields, native date types, optional task behavior, exact mutation payloads, reset behavior, error handling, and cancel behavior.
- Wrap Edit details and Create job opportunity in tracker panels with proper panel headers and styled action areas.

- [ ] **Step 6: Run focused checks and commit**

```bash
npm test -- src/components/OpportunityDetailPage.test.tsx
npm run typecheck
git add src/components/OpportunityDetailPage.tsx src/components/OpportunityDetailPage.test.tsx
git commit -m "fix: align opportunity detail structure"
```

---

### Task 4 [OUI-4]: Integrate menu, detail, and form styling through the existing CSS system

**Risk:** Medium. Central stylesheet affects desktop and responsive layouts.

**Dependencies:** OUI-1, OUI-2, and OUI-3 class contracts must be complete.

**Files:**

- Modify: `src/app/globals.css`
- Create: `src/app/globals.test.ts`

**Interfaces:**

- Active tokens are `--line` and `--ink-muted`; obsolete `--border` and `--text-muted` must not remain.
- Existing breakpoints at 1050px and 760px remain authoritative.

- [ ] **Step 1: Write a failing CSS contract test**

Read `globals.css` with `readFileSync` and assert:

```ts
expect(css).not.toContain("var(--border)");
expect(css).not.toContain("var(--text-muted)");
for (const selector of [
  ".new-opportunity-menu",
  ".new-opportunity-menu__popover",
  ".detail-main, .detail-side",
  ".tracker-panel__header",
  ".application-form__actions"
]) expect(css).toContain(selector);
```

Also reject obsolete `.opportunity-type-chooser` selectors.

- [ ] **Step 2: Run the CSS test and confirm RED**

```bash
npm test -- src/app/globals.test.ts
```

Expected: obsolete variables/chooser selectors remain and menu selectors are absent.

- [ ] **Step 3: Repair tokens and remove chooser CSS**

- Replace `var(--border)` with `var(--line)`.
- Replace `var(--text-muted)` with `var(--ink-muted)`.
- Remove all `.opportunity-type-chooser` rules and its chooser-only media rule.
- Keep fieldset, task-list, and interaction styles that remain used.

- [ ] **Step 4: Add menu styling using existing design tokens**

Implement an anchored right-aligned popover under the primary button. Reuse `--surface`, `--line`, `--shadow-md`, `--radius-sm`, `--ink`, `--ink-muted`, and `--accent-soft`. Menu items are stacked, have 44px minimum targets, and use existing focus-visible behavior. At 760px the popover remains within the viewport and the trigger fills the available header action width.

- [ ] **Step 5: Complete detail/form integration styles**

- Retain `.detail-main, .detail-side` as the component contract.
- Ensure tracker panel headers/content use the established padding and separators.
- Style next-action task lists without raw browser button appearance.
- Ensure inline composers use application-form spacing rather than legacy raw `form label` rules.
- Preserve the existing 1050px sidebar-first tablet layout and 760px single-column layout.

- [ ] **Step 6: Run deterministic acceptance checks and commit**

```bash
npm test -- src/app/globals.test.ts src/components/NewOpportunityMenu.test.tsx src/components/Dashboard.test.tsx src/components/NewOpportunityPage.test.tsx src/components/OpportunityDetailPage.test.tsx
npm run lint
npm run typecheck
npm run build
git add src/app/globals.css src/app/globals.test.ts
git commit -m "style: restore opportunity interface alignment"
```

Expected: all focused tests, lint, typecheck, and production build pass.

---

## User visual acceptance handoff

Codex starts the updated app on localhost and provides the URL without performing browser verification. The user verifies:

1. New opportunity opens a two-option dropdown.
2. Each option opens the correct form directly.
3. Job and connection creation match the original application form language.
4. Job and connection details match the original main/sidebar composition.
5. Record interaction, Add task, Edit details, and Create job opportunity are fully styled.
6. Desktop and mobile layouts remain aligned.

Any user-reported visual mismatch is treated as failed acceptance and corrected against the supplied screenshots.
