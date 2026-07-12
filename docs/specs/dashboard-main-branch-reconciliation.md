# Dashboard Main-Branch Reconciliation Specification

## Problem

The opportunity dashboard preserves the main branch's colors and broad component vocabulary, but its hierarchy, density, loading treatment, mixed-record table, and responsive controls have drifted. The result no longer feels like the main-branch JobTracker dashboard the user identified as the visual standard.

## User outcomes

- The dashboard again feels visually and behaviorally continuous with main.
- Jobs and connections remain first-class records without making the table visually noisy.
- Search, type, status, sort, attention, and creation controls are easy to scan and operate.
- Loading, empty, desktop, tablet, mobile, keyboard, pointer, touch, and reduced-motion states are coherent.
- Existing opportunity data, filters, mutations, routes, and date behavior are preserved.

## Scope

- Reconcile dashboard header, pipeline framing, filter hierarchy, attention loading state, table content hierarchy, loading/empty states, and responsive behavior against main.
- Improve dashboard and creation-menu semantics, accessible naming, keyboard navigation, focus behavior, and pointer-specific feedback.
- Add deterministic component and CSS contract coverage for every changed behavior.

## Non-goals

- No database, migration, API, persistence, status-model, or date-contract changes.
- No detail-page or creation-form redesign.
- No new component library, icon package, font, or runtime dependency.
- No dark-theme redesign; existing tokens remain authoritative.
- No Codex-driven browser verification. The user performs final visual acceptance.

## Current-state Design Engineer audit

