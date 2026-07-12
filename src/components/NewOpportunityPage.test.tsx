import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams()
}));

import { buildConnectionCreationPayload } from "./ConnectionOpportunityForm";
import { NewOpportunityPage } from "./NewOpportunityPage";

describe("NewOpportunityPage", () => {
  it("starts with a clear job or connection choice", () => {
    const markup = renderToStaticMarkup(<NewOpportunityPage />);
    expect(markup).toContain("What kind of opportunity are you adding?");
    expect(markup).toContain("Job posting");
    expect(markup).toContain("Connection");
  });

  it("builds a connection envelope without job-only fields", () => {
    const payload = buildConnectionCreationPayload({
      label: "Maya Chen",
      organization: "Acme",
      roleContext: "VP Engineering",
      contactInfo: "maya@example.com",
      meetingContext: "Example City engineering meetup",
      summary: "Met after a panel",
      relationshipStrength: "new",
      status: "new",
      priority: "medium",
      activityType: "meeting",
      activityBody: "Discussed platform leadership",
      activityDate: "2026-07-10",
      taskTitle: "Send portfolio",
      taskDueDate: "2026-07-15"
    });

    expect(payload).toMatchObject({
      opportunity: {
        type: "connection",
        label: "Maya Chen",
        relationshipStrength: "new",
        status: "new"
      },
      initialActivity: {
        type: "meeting",
        body: "Discussed platform leadership",
        occurredAt: "2026-07-10T12:00:00.000Z"
      },
      initialTask: { title: "Send portfolio", dueDate: "2026-07-15" }
    });
    expect(payload.opportunity).not.toHaveProperty("url");
    expect(payload.opportunity).not.toHaveProperty("appliedDate");
  });
});
