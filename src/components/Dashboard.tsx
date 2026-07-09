"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { getDashboardInsights } from "../lib/dashboard";
import {
  APPLICATION_STATUSES,
  STATUS_LABELS,
  type Application,
  type ApplicationDetail,
  type ApplicationInput,
  type ApplicationStatus,
  type FollowUpItem
} from "../types";
import { ApplicationTable } from "./ApplicationTable";
import { AttentionQueue } from "./AttentionQueue";
import { PipelineOverview } from "./PipelineOverview";
import { QuickCapture } from "./QuickCapture";
import { StatusFilter, type StatusFilterValue } from "./StatusFilter";
import { useTheme } from "./ThemeProvider";
import { Toast } from "./Toast";

type SavedView = "all" | "active" | "attention" | "interviewing" | "archived";
type SortValue = "updated" | "company" | "next-action" | "priority";

type ToastState = {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
};

const SAVED_VIEWS: Array<{ value: SavedView; label: string }> = [
  { value: "all", label: "All opportunities" },
  { value: "active", label: "Active" },
  { value: "attention", label: "Needs attention" },
  { value: "interviewing", label: "Interviewing" },
  { value: "archived", label: "Archived" }
];

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 } as const;

async function readError(response: Response) {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? `Request failed with ${response.status}`;
}

function buildStatusCounts(applications: Application[]) {
  const counts: Partial<Record<StatusFilterValue, number>> = { all: applications.length };

  for (const status of APPLICATION_STATUSES) {
    counts[status] = applications.filter((application) => application.status === status).length;
  }

  return counts;
}

function matchesSearch(application: Application, search: string) {
  const query = search.trim().toLowerCase();

  if (!query) {
    return true;
  }

  return [
    application.company,
    application.role,
    application.source,
    application.location,
    application.contact,
    application.notes,
    application.nextAction
  ].some((value) => value?.toLowerCase().includes(query));
}

function detailToApplication(detail: ApplicationDetail): Application {
  return {
    id: detail.id,
    company: detail.company,
    role: detail.role,
    status: detail.status,
    source: detail.source,
    location: detail.location,
    url: detail.url,
    contact: detail.contact,
    notes: detail.summary,
    appliedDate: detail.appliedDate,
    followUpDate: detail.followUpDate,
    nextAction: detail.nextAction,
    nextActionDate: detail.nextActionDate,
    priority: detail.priority,
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt
  };
}

function sortApplications(applications: Application[], sort: SortValue) {
  return [...applications].sort((left, right) => {
    if (sort === "company") {
      return left.company.localeCompare(right.company);
    }

    if (sort === "next-action") {
      return (left.nextActionDate ?? "9999-12-31").localeCompare(right.nextActionDate ?? "9999-12-31");
    }

    if (sort === "priority") {
      return PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority];
    }

    return right.updatedAt.localeCompare(left.updatedAt);
  });
}

