# Attention Prompt and Up Next Hierarchy

**Status:** Proposed for approval  
**Date:** 2026-07-13  
**Orchestration run:** `attention-followup-20260714T012724Z-b82977a2-9893-4b86-97ee-7e713acc33f3`

## Problem

The dashboard correctly surfaces work that needs attention, but it currently presents two different concepts with the same visual and type-level anatomy:

1. A persisted task that the user created and that is due today or overdue.
2. A system-derived planning gap because an active opportunity has no open task.

The second concept is rendered as “Set a next action · Plan next move,” which looks like a task even though no task exists. On the detail page, a due task is highlighted with a large amber surface inside an already tinted Actions card. Legacy and nested padding squeeze the working area, and selector specificity prevents Complete from receiving its intended primary-button treatment. The result is visually loud where it should be precise and visually weak where the primary action should be obvious.

## User outcomes

- A user can immediately tell whether Needs attention contains a task they created or a system-generated planning prompt.
- A planning prompt remains visible for forward-moving opportunities without a next action, but never masquerades as a persisted action.
- The Actions card reads as one coherent surface with a clear title, due state, and primary Complete action.
- Secondary controls remain available without competing with the primary action.
- Dashboard-to-detail navigation, task mutations, focus management, and the attention filter remain compatible.

## Scope

- Make the `DashboardAttentionItem` union type truthful about persisted tasks versus derived planning gaps.
- Give missing-next-action items distinct copy and compact visual semantics in the dashboard strip.
- Repair the Actions card’s inherited padding and primary-button specificity.
- Replace the full-row amber fill and halo with a compact due-state treatment.
- Put Cancel and rescheduling behind a native, closed-by-default “More options” disclosure for the primary Up next task.
- Name the Actions section and focused task group for assistive technology.
- Add focused domain, component, CSS, accessibility, and responsive regression coverage.

## Non-goals

- No change to which opportunity statuses require forward motion.
- No removal of missing-next-action items from Needs attention.
- No database schema, migration, storage, API, task mutation, authentication, authorization, dependency, or URL-contract change.
- No new task, automatic task creation, due date, or activity record when the planning prompt is derived.
- No redesign of non-primary task rows, activity history, the detail header, or the contextual arrival banner.
- No animation or new icon library.

## Current-state evidence

### Synthetic planning prompt

- `src/lib/storage.ts` loads persisted open tasks and maps the first one to `OpportunitySummary.nextOpenTask`; no open row yields `null`.
- `src/lib/dashboard.ts:82-96` synthesizes `kind: "missing_next_action"`, `taskId: null`, `actionLabel: "Set a next action"`, and no due date when a forward-moving opportunity has no open task.
- `src/components/AttentionQueue.tsx:6-8` adds “Plan next move,” while `src/components/AttentionQueue.tsx:19-34` renders both union variants with the same action-first chip anatomy.
- The configured local database confirms that opportunity `71d5c804-d743-4c68-9ad4-6bb15a9ffa3e` is an applied, high-priority job with zero rows in `opportunity_tasks`. The displayed dashboard item is therefore derived, not user-authored.
- `src/lib/opportunity-attention.ts:54-58` already preserves the correct authoritative distinction on arrival: a missing-next-action target is active only while the fetched record still has no open task and still requires forward motion.

### Up next hierarchy

- `src/app/globals.css:428` gives every `.next-action-card` 24px outer padding. The consolidated Actions card then adds header padding at `src/app/globals.css:639` and body padding at `src/app/globals.css:696`.
- At a 1280px live viewport, the Actions card measured 317px wide while the highlighted task measured only 227px wide.
- `src/app/globals.css:792` adds an amber background and a 6px amber halo to the targeted row, producing a nested card inside the blue-tinted Actions card.
- `src/app/globals.css:102` has greater selector specificity than `src/app/globals.css:648`; the computed Complete button is therefore white with muted text instead of blue with white text.
- The primary task exposes Complete, Cancel, date input, and Reschedule at the same time. In the narrow side rail, secondary task maintenance competes with completion.
- `src/components/OpportunityTaskList.tsx:32` focuses a generic task container without an accessible group name when Review options is used.

### Existing coverage

- `src/lib/dashboard.test.ts` covers synthesized-item ordering and terminal/future suppression.
- `src/components/AttentionQueue.test.tsx` verifies the missing-next-action URL has no task ID, but currently accepts the action-like copy.
- `src/components/OpportunityTaskList.test.tsx` verifies ordering, task groups, primary markup, and focus-target classes.
- `src/app/globals.test.ts` checks selector presence but not the padding collision, computed primary-button result, compact attention signal, or container-width behavior.
- The isolated baseline passes 27 test files and 297 tests.

