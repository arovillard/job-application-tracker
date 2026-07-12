// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("./ThemeProvider", () => ({ useTheme: () => ({ theme: "light", setTheme: vi.fn() }) }));
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
  return { root: root! };
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("Dashboard", () => {
  it("renders opportunity type and broad-status controls", () => {
    const markup = renderToStaticMarkup(<Dashboard />);

    expect(markup).toContain("Opportunities");
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

  it("does not steal focus or prevent search shortcuts in editable targets", () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise(() => undefined));
    const { root } = mountDashboard();
    const targets = [
      document.createElement("input"),
      document.createElement("textarea"),
      document.createElement("select"),
      document.createElement("div")
    ];
    targets[3].setAttribute("contenteditable", "true");
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
});
