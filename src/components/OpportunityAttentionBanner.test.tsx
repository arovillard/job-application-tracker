import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { OpportunityTask } from "../types";
import { OpportunityAttentionBanner } from "./OpportunityAttentionBanner";

const task: OpportunityTask = {
  id: "task-1",
  opportunityId: "opportunity-1",
  title: "Investigate unanswered email",
  dueDate: "2026-07-13",
  state: "open",
  sourceActivityId: null,
  completedAt: null,
  createdAt: "2026-07-01T12:00:00.000Z",
  updatedAt: "2026-07-01T12:00:00.000Z"
};

const callbacks = {
  pendingTaskId: null,
  onComplete: vi.fn(),
  onReview: vi.fn(),
  onSetNextAction: vi.fn()
};

describe("OpportunityAttentionBanner", () => {
  it("renders an actionable due-task arrival", () => {
    const markup = renderToStaticMarkup(<OpportunityAttentionBanner
      {...callbacks}
      context={{ state: "active_task", task, isOverdue: false }}
    />);
    expect(markup).toContain("Needs attention today");
    expect(markup).toContain("Investigate unanswered email");
    expect(markup).toContain("Complete");
    expect(markup).toContain("Review options");
    expect(markup).toContain('aria-labelledby="attention-context-title"');
    expect(markup).toContain('id="attention-context-title"');
    expect(markup).toContain('tabindex="-1"');
  });

  it("renders missing and resolved states with explicit explanations", () => {
    const missing = renderToStaticMarkup(<OpportunityAttentionBanner {...callbacks} context={{ state: "missing_next_action" }} />);
    const resolved = renderToStaticMarkup(<OpportunityAttentionBanner {...callbacks} context={{ state: "resolved" }} />);
    expect(missing).toContain("No next action is planned");
    expect(missing).toContain("Set next action");
    expect(resolved).toContain("This attention item is no longer active");
    expect(resolved).toContain("Review current actions");
    expect(resolved).toContain('tabindex="-1"');
  });
});
