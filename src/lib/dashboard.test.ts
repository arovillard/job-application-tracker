import { describe, expect, it } from "vitest";

import type { ConnectionOpportunity, JobOpportunity, OpportunitySummary, OpportunityTask } from "../types";
import { getDashboardInsights } from "./dashboard";

function task(overrides: Partial<OpportunityTask> = {}): OpportunityTask {
  return {
    id: overrides.id ?? "task-1",
    opportunityId: overrides.opportunityId ?? "opportunity-1",
    title: overrides.title ?? "Follow up",
    dueDate: overrides.dueDate ?? "2026-07-09",
    state: overrides.state ?? "open",
    sourceActivityId: overrides.sourceActivityId ?? null,
    completedAt: overrides.completedAt ?? null,
    createdAt: overrides.createdAt ?? "2026-07-01T12:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-07-01T12:00:00.000Z"
  };
}

function job(overrides: Partial<JobOpportunity & { nextOpenTask: OpportunityTask | null }> = {}): OpportunitySummary {
  const id = overrides.id ?? "job-1";
  return {
    id,
    type: "job",
    label: overrides.label ?? "Engineering Manager",
    organization: overrides.organization ?? "Acme",
    status: overrides.status ?? "applied",
    priority: overrides.priority ?? "medium",
    summary: overrides.summary ?? null,
    originOpportunityId: overrides.originOpportunityId ?? null,
    url: overrides.url ?? null,
    source: overrides.source ?? null,
    location: overrides.location ?? null,
    contact: overrides.contact ?? null,
    appliedDate: overrides.appliedDate ?? null,
    createdAt: overrides.createdAt ?? "2026-07-01T12:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-07-01T12:00:00.000Z",
    nextOpenTask: overrides.nextOpenTask === undefined ? null : overrides.nextOpenTask
  };
}

function connection(overrides: Partial<ConnectionOpportunity & { nextOpenTask: OpportunityTask | null }> = {}): OpportunitySummary {
  const id = overrides.id ?? "connection-1";
  return {
    id,
    type: "connection",
    label: overrides.label ?? "Maya Chen",
    organization: overrides.organization ?? "Acme",
    status: overrides.status ?? "new",
    priority: overrides.priority ?? "medium",
    summary: overrides.summary ?? null,
    originOpportunityId: null,
    roleContext: overrides.roleContext ?? "VP Engineering",
    contactInfo: overrides.contactInfo ?? null,
    meetingContext: overrides.meetingContext ?? null,
    relationshipStrength: overrides.relationshipStrength ?? "familiar",
    lastInteractionAt: overrides.lastInteractionAt ?? null,
    createdAt: overrides.createdAt ?? "2026-07-01T12:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-07-01T12:00:00.000Z",
    nextOpenTask: overrides.nextOpenTask === undefined ? null : overrides.nextOpenTask
  };
}

describe("getDashboardInsights", () => {
  it("orders due work before opportunities missing a next action", () => {
    const opportunities = [
      connection({
        id: "connection-due",
        priority: "high",
        nextOpenTask: task({ id: "connection-task", opportunityId: "connection-due", dueDate: "2026-07-08" })
      }),
      job({
        id: "job-due",
        nextOpenTask: task({ id: "job-task", opportunityId: "job-due", dueDate: "2026-07-09" })
      }),
      connection({ id: "connection-new", label: "Jordan Lee", nextOpenTask: null }),
      connection({ id: "connection-dormant", status: "dormant", nextOpenTask: null }),
      job({ id: "job-archived", status: "archived", nextOpenTask: null })
    ];

    const insights = getDashboardInsights(opportunities, "2026-07-09");

    expect(insights.attention.map((item) => ({
      opportunityId: item.opportunityId,
      kind: item.kind,
      taskId: item.taskId,
      dueDate: item.dueDate
    }))).toEqual([
      { opportunityId: "connection-due", kind: "task", taskId: "connection-task", dueDate: "2026-07-08" },
      { opportunityId: "job-due", kind: "task", taskId: "job-task", dueDate: "2026-07-09" },
      { opportunityId: "connection-new", kind: "missing_next_action", taskId: null, dueDate: null }
    ]);

    const planning = insights.attention.find((item) => item.kind === "missing_next_action");
    expect(planning).toMatchObject({
      kind: "missing_next_action",
      taskId: null,
      reasonLabel: "No next action planned",
      dueDate: null,
      isOverdue: false
    });
    expect(planning).not.toHaveProperty("actionLabel");
  });

  it("keeps future tasks out of attention while suppressing missing-action warnings", () => {
    const future = task({ dueDate: "2026-07-12" });
    expect(getDashboardInsights([
      job({ id: "future-job", nextOpenTask: { ...future, opportunityId: "future-job" } }),
      connection({ id: "future-connection", nextOpenTask: { ...future, opportunityId: "future-connection" } })
    ], "2026-07-09")).toEqual({ attention: [] });
  });

  it("excludes terminal opportunities from due-task attention", () => {
    const due = task({ dueDate: "2026-07-09" });
    expect(getDashboardInsights([
      job({ id: "rejected-job", status: "rejected", nextOpenTask: { ...due, opportunityId: "rejected-job" } }),
      job({ id: "archived-job", status: "archived", nextOpenTask: { ...due, opportunityId: "archived-job" } }),
      connection({ id: "dormant", status: "dormant", nextOpenTask: { ...due, opportunityId: "dormant" } }),
      connection({ id: "closed", status: "closed", nextOpenTask: { ...due, opportunityId: "closed" } }),
      connection({ id: "archived", status: "archived", nextOpenTask: { ...due, opportunityId: "archived" } })
    ], "2026-07-09")).toEqual({ attention: [] });
  });
});
