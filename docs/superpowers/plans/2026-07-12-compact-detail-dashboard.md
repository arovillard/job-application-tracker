# Compact Detail and Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Compact dashboard/detail hierarchy and redesign the primary next-action card without changing behavior.

**Architecture:** Add narrow presentation hooks to existing React components and style them through current tokens. Preserve task/status data flow; component and CSS tests own the new contract.

**Tech Stack:** Next.js, React, TypeScript, CSS, Vitest.

## Global Constraints

- No dependencies, APIs, persistence changes, or animation.
- Preserve themes, keyboard behavior, and 44px controls.

---

### Task 1: Compact hierarchy

**Files:** `src/components/Dashboard.tsx`, `src/components/Dashboard.test.tsx`, `src/components/OpportunityDetailPage.tsx`, `src/app/globals.css`, `src/app/globals.test.ts`

- [x] Add `pipeline-title-lockup` and `detail-shell` hooks.
- [x] Assert and style compact desktop/responsive spacing.

### Task 2: Redesign Next action

**Files:** `src/components/OpportunityTaskList.tsx`, `src/components/OpportunityTaskList.test.tsx`, `src/app/globals.css`, `src/app/globals.test.ts`

- [x] Separate primary task content, immediate actions, and rescheduling.
- [x] Assert semantic structure and responsive ownership.

### Task 3: Acceptance

- [x] Run focused tests, lint, and typecheck only with explicit verification permission.
- [x] Compare desktop output with supplied screenshots.
