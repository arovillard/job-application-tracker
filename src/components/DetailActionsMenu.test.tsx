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
  it.each([
    ["Enter", "Edit details"],
    [" ", "Edit details"],
    ["ArrowDown", "Edit details"],
    ["Home", "Edit details"],
    ["ArrowUp", "Delete permanently"],
    ["End", "Delete permanently"]
  ])("opens from a focused trigger with %s and focuses %s", (key, expectedItem) => {
    const { container, root } = mountMenu();
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;

    act(() => trigger.focus());
    act(() => trigger.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })));

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement?.textContent).toBe(expectedItem);
    act(() => root.unmount());
  });

  it("restores the trigger before invoking a dialog action", () => {
    const onEdit = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    let root: Root;
    act(() => { root = createRoot(container); root.render(<DetailActionsMenu hasLinkedJob onArchive={vi.fn()} onCreateLinkedJob={vi.fn()} onDelete={vi.fn()} onEdit={onEdit} />); });
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;

    act(() => trigger.focus());
    act(() => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })));
    expect(document.activeElement?.textContent).toBe("Edit details");
    act(() => (document.activeElement as HTMLButtonElement).click());
    expect(onEdit).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(trigger);
    act(() => root!.unmount());
  });

  it("wraps repeated item navigation, restores on Escape, and leaves focus alone on outside dismissal", () => {
    const { container, root } = mountMenu();
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;

    act(() => trigger.click());
    const items = [...container.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(items.map((item) => item.textContent)).toEqual(["Edit details", "Create job opportunity", "Archive", "Delete permanently"]);
    expect(items.find((item) => item.textContent === "Delete permanently")?.classList.contains("button--danger")).toBe(true);

    act(() => items[0].focus());
    act(() => items[0].dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(items[3]);
    act(() => (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(items[0]);
    act(() => (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(items[3]);
    act(() => (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(items[0]);
    act(() => (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(items[1]);
    act(() => (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);

    act(() => trigger.click());
    act(() => container.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
    act(() => document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).not.toBe(trigger);
    act(() => root.unmount());
  });

  it.each([
    ["ArrowDown", "Edit details"],
    ["ArrowUp", "Delete permanently"],
    ["Home", "Edit details"],
    ["End", "Delete permanently"]
  ])("moves focus immediately with %s when the pointer-open menu trigger is focused", (key, expectedItem) => {
    const { container, root } = mountMenu();
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
    act(() => trigger.click());
    act(() => trigger.focus());
    act(() => trigger.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })));
    expect(document.activeElement?.textContent).toBe(expectedItem);
    act(() => root.unmount());
  });

  it("closes a pointer-open menu with Escape from its focused trigger", () => {
    const { container, root } = mountMenu();
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
    act(() => trigger.click());
    act(() => trigger.focus());
    act(() => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    act(() => root.unmount());
  });
});
