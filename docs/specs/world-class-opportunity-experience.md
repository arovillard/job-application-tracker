# World-Class Opportunity Experience Specification

## Problem

The opportunities model now supports jobs and connections, but the feature expansion flattened or obscured several polished interaction patterns from the main-branch application experience. Important actions can appear below long content, forms expose too much at once, useful source links and visual status semantics are missing, and the dashboard does not summarize pipeline health.

The result is functionally capable but visually quieter, less self-explanatory, and easier to misread than the bounded main-branch baseline at commit `f1855f3c8f86f42188a172dfc01058af1e2e24dd`.

## User outcomes

1. A user understands pipeline health and required attention within seconds.
2. Job and connection records remain visually distinct while sharing one coherent system.
3. Record interaction, add task, edit, create linked job, archive, and delete actions always produce an immediately visible response.
4. Creation feels focused: identity first, momentum second, optional detail last.
5. Activity, stage, priority, due state, source posting, and relationship context are scannable rather than textually flat.
6. Keyboard, touch, narrow-screen, reduced-motion, loading, empty, error, and destructive flows are deliberate.

## Scope

- Dashboard hierarchy, pipeline summary, filtering feedback, loading/error/empty states, and mixed-record table detail.
- Job and connection creation forms, including an atomic first next action.
- Opportunity detail header, next-action hierarchy, timeline/snapshot labels, modal workflows, focus management, secondary-action overflow, and destructive confirmation.
- Shared visual system refinements across light/dark themes and responsive breakpoints.
- Focused semantic, interaction, and static CSS contract tests.

## Non-goals

- No database schema, migration, dependency, authentication, authorization, artifact-storage, or public API route changes.
- No replacement of the existing Opportunity Tracker branding, blue accent, typography, or data model.
- No decorative charting library or animation framework.
- No browser automation. Final pixel/touch acceptance remains a manual localhost pass.
- No redesign of artifact rendering internals or task persistence.

## Current-state audit

## Visual baseline evidence

- Create form screenshot: `<reference-input>/Screenshot 2026-07-12 at 7.42.06 AM.png`
- Job detail screenshot: `<reference-input>/Screenshot 2026-07-12 at 7.42.38 AM.png`
- Source implementation baseline: `f1855f3c8f86f42188a172dfc01058af1e2e24dd`

The form baseline establishes narrow centred content, an oversized page title, one bordered card, a two-column identity grid, a blue-tinted Next move surface, a collapsed Optional details row, and a right-aligned primary footer action.

The detail baseline establishes breadcrumb/type hierarchy, identity plus stage, a compact action row, a wide activity/materials column, a narrow next-move/snapshot rail, visible event counts, semantic timeline dots, bordered row separators, and restrained blue/warm status accents.

| Before | After | Why |
| --- | --- | --- |
| Transient detail forms append after the full detail grid and long application materials. | Open Record interaction and Add task in compact dialogs; open Edit details and Create linked job in responsive wide dialogs. | The current action appears inert when the resulting panel is below the viewport. Main used modal workflows and the existing `Modal` already provides focus trapping and Escape handling. |
| Archive and permanent delete sit beside routine actions; delete uses `window.confirm`. | Keep Record interaction and Add task primary; place Edit, linked-job creation, Archive, and Delete in an accessible More menu; confirm destructive actions in a named dialog. | Separates workflow actions from destructive maintenance and avoids browser-dependent confirmation UX. |
| Interaction/task drafts share state and cancellation retains stale data. | Isolate drafts by active dialog, reset on cancel/success, close after save, restore trigger focus, and announce completion. | Prevents stale due dates and makes successful actions perceivable. |
| “Next actions” displays every task with equal weight. | Surface the earliest open task as the Next action card with due-state semantics and CTA; keep remaining open/history tasks in a secondary task panel/disclosure. | Restores the main screenshot's strong next-move hierarchy. |
| Job and connection snapshots are both titled “Details.” | Use “Job snapshot” and “Connection snapshot,” retain type-specific fields, and render posting URLs as labelled external links. | Improves type recognition and information scanning. |
| Connection edit displays creation-only interaction/task fields that are discarded. | Add explicit create/edit form modes; edit mode omits initial interaction and first-task controls. | Removes a silent data-loss affordance. |
| Job rows omit their stored posting URL. | Restore a compact external posting link when present and add scoped table headers. | Recovers useful detail from main and improves table semantics. |
| Connection stages and most activity types fall back to unstyled gray/transparent markers. | Map every connection stage and human activity type to a restrained semantic palette with a safe default. | Status and timeline color become meaningful scanning aids rather than decoration. |
| Dashboard offers counts only through filters and attention strip. | Add a compact Pipeline pulse strip: active total, jobs, connections, needs attention, and closed/archived context with a proportional type bar. | Gives immediate orientation without adding a decorative analytics dependency. |
| Failed loading can render an empty-database message; filtered-zero states imply first-time setup. | Use dedicated retryable error state and filter-aware empty state with Clear filters. | Prevents duplicate entry and explains why no records are visible. |
| Creation forms render almost all fields immediately and ignore existing intro/planning/disclosure styling. | Use identity-first fields, a prominent Next move block, and an Optional details disclosure; show applied date only for relevant job stages. | Matches the polished main form, reduces cognitive load, and makes momentum the product's organizing idea. |
| Required/optional and native input intent are inconsistently communicated. | Add visible Required/Optional copy, `type=url`, autocomplete hints, helper text, and announced submit errors. | Improves mobile keyboards, autofill, validation understanding, and assistive technology feedback. |
| Mobile action buttons and forms lack a clear priority order. | Keep two primary actions visible, overflow secondary actions, use near-full-height wide dialogs, and make form action footers sticky/full-width on narrow screens. | Avoids button walls and keeps completion controls visible. |
| Existing visual tokens, restrained shadows, focus-visible rings, fine-pointer motion gating, and reduced-motion handling are sound. | Preserve and extend those conventions; add no keyboard-triggered motion, `transition: all`, scale-from-zero, or ungated hover transforms. | Builds on the strongest existing craft instead of introducing a competing style. |

