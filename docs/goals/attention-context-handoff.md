# Attention Context Handoff Goal Ledger

## Native Goal

- Objective: Implement the approved Attention Context Handoff specification and plan end to end, including four task waves, deterministic checks, per-task Sol reviews, full verification, and final Sol acceptance.
- Status: active
- Token budget: none supplied
- Activation confirmed: 2026-07-13

## Approved artifacts

- Specification: `docs/specs/attention-context-handoff.md`
- Plan: `docs/plans/attention-context-handoff.md`
- Approval artifact commit: `36aacda80a5e01daea951d852f52a60a27a457bc`
- Worktree: `<isolated-worktree>/attention-context`
- Branch: `codex/attention-context`
- Baseline: `npm install` completed with 0 vulnerabilities; `npm test -- --run` passed 24 files and 257 tests.

CLI-routed agents below are independent external processes. Their usage is not guaranteed to be included in native Goal token accounting.

## Tasks

### ACH-1 — Attention domain and action-first dashboard navigation

- Dependencies: none
- Owner: pending Terra worker
- Write set: `src/lib/opportunity-attention.ts`, `src/lib/opportunity-attention.test.ts`, `src/lib/dashboard.ts`, `src/lib/dashboard.test.ts`, `src/components/AttentionQueue.tsx`, `src/components/AttentionQueue.test.tsx`
- Status: in progress
- Tests: pending
- Review: pending
- Routing: pending

### ACH-2 — Contextual presentation and targetable task rows

- Dependencies: ACH-1 approved
- Owner: unassigned
- Write set: `src/components/OpportunityAttentionBanner.tsx`, `src/components/OpportunityAttentionBanner.test.tsx`, `src/components/OpportunityTaskList.tsx`, `src/components/OpportunityTaskList.test.tsx`
- Status: pending

### ACH-3 — Route and detail-page attention orchestration

- Dependencies: ACH-1 and ACH-2 approved
- Owner: unassigned
- Write set: `src/app/opportunities/[id]/page.tsx`, `src/app/opportunities/[id]/page.test.tsx`, `src/components/OpportunityDetailPage.tsx`, `src/components/OpportunityDetailPage.test.tsx`
- Status: pending

### ACH-4 — Responsive visual integration and acceptance suite

- Dependencies: ACH-2 and ACH-3 approved
- Owner: unassigned
- Write set: `src/app/globals.css`, `src/app/globals.test.ts`
- Status: pending

## Final acceptance

- Focused suite: pending
- `npm run verify`: pending
- `npm run build`: pending
- Privacy/scope inspection: pending
- Sol final review: pending

## Decisions and blockers

- Implementation writers are serialized.
- No schema, storage, API route, dependency, authentication, authorization, private-file, application-submission, or master-resume change is authorized.
- No blockers.
