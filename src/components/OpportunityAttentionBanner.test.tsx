import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { OpportunityTask } from "../types";
import { OpportunityAttentionBanner, OpportunityAttentionNotice } from "./OpportunityAttentionBanner";

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
  onCancel: vi.fn(),
  onReview: vi.fn(),
  onSetNextAction: vi.fn()
};

describe("OpportunityAttentionBanner", () => {
  it("renders Complete and Cancel as the direct due-task decisions", () => {
    const markup = renderToStaticMarkup(<OpportunityAttentionBanner
      {...callbacks}
      context={{ state: "active_task", task, isOverdue: false }}
    />);
    const pending = renderToStaticMarkup(<OpportunityAttentionBanner
      {...callbacks}
      context={{ state: "active_task", task, isOverdue: false }}
      pendingTaskId={task.id}
    />);

    expect(markup).toContain("Needs attention today");
    expect(markup).toContain("Investigate unanswered email");
    expect(markup).toContain(">Complete</button>");
    expect(markup).toContain(">Cancel</button>");
    expect(markup).not.toContain("Review options");
    expect(pending.match(/disabled=""/g)).toHaveLength(2);
    expect(markup).toContain('aria-labelledby="attention-context-title"');
    expect(markup).toContain('id="attention-context-title"');
    expect(markup).toContain('tabindex="-1"');
  });

  it("renders the missing-action state and a separate compact stale notice", () => {
    const missing = renderToStaticMarkup(<OpportunityAttentionBanner {...callbacks} context={{ state: "missing_next_action" }} />);
    const stale = renderToStaticMarkup(<OpportunityAttentionNotice onDismiss={vi.fn()} />);
    expect(missing).toContain("No next action is planned");
    expect(missing).toContain("Set next action");
    expect(stale).toContain("This attention item was already handled");
    expect(stale).toContain(">Dismiss</button>");
    expect(stale).not.toContain('tabindex="-1"');
  });
});