## Proposed behavior

### Dashboard

- Header remains Opportunity Tracker with one New opportunity menu.
- A Pipeline pulse surface sits between the header and filters.
- Metrics are derived from already-loaded opportunities:
  - Active total excludes archived, rejected, dormant, and closed.
  - Active jobs and connections are explicit.
  - Needs attention reuses dashboard insight data.
  - Closed/archived context is visible but visually subdued.
- A proportional jobs/connections bar is always `aria-hidden=true`; adjacent labels provide the complete textual equivalent. At zero active records it renders a neutral empty track with no fabricated segment.
- Loading uses semantic skeletons. Initial fetch failure suppresses Pipeline pulse, attention, controls, and table, leaving the app header and one Retry surface.
- Retry clears the prior load error, enters named loading state, and replaces repeated failures with the latest error. Mutation errors use separate state and retain loaded data.
- Search or non-default filters produce a contextual empty state and Clear filters action.
- Job rows restore `View posting` links; table headers use `scope="col"`.
- Existing sort, status PATCH, undo toast, keyboard shortcuts, and mixed status sets remain unchanged.

### Creation

- Both forms share this visual sequence:
  1. Intro and required identity fields.
  2. Stage/focus controls.
  3. Next move planning surface with optional title and due date.
  4. Optional details disclosure.
- Job creation sends `{ opportunity, initialTask }` through the existing atomic create endpoint.
- Connection creation continues to support `initialTask` and optional initial activity; history lives inside Optional details.
- Optional details is closed by default on create and remains mounted so values survive collapse. On edit it opens when optional values exist. Invalid hidden native controls open the disclosure before focus transfer.
- Job applied date appears for Applied, Interviewing, Offer, or Rejected. Returning an edited job to Wishlist sends `appliedDate: null`; hidden create fields also submit `null`.
- Connection edit mode excludes initial activity/task sections.
- Job linked mode excludes first-task controls and emits the wrapper; its caller sends only `payload.opportunity` to the unchanged linked-job endpoint.
- Errors are `role="alert"`; submission labels communicate pending state.
- Form action footer always contains primary action and, when supplied, Cancel.

### Detail workspace

- Header retains breadcrumb, type eyebrow, identity, stage, and priority context.
- Record interaction and Add task are primary visible actions.
- More menu contains Edit details, Create job opportunity where applicable, Archive, and Delete permanently.
- Dialog behavior:
  - Initial focus moves to the first meaningful field.
  - Tab and Shift+Tab remain trapped.
  - Escape/backdrop/Cancel close and restore trigger focus.
  - Body scroll locks while open.
  - Dialogs are centred on desktop; wide forms become near-full-height on mobile.
  - Keyboard-triggered opening does not animate.
- Successful mutation closes the dialog, clears its draft, updates detail data, and exposes a polite success status.
- Archive/delete confirmation names the record; delete uses danger styling.
- No action-generated surface is appended after application materials.

### Information hierarchy

- Next action card shows the selected earliest open task, overdue/due/no-date semantics, and direct action affordances.
- Remaining tasks appear in a secondary Tasks panel; history remains collapsed by default.
- Activity timeline markers distinguish note/message/email/call/meeting/introduction and system lifecycle events.
- Snapshot title and fields are type-specific.
- Application materials remain below activity in the main column and retain disclosure behavior.

## Accessibility and input methods

