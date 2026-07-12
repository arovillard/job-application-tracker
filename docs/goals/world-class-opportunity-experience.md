# World-Class Opportunity Experience Goal

## Objective

Execute `docs/specs/world-class-opportunity-experience.md` through `docs/plans/world-class-opportunity-experience.md` with deterministic non-browser verification and final Sol acceptance.

## Worktree

- Path: `<isolated-worktree>/opportunity-leads`
- Branch: `codex/opportunity-leads`
- Approved artifacts commit: `067b067`
- Token budget: none specified

## Tasks

| Task | Dependencies | Status | Evidence |
| --- | --- | --- | --- |
| WCE-1 Dialog primitive | none | complete | `6820b83..9c69802`; 10 tests; Sol approved |
| WCE-2 Creation forms | none | complete | `f3f4152..e5ec6e0`; 18 tests; Sol approved |
| WCE-3 Pipeline pulse | none | implemented | `10ea564`; 2 tests; review with WCE-4 |
| WCE-4 Dashboard/table state | WCE-3 | in progress | pending |
| WCE-5 Detail dialogs | WCE-1, WCE-2 | pending | pending |
| WCE-6 Task hierarchy | WCE-5 | pending | pending |
| WCE-7 Destructive safety | WCE-5 | pending | pending |
| WCE-8 Form/detail visuals | WCE-5, WCE-6, WCE-7 | pending | pending |
| WCE-9 Dashboard visuals | WCE-4, WCE-8 | pending | pending |
| WCE-10 Acceptance | WCE-1..9 | pending | pending |

## Decisions

- Root Sol holds delegated approval.
- No browser automation; user owns the explicit localhost visual pass.
- Linked-job mode omits first-task controls and unwraps `payload.opportunity`.
- Destructive workflows remain a separate High-risk reviewed task.

## Verification

- Baseline from prior completed goal: `npm run verify` passed 15 files / 83 tests; `npm run build` passed.
- Current goal evidence: pending.
