// @vitest-environment jsdom

import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const routerState = vi.hoisted(() => ({ push: vi.fn() }));
const effectState = vi.hoisted(() => ({ skip: false }));
vi.mock("next/navigation", () => ({ useRouter: () => routerState }));
vi.mock("next/link", () => ({ default: (props: ComponentProps<"a">) => <a {...props} /> }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useEffect: (effect: Parameters<typeof actual.useEffect>[0], dependencies?: Parameters<typeof actual.useEffect>[1]) => actual.useEffect(effectState.skip ? () => undefined : effect, dependencies)
  };
});

import type { OpportunityDetail } from "../types";
import { InteractionComposer, OpportunityDetailContent, OpportunityDetailPage, OpportunitySnapshot, TASK_ACTION_STATUS, TaskComposer, TrackerPanel } from "./OpportunityDetailPage";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function jsonResponse(body: unknown, ok = true) { return { ok, status: ok ? 200 : 422, json: async () => body } as Response; }
function change(control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(control), "value")?.set?.call(control, value);
  control.dispatchEvent(new Event("input", { bubbles: true }));
  control.dispatchEvent(new Event("change", { bubbles: true }));
}
function mountDetail(props: Partial<ComponentProps<typeof OpportunityDetailPage>> = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root;
  act(() => { root = createRoot(container); root.render(<OpportunityDetailPage opportunityId="opportunity-1" today="2026-07-13" {...props} />); });
  return { container, root: root! };
}
async function flush() { await act(async () => { await Promise.resolve(); }); }

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

afterEach(() => {
  effectState.skip = false;
  vi.restoreAllMocks();
  routerState.push.mockReset();
  document.body.innerHTML = "";
});

