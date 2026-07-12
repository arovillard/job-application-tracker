# World-Class Opportunity Experience Implementation Plan

## Inputs and constraints

- Spec: `docs/specs/world-class-opportunity-experience.md`
- Baseline: `f1855f3c8f86f42188a172dfc01058af1e2e24dd`
- Screenshots: `<reference-input>/Screenshot 2026-07-12 at 7.42.06 AM.png`, `<reference-input>/Screenshot 2026-07-12 at 7.42.38 AM.png`
- Preserve model, storage, route paths, artifacts, themes, and brand.
- No dependencies, migrations, schema changes, generated artifacts, or browser automation.
- TDD; at most two disjoint writers; serialize CSS and destructive workflows.
- No `transition: all`, `ease-in`, `scale(0)`, keyboard animation, or ungated hover transform.

## Frozen cross-task interfaces

- `ModalProps.size?: "compact" | "wide"`; root class `modal modal--<size>`.
- `JobCreationPayload = { opportunity: JobOpportunityInput; initialTask: OpportunityTaskInput | null }`.
- `JobOpportunityForm.mode: "create" | "edit" | "linked"`; create renders first-task controls; edit/linked omit them. All emit `JobCreationPayload`; linked caller sends only `payload.opportunity`.
- `ConnectionOpportunityForm.mode: "create" | "edit"`; edit omits initial activity/task.
- `PipelinePulseProps = { opportunities: OpportunitySummary[]; attentionCount: number }`.
- `DetailSurface = "interaction" | "task" | "edit" | "linked-job" | "archive" | "delete" | null`.
- Frozen hooks for CSS: `pipeline-pulse*`, `detail-actions-menu*`, `detail-dialog*`, `next-action-card*`, `form-disclosure*`, `application-form__actions`.

## Waves

| Wave | Tasks | Rule |
| --- | --- | --- |
| 1 | WCE-1 | Immediate review |
| 2 | WCE-2 + WCE-3 | Two disjoint writers |
| 3 | WCE-4 | After WCE-3 |
| 4 | WCE-5 | After WCE-1/WCE-2 |
| 5 | WCE-6 | After WCE-5 |
| 6 | WCE-7 | High-risk, serialized |
| 7 | WCE-8 then WCE-9 | Shared CSS, serialized |
| 8 | WCE-10 | Root acceptance |

## Task 1 [WCE-1] Dialog primitive

**Spec:** Detail workspace; Accessibility; criteria 1-2.

**Outcome:** Compact/wide modal with focus and scroll safety.

**Write:** `src/components/Modal.tsx`, `src/components/Modal.test.tsx` (new).

**RED:** named dialog/size class; RAF initial focus; Tab last→first; Shift+Tab first→last; Escape/backdrop close once; unmount restores trigger; body overflow locks and restores exact prior value.

**GREEN:** add size prop/class; capture focus/overflow; retain title id; clean frame/listener/style.

**Check/evidence:** `npm test -- --run src/components/Modal.test.tsx && npm run typecheck`; all RED cases green, only owned files.

**Risk/review:** Medium shared primitive; immediate Sol review.

## Task 2 [WCE-2] Creation form contracts

**Spec:** Creation; Failure paths; Accessibility; criteria 4-5.

**Outcome:** Identity/next-move/optional-details hierarchy, native semantics, modes, and atomic first task.

**Write:** `src/components/JobOpportunityForm.tsx`, `ConnectionOpportunityForm.tsx`, `NewOpportunityPage.tsx`, `NewOpportunityPage.test.tsx`, `OpportunityForms.test.tsx` (new).

**RED:** create disclosure closed; collapsed values persist; populated edit opens; invalid hidden URL opens/focuses; required/helper associations; conditional applied date and Wishlist→`null`; create job wrapper with task; edit/linked omit task UI but emit wrapper; connection create preserves ISO activity/task; connection edit omits creation groups; top-level POST sends wrapper; failed POST focuses alert summary.

**GREEN:** mode props/types; controlled details; intro/planning/actions; optional Cancel; New page submits wrapper.

**Check/evidence:** `npm test -- --run src/components/NewOpportunityPage.test.tsx src/components/OpportunityForms.test.tsx && npm run typecheck`; both types and failure semantics green.

