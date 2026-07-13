# Attention Context Handoff Specification

## Problem

The dashboard correctly identifies opportunities that need attention, but clicking an attention item opens the ordinary opportunity detail page without preserving why the user arrived. The attention model already knows the reason and, for due work, the task title; the dashboard hides that title, the link drops the task identity, and the detail page gives its strongest hierarchy to the normal record header and activity column.

The user must remember the dashboard signal and scan the narrow Actions rail to infer what to do. This breaks recognition over recall and makes the “Needs attention” promise feel unreliable even though the required action exists.

## User outcomes

1. Before clicking, the user can read the action that requires attention rather than only the opportunity name.
2. After clicking, the user can answer “Why am I here?” and “What can I do next?” within two seconds without scanning the page.
3. A due or overdue task can be completed directly from the contextual arrival surface, while all existing task options remain available in the Actions card.
4. An opportunity with no next action gives the user an immediate “Set next action” path.
5. Stale, completed, cancelled, rescheduled, malformed, and direct-link visits remain safe and understandable.

## Scope

- Make dashboard attention items action-first and include explicit task identity in the attention model.
- Carry attention kind and optional task ID through bookmarkable URL search parameters.
- Add an entry-aware contextual attention surface between the detail header and workspace.
- Validate attention state against the freshly fetched opportunity detail before presenting it as active.
- Highlight and focus the corresponding task when the user chooses to review its full options.
- Announce successful task mutations consistently.
- Add responsive, keyboard, reduced-motion, and touch-size contracts for the new surfaces.
- Add focused unit, component, route-boundary, integration, and static CSS coverage.

## Non-goals

- No dedicated attention queue or guided-execution mode.
- No permanent redesign of every opportunity detail page.
- No database schema, migration, storage, API route, dependency, authentication, or authorization change.
- No task-title editing or new task actions.
- No automatic submission, external messaging, application submission, credential use, or master-resume changes.
- No animation framework or decorative attention motion.

## Current-state evidence

- `src/lib/dashboard.ts` derives a specific `DashboardAttentionItem.actionLabel`, `kind`, due date, and composite ID from `OpportunitySummary.nextOpenTask`, but exposes no explicit `taskId`.
- `src/components/AttentionQueue.tsx` renders the opportunity label and urgency copy, omits `actionLabel`, and links only to `/opportunities/:id`.
- `src/app/opportunities/[id]/page.tsx` accepts only the record ID and passes no arrival context into the client page.
- `src/components/OpportunityDetailPage.tsx` renders Activity history in the wide main column and the Actions card in the narrow side rail. “Record interaction” remains the primary header action regardless of attention origin.
- `src/components/OpportunityTaskList.tsx` already provides the correct task action hierarchy, including Complete, Cancel, and Reschedule, but has no target-row or attention-arrival contract.
- `src/components/AttentionQueue.test.tsx` covers empty and loading states only. Existing detail tests provide strong conventions for async fetches, pending mutations, focus restoration, stale results, and status announcements.

## Proposed behavior

### Action-first dashboard items

Each attention pill uses this hierarchy:

1. Primary: exact action title (`actionLabel`), such as “Look into why they have not responded to my email.”
2. Secondary: opportunity label plus urgency, such as “Lead AI Strategy · Due today.”

Missing-next-action items use “Set a next action” as the primary copy and “<opportunity> · Plan next move” as the secondary copy.

The full accessible link name includes both the action and opportunity context. Pills remain compact but have a minimum 44px target, allow a wider action-first label than the current 250px cap, and preserve ellipsis for extreme content.

### Explicit attention navigation contract

`DashboardAttentionItem` becomes a discriminated union rather than an independent `kind` plus nullable ID:

- `kind: "task"` always has the source task ID.
- `kind: "missing_next_action"` always has `taskId: null`.

The shared link input enforces the same invariant:

```ts
export type AttentionLinkTarget =
  | { kind: "task"; opportunityId: string; taskId: string }
  | { kind: "missing_next_action"; opportunityId: string; taskId: null };
```

Links use these search parameters:

```text
/opportunities/<opportunityId>?attention=task&taskId=<encodedTaskId>
/opportunities/<opportunityId>?attention=missing_next_action
```

The shared target type is:

```ts
export type AttentionTarget =
  | { kind: "task"; taskId: string }
  | { kind: "missing_next_action" };
```

`src/lib/opportunity-attention.ts` owns:

```ts
export type AttentionSearchParams = Record<string, string | string[] | undefined>;
export function buildAttentionHref(item: AttentionLinkTarget): string;
export function parseAttentionTarget(searchParams: AttentionSearchParams): AttentionTarget | null;
export function resolveAttentionContext(
  detail: OpportunityDetail,
  target: AttentionTarget,
  today: string
): ResolvedAttentionContext;
```

