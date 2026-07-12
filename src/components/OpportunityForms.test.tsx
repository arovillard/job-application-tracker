// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { ConnectionOpportunityForm } from "./ConnectionOpportunityForm";
import { JobOpportunityForm } from "./JobOpportunityForm";
import type { JobOpportunityInput } from "../types";

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
  it("keeps job optional details closed on explicit create, retains values through toggle events, and opens inferred edit details", () => {
    const onSubmit = vi.fn();
    const container = render(<JobOpportunityForm mode="create" onSubmit={onSubmit} />);
    const disclosure = container.querySelector("details");
    expect(disclosure?.hasAttribute("open")).toBe(false);

    act(() => {
      disclosure!.open = true;
      disclosure!.dispatchEvent(new Event("toggle"));
      change(field(container, "Posting URL"), "https://example.com/job");
      disclosure!.open = false;
      disclosure!.dispatchEvent(new Event("toggle"));
      disclosure!.open = true;
      disclosure!.dispatchEvent(new Event("toggle"));
    });
    expect(field(container, "Posting URL").value).toBe("https://example.com/job");

    const edit = render(<JobOpportunityForm initialValue={{ type: "job", label: "Engineer", status: "applied", url: "https://example.com/job" }} onSubmit={(input: JobOpportunityInput) => undefined} />);
    expect(edit.querySelector("details")?.hasAttribute("open")).toBe(true);
    expect(field(edit, "First task")).toBeUndefined();
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
    const container = render(<JobOpportunityForm mode="edit" initialValue={{ type: "job", label: "Engineer", status: "applied", appliedDate: "2026-07-10" }} onSubmit={onSubmit} />);
    expect(field(container, "Applied date")).not.toBeUndefined();
    act(() => change(field(container, "Stage"), "wishlist"));
    expect(field(container, "Applied date")).toBeUndefined();
    act(() => container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ opportunity: expect.objectContaining({ appliedDate: null }) }));
  });

  it("emits the wrapper only for explicit job modes and keeps omitted-mode callers on the raw input contract", () => {
    const onSubmit = vi.fn();
    const container = render(<JobOpportunityForm mode="create" initialValue={{ type: "job", label: "Engineer", status: "wishlist" }} onSubmit={onSubmit} />);
    expect(field(container, "First task")).not.toBeUndefined();
    act(() => { change(field(container, "First task"), "Send portfolio"); container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ initialTask: { title: "Send portfolio", dueDate: null } }));

    for (const mode of ["edit", "linked"] as const) {
      const modeContainer = render(<JobOpportunityForm mode={mode} initialValue={{ type: "job", label: "Engineer", status: "wishlist" }} onSubmit={onSubmit} />);
      expect(field(modeContainer, "First task")).toBeUndefined();
      act(() => modeContainer.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
      expect(onSubmit).toHaveBeenLastCalledWith(expect.objectContaining({ opportunity: expect.any(Object), initialTask: null }));
    }

    const legacySubmit = vi.fn<(input: JobOpportunityInput) => void>();
    const legacyEdit = render(<JobOpportunityForm initialValue={{ type: "job", label: "Engineer", status: "wishlist" }} onSubmit={legacySubmit} />);
    act(() => legacyEdit.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(legacySubmit).toHaveBeenLastCalledWith(expect.objectContaining({ type: "job", label: "Engineer" }));
    expect(legacySubmit.mock.calls.at(-1)?.[0]).not.toHaveProperty("opportunity");

    const legacyLinked = render(<JobOpportunityForm originOpportunityId="connection-1" onSubmit={legacySubmit} />);
    expect(field(legacyLinked, "First task")).toBeUndefined();
    act(() => legacyLinked.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(legacySubmit).toHaveBeenLastCalledWith(expect.objectContaining({ originOpportunityId: "connection-1" }));
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

    const legacyEdit = render(<ConnectionOpportunityForm initialValue={{ type: "connection", label: "Maya", status: "new" }} onSubmit={onSubmit} />);
    expect(legacyEdit.textContent).not.toContain("Initial interaction");
    expect(field(legacyEdit, "First task")).toBeUndefined();
    const identity = field(legacyEdit, "Person's name");
    expect(identity.required).toBe(true);
    expect(identity.getAttribute("aria-describedby")).toBe("connection-label-helper");
    expect(document.getElementById("connection-label-helper")?.textContent).toContain("required");
  });
});
