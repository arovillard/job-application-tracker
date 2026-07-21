// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { OpportunityDetail, OpportunitySummary } from "../types";
const themeState = vi.hoisted(() => ({ theme: "light" as "light" | "dark", setTheme: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("./ThemeProvider", () => ({ useTheme: () => themeState }));
const toastState = vi.hoisted(() => ({ props: null as { message: string | null; actionLabel?: string; onAction?: () => void } | null }));
vi.mock("./Toast", () => ({ Toast: (props: { message: string | null; actionLabel?: string; onAction?: () => void }) => {
  toastState.props = props;
  return null;
} }));

import { Dashboard } from "./Dashboard";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mountDashboard() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(<Dashboard />);
  });
  return { container, root: root! };
}

const job: OpportunitySummary = {
  id: "job-1", type: "job", label: "Platform Engineer", organization: "Acme Corp", status: "applied", priority: "high", summary: null, originOpportunityId: null,
  createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-11T08:00:00.000Z", url: null, source: null, location: "Remote", contact: null, appliedDate: null, nextOpenTask: null
};
const connection: OpportunitySummary = {
  id: "connection-1", type: "connection", label: "Maya Chen", organization: null, status: "in_conversation", priority: "medium", summary: null, originOpportunityId: null,
  createdAt: "2026-07-02T00:00:00.000Z", updatedAt: "2026-07-12T08:00:00.000Z", roleContext: "Engineering leader", contactInfo: null, meetingContext: null, relationshipStrength: "strong", lastInteractionAt: null, nextOpenTask: null
};

function jsonResponse(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 422, json: async () => body } as Response;
}

function change(control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(control), "value")?.set?.call(control, value);
  control.dispatchEvent(new Event("input", { bubbles: true }));
  control.dispatchEvent(new Event("change", { bubbles: true }));
}