describe("attention arrival orchestration", () => {
  it("focuses an active attention arrival and moves review focus to its task", async () => {
    const due = { ...connection.tasks[0], dueDate: "2026-07-13" };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ ...connection, tasks: [due] }));
    const { container, root } = mountDetail({ attentionTarget: { kind: "task", taskId: due.id } });
    await flush();
    const banner = container.querySelector<HTMLElement>(".attention-context--active")!;
    expect(document.activeElement).toBe(banner);
    expect(banner.textContent).toContain("Send portfolio");
    act(() => [...banner.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Review options")!.click());
    expect(document.activeElement?.id).toBe(`opportunity-task-${due.id}`);
    expect(document.activeElement?.classList.contains("task-item--attention")).toBe(true);
    act(() => root.unmount());
  });

  it("completes from the attention surface, announces resolution, and preserves focus", async () => {
    let resolveComplete!: (value: Response) => void;
    const completeRequest = new Promise<Response>((resolve) => { resolveComplete = resolve; });
    const due = { ...connection.tasks[0], dueDate: "2026-07-13" };
    const completed = { ...due, state: "completed" as const, completedAt: "2026-07-13T12:00:00.000Z" };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ ...connection, tasks: [due] })).mockReturnValueOnce(completeRequest);
    const { container, root } = mountDetail({ attentionTarget: { kind: "task", taskId: due.id } });
    await flush();
    const complete = container.querySelector<HTMLButtonElement>(".attention-context .button--primary")!;
    act(() => { complete.click(); complete.click(); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(complete.disabled).toBe(true);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`/api/opportunities/opportunity-1/tasks/${due.id}`);
    await act(async () => { resolveComplete(jsonResponse({ ...connection, tasks: [completed] })); });
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Action completed");
    expect(container.textContent).toContain("This attention item is no longer active");
    expect(document.activeElement).toBe(container.querySelector(".attention-context--resolved"));
    act(() => root.unmount());
  });

  it("opens the existing task dialog for a missing-next-action arrival", async () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { callback(0); return 1; });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ ...connection, tasks: [] }));
    const { container, root } = mountDetail({ attentionTarget: { kind: "missing_next_action" } });
    await flush();
    const trigger = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Set next action")!;
    act(() => trigger.click());
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.activeElement).toBe(container.querySelector<HTMLInputElement>('input[required]'));
    act(() => container.querySelector<HTMLButtonElement>(".modal__close")!.click());
    expect(document.activeElement).toBe(trigger);
    act(() => root.unmount());
  });

  it("shows a neutral notice for stale targets and no banner for direct visits", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(connection));
    const stale = mountDetail({ attentionTarget: { kind: "task", taskId: "missing-task" } });
    await flush();
    expect(stale.container.textContent).toContain("This attention item is no longer active");
    expect(document.activeElement).not.toBe(stale.container.querySelector(".attention-context--resolved"));
    act(() => [...stale.container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Review current actions")!.click());
    expect(document.activeElement?.id).toBe("opportunity-actions");
    act(() => stale.root.unmount());
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(connection));
    const direct = mountDetail();
    await flush();
    expect(direct.container.querySelector(".attention-context")).toBeNull();
    act(() => direct.root.unmount());
  });

  it("keeps an attention-specific initial fetch failure out of the contextual surface", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ error: "Unable to load opportunity" }, false));
    const { container, root } = mountDetail({ attentionTarget: { kind: "task", taskId: "task-1" } });
    await flush();
    expect(container.textContent).toContain("Unable to load opportunity");
    expect(container.querySelector(".attention-context")).toBeNull();
    act(() => root.unmount());
  });

  it("does not focus a consumed stale target if it later becomes active", async () => {
    const open = { ...connection.tasks[0], dueDate: "2026-07-13" };
    const completed = { ...open, state: "completed" as const, completedAt: "2026-07-12T12:00:00.000Z" };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ ...connection, tasks: [completed] })).mockResolvedValueOnce(jsonResponse({ ...connection, tasks: [open] }));
    const { container, root } = mountDetail({ attentionTarget: { kind: "task", taskId: open.id } });
    await flush();
    expect(document.activeElement).not.toBe(container.querySelector(".attention-context--resolved"));
    act(() => [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Reopen")!.click());
    await flush();
    const active = container.querySelector(".attention-context--active");
    expect(active).not.toBeNull();
    expect(document.activeElement).not.toBe(active);
    act(() => root.unmount());
  });

  it("keeps every task action success message explicit", () => {
    expect(TASK_ACTION_STATUS).toEqual({ complete: "Action completed", cancel: "Action cancelled", reschedule: "Action rescheduled", reopen: "Action reopened" });
  });

  it("keeps a failed reschedule draft and active attention context", async () => {
    const due = { ...connection.tasks[0], dueDate: "2026-07-13" };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ ...connection, tasks: [due] })).mockResolvedValueOnce(jsonResponse({ error: "Reschedule rejected" }, false));
    const { container, root } = mountDetail({ attentionTarget: { kind: "task", taskId: due.id } });
    await flush();
    const input = container.querySelector<HTMLInputElement>(`#opportunity-task-${due.id} input[type="date"]`)!;
    act(() => change(input, "2026-07-20"));
    act(() => [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Reschedule")!.click());
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Reschedule rejected");
    expect(input.value).toBe("2026-07-20");
    expect(container.querySelector(".attention-context--active")).not.toBeNull();
    act(() => root.unmount());
  });

  it("treats the same attention target as a new arrival after it disappears", async () => {
    const due = { ...connection.tasks[0], dueDate: "2026-07-13" };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ ...connection, tasks: [due] }));
    const { container, root } = mountDetail({ attentionTarget: { kind: "task", taskId: due.id } });
    await flush();
    act(() => root.render(<OpportunityDetailPage opportunityId="opportunity-1" attentionTarget={null} today="2026-07-13" />));
    await flush();
    act(() => root.render(<OpportunityDetailPage opportunityId="opportunity-1" attentionTarget={{ kind: "task", taskId: due.id }} today="2026-07-13" />));
    await flush();
    expect(document.activeElement).toBe(container.querySelector(".attention-context--active"));
    act(() => root.unmount());
  });

  it.each(["success", "failure"] as const)("ignores a late detail %s when opportunity id changes", async (outcome) => {
    let resolveDetail!: (value: Response) => void;
    const detailRequest = new Promise<Response>((resolve) => { resolveDetail = resolve; });
    const nextOpportunity = { ...connection, id: "opportunity-2", label: "Jordan Lee", status: "new" as const, tasks: [] };
    vi.spyOn(globalThis, "fetch").mockReturnValueOnce(detailRequest).mockResolvedValueOnce(jsonResponse(nextOpportunity));
    const { container, root } = mountDetail();
    act(() => root.render(<OpportunityDetailPage opportunityId="opportunity-2" today="2026-07-13" />));
    await flush();
    expect(container.textContent).toContain("Jordan Lee");
    await act(async () => { resolveDetail(outcome === "success" ? jsonResponse({ ...connection, label: "Late detail result" }) : jsonResponse({ error: "Late detail failure" }, false)); });
    expect(container.textContent).toContain("Jordan Lee");
    expect(container.textContent).not.toContain("Late detail result");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    act(() => root.unmount());
  });

  it.each(["success", "failure"] as const)("clears stale detail and ignores a late task %s when opportunity id changes", async (outcome) => {
    let resolveTask!: (value: Response) => void;
    const taskRequest = new Promise<Response>((resolve) => { resolveTask = resolve; });
    const due = { ...connection.tasks[0], dueDate: "2026-07-13" };
    const nextOpportunity = { ...connection, id: "opportunity-2", label: "Jordan Lee", tasks: [{ ...due, id: "task-2", opportunityId: "opportunity-2" }] };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ ...connection, tasks: [due] })).mockReturnValueOnce(taskRequest).mockResolvedValueOnce(jsonResponse(nextOpportunity));
    const { container, root } = mountDetail({ attentionTarget: { kind: "task", taskId: due.id } });
    await flush(); act(() => container.querySelector<HTMLButtonElement>(".attention-context .button--primary")!.click());
    act(() => root.render(<OpportunityDetailPage opportunityId="opportunity-2" today="2026-07-13" />));
    expect(container.textContent).toContain("Loading opportunity"); await flush(); expect(container.textContent).toContain("Jordan Lee");
    await act(async () => { resolveTask(outcome === "success" ? jsonResponse({ ...connection, label: "Late task result", tasks: [] }) : jsonResponse({ error: "Late task failure" }, false)); });
    expect(container.textContent).toContain("Jordan Lee"); expect(container.textContent).not.toContain("Late task result"); expect(container.querySelector('[role="status"]')).toBeNull(); expect(container.querySelector('[role="alert"]')).toBeNull();
    act(() => root.unmount());
  });

  it.each(["success", "failure"] as const)("clears a pending dialog and ignores its late %s when opportunity id changes", async (outcome) => {
    let resolveDialog!: (value: Response) => void;
    const dialogRequest = new Promise<Response>((resolve) => { resolveDialog = resolve; });
    const next = { ...connection, id: "opportunity-2", label: "Jordan Lee", tasks: [] };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(connection)).mockReturnValueOnce(dialogRequest).mockResolvedValueOnce(jsonResponse(next));
    const { container, root } = mountDetail(); await flush();
    act(() => [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Add task")!.click());
    act(() => change(container.querySelector<HTMLInputElement>('input[required]')!, "Old record task"));
    act(() => container.querySelector<HTMLFormElement>("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    act(() => root.render(<OpportunityDetailPage opportunityId="opportunity-2" today="2026-07-13" />)); await flush();
    expect(container.textContent).toContain("Jordan Lee"); expect(container.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => { resolveDialog(outcome === "success" ? jsonResponse({ ...connection, label: "Late dialog result" }) : jsonResponse({ error: "Late dialog failure" }, false)); });
    expect(container.textContent).toContain("Jordan Lee"); expect(container.textContent).not.toContain("Late dialog result"); expect(container.querySelector('[role="dialog"]')).toBeNull(); expect(container.querySelector('[role="status"]')).toBeNull(); expect(container.querySelector('[role="alert"]')).toBeNull();
    act(() => root.unmount());
  });

  it.each(["success", "failure"] as const)("ignores a late status %s when opportunity id changes", async (outcome) => {
    let resolveStatus!: (value: Response) => void;
    const statusRequest = new Promise<Response>((resolve) => { resolveStatus = resolve; });
    const next = { ...connection, id: "opportunity-2", label: "Jordan Lee", status: "new" as const, tasks: [] };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(connection)).mockReturnValueOnce(statusRequest).mockResolvedValueOnce(jsonResponse(next));
    const { container, root } = mountDetail(); await flush();
    act(() => change(container.querySelector<HTMLSelectElement>(".stage-select select")!, "waiting"));
    act(() => root.render(<OpportunityDetailPage opportunityId="opportunity-2" today="2026-07-13" />)); await flush();
    await act(async () => { resolveStatus(outcome === "success" ? jsonResponse({ ...connection, status: "waiting" }) : jsonResponse({ error: "Late status failure" }, false)); });
    expect(container.textContent).toContain("Jordan Lee"); expect(container.querySelector<HTMLSelectElement>(".stage-select select")?.value).toBe("new"); expect(container.querySelector('[role="status"]')).toBeNull(); expect(container.querySelector('[role="alert"]')).toBeNull();
    act(() => root.unmount());
  });

  it.each(["success", "failure"] as const)("ignores a late archive %s when opportunity id changes", async (outcome) => {
    let resolveArchive!: (value: Response) => void;
    const archiveRequest = new Promise<Response>((resolve) => { resolveArchive = resolve; });
    const next = { ...connection, id: "opportunity-2", label: "Jordan Lee", status: "new" as const, tasks: [] };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(connection)).mockReturnValueOnce(archiveRequest).mockResolvedValueOnce(jsonResponse(next));
    const { container, root } = mountDetail(); await flush();
    act(() => container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click()); act(() => [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((button) => button.textContent === "Archive")!.click()); act(() => container.querySelector<HTMLFormElement>("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    act(() => root.render(<OpportunityDetailPage opportunityId="opportunity-2" today="2026-07-13" />)); await flush();
    await act(async () => { resolveArchive(outcome === "success" ? jsonResponse({ ...connection, status: "archived" }) : jsonResponse({ error: "Late archive failure" }, false)); });
    expect(container.textContent).toContain("Jordan Lee"); expect(container.querySelector<HTMLSelectElement>(".stage-select select")?.value).toBe("new"); expect(container.querySelector('[role="dialog"]')).toBeNull(); expect(container.querySelector('[role="status"]')).toBeNull(); expect(container.querySelector('[role="alert"]')).toBeNull(); expect(routerState.push).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  it.each(["success", "failure"] as const)("ignores a late delete %s and redirect when opportunity id changes", async (outcome) => {
    let resolveDelete!: (value: Response) => void;
    const deleteRequest = new Promise<Response>((resolve) => { resolveDelete = resolve; });
    const next = { ...connection, id: "opportunity-2", label: "Jordan Lee", tasks: [] };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(connection)).mockReturnValueOnce(deleteRequest).mockResolvedValueOnce(jsonResponse(next));
    const { container, root } = mountDetail(); await flush();
    act(() => container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click()); act(() => [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((button) => button.textContent === "Delete permanently")!.click()); act(() => container.querySelector<HTMLFormElement>("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    act(() => root.render(<OpportunityDetailPage opportunityId="opportunity-2" today="2026-07-13" />)); await flush();
    await act(async () => { resolveDelete(outcome === "success" ? jsonResponse({}) : jsonResponse({ error: "Late delete failure" }, false)); });
    expect(routerState.push).not.toHaveBeenCalled(); expect(container.textContent).toContain("Jordan Lee"); expect(container.querySelector('[role="status"]')).toBeNull(); expect(container.querySelector('[role="alert"]')).toBeNull();
    act(() => root.unmount());
  });

  it("does not redirect when a delete settles after a new opportunity commits before passive invalidation", async () => {
    let resolveDelete!: (value: Response) => void;
    const deleteRequest = new Promise<Response>((resolve) => { resolveDelete = resolve; });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(connection))
      .mockReturnValueOnce(deleteRequest);
    const { container, root } = mountDetail();
    await flush();
    act(() => container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click());
    act(() => [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((button) => button.textContent === "Delete permanently")!.click());
    act(() => container.querySelector<HTMLFormElement>("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

    effectState.skip = true;
    flushSync(() => root.render(<OpportunityDetailPage opportunityId="opportunity-2" today="2026-07-13" />));
    await act(async () => { resolveDelete(jsonResponse({})); await Promise.resolve(); });

    expect(routerState.push).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  it("does not show a task failure when it settles after a new opportunity commits before passive invalidation", async () => {
    let resolveTask!: (value: Response) => void;
    const taskRequest = new Promise<Response>((resolve) => { resolveTask = resolve; });
    const due = { ...connection.tasks[0], dueDate: "2026-07-13" };
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ ...connection, tasks: [due] }))
      .mockReturnValueOnce(taskRequest);
    const { container, root } = mountDetail({ attentionTarget: { kind: "task", taskId: due.id } });
    await flush();
    act(() => container.querySelector<HTMLButtonElement>(".attention-context .button--primary")!.click());

    effectState.skip = true;
    flushSync(() => root.render(<OpportunityDetailPage opportunityId="opportunity-2" today="2026-07-13" />));
    await act(async () => { resolveTask(jsonResponse({ error: "Late task failure" }, false)); await Promise.resolve(); });

    expect(container.querySelector('[role="alert"]')).toBeNull();
    act(() => root.unmount());
  });

  it("does not follow a linked-job success after a new opportunity commits before passive invalidation", async () => {
    let resolveLinkedJob!: (value: Response) => void;
    const linkedJobRequest = new Promise<Response>((resolve) => { resolveLinkedJob = resolve; });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(connection))
      .mockReturnValueOnce(linkedJobRequest);
    const { container, root } = mountDetail();
    await flush();
    act(() => container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click());
    act(() => [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((button) => button.textContent === "Create job opportunity")!.click());
    act(() => change(container.querySelector<HTMLInputElement>('input[required]')!, "Late linked job"));
    act(() => container.querySelector<HTMLFormElement>("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

    effectState.skip = true;
    flushSync(() => root.render(<OpportunityDetailPage opportunityId="opportunity-2" today="2026-07-13" />));
    await act(async () => { resolveLinkedJob(jsonResponse({ ...job, id: "job-2" })); await Promise.resolve(); });

    expect(routerState.push).not.toHaveBeenCalled();
    act(() => root.unmount());
  });
});

describe("OpportunityDetailContent", () => {
  it("uses a compact command header before the workspace", () => {
    const markup = renderToStaticMarkup(<OpportunityDetailContent detail={connection} onTaskAction={vi.fn()} />);

    expect(markup).toContain('class="detail-command"');
    expect(markup).toContain('class="detail-command__top"');
    expect(markup).toContain('class="detail-command__identity"');
    expect(markup).toContain('class="detail-command__controls"');
    expect(markup).toMatch(/detail-command[\s\S]*detail-action-bar[\s\S]*stage-select[\s\S]*Opportunity workspace/);
  });

  it("shows only useful connection facts and one contextual empty prompt", () => {
    const markup = renderToStaticMarkup(<OpportunitySnapshot detail={{ ...connection, roleContext: null, contactInfo: null, meetingContext: null, lastInteractionAt: null, originatedJobs: [] }} onEdit={vi.fn()} />);

    expect(markup).toContain("About this connection");
    expect(markup).toContain('class="snapshot-badge">');
    expect(markup).toContain("Add context to make future follow-ups easier.");
    expect(markup).toContain("Edit details");
    expect(markup).not.toContain("Not set");
    expect(markup).not.toContain("Role or context");
  });

  it("exposes the current opportunity status to the stage selector", () => {
    const connectionMarkup = renderToStaticMarkup(<OpportunityDetailContent detail={connection} onTaskAction={vi.fn()} />);
    const jobMarkup = renderToStaticMarkup(<OpportunityDetailContent detail={job} onTaskAction={vi.fn()} />);

    expect(connectionMarkup).toContain('class="stage-select" data-status="in_conversation"');
    expect(jobMarkup).toContain('class="stage-select" data-status="applied"');
  });

  it("shows archived as an accurate disabled current stage without offering it as a transition", () => {
    const activeMarkup = renderToStaticMarkup(<OpportunityDetailContent detail={job} onTaskAction={vi.fn()} />);
    const archivedMarkup = renderToStaticMarkup(<OpportunityDetailContent detail={{ ...job, status: "archived" }} onTaskAction={vi.fn()} />);

    expect(activeMarkup).not.toContain('<option disabled="" value="archived">');
    expect(archivedMarkup).toContain('<option disabled="" value="archived" selected="">Archived</option>');
  });

  it("keeps Archive out of the stage selector so it requires More confirmation", () => {
    const markup = renderToStaticMarkup(<OpportunityDetailContent detail={{ ...connection, status: "archived" }} onTaskAction={vi.fn()} />);

    expect(markup).not.toContain('<option value="archived">');
    expect(markup).toContain("More");
  });

  it("uses the panel header/title contract for inline panels", () => {
    const titles = ["Record interaction", "Add task", "Edit details", "Create linked job"];
    const markup = titles.map((title) => renderToStaticMarkup(<TrackerPanel title={title}>Panel content</TrackerPanel>));

    for (const [index, title] of titles.entries()) {
      expect(markup[index]).toContain(`<header class="tracker-panel__header"><h2 class="tracker-panel__title">${title}</h2></header>`);
    }
  });

  it("renders connection context, activity, tasks, and actions", () => {
    const markup = renderToStaticMarkup(<OpportunityDetailContent detail={connection} onTaskAction={vi.fn()} />);
    expect(markup).toContain("Connection");
    expect(markup).toContain("Maya Chen");
    expect(markup).toContain("Familiar");
    expect(markup).toContain("Meeting");
    expect(markup).toContain("Send portfolio");
    expect(markup).toContain("Record interaction");
    expect(markup).toContain("More");
    const actionBar = markup.match(/<div class="detail-action-bar">(.*?)<\/div>/)?.[1] ?? "";
    expect(actionBar).toContain("Record interaction");
    expect(actionBar).toContain("Add task");
    expect(actionBar).toContain("More");
    expect(actionBar).not.toContain("Create job opportunity");
    expect(actionBar).not.toContain("Edit details");
    expect(actionBar).not.toContain("Archive");
    expect(actionBar).not.toContain("Delete permanently");
    expect(markup).toContain("Contact");
    expect(markup).toContain("Last interaction");
  });

  it("renders job materials without relationship controls", () => {
    const markup = renderToStaticMarkup(<OpportunityDetailContent detail={job} onTaskAction={vi.fn()} />);
    expect(markup).toContain("Job");
    expect(markup).toContain("Engineering Manager");
    expect(markup).toContain("Application materials");
    expect(markup).toContain("Fit Analysis");
    expect(markup).toContain("Priority");
    expect(markup).toContain("Posting");
    expect(markup).toContain("Applied");
    expect(markup).not.toContain("Relationship strength");
  });

  it("renders task rescheduling controls", () => {
    const markup = renderToStaticMarkup(<OpportunityDetailContent detail={job} onTaskAction={vi.fn()} />);
    expect(markup).toContain("Reschedule");
  });

  it("renders the aligned detail structure with activity before materials", () => {
    const markup = renderToStaticMarkup(<OpportunityDetailContent detail={job} onTaskAction={vi.fn()} />);
    expect(markup).toContain('class="detail-nav__back"');
    expect(markup).toContain('class="detail-main"');
    expect(markup).toContain('class="detail-side"');
    expect(markup).toContain('class="next-action-card actions-card"');
    expect(markup).toContain('class="tracker-panel__header"');
    expect(markup).toContain('class="detail-list detail-list--compact"');
    expect(markup.indexOf("Activity history")).toBeLessThan(markup.indexOf("Application materials"));
    expect(markup.indexOf('class="next-action-card actions-card"')).toBeLessThan(markup.indexOf('class="detail-list detail-list--compact"'));
  });

  it("keeps activity and materials as detail-main siblings while dialogs stay outside the grid", async () => {
    const longArtifact = { ...job.artifacts[0], title: "A very long application artifact title that must not widen the task sidebar" };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ ...job, artifacts: [longArtifact] }));
    const { container, root } = mountDetail();
    await flush();
    act(() => [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Add task")!.click());

    const main = container.querySelector(".detail-main")!;
    const mainPanels = [...main.children];
    expect(mainPanels).toHaveLength(2);
    expect(mainPanels.map((panel) => panel.querySelector(".tracker-panel__title")?.textContent)).toEqual(["Activity history", "Application materials"]);
    expect(mainPanels[0].nextElementSibling).toBe(mainPanels[1]);

    const grid = container.querySelector(".detail-grid")!;
    const dialog = container.querySelector('[role="dialog"]')!;
    expect(dialog.closest(".modal-backdrop")?.parentElement).toBe(grid.parentElement);
    expect(grid.contains(dialog)).toBe(false);
    act(() => root.unmount());
  });

  it("opens Add task from the no-task CTA and restores that CTA on close", async () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { callback(0); return 1; });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ ...connection, tasks: [] }));
    const { container, root } = mountDetail();
    await flush();
    const cta = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Set a next action")!;

    act(() => cta.click());

    expect(container.querySelector('[role="dialog"]')?.classList.contains("modal--compact")).toBe(true);
    expect(document.activeElement).toBe(container.querySelector<HTMLInputElement>("input[required]"));
    act(() => container.querySelector<HTMLButtonElement>(".modal__close")!.click());
    expect(document.activeElement).toBe(cta);
    act(() => root.unmount());
  });

  it("renders interaction and task composers with application form hooks", () => {
    const interactionMarkup = renderToStaticMarkup(<InteractionComposer activityType="note" body="" occurredDate="" taskTitle="" taskDueDate="" onActivityTypeChange={vi.fn()} onBodyChange={vi.fn()} onOccurredDateChange={vi.fn()} onTaskTitleChange={vi.fn()} onTaskDueDateChange={vi.fn()} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    const taskMarkup = renderToStaticMarkup(<TaskComposer taskTitle="" taskDueDate="" onTaskTitleChange={vi.fn()} onTaskDueDateChange={vi.fn()} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(interactionMarkup).toContain('class="application-form interaction-form"');
    expect(interactionMarkup).toContain('class="application-form__input"');
    expect(interactionMarkup).toContain('class="application-form__select"');
    expect(interactionMarkup).toContain('class="application-form__textarea"');
    expect(interactionMarkup).toContain('class="application-form__body"');
    expect(interactionMarkup).toContain('class="application-form interaction-form"');
    expect(interactionMarkup).toContain('class="application-form__grid interaction-form__meta"');
    expect(interactionMarkup).toContain('class="application-form__field interaction-form__narrative"');
    expect(interactionMarkup).toContain('class="interaction-form__followup"');
    expect(interactionMarkup).toContain("Plan the follow-up");
    expect(interactionMarkup).toContain("Capture the conversation, context, and anything worth remembering…");
    expect(interactionMarkup).toContain('class="application-form__actions"');
    expect(interactionMarkup).toMatch(/application-form__body[\s\S]*application-form__actions/);
    expect(interactionMarkup).toContain('type="date"');
    expect(taskMarkup).toContain('class="application-form task-composer-form"');
    expect(taskMarkup).toContain('class="application-form task-composer-form"');
    expect(taskMarkup).toContain('class="task-composer-form__intro"');
    expect(taskMarkup).toContain("Make the next move concrete");
    expect(taskMarkup).toContain('class="application-form__input"');
    expect(taskMarkup).toContain('class="application-form__body"');
    expect(taskMarkup).toContain('class="application-form__actions"');
    expect(taskMarkup).toMatch(/application-form__body[\s\S]*application-form__actions/);
    expect(taskMarkup).toContain('type="date"');
  });

  it("renders origin links in both directions", () => {
    const linkedJob = { ...job, id: "job-2", originOpportunityId: connection.id, origin: connection };
    const connectionWithJob = { ...connection, originatedJobs: [linkedJob] };
    expect(renderToStaticMarkup(<OpportunityDetailContent detail={linkedJob} onTaskAction={vi.fn()} />)).toContain("Maya Chen");
    expect(renderToStaticMarkup(<OpportunityDetailContent detail={connectionWithJob} onTaskAction={vi.fn()} />)).toContain("Engineering Manager");
  });

  it("keeps a failed interaction dialog and its isolated draft open with an alert", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(connection)).mockResolvedValueOnce(jsonResponse({ error: "Interaction rejected" }, false));
    const { container, root } = mountDetail();
    await flush();
    const record = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Record interaction")!;
    act(() => record.click());
    const body = container.querySelector<HTMLTextAreaElement>("textarea")!;
    act(() => change(body, "Followed up after panel"));
    act(() => container.querySelector<HTMLFormElement>("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await flush();
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Interaction rejected");
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("Followed up after panel");
    act(() => root.unmount());
  });

  it("retains focus in an interaction draft while typing rerenders the dialog", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(connection));
    const { container, root } = mountDetail();
    await flush();
    act(() => [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Record interaction")!.click());
    const body = container.querySelector<HTMLTextAreaElement>("textarea")!;
    body.focus();
    act(() => change(body, "Draft note"));
    expect(document.activeElement).toBe(body);
    act(() => root.unmount());
  });

  it("submits an interaction only once while its request is pending", async () => {
    let resolveRequest!: (value: Response) => void;
    const request = new Promise<Response>((resolve) => { resolveRequest = resolve; });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(connection)).mockReturnValueOnce(request);
    const { container, root } = mountDetail();
    await flush();
    act(() => [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Record interaction")!.click());
    act(() => change(container.querySelector<HTMLTextAreaElement>("textarea")!, "Draft"));
    const form = container.querySelector<HTMLFormElement>("form")!;
    act(() => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
    await act(async () => { resolveRequest(jsonResponse(connection)); });
    act(() => root.unmount());
  });

  it("ignores a cancelled interaction result and preserves background errors outside dialogs", async () => {
    let resolveRequest!: (value: Response) => void;
    const request = new Promise<Response>((resolve) => { resolveRequest = resolve; });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(connection)).mockReturnValueOnce(request);
    const { container, root } = mountDetail();
    await flush();
    const record = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Record interaction")!;
    act(() => record.click());
    act(() => change(container.querySelector<HTMLTextAreaElement>("textarea")!, "Draft"));
    act(() => container.querySelector<HTMLFormElement>("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    act(() => [...container.querySelector('[role="dialog"]')!.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Cancel")!.click());
    await act(async () => { resolveRequest(jsonResponse({ ...connection, label: "Stale result" })); });
    expect(container.textContent).not.toContain("Stale result");
    expect(container.querySelector('[role="status"]')).toBeNull();
    act(() => root.unmount());
  });

  it("keeps the newest dialog result when an older request resolves out of order", async () => {
    let resolveFirst!: (value: Response) => void;
    let resolveSecond!: (value: Response) => void;
    const first = new Promise<Response>((resolve) => { resolveFirst = resolve; });
    const second = new Promise<Response>((resolve) => { resolveSecond = resolve; });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(connection)).mockReturnValueOnce(first).mockReturnValueOnce(second);
    const { container, root } = mountDetail();
    await flush();
    const record = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Record interaction")!;
    act(() => record.click());
    act(() => change(container.querySelector<HTMLTextAreaElement>("textarea")!, "First"));
    act(() => container.querySelector<HTMLFormElement>("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    act(() => container.querySelector<HTMLButtonElement>(".modal__close")!.click());
    act(() => record.click());
    act(() => change(container.querySelector<HTMLTextAreaElement>("textarea")!, "Second"));
    act(() => container.querySelector<HTMLFormElement>("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await act(async () => { resolveSecond(jsonResponse({ ...connection, label: "Newest result" })); });
    await act(async () => { resolveFirst(jsonResponse({ ...connection, label: "Stale result" })); });
    expect(container.textContent).toContain("Newest result");
    expect(container.textContent).not.toContain("Stale result");
    act(() => root.unmount());
  });

  it("keeps a task pending while a dialog opens and applies its result independently", async () => {
    let resolveTask!: (value: Response) => void;
    const taskRequest = new Promise<Response>((resolve) => { resolveTask = resolve; });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(connection)).mockReturnValueOnce(taskRequest);
    const { container, root } = mountDetail();
    await flush();

    act(() => [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Complete")!.click());
    act(() => [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Record interaction")!.click());

    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect([...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Complete")?.disabled).toBe(true);

    await act(async () => { resolveTask(jsonResponse({ ...connection, label: "Task update applied" })); });

    expect(container.textContent).toContain("Maya Chen");
    expect(container.textContent).not.toContain("Task update applied");
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect([...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Complete")?.disabled).toBe(false);
    act(() => root.unmount());
  });

  it("serializes stage PATCH writes and does not issue a second mutation while the first is pending", async () => {
    let resolveFirst!: (value: Response) => void;
    const first = new Promise<Response>((resolve) => { resolveFirst = resolve; });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(connection)).mockReturnValueOnce(first).mockResolvedValueOnce(jsonResponse({ ...connection, status: "waiting" }));
    const { container, root } = mountDetail();
    await flush();
    const stage = container.querySelector<HTMLSelectElement>(".stage-select select")!;

    act(() => change(stage, "outreach_planned"));
    act(() => change(stage, "waiting"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(stage.disabled).toBe(true);
    await act(async () => { resolveFirst(jsonResponse({ ...connection, status: "outreach_planned" })); });

    expect(stage.disabled).toBe(false);
    act(() => change(stage, "waiting"));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await flush();

    expect(stage.value).toBe("waiting");
    act(() => root.unmount());
  });

  it.each(["task-first", "status-first"] as const)("merges divergent task and status responses when %s resolves first", async (resolutionOrder) => {
    let resolveTask!: (value: Response) => void;
    let resolveStatus!: (value: Response) => void;
    const taskResponse = new Promise<Response>((resolve) => { resolveTask = resolve; });
    const statusResponse = new Promise<Response>((resolve) => { resolveStatus = resolve; });
    const completedTask = { ...connection.tasks[0], state: "completed" as const, completedAt: "2026-07-12T12:00:00.000Z", updatedAt: "2026-07-12T12:00:00.000Z" };
    const taskActivity = { ...connection.activities[0], id: "activity-task", body: "Portfolio sent", occurredAt: "2026-07-12T12:00:00.000Z" };
    const taskSnapshot = { ...connection, label: "Task response identity", status: "in_conversation" as const, tasks: [completedTask], activities: [taskActivity], updatedAt: "2026-07-12T12:00:00.000Z" };
    const statusSnapshot = { ...connection, label: "Status response identity", status: "waiting" as const, tasks: [connection.tasks[0]], activities: [connection.activities[0]], updatedAt: "2026-07-12T13:00:00.000Z" };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(connection)).mockReturnValueOnce(taskResponse).mockReturnValueOnce(statusResponse);
    const { container, root } = mountDetail();
    await flush();

    act(() => [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Complete")!.click());
    act(() => change(container.querySelector<HTMLSelectElement>(".stage-select select")!, "waiting"));
    if (resolutionOrder === "task-first") {
      await act(async () => { resolveTask(jsonResponse(taskSnapshot)); });
      await act(async () => { resolveStatus(jsonResponse(statusSnapshot)); });
    } else {
      await act(async () => { resolveStatus(jsonResponse(statusSnapshot)); });
      await act(async () => { resolveTask(jsonResponse(taskSnapshot)); });
    }

    expect(container.querySelector<HTMLSelectElement>(".stage-select select")?.value).toBe("waiting");
    expect(container.textContent).toContain("Maya Chen");
    expect(container.textContent).not.toContain("Task response identity");
    expect(container.textContent).not.toContain("Status response identity");
    expect(container.textContent).toContain("Portfolio sent");
    expect([...container.querySelectorAll<HTMLButtonElement>("button")].some((button) => button.textContent === "Complete")).toBe(false);
    act(() => root.unmount());
  });

  it("resets an interaction draft when Cancel closes its dialog", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(connection));
    const { container, root } = mountDetail();
    await flush();
    const record = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Record interaction")!;
    act(() => record.click());
    act(() => change(container.querySelector<HTMLTextAreaElement>("textarea")!, "Draft note"));
    act(() => [...container.querySelector('[role="dialog"]')!.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Cancel")!.click());
    await flush();
    act(() => record.click());
    await flush();
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("");
    act(() => root.unmount());
  });

  it("resets successful interaction and task drafts before reopening while preserving failed drafts", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(connection))
      .mockResolvedValueOnce(jsonResponse(connection))
      .mockResolvedValueOnce(jsonResponse(connection));
    const { container, root } = mountDetail();
    await flush();
    const record = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Record interaction")!;
    const addTask = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Add task")!;

    act(() => record.click());
    act(() => change(container.querySelector<HTMLTextAreaElement>("textarea")!, "Saved note"));
    act(() => container.querySelector<HTMLFormElement>("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await flush();
    act(() => record.click());
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("");
    act(() => container.querySelector<HTMLButtonElement>(".modal__close")!.click());

    act(() => addTask.click());
    act(() => change(container.querySelector<HTMLInputElement>("input[required]")!, "Saved task"));
    act(() => container.querySelector<HTMLFormElement>("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await flush();
    act(() => addTask.click());
    expect(container.querySelector<HTMLInputElement>("input[required]")?.value).toBe("");
    act(() => root.unmount());
  });

  it("posts only the linked job opportunity payload and closes with a named success status", async () => {
    const created = { ...job, id: "job-2", originOpportunityId: connection.id, origin: connection };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(connection)).mockResolvedValueOnce(jsonResponse(created));
    const { container, root } = mountDetail();
    await flush();
    act(() => container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click());
    act(() => [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((button) => button.textContent === "Create job opportunity")!.click());
    const field = (label: string) => [...container.querySelectorAll("label")].find((candidate) => candidate.textContent?.includes(label))?.querySelector("input") as HTMLInputElement;
    act(() => { change(field("Role"), "Staff Engineer"); change(field("Organization"), "Acme"); });
    act(() => container.querySelector<HTMLFormElement>("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await flush();
    const [, request] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(request.body as string)).toMatchObject({ type: "job", label: "Staff Engineer", originOpportunityId: connection.id });
    expect(JSON.parse(request.body as string)).not.toHaveProperty("initialTask");
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Linked job created");
    expect(routerState.push).toHaveBeenCalledWith("/opportunities/job-2");
    act(() => root.unmount());
  });

  it("keeps a failed task dialog open with its draft and a dialog-scoped error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(connection)).mockResolvedValueOnce(jsonResponse({ error: "Task rejected" }, false));
    const { container, root } = mountDetail();
    await flush();
    act(() => [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Add task")!.click());
    act(() => change(container.querySelector<HTMLInputElement>("input[required]")!, "Send follow-up"));
    act(() => container.querySelector<HTMLFormElement>("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await flush();

    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Task rejected");
    expect(container.querySelector<HTMLInputElement>("input[required]")?.value).toBe("Send follow-up");
    act(() => root.unmount());
  });

  it("keeps a failed connection edit dialog open in edit mode", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(connection)).mockResolvedValueOnce(jsonResponse({ error: "Edit rejected" }, false));
    const { container, root } = mountDetail();
    await flush();
    act(() => container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click());
    act(() => [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((button) => button.textContent === "Edit details")!.click());
    const name = [...container.querySelectorAll("label")].find((label) => label.textContent?.includes("Person's name"))!.querySelector("input")!;
    act(() => change(name, "Maya Rivera"));
    act(() => container.querySelector<HTMLFormElement>("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await flush();

    expect(container.querySelector('[role="dialog"]')?.classList.contains("modal--wide")).toBe(true);
    expect(container.textContent).toContain("Plan your Next move");
    expect(container.textContent).not.toContain("Initial interaction");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Edit rejected");
    expect((name as HTMLInputElement).value).toBe("Maya Rivera");
    act(() => root.unmount());
  });

  it("applies a successful edit and closes its dialog", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(connection)).mockResolvedValueOnce(jsonResponse({ ...connection, label: "Maya Rivera" }));
    const { container, root } = mountDetail();
    await flush();
    act(() => container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click());
    act(() => [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((button) => button.textContent === "Edit details")!.click());
    const name = [...container.querySelectorAll("label")].find((label) => label.textContent?.includes("Person's name"))!.querySelector("input")!;
    act(() => change(name, "Maya Rivera"));
    act(() => container.querySelector<HTMLFormElement>("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await flush();

    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.textContent).toContain("Maya Rivera");
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Details saved");
    act(() => root.unmount());
  });

  it("keeps a failed linked-job draft open", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(connection)).mockResolvedValueOnce(jsonResponse({ error: "Linked job rejected" }, false));
    const { container, root } = mountDetail();
    await flush();
    act(() => container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click());
    act(() => [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((button) => button.textContent === "Create job opportunity")!.click());
    const role = [...container.querySelectorAll("label")].find((label) => label.textContent?.includes("Role"))!.querySelector("input")!;
    act(() => change(role, "Staff Engineer"));
    act(() => container.querySelector<HTMLFormElement>("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await flush();

    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Linked job rejected");
    expect((role as HTMLInputElement).value).toBe("Staff Engineer");
    act(() => root.unmount());
  });

  it("uses compact primary dialogs and restores the originating primary or More trigger", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(connection));
    const { container, root } = mountDetail();
    await flush();
    const record = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Record interaction")!;
    act(() => record.click());
    expect(container.querySelector('[role="dialog"]')?.classList.contains("modal--compact")).toBe(true);
    act(() => container.querySelector<HTMLButtonElement>(".modal__close")!.click());
    expect(document.activeElement).toBe(record);

    const more = container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
    act(() => more.click());
    act(() => [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((button) => button.textContent === "Edit details")!.click());
    expect(container.querySelector('[role="dialog"]')?.classList.contains("modal--wide")).toBe(true);
    act(() => container.querySelector<HTMLButtonElement>(".modal__close")!.click());
    expect(document.activeElement).toBe(more);
    act(() => root.unmount());
  });

  it("opens named archive and danger delete confirmations from More, then the safe action restores More", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(connection));
    const { container, root } = mountDetail();
    await flush();
    const more = container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;

    act(() => more.click());
    act(() => [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((button) => button.textContent === "Archive")!.click());
    const archiveDialog = container.querySelector('[role="dialog"]')!;
    expect(archiveDialog.textContent).toContain("Archive Maya Chen");
    expect(archiveDialog.querySelector(".confirmation-form--archive")).not.toBeNull();
    expect(archiveDialog.querySelector(".application-form__body")?.nextElementSibling?.classList.contains("application-form__actions")).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.textContent).toBe("Archive opportunity");
    act(() => [...container.querySelector('[role="dialog"]')!.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Keep active")!.click());
    expect(document.activeElement).toBe(more);

    act(() => more.click());
    act(() => [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((button) => button.textContent === "Delete permanently")!.click());
    const deleteDialog = container.querySelector('[role="dialog"]')!;
    expect(deleteDialog.textContent).toContain("Delete Maya Chen permanently");
    expect(deleteDialog.querySelector(".confirmation-form--danger")).not.toBeNull();
    expect(deleteDialog.querySelector(".application-form__body")?.nextElementSibling?.classList.contains("application-form__actions")).toBe(true);
    expect(deleteDialog.querySelector<HTMLButtonElement>('button[type="submit"]')?.classList.contains("button--danger")).toBe(true);
    act(() => root.unmount());
  });

  it("locks archive confirmation duplicates, preserves a failure, and merges the successful status without navigation", async () => {
    let resolveArchive!: (value: Response) => void;
    const archiveRequest = new Promise<Response>((resolve) => { resolveArchive = resolve; });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(connection)).mockReturnValueOnce(archiveRequest);
    const { container, root } = mountDetail();
    await flush();
    act(() => container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click());
    act(() => [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((button) => button.textContent === "Archive")!.click());
    const form = container.querySelector<HTMLFormElement>("form")!;
    act(() => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
    await act(async () => { resolveArchive(jsonResponse({ error: "Archive rejected" }, false)); });
    expect(container.querySelector(".application-form__body [role=\"alert\"]")?.textContent).toContain("Archive rejected");
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Archive rejected");

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ ...connection, status: "archived" }));
    act(() => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await flush();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector(".stage-select")?.getAttribute("data-status")).toBe("archived");
    expect(routerState.push).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  it("navigates once only after successful delete and ignores a late delete result after unmount", async () => {
    let resolveDelete!: (value: Response) => void;
    const deleteRequest = new Promise<Response>((resolve) => { resolveDelete = resolve; });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(connection)).mockReturnValueOnce(deleteRequest);
    const { container, root } = mountDetail();
    await flush();
    act(() => container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click());
    act(() => [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((button) => button.textContent === "Delete permanently")!.click());
    const form = container.querySelector<HTMLFormElement>("form")!;
    act(() => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => { resolveDelete(jsonResponse({})); });
    expect(routerState.push).toHaveBeenCalledTimes(1);
    expect(routerState.push).toHaveBeenCalledWith("/");
    act(() => root.unmount());

    let resolveLateDelete!: (value: Response) => void;
    const lateDelete = new Promise<Response>((resolve) => { resolveLateDelete = resolve; });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(connection)).mockReturnValueOnce(lateDelete);
    const late = mountDetail();
    await flush();
    act(() => late.container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click());
    act(() => [...late.container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((button) => button.textContent === "Delete permanently")!.click());
    act(() => late.container.querySelector<HTMLFormElement>("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    act(() => late.root.unmount());
    await act(async () => { resolveLateDelete(jsonResponse({})); });
    expect(routerState.push).toHaveBeenCalledTimes(1);
  });

  it("does not issue archive PATCH while a stage PATCH is pending", async () => {
    let resolveStage!: (value: Response) => void;
    const stageRequest = new Promise<Response>((resolve) => { resolveStage = resolve; });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(connection)).mockReturnValueOnce(stageRequest);
    const { container, root } = mountDetail();
    await flush();

    act(() => change(container.querySelector<HTMLSelectElement>(".stage-select select")!, "waiting"));
    const more = container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
    expect(more.disabled).toBe(true);
    act(() => more.click());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => { resolveStage(jsonResponse({ ...connection, status: "waiting" })); });
    act(() => root.unmount());
  });

  it("does not start a stage request while archive is pending", async () => {
    let resolveArchive!: (value: Response) => void;
    const archiveRequest = new Promise<Response>((resolve) => { resolveArchive = resolve; });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(connection)).mockReturnValueOnce(archiveRequest);
    const { container, root } = mountDetail();
    await flush();
    act(() => container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click());
    act(() => [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((button) => button.textContent === "Archive")!.click());
    act(() => container.querySelector<HTMLFormElement>("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

    act(() => change(container.querySelector<HTMLSelectElement>(".stage-select select")!, "waiting"));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => { resolveArchive(jsonResponse({ ...connection, status: "archived" })); });
    act(() => root.unmount());
  });

  it("keeps the first archive response active after a duplicate submission", async () => {
    let resolveArchive!: (value: Response) => void;
    const archiveRequest = new Promise<Response>((resolve) => { resolveArchive = resolve; });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(connection)).mockReturnValueOnce(archiveRequest);
    const { container, root } = mountDetail();
    await flush();
    act(() => container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click());
    act(() => [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((button) => button.textContent === "Archive")!.click());
    const form = container.querySelector<HTMLFormElement>("form")!;
    act(() => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => { resolveArchive(jsonResponse({ ...connection, status: "archived" })); });
    expect(container.querySelector(".stage-select")?.getAttribute("data-status")).toBe("archived");
    act(() => root.unmount());
  });

  it("keeps a failed delete confirmation open with its error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(connection)).mockResolvedValueOnce(jsonResponse({ error: "Delete rejected" }, false));
    const { container, root } = mountDetail();
    await flush();
    act(() => container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click());
    act(() => [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((button) => button.textContent === "Delete permanently")!.click());
    act(() => container.querySelector<HTMLFormElement>("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await flush();

    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Delete rejected");
    expect(routerState.push).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  it("ignores an archive result that arrives after unmount", async () => {
    let resolveArchive!: (value: Response) => void;
    const archiveRequest = new Promise<Response>((resolve) => { resolveArchive = resolve; });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(connection)).mockReturnValueOnce(archiveRequest);
    const { container, root } = mountDetail();
    await flush();
    act(() => container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click());
    act(() => [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((button) => button.textContent === "Archive")!.click());
    act(() => container.querySelector<HTMLFormElement>("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    act(() => root.unmount());
    await act(async () => { resolveArchive(jsonResponse({ ...connection, status: "archived" })); });
    expect(routerState.push).not.toHaveBeenCalled();
  });

  it("does not dismiss a pending destructive confirmation", async () => {
    let resolveArchive!: (value: Response) => void;
    const archiveRequest = new Promise<Response>((resolve) => { resolveArchive = resolve; });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(connection)).mockReturnValueOnce(archiveRequest);
    const { container, root } = mountDetail();
    await flush();
    act(() => container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click());
    act(() => [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((button) => button.textContent === "Archive")!.click());
    act(() => container.querySelector<HTMLFormElement>("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    const dialog = () => container.querySelector('[role="dialog"]');
    const cancel = [...dialog()!.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Keep active")!;

    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(dialog()).not.toBeNull();
    act(() => container.querySelector<HTMLElement>(".modal-backdrop")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(dialog()).not.toBeNull();
    act(() => container.querySelector<HTMLButtonElement>(".modal__close")!.click());
    expect(dialog()).not.toBeNull();
    expect(cancel.disabled).toBe(true);
    act(() => cancel.click());
    expect(dialog()).not.toBeNull();

    await act(async () => { resolveArchive(jsonResponse({ ...connection, status: "archived" })); });
    act(() => root.unmount());
  });
});