Unknown attention values and array-valued `attention` values parse to `null`. Task attention also rejects missing, empty, or array-valued task IDs. Missing-next-action attention rejects any extraneous `taskId`, including scalar and array values. Invalid targets behave like ordinary direct visits. Search parameters remain in browser history and bookmarks; the page does not rewrite or delete them.

`buildAttentionHref` accepts only the discriminated `AttentionLinkTarget`; it also rejects an empty task ID at runtime as a controlled developer-invariant failure instead of emitting a malformed attention URL.

### Authoritative attention resolution

The detail fetch remains authoritative. `resolveAttentionContext` returns one of:

```ts
export type ResolvedAttentionContext =
  | { state: "active_task"; task: OpportunityTask; isOverdue: boolean }
  | { state: "missing_next_action" }
  | { state: "resolved" };
```

A task target is active only when the fetched opportunity is still attention-eligible (not rejected, archived, dormant, or closed), the detail contains that task, `task.opportunityId` equals `detail.id`, its state is `open`, it has a due date, and the due date is today or earlier. A terminal opportunity or completed, cancelled, missing, wrong-owner, undated, or future-rescheduled task resolves to `state: "resolved"`.

A missing-next-action target is active only when the fetched opportunity has no open tasks and its current type/status still requires forward motion under the same rules used by dashboard insights. Otherwise it resolves to `state: "resolved"`.

No visit mutates persistence. Ordinary `/opportunities/:id` visits have no target and render no contextual surface.

### Contextual attention surface

When the target is active, a full-width contextual section renders immediately after the detail command header and before the two-column workspace. Each attention key is consumed by its first authoritative resolution after the detail fetch: if that first resolution is active, the section receives programmatic focus once with `preventScroll: true`; if it is already resolved, it remains passively unfocused even if later task mutations make the same URL target active. Ordinary detail visits never receive this focus movement.

For a task:

- Eyebrow: “Needs attention today” or “Needs attention · Overdue”.
- Heading: exact task title.
- Supporting copy: the due-today or overdue date; the record header immediately above supplies opportunity context.
- Primary button: Complete, wired to the existing task mutation path and pending lock.
- Secondary button: Review options, which focuses the matching task row in the Actions card.

For a missing next action:

- Eyebrow: “Needs attention”.
- Heading: “No next action is planned”.
- Supporting copy: “Decide what should happen next.”
- Primary button: Set next action, opening the existing compact task dialog with its normal focus and restoration behavior.

The surface is a named section with a real `h2`, not an alert. It uses semantic text in addition to color. It does not animate.

### Targeted Actions card

`OpportunityTaskList` accepts `attentionTaskId?: string | null`. The matching task row gains:

- Stable ID `opportunity-task-<taskId>`.
- `tabIndex={-1}` so Review options can move focus to it.
- A persistent `task-item--attention` class while the URL target is active.

The Actions section gains stable ID `opportunity-actions` and `tabIndex={-1}` for the resolved-state fallback. Existing ordering, Complete/Cancel/Reschedule controls, history disclosure, headings, and touch targets remain unchanged.

### Resolved or stale target

If a syntactically valid URL target no longer represents active attention, the page renders a neutral contextual notice in the same arrival location:

- Heading: “This attention item is no longer active”.
- Supporting copy: “It may have been completed, cancelled, or rescheduled.”
- Secondary action: Review current actions, which focuses the Actions section.

This state is non-blocking and performs no mutation. A stale arrival is not programmatically focused and consumes its one-time arrival key, so a later resolved-to-active transition cannot steal focus. The resolved section remains programmatically focusable so a successful Complete initiated inside the contextual surface can move focus to the replacement notice after React removes the focused button. This distinguishes safe post-action focus continuity from passive stale-arrival behavior.

### Mutation feedback

Successful task mutations expose these polite status messages:

- Complete: “Action completed”.
- Cancel: “Action cancelled”.
- Reschedule: “Action rescheduled”.
- Reopen: “Action reopened”.

When the targeted task stops meeting attention rules, the contextual surface recomputes from updated detail and becomes the neutral resolved notice. If Complete was initiated from the contextual surface, focus moves to that resolved notice after the authoritative response renders; ordinary stale arrivals remain unfocused. Failure preserves the active surface, leaves the draft due date intact, preserves focusable controls, and exposes the existing page error alert.

The complete, cancel, reschedule, and reopen paths all use a single tested action-to-status mapping, with the Complete path additionally covered through the contextual surface integration.

