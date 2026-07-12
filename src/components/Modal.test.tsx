// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Modal } from "./Modal";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type ModalOptions = {
  onClose?: () => void;
  size?: "compact" | "wide";
};

function mountModal({ onClose = vi.fn(), size }: ModalOptions = {}) {
  const trigger = document.createElement("button");
  trigger.textContent = "Open modal";
  const container = document.createElement("div");
  document.body.append(trigger, container);
  trigger.focus();

  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(
      <Modal onClose={onClose} size={size} title="Edit opportunity">
        <input aria-label="Organization" />
        <button type="button">Save changes</button>
      </Modal>
    );
  });

  return { container, onClose, root: root!, trigger };
}

afterEach(() => {
  document.body.innerHTML = "";
  document.body.style.overflow = "";
  vi.unstubAllGlobals();
});

describe("Modal", () => {
  it("renders a named compact dialog by default and applies the requested wide size", () => {
    const compact = mountModal();
    const compactDialog = compact.container.querySelector('[role="dialog"]')!;

    expect(compactDialog.classList.contains("modal")).toBe(true);
    expect(compactDialog.classList.contains("modal--compact")).toBe(true);
    expect(compactDialog.getAttribute("aria-modal")).toBe("true");
    expect(compactDialog.getAttribute("aria-labelledby")).toBe(compactDialog.querySelector("h2")?.id);

    act(() => compact.root.unmount());
    const wide = mountModal({ size: "wide" });
    expect(wide.container.querySelector('[role="dialog"]')?.classList.contains("modal--wide")).toBe(true);
    act(() => wide.root.unmount());
  });

  it("moves focus to the first focusable element on the animation frame", () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const { container, root } = mountModal();
    const closeButton = container.querySelector(".modal__close") as HTMLElement;

    expect(document.activeElement).not.toBe(closeButton);
    act(() => callbacks[0]?.(0));
    expect(document.activeElement).toBe(closeButton);

    act(() => root.unmount());
  });

  it("wraps Tab from the last focusable element to the first", () => {
    const { container, root } = mountModal();
    const closeButton = container.querySelector(".modal__close") as HTMLElement;
    const saveButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Save changes")!;
    saveButton.focus();
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Tab" });

    act(() => document.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(closeButton);
    act(() => root.unmount());
  });

  it("wraps Shift+Tab from the first focusable element to the last", () => {
    const { container, root } = mountModal();
    const closeButton = container.querySelector(".modal__close") as HTMLElement;
    const saveButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Save changes")!;
    closeButton.focus();
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Tab", shiftKey: true });

    act(() => document.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(saveButton);
    act(() => root.unmount());
  });

  it("closes once for Escape and backdrop presses", () => {
    const onClose = vi.fn();
    const { container, root } = mountModal({ onClose });

    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" })));
    expect(onClose).toHaveBeenCalledTimes(1);

    act(() => container.querySelector(".modal-backdrop")?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(onClose).toHaveBeenCalledTimes(2);
    act(() => root.unmount());
  });

  it("restores trigger focus and the exact body overflow value on unmount", () => {
    document.body.style.overflow = "scroll";
    const { root, trigger } = mountModal();

    expect(document.body.style.overflow).toBe("hidden");
    act(() => root.unmount());

    expect(document.body.style.overflow).toBe("scroll");
    expect(document.activeElement).toBe(trigger);
  });
});
