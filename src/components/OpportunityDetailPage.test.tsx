// @vitest-environment jsdom

import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const routerState = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => routerState }));
vi.mock("next/link", () => ({ default: (props: ComponentProps<"a">) => <a {...props} /> }));

import type { OpportunityDetail } from "../types";
import { InteractionComposer, OpportunityDetailContent, OpportunityDetailPage, TaskComposer, TrackerPanel } from "./OpportunityDetailPage";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function jsonResponse(body: unknown, ok = true) { return { ok, status: ok ? 200 : 422, json: async () => body } as Response; }
function change(control: HTMLInputElement | HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(control), "value")?.set?.call(control, value);
  control.dispatchEvent(new Event("input", { bubbles: true }));
  control.dispatchEvent(new Event("change", { bubbles: true }));
}
function mountDetail() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root;
  act(() => { root = createRoot(container); root.render(<OpportunityDetailPage opportunityId="opportunity-1" />); });
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
  vi.restoreAllMocks();
  routerState.push.mockReset();
  document.body.innerHTML = "";
});

describe("OpportunityDetailContent", () => {
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

  it("renders the aligned detail structure with activity before materials", () => {
    const markup = renderToStaticMarkup(<OpportunityDetailContent detail={job} onTaskAction={vi.fn()} />);
    expect(markup).toContain('class="detail-nav__back"');
    expect(markup).toContain('class="detail-main"');
    expect(markup).toContain('class="detail-side"');
    expect(markup).toContain('class="next-action-card"');
    expect(markup).toContain('class="tracker-panel__header"');
    expect(markup).toContain('class="detail-list"');
    expect(markup.indexOf("Activity history")).toBeLessThan(markup.indexOf("Application materials"));
    expect(markup.indexOf('class="next-action-card"')).toBeLessThan(markup.indexOf('class="detail-list"'));
  });

  it("renders interaction and task composers with application form hooks", () => {
    const interactionMarkup = renderToStaticMarkup(<InteractionComposer activityType="note" body="" occurredDate="" taskTitle="" taskDueDate="" onActivityTypeChange={vi.fn()} onBodyChange={vi.fn()} onOccurredDateChange={vi.fn()} onTaskTitleChange={vi.fn()} onTaskDueDateChange={vi.fn()} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    const taskMarkup = renderToStaticMarkup(<TaskComposer taskTitle="" taskDueDate="" onTaskTitleChange={vi.fn()} onTaskDueDateChange={vi.fn()} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(interactionMarkup).toContain('class="application-form"');
    expect(interactionMarkup).toContain('class="application-form__input"');
    expect(interactionMarkup).toContain('class="application-form__select"');
    expect(interactionMarkup).toContain('class="application-form__textarea"');
    expect(interactionMarkup).toContain('class="application-form__actions"');
    expect(interactionMarkup).toContain('type="date"');
    expect(taskMarkup).toContain('class="application-form"');
    expect(taskMarkup).toContain('class="application-form__input"');
    expect(taskMarkup).toContain('class="application-form__actions"');
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
    act(() => [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Cancel")!.click());
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
});