- Dialogs: `role=dialog`, `aria-modal`, labelled title, body scroll lock, focus trap/restoration.
- Menus: semantic trigger state, arrow/Home/End/Escape behavior, outside dismissal without focus theft.
- Alerts/statuses: creation and mutation errors use alerts; successful saves and loading use named status semantics. A page-level submit failure focuses a `tabIndex=-1` error summary.
- Required fields retain native `required`; visible Required copy is inside the label and helper/error text uses stable `aria-describedby` ids. Optional copy is programmatically part of the disclosure summary.
- Tables: scoped column headers and unique row links.
- Native date/url inputs retained.
- Touch targets remain at least 44px.
- Motion remains under 220ms, fine-pointer gated for hover transforms, and disabled/reduced for keyboard and `prefers-reduced-motion`.

## Failure paths

- Dashboard fetch failure: error surface with Retry; never show first-record empty copy simultaneously.
- Creation/mutation failure: dialog/form remains open with draft preserved and an announced error.
- Delete/archive failure: confirmation closes only after success; error remains visible.
- Initial task/activity validation is handled atomically by the existing create endpoint.

## Security, privacy, compatibility, and rollback

- No new external requests, credentials, user-provided HTML, or persistence surfaces.
- Existing URL is rendered with safe `target="_blank"` and `rel="noreferrer"`.
- Existing API/storage validation remains authoritative.
- All changes are additive presentation/client orchestration and can be rolled back by the goal's commit range.

## Acceptance criteria

1. Record interaction, Add task, Edit details, Create linked job, Archive, and Delete never render below the detail grid.
2. Dialog focus, Escape, Tab wrap, cancellation, restoration, scroll lock, and success/error semantics have deterministic tests.
3. Connection edit does not expose creation-only controls.
4. Both creation forms use identity/next-move/optional-details hierarchy and create an initial task atomically when supplied.
5. Job applied date is conditionally visible and URL uses a native URL input.
6. Dashboard renders the Pipeline pulse metrics from mixed records.
7. Error, search-empty, and filter-empty states are distinct and actionable.
8. Job posting links, scoped headers, unique row links, mixed status options, PATCH behavior, and sorting remain covered.
9. Next action is visually primary; secondary tasks/history remain available.
10. Every stage and activity marker has a visible semantic/default style.
11. Mobile action hierarchy, dialog sizing, one-line filters, sticky form actions, and card-table layout have static CSS contracts.
12. No prohibited motion declarations or ungated hover transforms are introduced.
13. `npm run verify` and `npm run build` pass.
14. A Sol final reviewer reports no blocking findings.
15. User receives a localhost checklist for desktop, 760px, and 320px visual acceptance; Codex does not run browser automation.

## Verification

```bash
npm test -- --run src/components/Modal.test.tsx src/components/NewOpportunityPage.test.tsx src/components/OpportunityForms.test.tsx src/components/Dashboard.test.tsx src/components/PipelinePulse.test.tsx src/components/OpportunityTable.test.tsx src/components/OpportunityDetailPage.test.tsx src/components/DetailActionsMenu.test.tsx src/components/OpportunityTaskList.test.tsx src/app/globals.test.ts
npm run verify
npm run build
```

Manual localhost acceptance procedure (user-owned; Codex does not browser-automate it):

- 1440px create: one centred card; title/section hierarchy matches the baseline; Next move is tinted; Optional details is one collapsed row; primary action remains visible at card bottom.
- 1440px detail: every action immediately opens a centred dialog above the viewport; activity/materials remain the wide column; Next action and snapshot remain the narrow rail; no editor exists below materials.
- 1440px dashboard: Pipeline pulse precedes filters; metric numerals dominate; rows retain posting/stage/next move/focus/updated detail without clipping.
- 760px: table becomes labelled cards; filters remain one horizontal scroll row; dialogs fit; secondary actions live in More.
- 320px: no page-level horizontal overflow; form controls/actions are full width; wide dialogs are near-full-height with internal scrolling and visible footer actions.
- Keyboard: `/`, `N`, menu arrows/Home/End/Escape, dialog Tab wrap/Escape/restoration, and error-summary focus are perceivable.
- Light/dark: text, borders, tinted cards, danger/warning/success, focus rings, and disabled states remain distinguishable.
- Reduced motion: no transform entry/exit is perceivable and keyboard openings have no animation.

## Decisions

- Preserve the existing visual language rather than replace it.
- Use modal dialogs, not drawers or below-fold panels.
- Use existing atomic `initialTask` support for both opportunity types.
- Linked-job mode omits first-task controls and unwraps the job payload for the unchanged linked endpoint.
- Keep analytics compact and actionable; no chart library.
- User delegated proposal approval to Root Sol for this goal.

## Open decisions

None.
