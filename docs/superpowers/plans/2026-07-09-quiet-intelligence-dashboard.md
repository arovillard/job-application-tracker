# Quiet Intelligence Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an accessible, action-first job-search dashboard with richer application planning fields and a polished responsive interaction system.

**Architecture:** Add priority and next-action fields to the existing SQLite application record, then calculate client-safe dashboard insights through a pure domain helper. Keep feature UI in focused components: pipeline overview, attention queue, quick capture, application list, toast, and modal. Existing routes remain stable.

**Tech Stack:** Next.js 16, React 19, TypeScript, better-sqlite3, Vitest, CSS custom properties.

## Global Constraints

- Preserve local-first storage and existing public routes.
- Use additive SQLite migrations only.
- Preserve existing artifact and follow-up-note behavior.
- Support keyboard, reduced motion, light/dark theme persistence, and mobile card layouts.
- Avoid new runtime dependencies.

---

### Task 1: Extend the application workspace model

**Files:**
- Modify: `src/types.ts`
- Modify: `src/lib/storage.ts`
- Modify: `src/lib/storage.test.ts`

**Interfaces:**
- Produces `ApplicationPriority`, `nextAction`, `nextActionDate`, and `priority` on `Application` / `ApplicationInput`.
- Produces SQLite persistence and validation for the fields without breaking existing databases.

- [ ] Write a storage test that creates and reloads an application with a high-priority next action due on `2026-07-15`.
- [ ] Run `npm test -- src/lib/storage.test.ts` and verify the expected missing-field failure.
- [ ] Add types, additive schema migration, mapping, normalization, create/update persistence, and select columns.
- [ ] Run `npm test -- src/lib/storage.test.ts` and verify the storage suite passes.

### Task 2: Build testable dashboard insights

**Files:**
- Create: `src/lib/dashboard.ts`
- Create: `src/lib/dashboard.test.ts`

**Interfaces:**
- Produces `getDashboardInsights(applications, followUps, today)` with metrics and queue entries.
- Consumes existing `Application` and `FollowUpItem` objects.

- [ ] Write deterministic tests for active, interviewing, offer, due-follow-up, and missing-next-action counts.
- [ ] Run `npm test -- src/lib/dashboard.test.ts` and verify the expected module-not-found failure.
- [ ] Implement pure date classification and dashboard insight generation.
- [ ] Run `npm test -- src/lib/dashboard.test.ts` and verify the tests pass.

### Task 3: Redesign the dashboard workspace

**Files:**
- Modify: `src/components/Dashboard.tsx`
- Modify: `src/components/ApplicationTable.tsx`
- Modify: `src/components/StatusFilter.tsx`
- Create: `src/components/PipelineOverview.tsx`
- Create: `src/components/AttentionQueue.tsx`
- Create: `src/components/QuickCapture.tsx`
- Create: `src/components/Toast.tsx`

**Interfaces:**
- `PipelineOverview` accepts dashboard insight metrics and metric click callbacks.
- `AttentionQueue` accepts attention items and an application URL builder.
- `QuickCapture` posts an `ApplicationInput` draft and returns the created application.
- `ApplicationTable` accepts sort and status controls while retaining existing links and delete contract.

- [ ] Write a failing component-level or pure helper test for the new dashboard insight behavior before adding its UI consumer.
- [ ] Add metric cards, attention queue, saved views, sort control, keyboard shortcuts, search focus, theme persistence, quick capture, and status undo toast.
- [ ] Make table rows expose meaningful next-action and priority data and support a mobile card treatment.
- [ ] Run `npm test` and manually verify dashboard controls against the local API.

### Task 4: Make application creation and details action-first

**Files:**
- Modify: `src/components/ApplicationForm.tsx`
- Modify: `src/components/NewApplicationPage.tsx`
- Modify: `src/components/ApplicationDetailPage.tsx`
- Create: `src/components/Modal.tsx`

**Interfaces:**
- `ApplicationForm` accepts `isSubmitting` and supports optional planning fields.
- `Modal` accepts open state, title, close handler, and children; it manages focus and Escape.
- Detail workspace displays next action, priority, compact status action, and application actions without a floating-menu dependency.

- [ ] Write a failing test for the focused modal behavior or a pure focusable-control helper if direct DOM coverage is unavailable.
- [ ] Add planning fields with progressive disclosure to the form and disable duplicate submits.
- [ ] Replace the native confirmation/floating action pattern with a persistent action bar and modal confirmation.
- [ ] Run the relevant test suite and browser-check keyboard close and focus restoration.

### Task 5: Apply visual system, responsive rules, and verification

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/app/layout.tsx`

**Interfaces:**
- CSS variables define both themes and semantic status colors.
- Components use stable class names and do not depend on user data for style generation.

- [ ] Add typography, semantic tokens, focus styles, skeletons, motion, dark-theme rules, mobile cards, and reduced-motion override.
- [ ] Run `npm run verify` and `npm run build`.
- [ ] Use the local browser to verify empty and populated dashboards, forms, modal behavior, light/dark themes, and mobile layout.
