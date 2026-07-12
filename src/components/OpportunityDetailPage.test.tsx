import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import type { OpportunityDetail } from "../types";
import { OpportunityDetailContent } from "./OpportunityDetailPage";

const base = {
  id: "opportunity-1",
  organization: "Acme",
  priority: "medium" as const,
  summary: "Discussed platform leadership",
  originOpportunityId: null,
  createdAt: "2026-07-01T12:00:00.000Z",
  updatedAt: "2026-07-11T12:00:00.000Z",
  activities: [{
    id: "activity-1", opportunityId: "opportunity-1", type: "meeting" as const,
    body: "Met after the engineering panel", metadata: null,
    occurredAt: "2026-07-10T18:00:00.000Z", createdAt: "2026-07-10T18:00:00.000Z"
  }],
  tasks: [{
    id: "task-1", opportunityId: "opportunity-1", title: "Send portfolio", dueDate: "2026-07-15",
    state: "open" as const, sourceActivityId: "activity-1", completedAt: null,
    createdAt: "2026-07-10T18:00:00.000Z", updatedAt: "2026-07-10T18:00:00.000Z"
  }],
  artifacts: [],
  origin: null,
  originatedJobs: []
};

const connection: OpportunityDetail = {
  ...base, type: "connection", label: "Maya Chen", status: "in_conversation",
  roleContext: "VP Engineering", contactInfo: "maya@example.com", meetingContext: "Engineering panel",
  relationshipStrength: "familiar", lastInteractionAt: "2026-07-10T18:00:00.000Z"
};

const job: OpportunityDetail = {
  ...base, type: "job", label: "Engineering Manager", status: "applied",
  url: "https://example.com/job", source: "Acme careers", location: "Example City",
  contact: "Maya Chen", appliedDate: "2026-07-09",
  artifacts: [{
    id: "artifact-1", opportunityId: "opportunity-1", type: "fit_analysis", title: "Fit Analysis",
    filePath: "/tmp/fit-analysis.md", contentType: "text/markdown",
    createdAt: "2026-07-11T12:00:00.000Z", updatedAt: "2026-07-11T12:00:00.000Z"
  }]
};

describe("OpportunityDetailContent", () => {
  it("renders connection context, activity, tasks, and actions", () => {
    const markup = renderToStaticMarkup(<OpportunityDetailContent detail={connection} onTaskAction={vi.fn()} />);
    expect(markup).toContain("Connection");
    expect(markup).toContain("Maya Chen");
    expect(markup).toContain("Familiar");
    expect(markup).toContain("Meeting");
    expect(markup).toContain("Send portfolio");
    expect(markup).toContain("Record interaction");
    expect(markup).toContain("Create job opportunity");
    expect(markup).toContain("Edit details");
    expect(markup).toContain("Archive");
    expect(markup).toContain("Delete permanently");
    expect(markup).toContain("Contact information");
    expect(markup).toContain("Last interaction");
  });

  it("renders job materials without relationship controls", () => {
    const markup = renderToStaticMarkup(<OpportunityDetailContent detail={job} onTaskAction={vi.fn()} />);
    expect(markup).toContain("Job");
    expect(markup).toContain("Engineering Manager");
    expect(markup).toContain("Application materials");
    expect(markup).toContain("Fit Analysis");
    expect(markup).toContain("Priority");
    expect(markup).toContain("Posting URL");
    expect(markup).toContain("Applied date");
    expect(markup).not.toContain("Relationship strength");
  });

  it("renders task rescheduling controls", () => {
    const markup = renderToStaticMarkup(<OpportunityDetailContent detail={job} onTaskAction={vi.fn()} />);
    expect(markup).toContain("Reschedule");
  });

  it("renders origin links in both directions", () => {
    const linkedJob = { ...job, id: "job-2", originOpportunityId: connection.id, origin: connection };
    const connectionWithJob = { ...connection, originatedJobs: [linkedJob] };
    expect(renderToStaticMarkup(<OpportunityDetailContent detail={linkedJob} onTaskAction={vi.fn()} />)).toContain("Maya Chen");
    expect(renderToStaticMarkup(<OpportunityDetailContent detail={connectionWithJob} onTaskAction={vi.fn()} />)).toContain("Engineering Manager");
  });
});
