import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { OpportunityTask } from "../types";
import { OpportunityTaskList, selectPrimaryTask } from "./OpportunityTaskList";

const task = (id: string, title: string, dueDate: string | null, state: OpportunityTask["state"] = "open"): OpportunityTask => ({
  id, opportunityId: "opportunity-1", title, dueDate, state, sourceActivityId: null,
  completedAt: state === "open" ? null : "2026-07-12T12:00:00.000Z",
  createdAt: "2026-07-01T12:00:00.000Z", updatedAt: "2026-07-01T12:00:00.000Z"
});

describe("OpportunityTaskList", () => {
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
    expect(overdue).toContain("Next action");
  });

  it("keeps remaining open tasks visible without duplicating the primary and collapses history", () => {
    const markup = renderToStaticMarkup(<OpportunityTaskList tasks={[
      task("primary", "Send follow-up", "2026-07-15"),
      task("remaining", "Schedule call", "2026-07-20"),
      task("history", "Previous call", "2026-07-10", "completed")
    ]} today="2026-07-12" onAction={vi.fn()} />);

    expect(markup.match(/<strong>Send follow-up<\/strong>/g)).toHaveLength(1);
    expect(markup).toContain("Tasks");
    expect(markup).toContain("Schedule call");
    expect(markup).toContain("Task history (1)");
    expect(markup).toContain("<details>");
    expect(markup).not.toContain("<details open=\"\">");
  });

  it("offers an add-task CTA when no open task exists", () => {
    const markup = renderToStaticMarkup(<OpportunityTaskList tasks={[task("history", "Previous call", null, "cancelled")]} onAction={vi.fn()} />);

    expect(markup).toContain("Set a next action");
  });
});
