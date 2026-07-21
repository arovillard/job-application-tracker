# Dashboard Next-Action CTA Design

**Status:** Approved for implementation planning
**Date:** 2026-07-21

## Problem

The dashboard currently treats two different conditions as equivalent attention work:

1. A user-created task that is due today or overdue.
2. An active opportunity that has no open task.

The second condition is a planning choice, not urgent work. `getDashboardInsights` synthesizes a `missing_next_action` item, and the same attention collection drives the dashboard banner, count, and Needs attention filter. This makes the attention system noisy and weakens the meaning of “Needs attention.”

The opportunity table already displays “Set a next action” when an opportunity has no open task, but the copy is inert. Task creation exists only on the opportunity detail page. Its modal is generic and does not identify the opportunity receiving the task, even though the modal obscures most of the underlying page.

## Goals

- Reserve Needs attention for user-created tasks that are due today or overdue.
- Put planning affordances next to the opportunity they affect.
- Let the user create a task without leaving the dashboard.
- Make the selected opportunity unmistakable throughout task creation.
- Reuse the same context-aware task composer on the dashboard and detail page.
- Preserve the existing task API, persistence model, and task-selection rules.

## Non-goals

- Do not create tasks automatically.
- Do not require a due date.
- Do not change task ordering, completion, cancellation, rescheduling, or reopening behavior.
- Do not change the database schema or task API contract.
- Do not redesign opportunity creation, interaction recording, or status editing.
- Do not prompt for new tasks on rejected, archived, dormant, or closed opportunities.
- Do not add animation or a new icon library.

## Current-State Evidence

- `src/lib/dashboard.ts` emits `missing_next_action` for a forward-moving opportunity with no open task.
- `src/components/Dashboard.tsx` derives the attention count, Needs attention filter, pipeline pulse, and attention banner from that synthesized collection.
- `src/components/OpportunityTable.tsx` renders “Set a next action” and “No date set” as non-interactive text whenever `nextOpenTask` is absent, including terminal records.
- `src/components/OpportunityDetailPage.tsx` owns both the task-composer UI and its mutation state. `TaskComposer` accepts only task fields and callbacks, so it cannot display opportunity identity.
- `POST /api/opportunities/:id/tasks` already returns authoritative opportunity detail after creating a task. The dashboard can convert that response to an updated summary using its existing `detailToSummary` helper.

## Approaches Considered

### 1. Shared context-aware composer opened over the dashboard — selected

Extract the task composer into a focused shared component. Both the dashboard and opportunity detail page pass the selected opportunity into it. The dashboard owns modal state and posts directly to the existing task endpoint.

This provides the shortest interaction, keeps identity visible, avoids duplicated forms, and keeps both entry points behaviorally consistent.

### 2. Dashboard-specific task modal

Copy the current form into the dashboard and add identity there.

This is initially smaller but creates two composers with separate copy, validation states, accessibility behavior, and future maintenance.

### 3. Navigate to the opportunity detail page

Make the row CTA link to the detail page and open task creation there.

This reuses more of the current controller, but adds navigation and makes the user re-establish context after intentionally choosing a row. It does not meet the desired in-place workflow.

## Product Rules

### Attention semantics

Needs attention contains only persisted open tasks with a due date on or before today. A missing next action does not:

- render in the attention banner;
- increment the attention count or pipeline pulse;
- make an opportunity appear in the Needs attention filter; or
- produce a new `attention=missing_next_action` link.

The existing missing-next-action URL parser and detail-page resolver remain compatible with old bookmarks or browser history, but the dashboard no longer generates those targets.

An undated or future-dated task is a valid next action but does not require attention yet.

### Row-level planning CTA

For an attention-eligible opportunity with no open task, the Next move cell renders a real button labeled “Set next action.” Attention-eligible means the record is not rejected, archived, dormant, or closed. This includes wishlist jobs because the CTA is a planning affordance, not an attention classification.

The button’s accessible name includes the selected entity, for example “Set next action for Kara Melton.” The cell does not show the misleading “No date set” text when no task exists.

When an opportunity has an open task, the cell continues to render the task title and formatted due date. Terminal opportunities without a task render a neutral “No next action” value and no CTA.

### Context-aware task modal

Selecting the row CTA opens a compact modal over the dashboard. The modal title is “Add next action.” The generic “Make the next move concrete” introduction is replaced by a persistent identity surface with this hierarchy:

- Eyebrow: “Creating task for”
- Type badge: “Job” or “Connection”
- Primary identity: opportunity label, such as “Kara Melton” or “Platform Engineer”
- Secondary context: organization when present; otherwise the connection role context, “Independent connection,” or “Organization not set,” in that order where applicable

The identity surface appears above the task fields and remains visible when a validation or server error is shown. It is informational and cannot switch the selected opportunity. Closing the modal and choosing another row is the only way to change the target, preventing accidental cross-entity task creation.

The form retains:

- required “What needs to happen?” input;
- optional due-date input;
- Cancel action;
- primary “Add task” action; and
- pending label “Saving…” while the request is active.

The opportunity detail page uses the same composer and identity treatment for every Add task and Set a next action entry point.

## Component Design

### Dashboard insights

`src/lib/dashboard.ts` stops synthesizing missing-next-action items. `DashboardAttentionItem` becomes task-only dashboard data: every item has a real `taskId`, `actionLabel`, and `dueDate`. Sorting remains earliest due date, then priority, then label.

`src/components/AttentionQueue.tsx` removes the planning-prompt presentation branch and renders only real due work. Its empty behavior remains unchanged: the strip is absent when nothing requires attention.

