# Resolved Attention Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the persistent resolved attention banner while preserving mutation feedback, safe focus, and understandable stale-link handling.

**Architecture:** Separate active attention presentation from a compact stale-arrival notice. Let the detail controller suppress and clear locally completed attention targets, derive stale-link copy from authoritative state until dismissal, and focus the existing Actions section after controls disappear.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Vitest/jsdom, existing CSS.

## Global Constraints

- Implement `docs/superpowers/specs/2026-07-19-resolved-attention-cleanup-design.md` exactly.
- Do not change persistence, task APIs, database schema, dependencies, or ordinary detail visits.
- Preserve existing live-region mutation messages and failure behavior.
- Do not add animation.

---

### Task 1: Specify the new interaction with failing tests

**Files:**
- Modify: `src/components/OpportunityAttentionBanner.test.tsx`
- Modify: `src/components/OpportunityDetailPage.test.tsx`

**Interfaces:**
- Consumes: existing attention target props, task PATCH flow, `#opportunity-actions`, and mocked Next router.
- Produces: regression coverage for URL cleanup, absent post-action banner, Actions focus, compact stale notice, and stale-notice dismissal.

- [ ] Replace the resolved-banner presentation assertion with an assertion that the active banner has no resolved rendering responsibility and that the compact notice has neutral copy and a Dismiss button.
- [ ] Change contextual completion and cancellation tests to expect `router.replace("/opportunities/opportunity-1", { scroll: false })`, no attention surface, the existing status message, and focus on `#opportunity-actions`.
- [ ] Change the stale-target test to expect a passive compact notice, URL replacement, and Actions focus after Dismiss.
- [ ] Run `npm test -- src/components/OpportunityAttentionBanner.test.tsx src/components/OpportunityDetailPage.test.tsx` and confirm failures describe the missing behavior.

### Task 2: Implement active-only banner and compact stale notice

**Files:**
- Modify: `src/components/OpportunityAttentionBanner.tsx`
- Modify: `src/components/OpportunityDetailPage.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- `OpportunityAttentionBanner` accepts only active-task or missing-next-action context.
- `OpportunityAttentionNotice` accepts `onDismiss: () => void` and renders the stale explanation.
- Successful contextual task actions clear attention navigation with `router.replace(path, { scroll: false })` and request focus for `#opportunity-actions`.

- [ ] Narrow the active banner context type and add the compact notice component.
- [ ] Replace resolved-banner focus refs with local suppression, stale-notice, and Actions-focus state.
- [ ] On successful contextual completion or cancellation, suppress the target, preserve the status update, replace the URL, and focus Actions after React commits.
- [ ] On an initially resolved target, render a passive stale notice; dismiss it, replace the URL, and focus Actions without an animation.
- [ ] Add only the compact notice layout styles needed to fit the existing visual system.
- [ ] Run the focused tests and confirm they pass.

### Task 3: Verify the complete branch

**Files:**
- Review only: all changed files.

**Interfaces:**
- Produces: verified implementation evidence.

- [ ] Run `npm run lint`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Inspect `git diff --check`, `git diff --stat`, and the final focused diff for unrelated changes.
