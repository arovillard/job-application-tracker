// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { ConnectionOpportunityForm } from "./ConnectionOpportunityForm";
import { JobOpportunityForm } from "./JobOpportunityForm";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function render(element: React.ReactNode) {
  const container = document.createElement("div");
  document.body.replaceChildren(container);
  const root = createRoot(container);
  act(() => root.render(element));
  return container;
}

function field(container: HTMLElement, label: string) {
  return Array.from(container.querySelectorAll("label")).find((candidate) => candidate.textContent?.includes(label))?.querySelector("input, textarea, select") as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
}

function change(control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(control), "value")?.set?.call(control, value);
  control.dispatchEvent(new Event("input", { bubbles: true }));
  control.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("opportunity creation forms", () => {
  it("keeps job optional details closed on create, retains collapsed values, and opens populated edit details", () => {
    const onSubmit = vi.fn();
    const container = render(<JobOpportunityForm onSubmit={onSubmit} />);
    const disclosure = container.querySelector("details");
    expect(disclosure?.hasAttribute("open")).toBe(false);

    act(() => { field(container, "Posting URL").value = "https://example.com/job"; field(container, "Posting URL").dispatchEvent(new Event("input", { bubbles: true })); });
    act(() => disclosure?.removeAttribute("open"));
    expect(field(container, "Posting URL").value).toBe("https://example.com/job");

    const edit = render(<JobOpportunityForm mode="edit" initialValue={{ type: "job", label: "Engineer", status: "applied", url: "https://example.com/job" }} onSubmit={onSubmit} />);
    expect(edit.querySelector("details")?.hasAttribute("open")).toBe(true);
  });

  it("uses native required URL semantics and opens hidden invalid optional details before focus", async () => {
    const container = render(<JobOpportunityForm onSubmit={vi.fn()} />);
    const role = field(container, "Role");
    const url = field(container, "Posting URL");
    expect(role.required).toBe(true);
    expect(url.getAttribute("type")).toBe("url");
    expect(url.getAttribute("aria-describedby")).toBeTruthy();
    expect(document.getElementById(url.getAttribute("aria-describedby") ?? "")).not.toBeNull();

    await act(async () => { url.dispatchEvent(new Event("invalid", { bubbles: false, cancelable: true })); await new Promise(requestAnimationFrame); });
    expect(container.querySelector("details")?.hasAttribute("open")).toBe(true);
    expect(document.activeElement).toBe(url);
  });

  it("shows applied date only for applied stages and clears it for Wishlist", () => {
    const onSubmit = vi.fn();
    const container = render(<JobOpportunityForm initialValue={{ type: "job", label: "Engineer", status: "applied", appliedDate: "2026-07-10" }} onSubmit={onSubmit} />);
    expect(field(container, "Applied date")).not.toBeUndefined();
    act(() => change(field(container, "Stage"), "wishlist"));
    expect(field(container, "Applied date")).toBeUndefined();
    act(() => container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ opportunity: expect.objectContaining({ appliedDate: null }) }));
  });

  it("emits a job creation wrapper with an optional first task and omits first-task controls in edit and linked modes", () => {
    const onSubmit = vi.fn();
    const container = render(<JobOpportunityForm initialValue={{ type: "job", label: "Engineer", status: "wishlist" }} onSubmit={onSubmit} />);
    expect(field(container, "First task")).not.toBeUndefined();
    act(() => { change(field(container, "First task"), "Send portfolio"); container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ initialTask: { title: "Send portfolio", dueDate: null } }));

    for (const mode of ["edit", "linked"] as const) {
      const modeContainer = render(<JobOpportunityForm mode={mode} initialValue={{ type: "job", label: "Engineer", status: "wishlist" }} onSubmit={onSubmit} />);
      expect(field(modeContainer, "First task")).toBeUndefined();
      act(() => modeContainer.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
      expect(onSubmit).toHaveBeenLastCalledWith(expect.objectContaining({ opportunity: expect.any(Object), initialTask: null }));
    }
  });

  it("keeps connection activity and task ISO payloads in create mode and omits creation-only groups in edit mode", () => {
    const onSubmit = vi.fn();
    const container = render(<ConnectionOpportunityForm onSubmit={onSubmit} />);
    expect(container.textContent).toContain("Initial interaction");
    expect(container.textContent).toContain("Next move");
    act(() => {
      change(field(container, "What happened?"), "Met at a panel");
      change(field(container, "Date"), "2026-07-10");
      change(field(container, "First task"), "Send portfolio");
      container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ initialActivity: expect.objectContaining({ occurredAt: "2026-07-10T12:00:00.000Z" }), initialTask: { title: "Send portfolio", dueDate: null } }));

    const edit = render(<ConnectionOpportunityForm mode="edit" initialValue={{ type: "connection", label: "Maya", status: "new" }} onSubmit={onSubmit} />);
    expect(edit.textContent).not.toContain("Initial interaction");
    expect(field(edit, "First task")).toBeUndefined();
  });
});
