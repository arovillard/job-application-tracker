// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() })
}));

vi.mock("./ThemeProvider", () => ({
  useTheme: () => ({ theme: "light", setTheme: vi.fn() })
}));

vi.mock("./Toast", () => ({
  Toast: () => null
}));

vi.mock("./ApplyWithAgentDrawer", () => ({
  ApplyWithAgentDrawer: ({ open }: { open: boolean }) => open ? <div role="dialog">Agent drawer open</div> : null
}));

import { Dashboard } from "./Dashboard";

describe("Dashboard", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses the stage filter without a duplicate saved-view row", () => {
    const markup = renderToStaticMarkup(<Dashboard />);

    expect(markup).not.toContain("All opportunities");
    expect(markup).not.toContain("Pipeline progress");
    expect(markup).toContain("Wishlist");
    expect(markup).toContain("Applied");
    expect(markup).toContain("Interviewing");
    expect(markup.indexOf("Apply with Agent")).toBeLessThan(markup.indexOf("Add existing application"));
    expect(markup).toContain("button button--primary agent-drawer-trigger");
    expect(markup).toContain('class="button dashboard-new-application"');
  });

  it("opens the agent drawer from the agent-first empty state and keeps manual entry secondary", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve({
      ok: true,
      json: async () => url === "/api/applications" ? [] : []
    })));
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(<Dashboard />));
    await act(async () => {});

    expect(container.textContent).toContain("Start your next application");
    const emptyState = container.querySelector(".application-table__empty-state")!;
    const apply = [...emptyState.querySelectorAll("button")].find((item) => item.textContent === "Apply with Agent")!;
    expect(apply.className).toContain("button--primary");
    expect(emptyState.querySelector('a[href="/applications/new"]')?.textContent).toContain("Already applied? Add it manually");
    await act(async () => apply.click());
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain("Agent drawer open");
    await act(async () => root.unmount());
  });

  it("keeps Apply with Agent primary for a populated dashboard", async () => {
    const application = {
      id: "app-1", company: "Acme", role: "Engineer", status: "wishlist", source: "example.com",
      location: null, url: null, contact: null, notes: null, appliedDate: null, followUpDate: null,
      nextAction: null, nextActionDate: null, priority: "medium", createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z"
    };
    vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve({ ok: true, json: async () => url === "/api/applications" ? [application] : [] })));
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(<Dashboard />)); await act(async () => {});
    const apply = [...container.querySelectorAll("button")].find((item) => item.textContent === "Apply with Agent")!;
    expect(apply.className).toContain("button--primary");
    const manual = container.querySelector('a[href="/applications/new"]')!;
    expect(manual.textContent).toContain("Add existing application");
    expect(manual.className).not.toContain("button--primary");
    await act(async () => root.unmount());
  });
});
