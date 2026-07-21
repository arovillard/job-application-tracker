// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Modal } from "./Modal";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type ModalOptions = {
  children?: React.ReactNode;
  dismissDisabled?: boolean;
  onClose?: () => void;
  size?: "compact" | "wide";
};

function mountModal({
  children = <><input aria-label="Organization" /><button type="button">Save changes</button></>,
  dismissDisabled,
  onClose = vi.fn(),
  size
}: ModalOptions = {}) {
  const trigger = document.createElement("button");
  trigger.textContent = "Open modal";
  const container = document.createElement("div");
  document.body.append(trigger, container);
  trigger.focus();

  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(
      <Modal dismissDisabled={dismissDisabled} onClose={onClose} size={size} title="Edit opportunity">
        {children}
      </Modal>
    );
  });

  return { container, onClose, root: root!, trigger };
}

function mountDismissibleModal() {
  const trigger = document.createElement("button");
  trigger.textContent = "Open modal";
  const container = document.createElement("div");
  document.body.append(trigger, container);
  trigger.focus();

  let root: Root;
  function DismissibleModal() {
    const [isOpen, setIsOpen] = useState(true);
    const close = () => setIsOpen(false);

    return isOpen ? (
      <Modal onClose={close} title="Edit opportunity">
        <input aria-label="Organization" />
        <button type="button" onClick={close}>Cancel</button>
      </Modal>
    ) : null;
  }

  act(() => {
    root = createRoot(container);
    root.render(<DismissibleModal />);
  });

  return { container, root: root!, trigger };
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

  it("moves focus to the first meaningful content control on the animation frame", () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const { container, root } = mountModal();
    const organizationInput = container.querySelector("input") as HTMLElement;

    expect(document.activeElement).not.toBe(organizationInput);
    act(() => callbacks[0]?.(0));
    expect(document.activeElement).toBe(organizationInput);

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

  it.each([
    ["Escape", ({ container }: ReturnType<typeof mountDismissibleModal>) => {
      document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" }));
      return container;
    }],
    ["backdrop", ({ container }: ReturnType<typeof mountDismissibleModal>) => {
      container.querySelector(".modal-backdrop")?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      return container;
    }],
    ["Cancel", ({ container }: ReturnType<typeof mountDismissibleModal>) => {
      Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Cancel")?.click();
      return container;
    }]
  ])("unmounts after %s and restores trigger focus and exact overflow", (_source, dismiss) => {
    document.body.style.overflow = "scroll";
    const modal = mountDismissibleModal();

    expect(document.body.style.overflow).toBe("hidden");
    act(() => dismiss(modal));

    expect(modal.container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.style.overflow).toBe("scroll");
    expect(document.activeElement).toBe(modal.trigger);
    act(() => modal.root.unmount());
  });

  it("restores trigger focus and the exact body overflow value on unmount", () => {
    document.body.style.overflow = "scroll";
    const { root, trigger } = mountModal();

    expect(document.body.style.overflow).toBe("hidden");
    act(() => root.unmount());

    expect(document.body.style.overflow).toBe("scroll");
    expect(document.activeElement).toBe(trigger);
  });

  it("ignores Escape, backdrop, and close-button dismissal while disabled", () => {
    const onClose = vi.fn();
    const { container, root } = mountModal({ dismissDisabled: true, onClose });
    const backdrop = container.querySelector(".modal-backdrop")!;
    const close = container.querySelector<HTMLButtonElement>(".modal__close")!;

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" }));
      backdrop.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      close.click();
    });

    const closeWasDisabled = close.disabled;
    const closeCallCount = onClose.mock.calls.length;
    act(() => root.unmount());

    expect(closeWasDisabled).toBe(true);
    expect(closeCallCount).toBe(0);
  });

  it.each(["first", "second"])("keeps scrolling locked until the final overlapping modal unmounts when %s unmounts first", (firstToUnmount) => {
    document.body.style.overflow = "scroll";
    const first = mountModal();
    const second = mountModal();

    expect(document.body.style.overflow).toBe("hidden");
    const [firstUnmounted, lastUnmounted] = firstToUnmount === "first" ? [first, second] : [second, first];
    act(() => firstUnmounted.root.unmount());
    expect(document.body.style.overflow).toBe("hidden");

    act(() => lastUnmounted.root.unmount());
    expect(document.body.style.overflow).toBe("scroll");
  });
});
