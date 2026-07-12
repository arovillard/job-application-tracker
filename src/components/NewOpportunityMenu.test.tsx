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
    const jobItem = container.querySelector('[href="/opportunities/new?type=job"]')!;
    expect(jobItem).not.toBeNull();
    expect(container.querySelector('[href="/opportunities/new?type=connection"]')).not.toBeNull();

    act(() => {
      (jobItem as HTMLElement).focus();
      jobItem.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });

    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(button);
    act(() => root.unmount());
  });

  it("closes after activating either menu item", () => {
    const { container, root } = mountMenu();
    const button = container.querySelector("button")!;

    act(() => {
      button.click();
    });
    container.querySelector('[href="/opportunities/new?type=job"]')!.addEventListener("click", (event) => event.preventDefault());
    act(() => {
      container.querySelector('[href="/opportunities/new?type=job"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(button.getAttribute("aria-expanded")).toBe("false");

    act(() => {
      button.click();
    });
    container.querySelector('[href="/opportunities/new?type=connection"]')!.addEventListener("click", (event) => event.preventDefault());
    act(() => {
      container.querySelector('[href="/opportunities/new?type=connection"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    act(() => root.unmount());
  });

  it("moves focus through the menu from N with wrapping and home/end", () => {
    const { container, root } = mountMenu();
    const button = container.querySelector("button")!;

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "n", bubbles: true }));
    });

    const jobItem = container.querySelector('[href="/opportunities/new?type=job"]')! as HTMLElement;
    const connectionItem = container.querySelector('[href="/opportunities/new?type=connection"]')! as HTMLElement;
    expect(document.activeElement).toBe(jobItem);

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "n", bubbles: true }));
    });
    expect(document.activeElement).toBe(jobItem);

    act(() => {
      jobItem.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    expect(document.activeElement).toBe(connectionItem);

    act(() => {
      connectionItem.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    expect(document.activeElement).toBe(jobItem);

    act(() => {
      jobItem.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    });
    expect(document.activeElement).toBe(connectionItem);

    act(() => {
      connectionItem.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    });
    expect(document.activeElement).toBe(jobItem);

    act(() => {
      jobItem.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    });
    expect(document.activeElement).toBe(connectionItem);

    act(() => {
      connectionItem.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    });
    expect(document.activeElement).toBe(jobItem);

    expect(button.getAttribute("aria-expanded")).toBe("true");
    act(() => root.unmount());
  });

  it("closes on Tab without preventing normal focus traversal", () => {
    const { container, root } = mountMenu();
    const button = container.querySelector("button")!;

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "n", bubbles: true }));
    });
    const jobItem = container.querySelector('[href="/opportunities/new?type=job"]')!;
    const tabEvent = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });

    act(() => {
      jobItem.dispatchEvent(tabEvent);
    });

    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(tabEvent.defaultPrevented).toBe(false);

    act(() => root.unmount());
  });

  it("closes on Shift+Tab without preventing normal focus traversal", () => {
    const { container, root } = mountMenu();
    const button = container.querySelector("button")!;

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "n", bubbles: true }));
    });
    const jobItem = container.querySelector('[href="/opportunities/new?type=job"]')!;
    const tabEvent = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true });

    act(() => {
      jobItem.dispatchEvent(tabEvent);
    });

    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(tabEvent.defaultPrevented).toBe(false);

    act(() => root.unmount());
  });

  it("closes when the pointer is pressed outside the menu", () => {
    const { container, root } = mountMenu();
    const button = container.querySelector("button")!;

    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();
    act(() => {
      document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });

    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(outside);
    act(() => root.unmount());
  });

  it("activates the focused item on Enter without restoring trigger focus", () => {
    const { container, root } = mountMenu();
    const button = container.querySelector("button")!;

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "n", bubbles: true }));
    });
    const jobItem = container.querySelector('[href="/opportunities/new?type=job"]')! as HTMLElement;
    const activation = vi.fn((event: Event) => event.preventDefault());
    jobItem.addEventListener("click", activation);

    act(() => {
      jobItem.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });

    expect(activation).toHaveBeenCalledTimes(1);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).not.toBe(button);
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
      const plaintextEditable = document.createElement("div");
      plaintextEditable.setAttribute("contenteditable", "plaintext-only");
      document.body.appendChild(plaintextEditable);
      plaintextEditable.focus();
      plaintextEditable.dispatchEvent(new KeyboardEvent("keydown", { key: "n", bubbles: true }));
    });
    expect(button.getAttribute("aria-expanded")).toBe("false");

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "n", ctrlKey: true, bubbles: true }));
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "n", metaKey: true, bubbles: true }));
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "n", shiftKey: true, bubbles: true }));
    });
    expect(button.getAttribute("aria-expanded")).toBe("false");

    act(() => root.unmount());
  });
});