**Risk/review:** Medium contract; individual review before WCE-5.

## Task 3 [WCE-3] Pipeline pulse leaf

**Spec:** Dashboard; Information hierarchy; criterion 6.

**Outcome:** Pure mixed-pipeline summary.

**Write:** `src/components/PipelinePulse.tsx` (new), `PipelinePulse.test.tsx` (new).

**RED:** active excludes terminal/archived; job/connection/attention/closed counts; proportional widths; zero-active neutral bar; visual bar aria-hidden and labels textual.

**GREEN:** derive counts from props; stable hooks and semantic heading.

**Check/evidence:** `npm test -- --run src/components/PipelinePulse.test.tsx && npm run typecheck`; mixed/zero fixtures green.

**Risk/review:** Low; batch with WCE-4.

## Task 4 [WCE-4] Dashboard/table state integration

**Spec:** Dashboard; Failure paths; criteria 6-8. **Depends:** WCE-3.

**Outcome:** Pulse, retry, contextual empties, posting link, and table semantics with existing workflows preserved.

**Write:** `src/components/Dashboard.tsx`, `Dashboard.test.tsx`, `OpportunityTable.tsx`, `OpportunityTable.test.tsx`.

**RED:** load error suppresses pulse/attention/controls/table; Retry clears/error→loading→data or latest error; mutation error keeps data; search/filter empty copy and Clear filters; pulse props; safe posting link; `scope=col`; preserve unique links, status sets, sort, filter reset, PATCH, pending lock, undo, loading semantics.

**GREEN:** split load/mutation errors; reusable load callback; contextual empty action; pulse only after successful load.

**Check/evidence:** `npm test -- --run src/components/PipelinePulse.test.tsx src/components/Dashboard.test.tsx src/components/OpportunityTable.test.tsx && npm run typecheck`; retry and preserved contracts green.

**Risk/review:** Medium state integration; review WCE-3/4 wave.

## Task 5 [WCE-5] Non-destructive detail dialogs

**Spec:** Detail workspace; Creation; Failure paths; criteria 1-3. **Depends:** WCE-1/WCE-2.

**Outcome:** Interaction/task/edit/linked-job actions open immediate dialogs and secondary actions use an accessible menu.

**Write:** `src/components/OpportunityDetailPage.tsx`, `OpportunityDetailPage.test.tsx`, `DetailActionsMenu.tsx` (new), `DetailActionsMenu.test.tsx` (new).

**RED:** two primary buttons; More menu Arrow/Home/End/Escape/outside; Edit/linked items; one named compact/wide dialog outside `.detail-grid`; cancel closes/restores/resets; failed mutation preserves dialog/draft + alert; success closes/status-announces; connection edit mode; linked mode and linked POST receives `payload.opportunity` only; type-specific snapshot title/link.

**GREEN:** discriminated `DetailSurface`; Modal; isolated drafts; remove appended panels; success status; unchanged APIs.

**Check/evidence:** `npm test -- --run src/components/Modal.test.tsx src/components/OpportunityDetailPage.test.tsx src/components/DetailActionsMenu.test.tsx && npm run typecheck`; long-artifact fixture proves no below-grid editor.

**Risk/review:** Medium central orchestration; immediate review.

## Task 6 [WCE-6] Next-action/task hierarchy

**Spec:** Information hierarchy; criterion 9. **Depends:** WCE-5.

**Outcome:** Earliest open task is primary; remaining/history tasks are available but secondary.

**Write:** `src/components/OpportunityTaskList.tsx`, `OpportunityTaskList.test.tsx` (new), `OpportunityDetailPage.tsx`, `OpportunityDetailPage.test.tsx`.

**RED:** dated before undated; overdue/due/no-date; no-task CTA; primary not duplicated; remaining opens visible; history collapsed; complete/cancel/reschedule/reopen endpoints and pending disable preserved.

**GREEN:** explicit primary task selector/prop; unchanged mutation contract; separate card/panel.

**Check/evidence:** `npm test -- --run src/components/OpportunityTaskList.test.tsx src/components/OpportunityDetailPage.test.tsx && npm run typecheck`; ordered fixtures green.

**Risk/review:** Medium; batch before CSS.

## Task 7 [WCE-7] Destructive safety