function shouldIgnoreShortcut(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

export function Dashboard() {
  const router = useRouter();
  const [applications, setApplications] = useState<Application[]>([]);
  const [followUps, setFollowUps] = useState<FollowUpItem[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>("all");
  const [savedView, setSavedView] = useState<SavedView>("all");
  const [sort, setSort] = useState<SortValue>("updated");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [pendingStatusId, setPendingStatusId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const pendingStatusRef = useRef(false);
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    let active = true;

    Promise.all([
      fetch("/api/applications", { cache: "no-store" }).then(async (response) => {
        if (!response.ok) {
          throw new Error(await readError(response));
        }
        return (await response.json()) as Application[];
      }),
      fetch("/api/followups", { cache: "no-store" }).then(async (response) => {
        if (!response.ok) {
          throw new Error(await readError(response));
        }
        return (await response.json()) as FollowUpItem[];
      })
    ])
      .then(([loadedApplications, loadedFollowUps]) => {
        if (active) {
          setApplications(loadedApplications);
          setFollowUps(loadedFollowUps);
        }
      })
      .catch((caught) => {
        if (active) {
          setError(caught instanceof Error ? caught.message : "Unable to load your pipeline");
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (shouldIgnoreShortcut(event.target)) {
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }

      if (event.key === "/") {
        event.preventDefault();
        searchRef.current?.focus();
      }

      if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        router.push("/applications/new");
      }
    };

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [router]);

  const insights = useMemo(
    () => getDashboardInsights(applications, followUps),
    [applications, followUps]
  );
  const attentionApplicationIds = useMemo(
    () => new Set(insights.attention.map((item) => item.applicationId)),
    [insights.attention]
  );
  const filteredApplications = useMemo(() => {
    const visible = applications.filter((application) => {
      const statusMatches = statusFilter === "all" || application.status === statusFilter;
      const viewMatches =
        savedView === "all" ||
        (savedView === "active" && ["applied", "interviewing", "offer"].includes(application.status)) ||
        (savedView === "attention" && attentionApplicationIds.has(application.id)) ||
        (savedView === "interviewing" && application.status === "interviewing") ||
        (savedView === "archived" && application.status === "archived");

      return statusMatches && viewMatches && matchesSearch(application, search);
    });

    return sortApplications(visible, sort);
  }, [applications, attentionApplicationIds, savedView, search, sort, statusFilter]);
  const statusCounts = useMemo(() => buildStatusCounts(applications), [applications]);

  const updateStatus = async (
    application: Application,
    status: ApplicationStatus,
    suppressUndo = false
  ) => {
    if (application.status === status || pendingStatusRef.current) {
      return;
    }

    pendingStatusRef.current = true;
    setPendingStatusId(application.id);
    setError(null);

    try {
      const response = await fetch(`/api/applications/${application.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status })
      });

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      const updated = detailToApplication((await response.json()) as ApplicationDetail);
      setApplications((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setFollowUps((current) => current.map((item) => (
        item.applicationId === updated.id
          ? { ...item, application: { ...item.application, status: updated.status } }
          : item
      )));

      if (!suppressUndo) {
        setToast({
          message: `${updated.company} moved to ${STATUS_LABELS[updated.status]}.`,
          actionLabel: "Undo",
          onAction: () => void updateStatus(updated, application.status, true)
        });
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to update the stage");
    } finally {
      pendingStatusRef.current = false;
      setPendingStatusId(null);
    }
  };

  const createApplication = async (input: ApplicationInput) => {
    const response = await fetch("/api/applications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    });

    if (!response.ok) {
      throw new Error(await readError(response));
    }

    const created = (await response.json()) as Application;
    setApplications((current) => [created, ...current]);
    setToast({ message: `${created.company} is in your pipeline.` });
    return created;
  };

  const selectPipelineView = (view: "active" | "attention" | "interviewing" | "offer") => {
    setStatusFilter(view === "offer" ? "offer" : "all");
    setSavedView(view === "offer" ? "all" : view);
    window.requestAnimationFrame(() => workspaceRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  return (
    <main className="app-shell dashboard-shell">
      <header className="dashboard-header">
        <div className="dashboard-header__brand">
          <span className="brand-mark" aria-hidden="true">J</span>
          <span>Job Tracker</span>
        </div>
        <div className="dashboard-header__actions">
          <span className="shortcut-hint"><kbd>⌘</kbd><kbd>K</kbd> Search</span>
          <button
            className="icon-button"
            type="button"
            aria-label={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
            onClick={() => setTheme((current) => (current === "light" ? "dark" : "light"))}
          >
            {theme === "light" ? "◐" : "☼"}
          </button>
          <Link className="button button--primary" href="/applications/new">
            <span aria-hidden="true">+</span> New application <kbd>N</kbd>
          </Link>
        </div>
      </header>

      <section className="dashboard-intro" aria-labelledby="dashboard-title">
        <p className="app-header__eyebrow">Your search, in focus</p>
        <h1 id="dashboard-title">Make your next move obvious.</h1>
        <p>See the opportunities that are moving, the conversations to protect, and the work that deserves attention today.</p>
      </section>

      {error ? <div className="notice notice--error" role="alert">{error}</div> : null}

      <PipelineOverview metrics={insights.metrics} onSelect={selectPipelineView} />

      <section className="dashboard-focus-grid" aria-label="Today and quick capture">
        <AttentionQueue items={insights.attention} loading={loading} />
        <QuickCapture disabled={loading} onCreate={createApplication} />
      </section>

      <section className="pipeline-workspace" aria-labelledby="pipeline-title" ref={workspaceRef}>
        <div className="pipeline-workspace__header">
          <div>
            <p className="panel-heading__eyebrow">Pipeline</p>
            <h2 id="pipeline-title">Your opportunities</h2>
          </div>
          <span className="pipeline-workspace__count">
            {loading ? "Loading your pipeline" : `${filteredApplications.length} in view`}
            {pendingStatusId ? " · Updating stage" : ""}
          </span>
        </div>
        <div className="pipeline-controls">
          <div className="saved-views" role="group" aria-label="Saved pipeline views">
            {SAVED_VIEWS.map((view) => (
              <button
                className="saved-views__button"
                data-active={savedView === view.value ? "true" : "false"}
                type="button"
                key={view.value}
                onClick={() => setSavedView(view.value)}
              >
                {view.label}
              </button>
            ))}
          </div>
          <div className="pipeline-controls__filters">
            <label className="search-field">
              <span className="sr-only">Search opportunities</span>
              <span className="search-field__icon" aria-hidden="true">⌕</span>
              <input
                className="search-field__input"
                ref={searchRef}
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search opportunities"
              />
            </label>
            <label className="select-field">
              <span className="sr-only">Sort applications</span>
              <select value={sort} onChange={(event) => setSort(event.target.value as SortValue)}>
                <option value="updated">Recently updated</option>
                <option value="next-action">Next action date</option>
                <option value="priority">Priority</option>
                <option value="company">Company name</option>
              </select>
            </label>
          </div>
          <StatusFilter value={statusFilter} onChange={setStatusFilter} counts={statusCounts} />
        </div>
        <ApplicationTable
          applications={filteredApplications}
          detailsHref={(application) => `/applications/${application.id}`}
          loading={loading}
          onStatusChange={updateStatus}
          pendingStatusId={pendingStatusId}
          emptyMessage={search || savedView !== "all" || statusFilter !== "all" ? "No opportunities match this view. Try clearing a filter or search term." : undefined}
        />
      </section>

      <Toast
        message={toast?.message ?? null}
        actionLabel={toast?.actionLabel}
        onAction={() => {
          if (!toast?.onAction || pendingStatusRef.current) {
            return;
          }
          const action = toast.onAction;
          setToast(null);
          action();
        }}
        onDismiss={() => setToast(null)}
      />
    </main>
  );
}
