import { describe, expect, it } from "vitest";

import { type Application, type FollowUpItem } from "../types";
import { getDashboardInsights } from "./dashboard";

function application(overrides: Partial<Application> = {}): Application {
  return {
    id: overrides.id ?? "application-1",
    company: overrides.company ?? "Acme",
    role: overrides.role ?? "Frontend Engineer",
    status: overrides.status ?? "applied",
    source: overrides.source ?? null,
    location: overrides.location ?? null,
    url: overrides.url ?? null,
    contact: overrides.contact ?? null,
    notes: overrides.notes ?? null,
    appliedDate: overrides.appliedDate ?? null,
    followUpDate: overrides.followUpDate ?? null,
    nextAction: overrides.nextAction ?? null,
    nextActionDate: overrides.nextActionDate ?? null,
    priority: overrides.priority ?? "medium",
    createdAt: overrides.createdAt ?? "2026-07-01T12:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-07-01T12:00:00.000Z"
  };
}

function followUp(overrides: Partial<FollowUpItem> = {}): FollowUpItem {
  const linkedApplication = application({
    id: overrides.applicationId ?? "application-2",
    company: "Orbit",
    role: "Product Designer",
    status: "interviewing"
  });

  return {
    id: overrides.id ?? "follow-up-1",
    applicationId: linkedApplication.id,
    type: "follow_up",
    body: overrides.body ?? "Send thank-you note",
    followUpDate: overrides.followUpDate ?? "2026-07-08",
    createdAt: overrides.createdAt ?? "2026-07-01T12:00:00.000Z",
    application: overrides.application ?? {
      id: linkedApplication.id,
      company: linkedApplication.company,
      role: linkedApplication.role,
      status: linkedApplication.status,
      source: linkedApplication.source,
      location: linkedApplication.location
    }
  };
}

describe("getDashboardInsights", () => {
  it("surfaces due work and applications missing a next action", () => {
    const applications = [
      application({
        id: "applied",
        company: "Acme",
        nextAction: "Send a concise follow-up",
        nextActionDate: "2026-07-09",
        priority: "high"
      }),
      application({
        id: "interviewing",
        company: "Orbit",
        role: "Product Designer",
        status: "interviewing"
      }),
      application({
        id: "offer",
        company: "Northstar",
        status: "offer"
      }),
      application({
        id: "archived",
        company: "Past Co",
        status: "archived"
      })
    ];

    const insights = getDashboardInsights(
      applications,
      [followUp({ applicationId: "interviewing" })],
      "2026-07-09"
    );

    expect(insights).toEqual({ attention: expect.any(Array) });
    expect(insights.attention.map((item) => ({
      applicationId: item.applicationId,
      kind: item.kind,
      dueDate: item.dueDate
    }))).toEqual([
      { applicationId: "interviewing", kind: "follow_up", dueDate: "2026-07-08" },
      { applicationId: "applied", kind: "next_action", dueDate: "2026-07-09" },
      { applicationId: "offer", kind: "missing_next_action", dueDate: null }
    ]);
  });

  it("keeps future work out of the attention count", () => {
    const insights = getDashboardInsights(
      [
        application({
          id: "future",
          nextAction: "Prepare interview examples",
          nextActionDate: "2026-07-12"
        })
      ],
      [followUp({ applicationId: "future", followUpDate: "2026-07-13" })],
      "2026-07-09"
    );

    expect(insights).toEqual({ attention: [] });
  });
});