## Design precedents

- [Linear Inbox](https://linear.app/docs/inbox) treats attention/reminder state as an inbox notification that opens the underlying issue; it does not turn the notification itself into a new issue. This supports preserving the planning gap while labeling it as derived context.
- [Carbon notifications](https://carbondesignsystem.com/components/notification/usage/) recommend concise contextual messaging near the related item and a single primary action for actionable notifications. This supports precise due-state emphasis and progressive disclosure of secondary maintenance controls.
- [Atlassian lozenges](https://atlassian.design/components/lozenge) are compact labels for meaningful attributes that affect how an object is understood or prioritized. This supports an amber due-state label instead of a large nested amber surface.

## Approaches considered

### 1. Status-led single surface — selected

- Keep missing-next-action in Needs attention, but render “No next action planned” with a compact “Planning” status and a planning-specific marker.
- Keep the Actions card as the only card surface.
- Emphasize the exact due state with a compact amber or danger label.
- Make Complete the obvious primary action and place Cancel/reschedule under “More options.”

This most directly fixes the semantic confusion and visual hierarchy while preserving existing workflows and URL contracts.

### 2. Retain the full amber block and reduce its controls

- Keep the amber background, remove the halo, and show only title, due state, and Complete.
- Put all other actions in a disclosure.

This remains noticeable but preserves the card-within-card effect and uses a large color area to express a small status fact.

### 3. Minimal accent-only correction

- Keep all controls visible.
- Remove the amber fill/halo, fix padding and button specificity, and add only a left rule or dot.

This is the smallest change, but it leaves the dense mini-form and does not clearly distinguish a planning prompt from a persisted task.

## Proposed behavior

### Truthful attention model

`DashboardAttentionItem` remains a discriminated union, but the missing-next-action variant no longer exposes an action label:

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

No task row or activity is created. The planning item continues to sort after dated due work and continues to use `attention=missing_next_action` with no `taskId`.

### Dashboard presentation

Persisted task:

- Primary: exact task title.
- Secondary: opportunity label plus “Due today · YYYY-MM-DD” or “Overdue · YYYY-MM-DD.”
- Marker: existing opportunity-priority marker.

Derived planning gap:

- Primary: “No next action planned.”
- Secondary: opportunity label plus a compact “Planning” label.
- Marker: a planning-specific amber ring or equivalent compact treatment, not the record’s red/amber/blue priority dot.
- Accessible name: “No next action planned for <opportunity>. Open planning prompt.”

The chip remains a real link with a 44px minimum target. Counts, ordering, View all, filter behavior, and deep-link resolution do not change.

### Actions card structure

- `.actions-card` resets inherited `.next-action-card` outer padding to zero. Header and section bodies remain the only spacing owners.
- The primary task removes its generic bottom divider and extra vertical row padding.
- The task title remains normal ink. The precise due state becomes the attention cue:
  - Due today: amber low-contrast status label plus text.
  - Overdue: danger low-contrast status label plus text.
- `.task-item--attention` no longer creates a filled nested surface or a 6px halo.
- Complete uses the accent background and white text through selectors that win in default and fine-pointer hover computed styles.

### Progressive disclosure

For the primary open task:

1. Title and due state.
2. Full-width Complete button.
3. Native `<details>` with a 44px “More options” summary, closed by default.
4. When open, the disclosure contains the existing due-date input, Reschedule, and Cancel controls.

Other task rows keep their current actions. Reopen behavior and completed/cancelled history remain unchanged. The native disclosure has no custom motion.

### Focus and semantics

- The Actions section uses `aria-labelledby` pointing at its visible Actions heading.
- Every task row has stable title and due IDs.
- The attention-targeted task is a named `role="group"` with `aria-labelledby` and `aria-describedby`, so programmatic focus announces the task title and due state.
- Review options keeps the existing programmatic target and ordering behavior.
- Focus outlines remain visible and are not clipped.
- Complete, More options, date input, Reschedule, and Cancel remain keyboard operable with targets at least 44px tall.

### Responsive behavior

- The layout responds to the Actions card’s own inline size, not only the viewport breakpoint.
- At narrow side-rail/container widths, the reschedule input and button stack to one column.
- Verify 1440px, 1280px, 980px, 768px, 760px, 390px, and 320px states with a long task title.
- Dashboard planning chips preserve ellipsis and horizontal overflow behavior already used by the attention strip.

## Data flow and interfaces

1. `listOpportunities` returns `nextOpenTask` from persisted open task rows.
2. `getDashboardInsights` emits either a persisted `task` attention item or a derived `missing_next_action` reason.
3. `AttentionQueue` selects presentation by the discriminant and builds the existing target-aware link.
4. The route parser and fresh-detail resolver remain authoritative.
5. `OpportunityTaskList` renders the existing task data and invokes the existing callbacks; disclosure changes presentation only.

## Failure paths

- If a planning prompt becomes stale because a task was added elsewhere, the existing detail resolver renders the neutral resolved state.
- A task mutation failure preserves the task, error alert, current date draft, and open More options disclosure so the user can retry.
- Retry controls are enabled again after a failed mutation.
- When a successful reschedule changes task ordering, the newly promoted primary row mounts with its own task identity and due-date draft.
- Pending task mutations disable the mutation buttons through the existing pending lock; opening or closing the disclosure has no persistence effect.
- Malformed, unknown, or stale attention URLs retain the current safe behavior.
- Long titles wrap; they do not force controls outside the card.

## Security, privacy, compatibility, migration, and rollback

- No new data is stored, transmitted, or placed in a URL.
- React escaping remains authoritative for user-entered titles and labels.
- Existing task and opportunity IDs remain opaque local identifiers.
- Existing direct links and attention links remain compatible.
- No migration is required.
- Rollback is a code/style revert; no data rollback is required.

## Acceptance criteria

1. A forward-moving opportunity with no open task produces a `missing_next_action` item with `taskId: null`, `reasonLabel: "No next action planned"`, and no `actionLabel`.
2. The planning item renders “No next action planned” and “Planning,” never “Set a next action” or “Plan next move,” and links with `attention=missing_next_action` and no task ID.
3. A real due task continues to lead with its exact persisted title and retains its explicit task ID and due/overdue copy.
4. Attention counts, sorting, filtering, View all, missing-action eligibility, future-task suppression, and detail revalidation are unchanged; a Dashboard interaction test starts from the Jobs type, proves the count remains stable, and verifies View all resets type to All while selecting Needs attention.
5. The Actions card has no inherited outer padding; header and body spacing provide one coherent surface.
6. The attention-targeted primary row has no amber filled background or halo. Due today and overdue remain visually and textually distinct through compact status labels.
7. Complete computes to the accent background with white text in default and fine-pointer hover states and remains at least 44px tall.
8. The primary task shows Complete and a closed-by-default More options disclosure; Cancel and rescheduling remain available inside it.
9. Failed rescheduling preserves the entered date, open disclosure, attention context, and enabled retry controls; successful rescheduling that promotes a different task resets the primary due-date draft to that task’s value.
10. The Actions section and attention-targeted task expose accessible names; Review options focuses a group whose accessibility-tree entry includes the task title and due state.
11. Narrow Actions containers stack rescheduling controls without clipping, horizontal overflow, or sub-44px interactive targets.
12. No animation, database, storage, API, dependency, URL, private-file, application-submission, or master-resume change is present.
13. Focused tests, `npm run verify`, `npm run build`, and `git diff --check` pass.
14. Desktop and narrow live-browser checks confirm the primary hierarchy and no dashboard/detail regression.
15. A freshly routed Sol final reviewer reports no blocking findings before Goal completion.

## Verification

```bash
npm test -- --run src/lib/dashboard.test.ts src/components/AttentionQueue.test.tsx src/components/OpportunityTaskList.test.tsx src/components/OpportunityAttentionBanner.test.tsx src/components/OpportunityDetailPage.test.tsx src/app/globals.test.ts
npm run verify
npm run build
git diff --check
```

Live browser scenarios:

- Persisted due-today and overdue task items.
- Derived planning item for an applied job with zero task rows.
- Direct detail visit and attention-targeted detail visit.
- More options closed, opened, successfully rescheduled, and cancelled.
- Keyboard path from dashboard chip to arrival banner to Review options to the named task group.
- Accessibility-aware browser snapshot after Review options, showing the focused group name and description include the task title and due state.
- Viewports 1440, 1280, 980, 768, 760, 390, and 320px, including a long task title.

The failed-reschedule retry path is verified with deterministic mocked fetch responses in the component integration suite. Do not induce a failure by mutating or corrupting the configured user database.

## Open decisions

No implementation-blocking decisions remain. The selected design intentionally keeps missing-next-action in Needs attention while making its system-derived nature explicit.
