// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, ...props }: { children: React.ReactNode } & Record<string, unknown>) => <a {...props}>{children}</a>
}));
import { NewOpportunityMenu } from "./NewOpportunityMenu";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mountMenu() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(<NewOpportunityMenu />);
  });
  return { container, root: root! };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("NewOpportunityMenu", () => {
  it("opens with typed job and connection destinations and closes on Escape", () => {
    const { container, root } = mountMenu();
    const button = container.querySelector("button")!;

    expect(button.getAttribute("aria-haspopup")).toBe("menu");
    expect(button.getAttribute("aria-expanded")).toBe("false");

    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector('[href="/opportunities/new?type=job"]')).not.toBeNull();
    expect(container.querySelector('[href="/opportunities/new?type=connection"]')).not.toBeNull();

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(button.getAttribute("aria-expanded")).toBe("false");
    act(() => root.unmount());
  });

  it("closes when the pointer is pressed outside the menu", () => {
    const { container, root } = mountMenu();
    const button = container.querySelector("button")!;

    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    act(() => {
      document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });

    expect(button.getAttribute("aria-expanded")).toBe("false");
    act(() => root.unmount());
  });

  it("opens on an unmodified N shortcut unless focus is in an editable control", () => {
    const { container, root } = mountMenu();
    const button = container.querySelector("button")!;

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "n", bubbles: true }));
    });
    expect(button.getAttribute("aria-expanded")).toBe("true");

    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      const input = document.createElement("input");
      document.body.appendChild(input);
      input.focus();
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "n", bubbles: true }));
    });
    expect(button.getAttribute("aria-expanded")).toBe("false");

    act(() => root.unmount());
  });
});