### Navigation lifecycle

If the optional attention target disappears and later returns through browser history, it is treated as a new arrival and receives the same first-resolution focus behavior. If `opportunityId` changes without a full client remount, the page immediately clears the old detail/attention surface and every open dialog/draft/error/status, resets every submitting ref and pending indicator, invalidates detail, dialog/destructive, task, and status result generations, and fetches the new opportunity. Late success or failure from the previous opportunity's detail, task, dialog, status, archive, or delete request cannot overwrite, refocus, close, show feedback on, or navigate away from the new record.

## Architecture and file responsibilities

- `src/lib/dashboard.ts`: derives attention items and explicit task IDs; imports the shared eligibility and forward-motion rules.
- `src/lib/opportunity-attention.ts`: pure shared attention eligibility, URL parsing/building, forward-motion rules, and fresh-detail resolution. No React, Next.js runtime, storage, or network dependencies.
- `src/components/AttentionQueue.tsx`: action-first rendering and target-aware links.
- `src/app/opportunities/[id]/page.tsx`: sanitizes asynchronous Next.js search parameters with the pure parser and passes an optional target.
- `src/components/OpportunityAttentionBanner.tsx`: pure contextual presentation and callbacks.
- `src/components/OpportunityDetailPage.tsx`: fetch/mutation orchestration, navigation-generation guards, arrival/post-action focus, banner callbacks, and success announcements.
- `src/components/OpportunityTaskList.tsx`: stable focus targets and targeted-row semantics without changing task ordering or mutations.
- `src/app/globals.css`: dashboard pill, contextual surface, target-row, responsive, focus, and touch styling.

## Data and persistence

No persisted data changes. Task IDs, titles, due dates, states, and opportunity ownership already exist in `OpportunityDetail`. Search parameters contain only opaque local record/task identifiers and the attention kind; task titles are not placed in URLs.

The existing task PATCH endpoint remains authoritative for completion, cancellation, rescheduling, and reopening. Its wrong-owner, not-found, and validation behavior is unchanged.

## Accessibility and input methods

- Preserve the dashboard attention section label and real link semantics.
- Give the contextual section a stable `aria-labelledby` relationship and real `h2`.
- Programmatically focus only active URL-targeted arrivals and only after detail data is available.
- After Complete removes the focused contextual button, move focus to the rendered resolved notice; do not focus passive stale arrivals.
- Review options moves keyboard focus to a named task row; Review current actions moves it to the named Actions section.
- Preserve native buttons, date input, headings, details/summary, modal focus trap, Escape, and restoration behavior.
- All new pressable controls and attention links are at least 44px tall.
- Focus indicators remain visible and are not clipped.
- Dashboard attention links use an inset focus treatment because their horizontal container clips overflow.
- No color-only urgency or resolved state.
- No keyboard-triggered animation, `transition: all`, scale-from-zero, or ungated hover transform.
- Existing `prefers-reduced-motion` and fine-pointer rules remain intact.

## Failure paths

- **Unknown or malformed query:** ignore it and render the ordinary detail page.
- **Extraneous task parameter:** reject `taskId` on missing-next-action URLs and render the ordinary detail page.
- **Valid but stale task target:** render the neutral resolved notice; never call PATCH.
- **Task belongs to another opportunity:** it is absent from fetched detail and resolves neutrally.
- **Task completed/cancelled in another tab:** fresh detail resolves neutrally.
- **Task rescheduled into the future:** updated detail resolves neutrally after success.
- **Opportunity becomes terminal:** rejected, archived, dormant, or closed detail resolves neutrally even if it still contains an open due task.
- **Task mutation failure:** retain the active banner and target highlight; show the page error alert.
- **Opportunity fetch failure:** retain the current full-page fetch error behavior; do not render a misleading attention surface.
- **Missing-next-action becomes stale:** if an open task now exists or status no longer requires forward motion, render the neutral resolved notice.
- **Direct/legacy links:** render exactly the current generic detail behavior.
- **Client navigation to another opportunity:** clear prior detail, dialogs/drafts, errors/status, and all pending mutation state before the new fetch; ignore both successful and failed late prior-opportunity detail, task, dialog, status, archive, and delete responses, including navigation callbacks.
- **Browser back to the same target:** reset the one-time focus guard while the target is absent, then focus the active contextual surface when it returns.

## Security, privacy, compatibility, and rollback

