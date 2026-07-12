# Dashboard Main-Branch Reconciliation Goal

## Objective

Reconcile the opportunities dashboard with the visual quality and information hierarchy of the approved main-branch baseline while preserving mixed job and connection workflows.

## Approved inputs

- Specification: `docs/specs/dashboard-main-branch-reconciliation.md`
- Plan: `docs/plans/dashboard-main-branch-reconciliation.md`
- Visual baseline: main commit `f1855f3c8f86f42188a172dfc01058af1e2e24dd`

## Execution status

- [x] DMR-1 creation menu semantics
- [x] DMR-2 dashboard chrome and filter hierarchy
- [x] DMR-3 mixed opportunity table fidelity
- [x] DMR-4 shared responsive CSS integration
- [x] Focused checks and risk reviews
- [x] Full non-browser verification
- [ ] Final whole-branch review
- [ ] User-owned localhost visual acceptance handoff

## Verification boundary

Codex will use component tests, static DOM/CSS assertions, type checks, and production build checks. Browser automation is intentionally excluded; final visual acceptance belongs to the user on localhost.

## Verification evidence

- `npm run verify`: passed (15 files, 83 tests; ESLint and TypeScript passed)
- `npm run build`: passed
- Focused component and stylesheet suites: passed
- DMR-1 review: approved with no findings
- DMR-2/DMR-3 review: test gaps fixed and re-approved
- DMR-4 review: approved; mobile CSS contract strengthened afterward
- Browser automation: not run by user request
