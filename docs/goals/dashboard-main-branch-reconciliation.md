# Dashboard Main-Branch Reconciliation Goal

## Objective

Reconcile the opportunities dashboard with the visual quality and information hierarchy of the approved main-branch baseline while preserving mixed job and connection workflows.

## Approved inputs

- Specification: `docs/specs/dashboard-main-branch-reconciliation.md`
- Plan: `docs/plans/dashboard-main-branch-reconciliation.md`
- Visual baseline: main commit `f1855f3c8f86f42188a172dfc01058af1e2e24dd`

## Execution status

- [ ] DMR-1 creation menu semantics
- [ ] DMR-2 dashboard chrome and filter hierarchy
- [ ] DMR-3 mixed opportunity table fidelity
- [ ] DMR-4 shared responsive CSS integration
- [ ] Focused checks and risk reviews
- [ ] Full non-browser verification and final review
- [ ] User-owned localhost visual acceptance handoff

## Verification boundary

Codex will use component tests, static DOM/CSS assertions, type checks, and production build checks. Browser automation is intentionally excluded; final visual acceptance belongs to the user on localhost.
