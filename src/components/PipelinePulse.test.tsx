// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PipelinePulse } from "./PipelinePulse";
import type { OpportunitySummary } from "../types";

function opportunity(overrides: Partial<OpportunitySummary>): OpportunitySummary {
  return {
    id: "opportunity-1",
    type: "job",
    label: "Product designer",
    organization: null,
    status: "wishlist",
    priority: "medium",
    summary: null,
    originOpportunityId: null,
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:00.000Z",
    nextOpenTask: null,
    url: null,
    source: null,
    location: null,
    contact: null,
    appliedDate: null,
    ...overrides
  } as OpportunitySummary;
}

describe("PipelinePulse", () => {
  it("derives mixed active, attention, and closed metrics with a proportional type bar", () => {
    document.body.innerHTML = renderToStaticMarkup(
      <PipelinePulse
        opportunities={[
          opportunity({ id: "job-1" }),
          opportunity({ id: "job-2", status: "applied" }),
          opportunity({ id: "job-3", status: "offer" }),
          opportunity({ id: "connection-1", type: "connection", status: "new", roleContext: null, contactInfo: null, meetingContext: null, relationshipStrength: "new", lastInteractionAt: null }),
          opportunity({ id: "connection-2", type: "connection", status: "waiting", roleContext: null, contactInfo: null, meetingContext: null, relationshipStrength: "familiar", lastInteractionAt: null }),
          opportunity({ id: "rejected", status: "rejected" }),
          opportunity({ id: "dormant", type: "connection", status: "dormant", roleContext: null, contactInfo: null, meetingContext: null, relationshipStrength: "new", lastInteractionAt: null }),
          opportunity({ id: "archived", status: "archived" })
        ]}
        attentionCount={2}
      />
    );

    expect(document.querySelector("h2")?.textContent).toBe("Pipeline pulse");
    expect(document.body.textContent).toContain("5 Active");
    expect(document.body.textContent).toContain("3 Jobs");
    expect(document.body.textContent).toContain("2 Connections");
    expect(document.body.textContent).toContain("2 Needs attention");
    expect(document.body.textContent).toContain("3 Closed / archived");

    const bar = document.querySelector(".pipeline-pulse__bar");
    expect(bar?.getAttribute("aria-hidden")).toBe("true");
    expect(bar?.querySelector(".pipeline-pulse__bar-jobs")?.getAttribute("style")).toContain("width:60%");
    expect(bar?.querySelector(".pipeline-pulse__bar-connections")?.getAttribute("style")).toContain("width:40%");
  });

  it("renders a neutral empty track without type segments when there are no active opportunities", () => {
    document.body.innerHTML = renderToStaticMarkup(
      <PipelinePulse
        opportunities={[
          opportunity({ id: "rejected", status: "rejected" }),
          opportunity({ id: "closed", type: "connection", status: "closed", roleContext: null, contactInfo: null, meetingContext: null, relationshipStrength: "new", lastInteractionAt: null })
        ]}
        attentionCount={0}
      />
    );

    expect(document.body.textContent).toContain("0 Active");
    expect(document.body.textContent).toContain("0 Jobs");
    expect(document.body.textContent).toContain("0 Connections");
    expect(document.body.textContent).toContain("0 Needs attention");
    expect(document.body.textContent).toContain("2 Closed / archived");

    const bar = document.querySelector(".pipeline-pulse__bar");
    expect(bar?.getAttribute("aria-hidden")).toBe("true");
    expect(bar?.classList.contains("pipeline-pulse__bar--empty")).toBe(true);
    expect(bar?.children).toHaveLength(0);
  });
});
