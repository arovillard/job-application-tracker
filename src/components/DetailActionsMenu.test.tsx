// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DetailActionsMenu } from "./DetailActionsMenu";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mountMenu() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(<DetailActionsMenu hasLinkedJob onArchive={vi.fn()} onCreateLinkedJob={vi.fn()} onDelete={vi.fn()} onEdit={vi.fn()} />);
  });
  return { container, root: root! };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("DetailActionsMenu", () => {
  it("moves keyboard-opened menus to the first item and restores More before invoking a dialog action", () => {
    const onEdit = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    let root: Root;
    act(() => { root = createRoot(container); root.render(<DetailActionsMenu hasLinkedJob onArchive={vi.fn()} onCreateLinkedJob={vi.fn()} onDelete={vi.fn()} onEdit={onEdit} />); });
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;

    act(() => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    expect(document.activeElement?.textContent).toBe("Edit details");
    act(() => (document.activeElement as HTMLButtonElement).click());
    expect(onEdit).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(trigger);
    act(() => root!.unmount());
  });

  it("opens an accessible menu and supports Arrow, Home, End, Escape, and outside dismissal", () => {
    const { container, root } = mountMenu();
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;

    act(() => trigger.click());
    const items = [...container.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(items.map((item) => item.textContent)).toEqual(["Edit details", "Create job opportunity", "Archive", "Delete permanently"]);

    act(() => items[0].dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
    expect(document.activeElement).toBe(items[3]);
    act(() => items[3].dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })));
    expect(document.activeElement).toBe(items[0]);
    act(() => items[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    expect(document.activeElement).toBe(items[1]);
    act(() => items[1].dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);

    act(() => trigger.click());
    act(() => container.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
    act(() => document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).not.toBe(trigger);
    act(() => root.unmount());
  });
});
