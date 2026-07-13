import { describe, expect, it } from "vitest";

import type { OpportunityDetail, OpportunityTask } from "../types";
import {
  buildAttentionHref,
  opportunityIsAttentionEligible,
  parseAttentionTarget,
  resolveAttentionContext
} from "./opportunity-attention";

const task = (overrides: Partial<OpportunityTask> = {}): OpportunityTask => ({
  id: overrides.id ?? "task/1",
  opportunityId: overrides.opportunityId ?? "opportunity 1",
  title: overrides.title ?? "Send follow-up",
  dueDate: overrides.dueDate ?? "2026-07-13",
  state: overrides.state ?? "open",
  sourceActivityId: null,
  completedAt: null,
  createdAt: "2026-07-01T12:00:00.000Z",
  updatedAt: "2026-07-01T12:00:00.000Z"
});

const detail = (tasks: OpportunityTask[]): Extract<OpportunityDetail, { type: "job" }> => ({
  id: "opportunity 1",
  type: "job",
  label: "Engineering Manager",
  organization: "Acme",
  status: "applied",
  priority: "medium",
  summary: null,
  originOpportunityId: null,
  url: null,
  source: null,
  location: null,
  contact: null,
  appliedDate: null,
  createdAt: "2026-07-01T12:00:00.000Z",
  updatedAt: "2026-07-01T12:00:00.000Z",
  activities: [],
  tasks,
  artifacts: [],
  origin: null,
  originatedJobs: []
});

describe("opportunity attention", () => {
  it("builds encoded task and missing-action URLs", () => {
    expect(buildAttentionHref({ kind: "task", opportunityId: "opportunity 1", taskId: "task/1" }))
      .toBe("/opportunities/opportunity%201?attention=task&taskId=task%2F1");
    expect(buildAttentionHref({ kind: "missing_next_action", opportunityId: "opportunity 1", taskId: null }))
      .toBe("/opportunities/opportunity%201?attention=missing_next_action");
    expect(() => buildAttentionHref({ kind: "task", opportunityId: "opportunity 1", taskId: "" }))
      .toThrow("Task attention requires a task ID");
  });

  it("parses only unambiguous supported targets", () => {
    expect(parseAttentionTarget({ attention: "task", taskId: "task-1" }))
      .toEqual({ kind: "task", taskId: "task-1" });
    expect(parseAttentionTarget({ attention: "missing_next_action" }))
      .toEqual({ kind: "missing_next_action" });
    expect(parseAttentionTarget({ attention: "task" })).toBeNull();
    expect(parseAttentionTarget({ attention: "task", taskId: "" })).toBeNull();
    expect(parseAttentionTarget({ attention: "task", taskId: ["task-1"] })).toBeNull();
    expect(parseAttentionTarget({ attention: ["task"], taskId: "task-1" })).toBeNull();
    expect(parseAttentionTarget({ attention: "missing_next_action", taskId: "task-1" })).toBeNull();
    expect(parseAttentionTarget({ attention: "missing_next_action", taskId: ["task-1"] })).toBeNull();
    expect(parseAttentionTarget({ attention: "unknown", taskId: "task-1" })).toBeNull();
  });

  it("resolves task attention from fresh detail", () => {
    const due = task();
    expect(resolveAttentionContext(detail([due]), { kind: "task", taskId: due.id }, "2026-07-13"))
      .toEqual({ state: "active_task", task: due, isOverdue: false });
    expect(resolveAttentionContext(detail([{ ...due, dueDate: "2026-07-12" }]), { kind: "task", taskId: due.id }, "2026-07-13"))
      .toMatchObject({ state: "active_task", isOverdue: true });
    expect(resolveAttentionContext(detail([{ ...due, state: "completed" }]), { kind: "task", taskId: due.id }, "2026-07-13"))
      .toEqual({ state: "resolved" });
    expect(resolveAttentionContext(detail([{ ...due, state: "cancelled" }]), { kind: "task", taskId: due.id }, "2026-07-13"))
      .toEqual({ state: "resolved" });
    expect(resolveAttentionContext(detail([{ ...due, dueDate: null }]), { kind: "task", taskId: due.id }, "2026-07-13"))
      .toEqual({ state: "resolved" });
    expect(resolveAttentionContext(detail([{ ...due, dueDate: "2026-07-14" }]), { kind: "task", taskId: due.id }, "2026-07-13"))
      .toEqual({ state: "resolved" });
    expect(resolveAttentionContext(detail([{ ...due, opportunityId: "another-opportunity" }]), { kind: "task", taskId: due.id }, "2026-07-13"))
      .toEqual({ state: "resolved" });
    expect(resolveAttentionContext(detail([]), { kind: "task", taskId: due.id }, "2026-07-13"))
      .toEqual({ state: "resolved" });
    const rejectedDetail: OpportunityDetail = { ...detail([due]), type: "job", status: "rejected" };
    expect(resolveAttentionContext(rejectedDetail, { kind: "task", taskId: due.id }, "2026-07-13"))
      .toEqual({ state: "resolved" });
  });

  it("shares terminal attention eligibility across task and dashboard rules", () => {
    expect(opportunityIsAttentionEligible({ type: "job", status: "applied" })).toBe(true);
    expect(opportunityIsAttentionEligible({ type: "job", status: "rejected" })).toBe(false);
    expect(opportunityIsAttentionEligible({ type: "job", status: "archived" })).toBe(false);
    expect(opportunityIsAttentionEligible({ type: "connection", status: "dormant" })).toBe(false);
    expect(opportunityIsAttentionEligible({ type: "connection", status: "closed" })).toBe(false);
    expect(opportunityIsAttentionEligible({ type: "connection", status: "archived" })).toBe(false);
  });

  it("resolves missing-next-action attention only for forward-moving records with no open task", () => {
    expect(resolveAttentionContext(detail([]), { kind: "missing_next_action" }, "2026-07-13"))
      .toEqual({ state: "missing_next_action" });
    expect(resolveAttentionContext(detail([task()]), { kind: "missing_next_action" }, "2026-07-13"))
      .toEqual({ state: "resolved" });
    expect(resolveAttentionContext({ ...detail([]), status: "archived" }, { kind: "missing_next_action" }, "2026-07-13"))
      .toEqual({ state: "resolved" });
  });
});