| Before | After | Why |
| --- | --- | --- |
| Current panel uses `Workspace / Opportunities` with an unstyled `<h1>` ([Dashboard.tsx:132](<isolated-worktree>/opportunity-leads/src/components/Dashboard.tsx#L132)). | Restore main's compact `Pipeline / Your opportunities` panel hierarchy with `<h2>`, retaining Opportunity Tracker branding. | Main's CSS explicitly styles the panel `<h2>`; the current `<h1>` falls back to browser margins and scale, weakening hierarchy. |
| Search, sort, and type controls compete in one grid row, with status controls on a second ungrouped row. | Restore main's primary search/sort row; place type and status as a clearly labelled, compact filter rail below it. | The current grid was designed for two columns. A third inline control creates crowding and unclear filter hierarchy. |
| Search input keeps icon padding but omits the main-branch search icon. | Restore the decorative search icon and main placeholder rhythm. | Empty leading space reads as accidental misalignment. |
| Table identity begins with uppercase type and relationship chips before the record label. | Lead with record label, follow with organization/context, then one restrained type marker; move relationship strength to tertiary text. | Main prioritizes the opportunity itself. Multiple chips increase row height and compete with the primary scan target. |
| Default sort is `updated`, but the Updated column is missing. | Restore a compact Updated column with the main-branch date treatment. | Users cannot explain the default ordering without seeing recency. |
| Loading table renders literal text while skeleton CSS remains unused ([OpportunityTable.tsx:60](<isolated-worktree>/opportunity-leads/src/components/OpportunityTable.tsx#L60)). | Restore three stable skeleton rows with an accessible loading label. | Main avoids layout shift and communicates loading without replacing the entire table surface. |
| Empty table links directly to untyped `/opportunities/new`, bypassing the required choice menu. | Keep one creation menu in the dashboard header; the empty state points users to that single control without rendering a second trigger. | A second menu would duplicate IDs, global `N` listeners, and focus ownership. One creation trigger preserves the user's requested model. |
| Attention loading skeleton has no accessible name. | Restore `aria-label="Loading attention queue"`. | Visual loading affordance should have equivalent nonvisual context. |
| Every row detail link is announced only as `Open`. | Keep visible `Open →` but provide `aria-label="Open {label}"`. | Screen-reader link lists otherwise contain indistinguishable destinations. |
| Theme control is always announced as `Toggle theme`. | Announce the destination action: `Switch to dark theme` or `Switch to light theme`. | The current label does not expose state or result. |
| Creation popover uses ARIA menu roles without Arrow/Home/End focus behavior. | Implement the complete two-item menu keyboard model and focus the first item when opened by keyboard. | Semantics and behavior must agree; Escape must restore trigger focus. |
| Hover transforms run on all pointer types. | Gate transform-only hover and press feedback behind `(hover: hover) and (pointer: fine)`; keep color feedback universal. | Touch devices can retain sticky hover. Frequent keyboard actions remain animation-free. |
| Mobile status filters wrap into data-dependent rows. | Restore a single horizontally scrollable filter rail with stable height; keep type controls in the same labelled filter region. | Main's rail preserves vertical space and handles longer connection stage sets more predictably. |
| Existing tests assert selector strings and dashboard copy but do not render mixed table rows or loading states. | Add fixtures for job/connection identity, recency, unique links, skeletons, empty creation menu, and menu keyboard behavior. | The prior visual drift passed all tests because contracts were not represented deterministically. |

## Proposed architecture

### Dashboard chrome

Keep `Opportunity Tracker` and the `O` brand mark. Restore main's semantic and visual hierarchy inside the pipeline panel:

- Eyebrow: `Pipeline`.
- Heading: `Your opportunities` as `<h2>`.
- Count remains right aligned and reports pending stage updates as main did.
- Search regains its decorative icon.
- Sort remains paired with search.

### Filter hierarchy

The control region has two clear tiers:

1. Search and sort.
2. A labelled `Filter opportunities` rail containing the `All / Jobs / Connections` type control followed by the relevant status controls.

Type changes preserve current filter-reset behavior. On mobile, the rail is horizontally scrollable, single-line, keyboard reachable, and does not wrap.

### Mixed opportunity table

Restore main's six-column information architecture:

1. Opportunity.
2. Stage.
3. Next move.
4. Focus.
5. Updated.
6. Row action.

The identity cell uses label first, organization or role context second, and a low-emphasis metadata line for type plus relationship strength when applicable. It does not stack multiple prominent pills before the label.

Loading renders three skeleton rows and retains table height. The empty state keeps main's centered composition but directs users to the single header `New opportunity` menu instead of rendering another trigger. Mobile card conversion retains labels for every data cell, including Updated.

### Interaction and motion

- The creation menu keeps instant open/close behavior because it is keyboard-accessible and frequently used.
- `N` opens the menu and focuses the first item; repeated `N` while open returns focus to the first item; ArrowDown/ArrowUp cycle; Home/End jump; Enter activates; Escape closes/restores trigger focus.
- Tab or Shift+Tab closes without preventing default, allowing normal document focus traversal. Pointer outside dismissal closes without forcing trigger focus; item activation closes and navigates without restoring trigger focus.
- Pointer hover transforms and pointer press scaling are limited to hover-capable fine pointers.
- No `transition: all`, scale-from-zero, ease-in UI feedback, or keyboard-triggered motion.
- Existing `prefers-reduced-motion` protection remains.

## Data flow and failure paths

All dashboard data continues to come from `/api/opportunities?archived=include`. Search, sort, type, status, attention filtering, optimistic pending state, status PATCH, toast undo, and creation destinations remain unchanged.

If loading fails, the existing alert remains visible. Loading skeletons are removed only when loading resolves. Creation-menu focus listeners are registered and cleaned up exactly once per mounted menu state.

## Security, privacy, migration, compatibility, and rollback

- Security/privacy: no new data, network calls, storage, or external resources.
- Migration: none.
- Compatibility: React 19, Next.js 16, existing CSS tokens, and current desktop/mobile breakpoints.
- Accessibility: semantic headings, labelled filter region, unique links, dynamic theme label, complete menu keyboard behavior, focus restoration, and loading names.
- Rollback: revert dashboard/component/CSS commits; no data rollback.

## Acceptance criteria

1. Dashboard hierarchy matches main's compact header and pipeline panel while retaining opportunity terminology.
2. Search icon, search/sort row, type/status filter rail, attention strip, and table align with main's spacing and density.
3. Mixed job/connection rows prioritize identity and show Updated consistently.
4. Loading and empty states match main's quality and accessibility.
5. Creation menu has complete two-item keyboard behavior and consistent empty-state reuse.
6. Theme and row-action accessible names are descriptive.
7. Hover movement is fine-pointer-only; keyboard and reduced-motion behavior are motion-safe.
8. Mobile filters remain one line and horizontally scrollable; mobile table cards include all data labels.
9. Existing type/status reset behavior, default updated sorting, job/connection stage options, pending-stage disabling, status PATCH request, detail routes, and next-task date behavior remain unchanged and have targeted regression coverage. API, persistence, and date storage remain outside the write set and continue to be covered by the full suite.
10. Focused tests, full verification, production build, and Sol final review pass.
11. The user completes browser visual acceptance against main on desktop and mobile.

## Executable verification

```bash
npm test -- src/components/NewOpportunityMenu.test.tsx src/components/Dashboard.test.tsx src/components/OpportunityTable.test.tsx src/components/AttentionQueue.test.tsx src/app/globals.test.ts
npm run verify
npm run build
```

User visual acceptance checks the populated dashboard, loading state, empty state, creation menu, long mixed rows, desktop, tablet, and mobile against the main-branch experience.

## Material decisions and tradeoffs

- Main is the visual baseline, not a literal data-model rollback. Opportunity Tracker branding and mixed records remain.
- One restrained type marker remains because mixed jobs/connections need disambiguation; relationship strength becomes tertiary text.
- Updated returns despite horizontal pressure because it explains the default sort. Existing mobile card conversion handles narrow screens.
- Menu animation is deliberately omitted; correctness and speed matter more for a shortcut-driven control.

## Bounded visual baseline

The authoritative main baseline is commit `f1855f3c8f86f42188a172dfc01058af1e2e24dd` for `src/components/Dashboard.tsx`, `src/components/ApplicationTable.tsx`, and `src/app/globals.css`.

Deterministic reconciliation preserves these measurable contracts:

- Primary search/sort grid: `grid-template-columns: minmax(220px, 1fr) auto`.
- Pipeline header spacing: `padding: 22px 24px 18px` on desktop.
- Table minimum width: `770px` with mobile card conversion at `760px`.
- Desktop cell spacing: `padding: 16px 18px`.
- Three loading skeleton rows with four visual skeleton blocks each.
- Mobile status/type filter rail: one line, horizontal overflow, no wrapping.

The 320px header/menu fit, visual spacing, typography, and touch-scroll feel cannot be proven by static tests and are explicitly assigned to the user's browser acceptance.

## Open decisions

None.
