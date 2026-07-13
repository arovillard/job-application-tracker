// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CONNECTION_STATUSES, JOB_STATUSES, type OpportunitySummary } from "../types";
import { OpportunityTable } from "./OpportunityTable";

const job: OpportunitySummary = {
  id: "job-1",
  type: "job",
  label: "Platform Engineer",
  organization: "Acme Corp",
  status: "applied",
  priority: "high",
  summary: null,
  originOpportunityId: null,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-12T08:00:00.000Z",
  url: null,
  source: null,
  location: "Remote",
  contact: null,
  appliedDate: null,
  nextOpenTask: {
    id: "task-1",
    opportunityId: "job-1",
    title: "Send portfolio",
    dueDate: "2026-07-15",
    state: "open",
    sourceActivityId: null,
    completedAt: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z"
  }
};

const connection: OpportunitySummary = {
  id: "connection-1",
  type: "connection",
  label: "Maya Chen",
  organization: null,
  status: "in_conversation",
  priority: "medium",
  summary: null,
  originOpportunityId: null,
  createdAt: "2026-07-02T00:00:00.000Z",
  updatedAt: "2026-07-11T08:00:00.000Z",
  roleContext: "Engineering leader",
  contactInfo: null,
  meetingContext: null,
  relationshipStrength: "strong",
  lastInteractionAt: null,
  nextOpenTask: null
};

function renderTable(opportunities: OpportunitySummary[], pendingStatusId: string | null = null) {
  document.body.innerHTML = renderToStaticMarkup(
    <OpportunityTable
      opportunities={opportunities}
      pendingStatusId={pendingStatusId}
      onStatusChange={() => undefined}
    />
  );
}

function mountTable(onStatusChange = vi.fn()) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(<OpportunityTable opportunities={[job, connection]} onStatusChange={onStatusChange} />);
  });
  return { container, onStatusChange, root: root! };
}

function rowFor(label: string) {
  const primary = [...document.querySelectorAll(".application-table__primary")].find((element) => element.textContent === label);
  return primary?.closest("tr") ?? null;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("OpportunityTable", () => {
  it("renders mixed opportunity identities, recency, statuses, and uniquely named row links", () => {
    renderTable([job, connection], "job-1");

    const jobRow = rowFor("Platform Engineer");
    const connectionRow = rowFor("Maya Chen");
    expect(jobRow).not.toBeNull();
    expect(connectionRow).not.toBeNull();
    expect(document.querySelector("th:nth-child(5)")?.textContent).toBe("Updated");

    for (const [row, label] of [[jobRow, "Platform Engineer"], [connectionRow, "Maya Chen"]] as const) {
      const identityClasses = [...row!.querySelector(".application-table__company")!.children].map((element) => element.className);
      expect(identityClasses.slice(0, 3)).toEqual([
        "application-table__identity-row",
        "application-table__secondary",
        "application-table__tertiary"
      ]);
      expect(row!.querySelector(`[aria-label="Open ${label}"]`)?.getAttribute("href")).toBe(
        label === "Platform Engineer" ? "/opportunities/job-1" : "/opportunities/connection-1"
      );
      expect(row!.querySelector('[data-label="Updated"] time')?.getAttribute("dateTime")).toBe(
        label === "Platform Engineer" ? job.updatedAt : connection.updatedAt
      );
    }

    const jobIdentity = jobRow!.querySelector(".application-table__identity-row")!;
    expect(jobIdentity.querySelector(".application-table__primary")?.textContent).toBe("Platform Engineer");
    expect(jobIdentity.querySelector(".type-badge")?.textContent).toBe("Job");
    expect(jobRow!.querySelector(".application-table__tertiary")?.textContent).toBe("Remote");
    expect(jobRow!.querySelector("select")?.value).toBe("applied");
    expect(jobRow!.querySelector("select")?.disabled).toBe(true);
    expect(jobRow!.querySelector(".next-move__date")?.getAttribute("dateTime")).toBe("2026-07-15");

    const connectionIdentity = connectionRow!.querySelector(".application-table__identity-row")!;
    expect(connectionIdentity.querySelector(".application-table__primary")?.textContent).toBe("Maya Chen");
    expect(connectionIdentity.querySelector(".type-badge")?.textContent).toBe("Connection");
    expect(connectionRow!.querySelector(".application-table__tertiary")?.textContent).toBe("Strong relationship");
    expect(connectionRow!.querySelector(".relationship-chip")).toBeNull();
    expect(connectionRow!.querySelector("select")?.value).toBe("in_conversation");
  });

  it("renders three accessible loading skeleton rows and an empty state that reuses the header creation control", () => {
    document.body.innerHTML = renderToStaticMarkup(<OpportunityTable opportunities={[]} loading />);
    const emptyMarkup = renderToStaticMarkup(<OpportunityTable opportunities={[]} />);

    const loadingStatus = document.querySelector('[role="status"]');
    expect(loadingStatus?.textContent).toContain("Loading opportunities");
    expect(loadingStatus?.getAttribute("aria-busy")).toBe("true");
    expect(document.querySelectorAll(".application-table__loading-row")).toHaveLength(3);
    expect(emptyMarkup).toContain("Use New opportunity above");
    expect(emptyMarkup).not.toContain("new-opportunity-menu");
    expect(emptyMarkup).not.toContain('href="/opportunities/new"');
  });

  it("invokes onStatusChange with the row opportunity and selected stage", () => {
    const { container, onStatusChange, root } = mountTable();
    const select = container.querySelector<HTMLSelectElement>(".stage-select select")!;

    act(() => {
      select.value = "offer";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(onStatusChange).toHaveBeenCalledWith(job, "offer");
    act(() => root.unmount());
  });

  it("renders complete, distinct status options for job and connection rows", () => {
    const { container, root } = mountTable();
    const optionValues = [...container.querySelectorAll<HTMLSelectElement>(".stage-select select")]
      .map((select) => [...select.options].map((option) => option.value));

    expect(optionValues).toEqual([JOB_STATUSES, CONNECTION_STATUSES]);
    expect(optionValues[0]).not.toEqual(optionValues[1]);
    act(() => root.unmount());
  });

  it("uses scoped headers and a safe job posting link", () => {
    const markup = renderToStaticMarkup(<OpportunityTable opportunities={[{ ...job, url: "https://jobs.example.test/platform" }]} />);
    document.body.innerHTML = markup;

    expect([...document.querySelectorAll("th")].every((header) => header.getAttribute("scope") === "col")).toBe(true);
    const posting = document.querySelector<HTMLAnchorElement>('a[aria-label="View posting for Platform Engineer"]');
    expect(posting?.className).toBe("application-table__link");
    expect(posting?.getAttribute("href")).toBe("https://jobs.example.test/platform");
    expect(posting?.getAttribute("target")).toBe("_blank");
    expect(posting?.getAttribute("rel")).toBe("noreferrer");
  });
});
