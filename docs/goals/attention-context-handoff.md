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
- Owner: external `terra-worker` process
- Write set: `src/lib/opportunity-attention.ts`, `src/lib/opportunity-attention.test.ts`, `src/lib/dashboard.ts`, `src/lib/dashboard.test.ts`, `src/components/AttentionQueue.tsx`, `src/components/AttentionQueue.test.tsx`
- Status: complete
- Commit range: `93789fa1e6a678c82e6dad5309088906b74a26c2..bde08143ddcff613dc99a0a0dbb1f975b4a5f036`
- Tests: TDD red confirmed; focused suite passed 3 files / 12 tests; full suite passed 25 files / 264 tests; `npm run typecheck` passed; `git diff --check` passed.
- Review: initial Sol review identified the final 44px CSS guarantee as Important; controller verified the approved plan assigns that exact test and implementation to ACH-4's exclusive write set. Fresh Sol re-review approved ACH-1 with no Critical, Important, or Minor findings and retained the 44px requirement as ACH-4/final-acceptance residual risk.
- Terra routing: dispatch `ach1-terra-implement-1`; prompt `<user-home>/<local-orchestration-output>/jobtracker-attention-20260713/ach1-terra-worker.prompt.md`; report `<user-home>/<local-orchestration-output>/jobtracker-attention-20260713/ach1-terra-worker.report.md`; requested/observed `gpt-5.6-terra`; role `terra-worker`; effort `medium`; sandbox `workspace-write`; phase verified; telemetry reported; exit 0; 580615 dispatch tokens; 192230ms.
- Sol review routing: dispatch `ach1-sol-review-1`; report `<user-home>/<local-orchestration-output>/jobtracker-attention-20260713/ach1-sol-review.report.md`; requested/observed `gpt-5.6-sol`; role `sol-reviewer`; effort `medium`; sandbox `read-only`; phase verified; telemetry reported; exit 0; 155678 dispatch tokens; 140204ms.
- Sol re-review routing: dispatch `ach1-sol-rereview-2`; report `<user-home>/<local-orchestration-output>/jobtracker-attention-20260713/ach1-sol-rereview.report.md`; requested/observed `gpt-5.6-sol`; role `sol-reviewer`; effort `medium`; sandbox `read-only`; phase verified; telemetry reported; exit 0; 169915 dispatch tokens; 54482ms.

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
- ACH-1's worker sandbox could not lock the common Git index or write a detailed report outside its workspace; the controller recovered the verified event evidence, reran deterministic checks, and created the scoped commit. No code blocker remained.
- The final 44px attention-link guarantee remains assigned to ACH-4 exactly as approved; it is not waived.
- No blockers.
