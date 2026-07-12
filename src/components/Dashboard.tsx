"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { getDashboardInsights } from "../lib/dashboard";
import { CONNECTION_STATUSES, JOB_STATUSES, type OpportunityDetail, type OpportunityStatus, type OpportunitySummary } from "../types";
import { AttentionQueue } from "./AttentionQueue";
import { CONNECTION_STATUS_LABELS, JOB_STATUS_LABELS, OpportunityTable, statusLabel } from "./OpportunityTable";
import { OpportunityTypeFilter, type OpportunityTypeFilterValue } from "./OpportunityTypeFilter";
import { StatusFilter, type StatusFilterOption } from "./StatusFilter";
import { useTheme } from "./ThemeProvider";
import { Toast } from "./Toast";

type SortValue = "updated" | "organization" | "next-action" | "priority";
const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 } as const;
const CLOSED_STATUSES = new Set<OpportunityStatus>(["rejected", "dormant", "closed"]);

async function readError(response: Response) {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? `Request failed with ${response.status}`;
}

function detailToSummary(detail: OpportunityDetail): OpportunitySummary {
  return { ...detail, nextOpenTask: detail.tasks.find((task) => task.state === "open") ?? null };
}

function matchesSearch(opportunity: OpportunitySummary, search: string) {
  const query = search.trim().toLowerCase();
  if (!query) return true;
  const typeFields = opportunity.type === "job"
    ? [opportunity.source, opportunity.location, opportunity.contact, opportunity.url]
    : [opportunity.roleContext, opportunity.contactInfo, opportunity.meetingContext];
  return [opportunity.label, opportunity.organization, opportunity.summary, ...typeFields]
    .some((value) => value?.toLowerCase().includes(query));
}

function sortOpportunities(opportunities: OpportunitySummary[], sort: SortValue) {
  return [...opportunities].sort((left, right) => {
    if (sort === "organization") return (left.organization ?? left.label).localeCompare(right.organization ?? right.label);
    if (sort === "next-action") return (left.nextOpenTask?.dueDate ?? "9999-12-31").localeCompare(right.nextOpenTask?.dueDate ?? "9999-12-31");
    if (sort === "priority") return PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority];
    return right.updatedAt.localeCompare(left.updatedAt);
  });
}

