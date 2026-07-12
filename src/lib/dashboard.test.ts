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
      dueDate: item.dueDate
    }))).toEqual([
      { opportunityId: "connection-due", kind: "task", dueDate: "2026-07-08" },
      { opportunityId: "job-due", kind: "task", dueDate: "2026-07-09" },
      { opportunityId: "connection-new", kind: "missing_next_action", dueDate: null }
    ]);
  });

  it("keeps future tasks out of attention while suppressing missing-action warnings", () => {
    const future = task({ dueDate: "2026-07-12" });
    expect(getDashboardInsights([
      job({ id: "future-job", nextOpenTask: { ...future, opportunityId: "future-job" } }),
      connection({ id: "future-connection", nextOpenTask: { ...future, opportunityId: "future-connection" } })
    ], "2026-07-09")).toEqual({ attention: [] });
  });
});