- No credentials, private-document paths, application artifacts, task titles, or user-authored HTML enter the URL.
- React text escaping remains authoritative for labels and task titles.
- No external request or public-sharing behavior is added.
- Existing URLs remain compatible because all search parameters are optional.
- Query parsing rejects ambiguous array values, missing/empty task IDs, and extraneous task IDs instead of choosing or ignoring one silently.
- The change is additive UI/client orchestration and can be rolled back by reverting its commit range; no data rollback is required.

## Acceptance criteria

1. A populated task attention item displays `actionLabel` before the opportunity label and links with `attention=task` plus its encoded explicit `taskId`.
2. A missing-next-action item displays “Set a next action” and links with `attention=missing_next_action` and no task ID.
3. Attention links and new contextual controls have at least 44px targets; the dashboard link uses an unclipped inset focus indicator.
4. A valid due-today or overdue task target renders and focuses the contextual surface after detail fetch, before Activity history.
5. The contextual task surface exposes the exact task title, due state, Complete, and Review options.
6. Review options focuses the matching targeted task row without changing task ordering.
7. Complete uses the existing PATCH route, respects the pending lock, announces “Action completed,” converts the surface to the neutral resolved state, and moves focus to that replacement notice after success.
8. A valid missing-next-action target renders “No next action is planned,” opens the existing Add task dialog through Set next action, and restores focus to that trigger on cancel.
9. Terminal opportunities plus completed, cancelled, missing, wrong-owner, undated, and future-rescheduled task targets render the neutral resolved notice and never mutate on arrival.
10. Unknown, array-valued, missing, empty, and extraneous query values plus ordinary direct visits render no contextual surface and preserve current behavior.
11. The route boundary passes valid targets and drops malformed targets; pure resolution covers cancelled, undated, future, missing, and explicit wrong-owner tasks.
12. Complete is integration-tested; cancel, reschedule, and reopen status copy is covered by the shared mapping; failed rescheduling retains the entered date and active attention state.
13. A stale target consumes its initial focus opportunity even if it later becomes active; removing and restoring the same attention prop starts a new arrival; changing opportunity ID clears stale UI, dialogs, drafts, and every pending lane, then ignores late success/failure from detail, task, dialog, status, archive, and delete requests/navigation.
14. All existing task ordering, rescheduling, modal, focus-restoration, error, and responsive contracts continue to pass.
15. No schema, migration, storage, API route, dependency, private-file, or master-resume change is present.
16. Focused tests, `npm run verify`, and `npm run build` pass.
17. A deterministic Sol final reviewer reports no blocking findings before Goal completion.

## Verification

```bash
npm test -- --run src/lib/dashboard.test.ts src/lib/opportunity-attention.test.ts src/components/AttentionQueue.test.tsx src/components/OpportunityAttentionBanner.test.tsx src/components/OpportunityTaskList.test.tsx src/components/OpportunityDetailPage.test.tsx 'src/app/opportunities/[id]/page.test.tsx' src/app/globals.test.ts
npm run verify
npm run build
```

Manual localhost acceptance:

- Desktop dashboard: action title is the attention pill's primary line; opportunity and urgency remain scannable.
- Desktop detail from a due task: the contextual surface is visible without scrolling and Activity history no longer competes with the arrival reason.
- Keyboard: activate an attention link, confirm focus lands on the contextual surface, then use Review options and confirm focus reaches the matching task row.
- Contextual Complete: confirm a pending request cannot be submitted twice and successful completion moves focus to the replacement resolved notice.
- Missing-next-action: Set next action opens the existing compact dialog and restores focus correctly on cancel.
- Stale URL: completed, cancelled, missing, and future-rescheduled task URLs show the neutral notice and issue no mutation.
- Navigation lifecycle: remove/restore the same attention target and change opportunity IDs without a remount while task, dialog, status, and delete requests are pending; confirm focus returns only for the restored active arrival and no old result, modal, or redirect reappears.
- 760px and 320px: contextual content/actions stack without horizontal overflow; all controls remain at least 44px.
- Light/dark/reduced motion: text, borders, urgency, resolved state, and focus remain distinguishable; no arrival motion occurs.

## Material decisions and tradeoffs

- Choose the contextual handoff rather than a permanent record redesign or full triage queue; this fixes the observed failure with bounded scope.
- Duplicate only the targeted task's title and Complete action in the arrival surface. The existing Actions card remains the single place for Cancel and Reschedule, avoiding duplicate editable date state.
- Keep search parameters after resolution so browser history and bookmarks remain stable; the neutral resolved notice explains the stale target.
- Use fresh detail data, not URL claims, to decide whether attention is active.
- Use explicit `taskId` instead of parsing the composite display ID.
- Add no attention animation; hierarchy, copy, focus, and placement provide the signal.

## Open decisions

None.