function localDateKey(value = new Date()) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function taskFor(opportunityId: string, title: string, dueDate: string | null) {
  return {
    id: `task-${opportunityId}`,
    opportunityId,
    title,
    dueDate,
    state: "open" as const,
    sourceActivityId: null,
    completedAt: null,
    createdAt: "2026-07-21T12:00:00.000Z",
    updatedAt: "2026-07-21T12:00:00.000Z"
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushDashboard() {
  await act(async () => {
    await Promise.resolve();
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  themeState.theme = "light";
  toastState.props = null;
  document.body.innerHTML = "";
});

describe("Dashboard", () => {
  it("renders opportunity type and broad-status controls", () => {
    const markup = renderToStaticMarkup(<Dashboard />);

    expect(markup).toContain("Pipeline");
    expect(markup).toContain('<h2 id="pipeline-title">Your opportunities</h2>');
    expect(markup).toContain('class="pipeline-title-lockup"');
    expect(markup).toContain('class="pipeline-title-lockup__divider" aria-hidden="true">·</span>');
    expect(markup).toContain('class="search-field__icon"');
    expect(markup).toContain('aria-label="Filter opportunities"');
    expect(markup).not.toContain("Workspace");
    expect(markup).toContain("Jobs");
    expect(markup).toContain("Connections");
    expect(markup).toContain("Active");
    expect(markup).toContain("Needs attention");
    expect(markup).toContain("Closed");
    expect(markup).toContain("Archived");
    expect(markup).toContain("New opportunity");
    expect(markup).not.toContain('href="/opportunities/new"');
    expect(markup).not.toContain("New application");
  });

  it("names the theme control for the destination theme", () => {
    expect(renderToStaticMarkup(<Dashboard />)).toContain('aria-label="Switch to dark theme"');

    themeState.theme = "dark";

    expect(renderToStaticMarkup(<Dashboard />)).toContain('aria-label="Switch to light theme"');
  });

  it("does not steal focus or prevent search shortcuts in editable targets", () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise(() => undefined));
    const { root } = mountDashboard();
    const contenteditable = document.createElement("div");
    contenteditable.setAttribute("contenteditable", "");
    const plaintextEditable = document.createElement("div");
    plaintextEditable.setAttribute("contenteditable", "plaintext-only");
    const targets = [
      document.createElement("input"),
      document.createElement("textarea"),
      document.createElement("select"),
      contenteditable,
      plaintextEditable
    ];
    targets.forEach((target) => document.body.appendChild(target));

    for (const target of targets) {
      target.focus();
      for (const event of [
        new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true }),
        new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true, cancelable: true })
      ]) {
        target.dispatchEvent(event);
        expect(event.defaultPrevented, `${target.tagName}:${event.key}`).toBe(false);
        expect(document.activeElement, `${target.tagName}:${event.key}`).toBe(target);
      }
    }

    act(() => root.unmount());
  });

  it("sorts loaded opportunities by most recently updated by default", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse([job, connection]));
    const { container, root } = mountDashboard();

    await flushDashboard();

    expect([...container.querySelectorAll(".application-table__primary")].map((element) => element.textContent)).toEqual([
      "Maya Chen", "Platform Engineer"
    ]);
    act(() => root.unmount());
  });

  it("sorts loaded opportunities by the selected sort mode", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse([job, connection]));
    const { container, root } = mountDashboard();

    await flushDashboard();
    const sort = container.querySelector<HTMLSelectElement>(".select-field select")!;
    act(() => {
      sort.value = "organization";
      sort.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect([...container.querySelectorAll(".application-table__primary")].map((element) => element.textContent)).toEqual([
      "Platform Engineer", "Maya Chen"
    ]);
    act(() => root.unmount());
  });

  it("keeps the attention count stable while View all resets type and selects Needs attention", async () => {
    const dueJob = { ...job, nextOpenTask: taskFor(job.id, "Follow up with recruiter", "2020-01-01") };
    const dueConnection = { ...connection, nextOpenTask: taskFor(connection.id, "Send introduction", "2020-01-02") };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse([dueJob, dueConnection]));
    const { container, root } = mountDashboard();
    await flushDashboard();

    const queue = container.querySelector<HTMLElement>(".attention-strip")!;
    const active = [...container.querySelectorAll<HTMLButtonElement>(".status-filter__button")]
      .find((button) => button.textContent?.trim() === "Active")!;
    const needsAttention = [...container.querySelectorAll<HTMLButtonElement>(".status-filter__button")]
      .find((button) => button.textContent?.includes("Needs attention"))!;
    const typeGroup = container.querySelector<HTMLElement>('[aria-label="Filter opportunities by type"]')!;
    const allTypes = [...typeGroup.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "All")!;
    const jobs = [...typeGroup.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "Jobs")!;
    const viewAll = [...queue.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "View all")!;

    expect(queue.textContent).toContain("2 to review");
    expect(active.getAttribute("aria-pressed")).toBe("true");
    expect(needsAttention.getAttribute("aria-pressed")).toBe("false");
    act(() => jobs.click());
    expect(allTypes.getAttribute("aria-pressed")).toBe("false");
    expect(jobs.getAttribute("aria-pressed")).toBe("true");

    act(() => viewAll.click());

    expect(queue.textContent).toContain("2 to review");
    expect([...container.querySelectorAll<HTMLButtonElement>(".status-filter__button")]
      .find((button) => button.textContent?.trim() === "Active")?.getAttribute("aria-pressed")).toBe("false");
    expect([...container.querySelectorAll<HTMLButtonElement>(".status-filter__button")]
      .find((button) => button.textContent?.includes("Needs attention"))?.getAttribute("aria-pressed")).toBe("true");
    expect(allTypes.getAttribute("aria-pressed")).toBe("true");
    expect(jobs.getAttribute("aria-pressed")).toBe("false");
    expect(container.textContent).toContain("Platform Engineer");
    expect(container.textContent).toContain("Maya Chen");
    act(() => root.unmount());
  });

  it("resets the status filter when switching between job and connection views", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse([job, connection]));
    const { container, root } = mountDashboard();

    await flushDashboard();
    const click = (label: string) => act(() => {
      [...container.querySelectorAll("button")].find((button) => button.textContent === label)?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    click("Jobs");
    expect([...container.querySelectorAll("button")].find((button) => button.textContent === "All job stages")?.getAttribute("aria-pressed")).toBe("true");
    click("Applied");
    click("Connections");

    expect([...container.querySelectorAll("button")].find((button) => button.textContent === "All connection stages")?.getAttribute("aria-pressed")).toBe("true");
    expect([...container.querySelectorAll("button")].some((button) => button.textContent === "Applied")).toBe(false);
    click("All");

    expect([...container.querySelectorAll("button")].find((button) => button.textContent === "Active")?.getAttribute("aria-pressed")).toBe("true");
    act(() => root.unmount());
  });

  it("sends the selected stage in the status PATCH request", async () => {
    const updated: OpportunityDetail = { ...job, status: "offer", tasks: [], activities: [], artifacts: [], origin: null, originatedJobs: [] };
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse([job]))
      .mockResolvedValueOnce(jsonResponse(updated));
    const { container, root } = mountDashboard();

    await flushDashboard();
    const select = container.querySelector<HTMLSelectElement>(".stage-select select")!;
    act(() => {
      select.value = "offer";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flushDashboard();

    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/opportunities/job-1/status", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "offer" })
    });
    act(() => root.unmount());
  });

  it("locks every stage control during a mutation and exposes an undo action after success", async () => {
    const update = deferred<Response>();
    const updated: OpportunityDetail = { ...job, status: "offer", tasks: [], activities: [], artifacts: [], origin: null, originatedJobs: [] };
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse([job, connection]))
      .mockReturnValueOnce(update.promise)
      .mockResolvedValueOnce(jsonResponse({ ...updated, status: "applied" }));
    const { container, root } = mountDashboard();

    await flushDashboard();
    const selectFor = (label: string) => {
      const row = [...container.querySelectorAll("tr")]
        .find((candidate) => candidate.querySelector(".application-table__primary")?.textContent === label);
      if (!row) throw new Error(`Missing row for ${label}`);
      const select = row.querySelector<HTMLSelectElement>(".stage-select select");
      if (!select) throw new Error(`Missing stage select for ${label}`);
      return select;
    };
    const jobSelect = selectFor("Platform Engineer");
    const connectionSelect = selectFor("Maya Chen");
    act(() => {
      jobSelect.value = "offer";
      jobSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    act(() => {
      connectionSelect.value = "waiting";
      connectionSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(jobSelect.disabled).toBe(true);
    expect(connectionSelect.disabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => { update.resolve(jsonResponse(updated)); });
    await flushDashboard();

    expect(toastState.props?.message).toContain("Platform Engineer moved to Offer.");
    expect(toastState.props?.actionLabel).toBe("Undo");
    expect(toastState.props?.onAction).toEqual(expect.any(Function));
    act(() => toastState.props?.onAction?.());
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/opportunities/job-1/status", expect.objectContaining({
      body: JSON.stringify({ status: "applied" })
    }));
    act(() => root.unmount());
  });

  it("creates an undated next action for the selected row without adding attention noise", async () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { callback(0); return 1; });
    const createdTask = taskFor(job.id, "Send portfolio", null);
    const updated: OpportunityDetail = { ...job, tasks: [createdTask], activities: [], artifacts: [], origin: null, originatedJobs: [] };
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse([job]))
      .mockResolvedValueOnce(jsonResponse(updated));
    const { container, root } = mountDashboard();
    await flushDashboard();

    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Set next action for Platform Engineer"]')!.click());

    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.querySelector(".modal__title")?.textContent).toBe("Add next action");
    expect(dialog.querySelector(".task-composer-form__context")?.textContent).toContain("Creating task for");
    expect(dialog.querySelector(".task-composer-form__context")?.textContent).toContain("Platform Engineer");
    expect(dialog.querySelector(".task-composer-form__context")?.textContent).toContain("Acme Corp");
    act(() => change(dialog.querySelector<HTMLInputElement>("input[required]")!, "Send portfolio"));
    act(() => dialog.querySelector<HTMLFormElement>("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await flushDashboard();

    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/opportunities/job-1/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Send portfolio", dueDate: null })
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector("#opportunity-next-move-job-1")?.textContent).toContain("Send portfolio");
    expect(container.querySelector(".attention-strip")).toBeNull();
    expect(toastState.props?.message).toBe("Next action added for Platform Engineer.");
    expect(document.activeElement).toBe(container.querySelector("#opportunity-next-move-job-1"));
    act(() => root.unmount());
  });

  it("keeps the selected entity and draft visible when next-action creation fails", async () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { callback(0); return 1; });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse([connection]))
      .mockResolvedValueOnce(jsonResponse({ error: "Task rejected" }, false));
    const { container, root } = mountDashboard();
    await flushDashboard();

    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Set next action for Maya Chen"]')!.click());
    const input = container.querySelector<HTMLInputElement>('[role="dialog"] input[required]')!;
    act(() => change(input, "Share hiring manager intro"));
    act(() => container.querySelector<HTMLFormElement>('[role="dialog"] form')!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await flushDashboard();

    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.querySelector(".task-composer-form__context")?.textContent).toContain("Maya Chen");
    expect(dialog.querySelector(".task-composer-form__context")?.textContent).toContain("Engineering leader");
    expect(dialog.querySelector<HTMLInputElement>("input[required]")?.value).toBe("Share hiring manager intro");
    expect(dialog.querySelector('[role="alert"]')?.textContent).toBe("Task rejected");
    expect(dialog.querySelector<HTMLInputElement>("input[required]")?.disabled).toBe(false);
    act(() => root.unmount());
  });

  it("adds a newly created due-today task to Needs attention", async () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { callback(0); return 1; });
    const today = localDateKey();
    const createdTask = taskFor(job.id, "Send portfolio", today);
    const updated: OpportunityDetail = { ...job, tasks: [createdTask], activities: [], artifacts: [], origin: null, originatedJobs: [] };
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse([job]))
      .mockResolvedValueOnce(jsonResponse(updated));
    const { container, root } = mountDashboard();
    await flushDashboard();

    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Set next action for Platform Engineer"]')!.click());
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
    act(() => {
      change(dialog.querySelector<HTMLInputElement>("input[required]")!, "Send portfolio");
      change(dialog.querySelector<HTMLInputElement>('input[type="date"]')!, today);
    });
    act(() => dialog.querySelector<HTMLFormElement>("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await flushDashboard();

    expect(container.querySelector(".attention-strip")?.textContent).toContain("1 to review");
    expect(container.querySelector(".attention-strip")?.textContent).toContain("Send portfolio");
    act(() => root.unmount());
  });

  it("replaces the dashboard with a retryable load error without rendering loaded workspace content", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Network unavailable"));
    const { container, root } = mountDashboard();

    await flushDashboard();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Network unavailable");
    expect([...container.querySelectorAll("button")].some((button) => button.textContent === "Retry")).toBe(true);
    expect(container.querySelector(".pipeline-pulse")).toBeNull();
    expect(container.querySelector(".pipeline-controls")).toBeNull();
    expect(container.querySelector(".application-table")).toBeNull();
    act(() => root.unmount());
  });

  it("retries a failed load and renders the pipeline pulse from the latest response", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("Network unavailable"))
      .mockResolvedValueOnce(jsonResponse([job, connection]));
    const { container, root } = mountDashboard();

    await flushDashboard();
    act(() => {
      [...container.querySelectorAll("button")].find((button) => button.textContent === "Retry")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector('.application-table--loading[role="status"]')?.textContent).toContain("Loading opportunities");
    await flushDashboard();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.querySelector(".pipeline-pulse")?.textContent).toContain("2 Active");
    expect(container.querySelector(".pipeline-pulse")?.textContent).toContain("0 Needs attention");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    act(() => root.unmount());
  });

  it("keeps loaded opportunities visible when a stage mutation fails", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse([job]))
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: "Stage update failed" }) } as Response);
    const { container, root } = mountDashboard();

    await flushDashboard();
    const select = container.querySelector<HTMLSelectElement>(".stage-select select")!;
    act(() => {
      select.value = "offer";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flushDashboard();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Stage update failed");
    expect(container.querySelector(".pipeline-pulse")).not.toBeNull();
    expect(container.querySelector(".application-table__primary")?.textContent).toBe("Platform Engineer");
    act(() => root.unmount());
  });

  it("explains search-empty results and clears search, type, and status filters together", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse([job, connection]));
    const { container, root } = mountDashboard();

    await flushDashboard();
    const search = container.querySelector<HTMLInputElement>(".search-field__input")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "missing");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      [...container.querySelectorAll("button")].find((button) => button.textContent === "Jobs")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    act(() => {
      [...container.querySelectorAll("button")].find((button) => button.textContent === "Offer")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("No opportunities match this search or filter.");
    const clear = [...container.querySelectorAll("button")].find((button) => button.textContent === "Clear filters")!;
    act(() => clear.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect([...container.querySelectorAll("button")].find((button) => button.textContent === "Active")?.getAttribute("aria-pressed")).toBe("true");
    expect([...container.querySelectorAll(".application-table__primary")].map((element) => element.textContent)).toHaveLength(2);
    expect(container.querySelector<HTMLInputElement>(".search-field__input")?.value).toBe("");
    act(() => root.unmount());
  });

  it("ignores stale repeated retry responses after the latest retry succeeds", async () => {
    const staleRetry = deferred<Response>();
    const latestRetry = deferred<Response>();
    vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("Network unavailable"))
      .mockReturnValueOnce(staleRetry.promise)
      .mockReturnValueOnce(latestRetry.promise);
    const { container, root } = mountDashboard();

    await flushDashboard();
    const retry = [...container.querySelectorAll("button")].find((button) => button.textContent === "Retry")!;
    act(() => {
      retry.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      retry.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => latestRetry.resolve(jsonResponse([connection])));
    await act(async () => staleRetry.resolve(jsonResponse([job])));

    expect([...container.querySelectorAll(".application-table__primary")].map((element) => element.textContent)).toEqual(["Maya Chen"]);
    act(() => root.unmount());
  });

  it("shows the latest retry failure even when an earlier retry resolves later", async () => {
    const staleRetry = deferred<Response>();
    const latestRetry = deferred<Response>();
    vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("Network unavailable"))
      .mockReturnValueOnce(staleRetry.promise)
      .mockReturnValueOnce(latestRetry.promise);
    const { container, root } = mountDashboard();

    await flushDashboard();
    const retry = [...container.querySelectorAll("button")].find((button) => button.textContent === "Retry")!;
    act(() => {
      retry.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      retry.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => latestRetry.reject(new Error("Latest retry failed")));
    await act(async () => staleRetry.resolve(jsonResponse([job])));

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Latest retry failed");
    expect(container.querySelector(".application-table")).toBeNull();
    act(() => root.unmount());
  });
});