function shouldIgnoreShortcut(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

export function Dashboard() {
  const router = useRouter();
  const [opportunities, setOpportunities] = useState<OpportunitySummary[]>([]);
  const [typeFilter, setTypeFilter] = useState<OpportunityTypeFilterValue>("all");
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [sort, setSort] = useState<SortValue>("updated");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [pendingStatusId, setPendingStatusId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; onAction?: () => void } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const pendingStatusRef = useRef(false);
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    let active = true;
    fetch("/api/opportunities?archived=include", { cache: "no-store" })
      .then(async (response) => { if (!response.ok) throw new Error(await readError(response)); return response.json() as Promise<OpportunitySummary[]>; })
      .then((loaded) => { if (active) setOpportunities(loaded); })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "Unable to load opportunities"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (shouldIgnoreShortcut(event.target)) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k" || event.key === "/") {
        event.preventDefault(); searchRef.current?.focus();
      } else if (event.key.toLowerCase() === "n") {
        event.preventDefault(); router.push("/opportunities/new");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [router]);

  const insights = useMemo(() => getDashboardInsights(opportunities), [opportunities]);
  const attentionIds = useMemo(() => new Set(insights.attention.map((item) => item.opportunityId)), [insights]);
  const filtered = useMemo(() => sortOpportunities(opportunities.filter((opportunity) => {
    if (typeFilter !== "all" && opportunity.type !== typeFilter) return false;
    const statusMatches = typeFilter === "all"
      ? statusFilter === "attention" ? attentionIds.has(opportunity.id)
        : statusFilter === "archived" ? opportunity.status === "archived"
          : statusFilter === "closed" ? CLOSED_STATUSES.has(opportunity.status)
            : opportunity.status !== "archived" && !CLOSED_STATUSES.has(opportunity.status)
      : statusFilter === "all" || opportunity.status === statusFilter;
    return statusMatches && matchesSearch(opportunity, search);
  }), sort), [attentionIds, opportunities, search, sort, statusFilter, typeFilter]);

  const statusOptions = useMemo<StatusFilterOption[]>(() => {
    if (typeFilter === "job") return [{ value: "all", label: "All job stages" }, ...JOB_STATUSES.map((status) => ({ value: status, label: JOB_STATUS_LABELS[status] }))];
    if (typeFilter === "connection") return [{ value: "all", label: "All connection stages" }, ...CONNECTION_STATUSES.map((status) => ({ value: status, label: CONNECTION_STATUS_LABELS[status] }))];
    return [
      { value: "active", label: "Active" },
      { value: "attention", label: "Needs attention", count: insights.attention.length },
      { value: "closed", label: "Closed" },
      { value: "archived", label: "Archived" }
    ];
  }, [insights.attention.length, typeFilter]);

  const updateStatus = async (opportunity: OpportunitySummary, status: OpportunityStatus, suppressUndo = false) => {
    if (opportunity.status === status || pendingStatusRef.current) return;
    pendingStatusRef.current = true; setPendingStatusId(opportunity.id); setError(null);
    try {
      const response = await fetch(`/api/opportunities/${opportunity.id}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
      if (!response.ok) throw new Error(await readError(response));
      const updated = detailToSummary(await response.json() as OpportunityDetail);
      setOpportunities((current) => current.map((item) => item.id === updated.id ? updated : item));
      if (!suppressUndo) setToast({ message: `${updated.label} moved to ${statusLabel(updated)}.`, onAction: () => void updateStatus(updated, opportunity.status, true) });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to update stage"); }
    finally { pendingStatusRef.current = false; setPendingStatusId(null); }
  };

  return <main className="app-shell dashboard-shell">
    <header className="dashboard-header"><div className="dashboard-header__brand"><span className="brand-mark" aria-hidden="true">O</span><span>Opportunity Tracker</span></div>
      <div className="dashboard-header__actions"><span className="shortcut-hint"><kbd>⌘</kbd><kbd>K</kbd> Search</span>
        <button className="icon-button" type="button" aria-label="Toggle theme" onClick={() => setTheme((current) => current === "light" ? "dark" : "light")}>{theme === "light" ? "◐" : "☼"}</button>
        <Link className="button button--primary" href="/opportunities/new"><span aria-hidden="true">+</span> New opportunity <kbd>N</kbd></Link>
      </div></header>
    {error ? <div className="notice notice--error" role="alert">{error}</div> : null}
    <section className="pipeline-workspace" aria-labelledby="pipeline-title">
      <div className="pipeline-workspace__header"><div><p className="panel-heading__eyebrow">Workspace</p><h1 id="pipeline-title">Opportunities</h1></div><span className="pipeline-workspace__count">{loading ? "Loading opportunities" : `${filtered.length} in view`}</span></div>
      <div className="pipeline-controls"><div className="pipeline-controls__filters">
        <label className="search-field"><span className="sr-only">Search opportunities</span><input className="search-field__input" ref={searchRef} type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search people, companies, and roles" /></label>
        <label className="select-field"><span className="sr-only">Sort opportunities</span><select value={sort} onChange={(event) => setSort(event.target.value as SortValue)}><option value="updated">Recently updated</option><option value="next-action">Next action date</option><option value="priority">Priority</option><option value="organization">Organization</option></select></label>
      </div><OpportunityTypeFilter value={typeFilter} onChange={(value) => { setTypeFilter(value); setStatusFilter(value === "all" ? "active" : "all"); }} /></div>
      <StatusFilter value={statusFilter} options={statusOptions} onChange={setStatusFilter} />
      <AttentionQueue items={insights.attention} loading={loading} onViewAll={() => { setTypeFilter("all"); setStatusFilter("attention"); }} />
      <OpportunityTable opportunities={filtered} loading={loading} pendingStatusId={pendingStatusId} onStatusChange={updateStatus} emptyMessage={search ? "No opportunities match this search." : "Create your first job or connection opportunity."} />
    </section>
    <Toast message={toast?.message ?? null} actionLabel={toast?.onAction ? "Undo" : undefined} onAction={() => { const action = toast?.onAction; setToast(null); action?.(); }} onDismiss={() => setToast(null)} />
  </main>;
}