**Spec:** Detail workspace; Failure paths; Security/rollback; criteria 1-2. **Depends:** WCE-5. Serialized.

**Outcome:** Archive/delete live in More, use named confirmation, lock duplicates, preserve failures, and navigate only after success.

**Write:** `src/components/OpportunityDetailPage.tsx`, `OpportunityDetailPage.test.tsx`, `DetailActionsMenu.tsx`, `DetailActionsMenu.test.tsx`.

**RED/adversarial:** record/action named; danger delete; Cancel restores; confirm pending lock; double activation = one request; failure keeps dialog + alert; archive success updates without navigation; delete success navigates once; late response cannot act after unmount; no `window.confirm`.

**GREEN:** reuse surface; separate pending ref/state; active guard; unchanged endpoints/helper.

**Rollback:** no data contract change; reverting commit restores UI without migration.

**Check/evidence:** `npm test -- --run src/components/OpportunityDetailPage.test.tsx src/components/DetailActionsMenu.test.tsx && npm run typecheck`; adversarial cases green.

**Risk/review:** High destructive operation; immediate Sol review before CSS.

## Task 8 [WCE-8] Form/dialog/detail visuals

**Spec:** Visual baseline; Creation; Detail; Accessibility; criteria 10-12. **Depends:** WCE-5/6/7.

**Outcome:** Screenshot-aligned form/detail hierarchy, responsive dialogs, sticky mobile actions, polished menu/next action.

**Write:** `src/app/globals.css`, `src/app/globals.test.ts`.

**RED:** centred narrow form/card geometry; tinted planning; disclosure row; compact/wide max sizes and internal scroll; 320px near-full-height; sticky mobile footer; anchored menu; wide-main/narrow-rail grid; next-action tint; forbidden motion checks.

**GREEN:** style frozen hooks only; preserve tokens/themes; pointer-only opacity/translate where useful; keyboard no animation.

**Check/evidence:** `npm test -- --run src/app/globals.test.ts && npm run typecheck`; selector-scoped media/motion contracts green.

**Risk/review:** Medium shared CSS; review before WCE-9.

## Task 9 [WCE-9] Dashboard/table/status/timeline visuals

**Spec:** Visual baseline; Dashboard; Information hierarchy; criteria 6-12. **Depends:** WCE-4/WCE-8.

**Outcome:** Metric hierarchy, rich rows, complete semantic colors, contextual states, and stable mobile filters/cards.

**Write:** `src/app/globals.css`, `src/app/globals.test.ts`.

**RED:** pulse grid/numerals/bar/zero; retry/empty surfaces; posting link; every connection stage selector; note/message/email/call/meeting/introduction + system/default markers; mobile rail cascade; 760px cards; 320px no fixed minimum; dark tokens; motion gates.

**GREEN:** extend tokens/selectors only; no chart/animation dependency.

**Check/evidence:** `npm test -- --run src/app/globals.test.ts && npm run typecheck`; exact selector/mobile ownership green.

**Risk/review:** Medium shared visual integration; review WCE-8/9 wave.

## Task 10 [WCE-10] Acceptance/handoff

**Spec:** All criteria/manual procedure. **Depends:** WCE-1..9.

**Nominal write:** `docs/goals/world-class-opportunity-experience.md`. Review fixes return to owning explicit write sets. Generated `next-env.d.ts` restoration is cleanup, not output.

**Checks:**

```bash
npm test -- --run src/components/Modal.test.tsx src/components/NewOpportunityPage.test.tsx src/components/OpportunityForms.test.tsx src/components/Dashboard.test.tsx src/components/PipelinePulse.test.tsx src/components/OpportunityTable.test.tsx src/components/OpportunityDetailPage.test.tsx src/components/DetailActionsMenu.test.tsx src/components/OpportunityTaskList.test.tsx src/app/globals.test.ts
npm run verify
npm run build
git diff --check
```

**Acceptance:** Root scope audit; final reviewer; one consolidated fix/re-review; fresh checks. Ledger records localhost URL and exact 1440/760/320/keyboard/theme/reduced-motion expected outcomes. Codex explicitly records that manual observations are user-owned and not browser-verified.

**Risk/review:** Aggregate branch; `sol-final-reviewer`.