### Opportunity table

`src/components/OpportunityTable.tsx` receives an optional task-creation callback. It invokes that callback with both the selected opportunity and the button element so the dashboard can identify the target and restore focus on cancellation.

The component remains usable without mutation callbacks. In read-only use, an eligible missing-task row renders neutral text rather than a non-functional button.

The Next move container exposes a stable per-opportunity focus target. After successful creation, focus moves to that updated container so keyboard and screen-reader users receive the new task title even though the original CTA has been replaced.

### Shared task composer

The task composer moves out of `OpportunityDetailPage.tsx` into a focused component module. It receives:

- the selected opportunity identity;
- controlled title and due-date values;
- controlled error and pending states; and
- submit, cancel, and field-change callbacks.

It owns presentation only. Dashboard and detail controllers continue to own drafts, requests, result reconciliation, status messages, and modal lifecycle.

### Dashboard controller

`src/components/Dashboard.tsx` adds one task-creation surface state containing the selected opportunity. Its task draft and error state are isolated from status mutations.

On submission, the dashboard posts `{ title, dueDate: value || null }` to `/api/opportunities/:id/tasks`. It blocks duplicate submission. An authoritative successful response replaces the matching summary through `detailToSummary`; insights then recompute from the updated collection.

If the new task is due today or overdue, it enters Needs attention because it is now real due work. Future-dated or undated tasks update only the row.

## Data Flow

1. The user selects “Set next action” in one row.
2. The dashboard stores that exact opportunity as the modal target, resets a previously successful draft, and opens the modal.
3. The composer renders identity from the stored target and edits a controlled task draft.
4. Submit posts to the target opportunity’s existing tasks endpoint.
5. On success, the dashboard reconciles the returned detail into the matching summary, clears the draft and error, closes the modal, and announces “Next action added for <label>.”
6. Focus moves to the updated Next move cell, which now contains the new task.
7. On failure, no opportunity summary changes. The modal remains open with the same target and draft, and a dialog-scoped alert explains the failure.

## Focus, Keyboard, and Modal Behavior

- The row CTA is a native button with a visible focus indicator and at least a 44px target.
- Opening the modal follows the existing modal focus-trap and initial-focus behavior.
- While no submission is active, Escape, the close button, backdrop dismissal, and Cancel close the modal and restore focus to the original CTA.
- Successful creation does not attempt to focus the removed CTA. It programmatically focuses the updated Next move container and exposes a polite success status.
- The selected identity is included in semantic modal content, not conveyed by color alone.
- The existing task title and due-date labels remain associated with their inputs.
- No new animation is added. Existing reduced-motion behavior continues to apply to the modal system.

## Responsive Behavior

- Desktop retains the current two-column task form within the compact modal.
- At the existing mobile breakpoint, the form fields and actions stack using the shared modal rules.
- The identity surface allows long labels and organization text to wrap without increasing the modal beyond the viewport.
- The row CTA fits the current mobile card layout without horizontal scrolling.

## Error and Concurrency Handling

- Client-required validation prevents an empty title submission.
- Server validation remains authoritative for task payloads.
- A failed request preserves the target, title, due date, and modal focus context.
- Submission controls remain disabled until the active request settles.
- A stale or late response updates state only while it still belongs to the active dashboard task request and matching opportunity.
- While submission is active, Cancel and the modal close button are disabled, and Escape or backdrop dismissal is ignored. This prevents a task from being created after the user believes the operation was cancelled.
- Status-mutation errors and task-creation errors remain separate so one workflow cannot overwrite the other’s feedback.

## Testing Strategy

Implementation follows test-driven development.

### Domain tests

- `getDashboardInsights` excludes active opportunities with no open task.
- Due and overdue tasks remain included and correctly ordered.
- Undated, future, and terminal tasks remain excluded.

### Component tests

- AttentionQueue renders only real task items and no planning variant.
- OpportunityTable renders an entity-named CTA for eligible missing-task rows.
- OpportunityTable renders neutral text for terminal missing-task rows.
- Clicking the CTA passes the exact opportunity and trigger.
- TaskComposer renders job and connection identity, secondary context, fields, errors, and pending state.
- The detail page uses the shared identity-aware composer.
- Modal dismissal is unavailable while task submission is pending and returns when the request settles.

### Dashboard integration tests

- Clicking one row opens a modal named “Add next action” for that exact entity.
- Submission uses the selected opportunity ID and expected payload.
- Success replaces the row’s CTA with the new task and announces the entity-specific confirmation.
- A due-today created task enters Needs attention; a future or undated task does not.
- Failure keeps the modal target and draft intact.
- Cancel restores trigger focus; success focuses the updated Next move cell.

### Verification

- Run focused domain and component tests through the red-green cycle.
- Run the full test suite, lint, typecheck, and production build.
- Verify desktop and mobile layouts, keyboard-only operation, focus restoration, and reduced-motion behavior.

## Acceptance Criteria

1. Missing next actions never appear in or increment Needs attention.
2. Eligible rows with no open task show a contextual “Set next action” button in Next move.
3. Terminal rows never prompt the user to create a task.
4. Selecting the CTA opens task creation over the dashboard without navigation.
5. The modal clearly identifies the exact opportunity receiving the task.
6. Every detail-page task-creation entry point uses the same identity-aware composer.
7. Successful creation updates the selected row without a full reload.
8. A newly created due or overdue task enters Needs attention; other new tasks do not.
9. Failure preserves the selected entity and draft for retry.
10. Cancel and success both leave keyboard focus in a meaningful location.
11. No database migration, dependency, or task API change is introduced.
