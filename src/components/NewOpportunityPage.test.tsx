// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ useRouter: vi.fn(() => ({ push: vi.fn() })), useSearchParams: vi.fn(() => new URLSearchParams()) }));
vi.mock("next/navigation", () => navigation);

import {
  buildConnectionCreationPayload,
  ConnectionOpportunityForm
} from "./ConnectionOpportunityForm";
import { NewOpportunityPage, resolveOpportunityType } from "./NewOpportunityPage";

describe("NewOpportunityPage", () => {
  it("posts the job creation wrapper and focuses its alert when creation fails", async () => {
    const push = vi.fn();
    navigation.useRouter.mockReturnValue({ push });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 422, json: async () => ({ error: "First task is invalid" }) }));
    const container = document.createElement("div");
    document.body.replaceChildren(container);
    const root = createRoot(container);
    await act(async () => { root.render(<NewOpportunityPage />); });
    const form = container.querySelector("form")!;
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    const [, request] = vi.mocked(fetch).mock.calls[0];
    expect(JSON.parse(request!.body as string)).toEqual({
      opportunity: expect.objectContaining({ type: "job", label: "", organization: null }),
      initialTask: null
    });
    const alert = container.querySelector('[role="alert"]') as HTMLElement;
    expect(alert).not.toBeNull();
    expect(alert.getAttribute("tabindex")).toBe("-1");
    expect(document.activeElement).toBe(alert);
    vi.unstubAllGlobals();
    navigation.useRouter.mockReset();
  });
  it("resolves unknown opportunity types to jobs", () => {
    expect(resolveOpportunityType(null)).toBe("job");
    expect(resolveOpportunityType("job")).toBe("job");
    expect(resolveOpportunityType("connection")).toBe("connection");
    expect(resolveOpportunityType("unknown")).toBe("job");
  });

  it("renders the job form by default without an intermediate chooser", () => {
    const markup = renderToStaticMarkup(<NewOpportunityPage />);
    expect(markup).toContain("Add a job");
    expect(markup).toContain('<section class="tracker-panel"><header class="tracker-panel__header"><h2 class="tracker-panel__title">Job details</h2></header>');
    expect(markup).toContain("Role");
    expect(markup).toContain("Organization");
    expect(markup).not.toContain("What kind of opportunity are you adding?");
  });

  it("uses a type-specific tracker panel header for connection details", () => {
    navigation.useSearchParams.mockReturnValue(new URLSearchParams("type=connection"));
    const markup = renderToStaticMarkup(<NewOpportunityPage />);

    expect(markup).toContain('<section class="tracker-panel"><header class="tracker-panel__header"><h2 class="tracker-panel__title">Connection details</h2></header>');
    expect(markup).toContain("Connection opportunity");
    navigation.useSearchParams.mockReset();
  });

  it("builds a connection envelope without job-only fields", () => {
    const payload = buildConnectionCreationPayload({
      label: "Maya Chen",
      organization: "Acme",
      roleContext: "VP Engineering",
      contactInfo: "maya@example.com",
      meetingContext: "Example City engineering meetup",
      summary: "Met after a panel",
      relationshipStrength: "new",
      status: "new",
      priority: "medium",
      activityType: "meeting",
      activityBody: "Discussed platform leadership",
      activityDate: "2026-07-10",
      taskTitle: "Send portfolio",
      taskDueDate: "2026-07-15"
    });

    expect(payload).toMatchObject({
      opportunity: {
        type: "connection",
        label: "Maya Chen",
        relationshipStrength: "new",
        status: "new"
      },
      initialActivity: {
        type: "meeting",
        body: "Discussed platform leadership",
        occurredAt: "2026-07-10T12:00:00.000Z"
      },
      initialTask: { title: "Send portfolio", dueDate: "2026-07-15" }
    });
    expect(payload.opportunity).not.toHaveProperty("url");
    expect(payload.opportunity).not.toHaveProperty("appliedDate");
  });

  it("renders connection dates as date inputs and ordinary fields as text", () => {
    document.body.innerHTML = renderToStaticMarkup(
      <ConnectionOpportunityForm onSubmit={() => undefined} />
    );

    const inputFor = (label: string) => {
      const matchingLabel = Array.from(document.querySelectorAll("label")).find(
        (candidate) => candidate.querySelector("span")?.textContent?.startsWith(label)
      );
      return matchingLabel?.querySelector("input") ?? null;
    };

    expect(inputFor("Date")?.getAttribute("type")).toBe("date");
    expect(inputFor("Due date")?.getAttribute("type")).toBe("date");
    expect(inputFor("Person's name")?.type).toBe("text");
  });

  it("preserves submission time and null due date when optional dates are blank", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-12T08:30:00.000Z"));

    try {
      const payload = buildConnectionCreationPayload({
        label: "Maya Chen",
        organization: "Acme",
        roleContext: "VP Engineering",
        contactInfo: "maya@example.com",
        meetingContext: "Example City engineering meetup",
        summary: "Met after a panel",
        relationshipStrength: "new",
        status: "new",
        priority: "medium",
        activityType: "meeting",
        activityBody: "Discussed platform leadership",
        activityDate: "",
        taskTitle: "Send portfolio",
        taskDueDate: ""
      });

      expect(payload.initialActivity?.occurredAt).toBe("2026-07-12T08:30:00.000Z");
      expect(payload.initialTask).toEqual({ title: "Send portfolio", dueDate: null });
    } finally {
      vi.useRealTimers();
    }
  });
});
