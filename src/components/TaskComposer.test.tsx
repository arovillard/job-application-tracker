// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ConnectionOpportunity, JobOpportunity } from "../types";
import { TaskComposer } from "./TaskComposer";

const common = {
  id: "opportunity-1",
  priority: "medium" as const,
  summary: null,
  originOpportunityId: null,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z"
};

const job: JobOpportunity = {
  ...common,
  type: "job",
  label: "Platform Engineer",
  organization: "Acme",
  status: "applied",
  url: null,
  source: null,
  location: null,
  contact: null,
  appliedDate: null
};

const connection: ConnectionOpportunity = {
  ...common,
  type: "connection",
  label: "Kara Melton",
  organization: null,
  status: "in_conversation",
  roleContext: "Design leader",
  contactInfo: null,
  meetingContext: null,
  relationshipStrength: "familiar",
  lastInteractionAt: null
};

const props = {
  taskTitle: "",
  taskDueDate: "",
  onTaskTitleChange: vi.fn(),
  onTaskDueDateChange: vi.fn(),
  onSubmit: vi.fn(),
  onCancel: vi.fn()
};

describe("TaskComposer", () => {
  it("names the selected job and its organization", () => {
    const markup = renderToStaticMarkup(<TaskComposer {...props} opportunity={job} />);

    expect(markup).toContain("Creating task for");
    expect(markup).toContain("Platform Engineer");
    expect(markup).toContain("Acme");
    expect(markup).toContain("Job");
  });

  it("uses connection role context and disables controls while saving", () => {
    const markup = renderToStaticMarkup(<TaskComposer {...props} opportunity={connection} isSubmitting />);

    expect(markup).toContain("Kara Melton");
    expect(markup).toContain("Design leader");
    expect(markup).toContain("Connection");
    expect(markup).toContain("Saving…");
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Cancel<\/button>/);
  });
});
