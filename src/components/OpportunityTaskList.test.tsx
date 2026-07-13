import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { OpportunityTask } from "../types";
import { getLocalCalendarDate, OpportunityTaskList, selectPrimaryTask } from "./OpportunityTaskList";

const task = (id: string, title: string, dueDate: string | null, state: OpportunityTask["state"] = "open"): OpportunityTask => ({
  id, opportunityId: "opportunity-1", title, dueDate, state, sourceActivityId: null,
  completedAt: state === "open" ? null : "2026-07-12T12:00:00.000Z",
  createdAt: "2026-07-01T12:00:00.000Z", updatedAt: "2026-07-01T12:00:00.000Z"
});

describe("OpportunityTaskList", () => {
  it("derives today from local calendar components at the UTC date boundary", () => {
    const localEvening = new Date(2026, 6, 12, 20, 30);

    expect(getLocalCalendarDate(localEvening)).toBe("2026-07-12");
  });

  it("selects the earliest dated open task before undated tasks", () => {
    expect(selectPrimaryTask([
      task("undated", "Research company", null),
      task("later", "Schedule call", "2026-07-20"),
      task("earlier", "Send follow-up", "2026-07-15"),
      task("done", "Past action", "2026-07-10", "completed")
    ])?.id).toBe("earlier");
  });

  it("renders one primary action with overdue, due-today, and no-date semantics", () => {
    const onAction = vi.fn();
    const overdue = renderToStaticMarkup(<OpportunityTaskList tasks={[task("overdue", "Send follow-up", "2026-07-11")]} today="2026-07-12" onAction={onAction} />);
    const dueToday = renderToStaticMarkup(<OpportunityTaskList tasks={[task("today", "Schedule call", "2026-07-12")]} today="2026-07-12" onAction={onAction} />);
    const noDate = renderToStaticMarkup(<OpportunityTaskList tasks={[task("none", "Research company", null)]} today="2026-07-12" onAction={onAction} />);

    expect(overdue).toContain("Overdue · 2026-07-11");
    expect(dueToday).toContain("Due today · 2026-07-12");
    expect(noDate).toContain("No due date");
    expect(overdue).toContain("Up next");
  });

  it("keeps remaining open tasks visible without duplicating the primary and collapses history", () => {
    const markup = renderToStaticMarkup(<OpportunityTaskList tasks={[
      task("primary", "Send follow-up", "2026-07-15"),
      task("remaining", "Schedule call", "2026-07-20"),
      task("history", "Previous call", "2026-07-10", "completed")
    ]} today="2026-07-12" onAction={vi.fn()} />);

    expect(markup.match(/<strong>Send follow-up<\/strong>/g)).toHaveLength(1);
    expect(markup).toContain("Actions");
    expect(markup).toContain("Other tasks");
    expect(markup).toContain("Schedule call");
    expect(markup).toContain("Completed and cancelled (1)");
    expect(markup).toContain('<details class="actions-card__history">');
    expect(markup).not.toContain("<details open=\"\">");
  });

  it("keeps the primary action and optional task groups in one Actions card", () => {
    const markup = renderToStaticMarkup(<OpportunityTaskList tasks={[task("primary", "Send follow-up", "2026-07-15")]} today="2026-07-12" onAction={vi.fn()} />);

    expect(markup).toContain('<section class="next-action-card actions-card"><header class="tracker-panel__header"><div><p class="panel-heading__eyebrow">Momentum</p><h2 class="tracker-panel__title">Actions</h2></div>');
    expect(markup).toContain('class="task-item task-item--primary"');
    expect(markup).toContain('class="task-item__eyebrow">Up next</span>');
    expect(markup).toContain('class="task-item__reschedule"');
    expect(markup).toContain("Move due date");
    expect(markup).not.toContain('<h2 class="tracker-panel__title">Tasks</h2>');
    expect(markup).not.toContain("Other tasks");
  });

  it("offers an add-task CTA when no open task exists", () => {
    const markup = renderToStaticMarkup(<OpportunityTaskList tasks={[task("history", "Previous call", null, "cancelled")]} onAction={vi.fn()} />);

    expect(markup).toContain("Set a next action");
  });
});
