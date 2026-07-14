// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { AttentionQueue } from "./AttentionQueue";

describe("AttentionQueue", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("does not render a panel when there is no attention work", () => {
    const markup = renderToStaticMarkup(
      <AttentionQueue items={[]} onViewAll={() => undefined} />
    );

    expect(markup).toBe("");
  });

  it("exposes the loading state as a named status region", () => {
    document.body.innerHTML = renderToStaticMarkup(
      <AttentionQueue items={[]} loading onViewAll={() => undefined} />
    );

    const loadingStatus = document.querySelector('[role="status"]');
    expect(loadingStatus?.textContent).toContain("Loading attention queue");
    expect(loadingStatus?.getAttribute("aria-busy")).toBe("true");
  });

  it("leads with the required action and carries an explicit task target", () => {
    document.body.innerHTML = renderToStaticMarkup(<AttentionQueue items={[{
      id: "task-task-1",
      opportunityId: "opportunity-1",
      taskId: "task-1",
      type: "job",
      label: "Lead AI Strategy",
      organization: "Acme",
      status: "applied",
      priority: "medium",
      kind: "task",
      actionLabel: "Investigate unanswered email",
      dueDate: "2026-07-13",
      isOverdue: false
    }]} onViewAll={() => undefined} />);

    const link = document.querySelector<HTMLAnchorElement>(".attention-strip__item")!;
    expect(link.href).toContain("/opportunities/opportunity-1?attention=task&taskId=task-1");
    expect(link.getAttribute("aria-label")).toBe("Investigate unanswered email for Lead AI Strategy. Due today · 2026-07-13");
    expect(link.querySelector("strong")?.textContent).toBe("Investigate unanswered email");
    expect(link.textContent).toContain("Lead AI Strategy");
    expect(link.textContent).toContain("Due today");
    expect(link.classList.contains("attention-strip__item--planning")).toBe(false);
    expect(link.querySelector(".attention-list__marker--medium")).not.toBeNull();
  });

  it("presents a missing next action as a planning prompt rather than a stored action", () => {
    document.body.innerHTML = renderToStaticMarkup(<AttentionQueue items={[{
      id: "missing-next-action-opportunity-1",
      opportunityId: "opportunity-1",
      taskId: null,
      type: "job",
      label: "Engineering Manager",
      organization: "Acme",
      status: "applied",
      priority: "high",
      kind: "missing_next_action",
      reasonLabel: "No next action planned",
      dueDate: null,
      isOverdue: false
    }]} onViewAll={() => undefined} />);

    const link = document.querySelector<HTMLAnchorElement>(".attention-strip__item--planning")!;
    expect(link.href).toContain("/opportunities/opportunity-1?attention=missing_next_action");
    expect(link.href).not.toContain("taskId=");
    expect(link.getAttribute("aria-label")).toBe(
      "No next action planned for Engineering Manager. Open planning prompt."
    );
    expect(link.querySelector("strong")?.textContent).toBe("No next action planned");
    expect(link.textContent).toContain("Engineering Manager");
    expect(link.textContent).toContain("Planning");
    expect(link.querySelector(".attention-list__marker--planning")).not.toBeNull();
    expect(link.textContent).not.toContain("Set a next action");
    expect(link.textContent).not.toContain("Plan next move");
  });
});
