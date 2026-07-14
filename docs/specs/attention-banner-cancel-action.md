# Attention Banner Cancel Action

**Status:** Approved direction; pending written-spec review  
**Date:** 2026-07-14

## Problem

The active due-task attention banner currently offers **Complete** and **Review options**. Review options only moves focus to the nearby task row. When that row is already visible, the interaction has little or no perceivable effect and leaves the user unsure what happened.

The likely decision at this alert is simpler: the task was completed, or it should be cancelled. Rescheduling remains useful, but it belongs in the existing Actions card rather than this high-priority banner.

## Selected design

For `active_task` attention banners only:

- Keep **Complete** as the primary action.
- Replace **Review options** with a secondary **Cancel** action.
- Cancel invokes the existing task cancellation mutation for the displayed task.
- Complete and Cancel share the existing pending lock and are both disabled while either mutation is in flight.
- On successful cancellation, the task moves to cancelled history, the attention target resolves, the existing `Action cancelled` status is announced, and focus moves to the resolved attention banner.
- On cancellation failure, the task and active banner remain visible, the existing page error is announced, and both actions become available for retry.

## Unchanged behavior

- The Actions card keeps **More options**, rescheduling, and its existing Cancel control.
- Non-primary task controls remain unchanged.
- Missing-next-action banners keep **Set next action**.
- Resolved attention banners keep **Review current actions** and their existing focus behavior.
- Complete retains its current mutation, double-submit protection, status announcement, and resolved-focus behavior.
- No task, storage, API, URL, database, schema, dependency, authentication, or authorization contract changes.

## Component contract

`OpportunityAttentionBanner` receives a task-specific `onCancel(task)` callback alongside `onComplete(task)`. The existing `onReview` callback remains because the resolved banner still uses it, but the active-task branch no longer renders Review options.

`OpportunityDetailController` wires `onCancel` to the existing `taskAction(task, "cancel", undefined, true)` path. No new mutation helper or endpoint is introduced.

## Accessibility and interaction

- Buttons retain visible labels, native semantics, keyboard operation, and at least 44px targets through existing button styles.
- Complete remains first in DOM and visual order; Cancel remains secondary.
- Both buttons expose the pending state through `disabled` while the task mutation is active.
- The alert remains named by its visible task title and preserves the current arrival and resolution focus lifecycle.
- No animation is added.

## Verification

- Component rendering proves active-task banners show Complete and Cancel and do not show Review options.
- Component rendering proves both task actions disable for the matching pending task.
- Integration coverage proves banner Cancel calls the existing task PATCH endpoint with `{ action: "cancel" }`, ignores a duplicate click while pending, announces `Action cancelled`, resolves the attention banner, and preserves focus.
- Integration coverage proves a failed banner cancellation leaves the active banner in place, announces the error, and re-enables both actions.
- Existing tests continue proving Actions-card rescheduling, missing-next-action behavior, resolved Review current actions, and Complete behavior.
- Focused tests, `npm run verify`, `npm run build`, and `git diff --check` pass.

## Non-goals

- Removing or redesigning rescheduling.
- Removing More options from the Actions card.
- Adding a confirmation modal for task cancellation.
- Changing task history or cancellation semantics.
- Redesigning the resolved or missing-next-action banners.
