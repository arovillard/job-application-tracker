// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { OpportunityDetail, OpportunitySummary } from "../types";
const themeState = vi.hoisted(() => ({ theme: "light" as "light" | "dark", setTheme: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("./ThemeProvider", () => ({ useTheme: () => themeState }));
vi.mock("./Toast", () => ({ Toast: () => null }));

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

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body } as Response;
}

async function flushDashboard() {
  await act(async () => {
    await Promise.resolve();
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  themeState.theme = "light";
  document.body.innerHTML = "";
});

describe("Dashboard", () => {
  it("renders opportunity type and broad-status controls", () => {
    const markup = renderToStaticMarkup(<Dashboard />);

    expect(markup).toContain("Pipeline");
    expect(markup).toContain('<h2 id="pipeline-title">Your opportunities</h2>');
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
});
