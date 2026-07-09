"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  APPLICATION_STATUSES,
  STATUS_LABELS,
  type Application,
  type ApplicationDetail,
  type FollowUpItem,
  type ApplicationStatus
} from "../types";
import { ApplicationTable } from "./ApplicationTable";
import { StatusFilter, type StatusFilterValue } from "./StatusFilter";
import { SummaryBar } from "./SummaryBar";

async function readError(response: Response) {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? `Request failed with ${response.status}`;
}

function buildStatusCounts(applications: Application[]) {
  const counts: Partial<Record<StatusFilterValue, number>> = {
    all: applications.length
  };

  for (const status of APPLICATION_STATUSES) {
    counts[status] = 0;
  }

  for (const application of applications) {
    counts[application.status] = (counts[application.status] ?? 0) + 1;
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
    application.notes
  ].some((value) => value?.toLowerCase().includes(query));
}

function formatDateOnly(value: string | null) {
  if (!value) {
    return "None";
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "UTC"
  }).format(parsed);
}

function formatDateTime(value: string) {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(parsed);
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
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt
  };
}

export function Dashboard() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [followUps, setFollowUps] = useState<FollowUpItem[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [pendingStatusId, setPendingStatusId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
          setError(caught instanceof Error ? caught.message : "Unable to load applications");
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

  const filteredApplications = useMemo(
    () =>
      applications.filter((application) => {
        const statusMatches = statusFilter === "all" || application.status === statusFilter;
        return statusMatches && matchesSearch(application, search);
      }),
    [applications, search, statusFilter]
  );

  const statusCounts = useMemo(() => buildStatusCounts(applications), [applications]);

  const followUpQueue = useMemo(() => followUps.slice(0, 5), [followUps]);

  const recentApplications = useMemo(
    () =>
      [...applications]
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, 5),
    [applications]
  );

  const updateStatus = async (application: Application, status: ApplicationStatus) => {
    if (application.status === status) {
      return;
    }

    setPendingStatusId(application.id);
    setError(null);

    try {
      const response = await fetch(`/api/applications/${application.id}/status`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ status })
      });

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      const updated = (await response.json()) as ApplicationDetail;
      const updatedApplication = detailToApplication(updated);

      setApplications((current) =>
        current.map((item) => (item.id === updatedApplication.id ? updatedApplication : item))
      );
      setFollowUps((current) =>
        current
          .filter((item) =>
            updatedApplication.status === "archived" || updatedApplication.status === "rejected"
              ? item.applicationId !== updatedApplication.id
              : true
          )
          .map((item) =>
            item.applicationId === updatedApplication.id
              ? {
                  ...item,
                  application: {
                    ...item.application,
                    status: updatedApplication.status
                  }
                }
              : item
          )
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to update status");
    } finally {
      setPendingStatusId(null);
    }
  };

  const deleteApplication = async (id: string) => {
    if (!window.confirm("Delete this application and its history?")) {
      return;
    }

    setError(null);

    try {
      const response = await fetch(`/api/applications/${id}`, {
        method: "DELETE"
      });

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      setApplications((current) => current.filter((application) => application.id !== id));
      setFollowUps((current) => current.filter((item) => item.applicationId !== id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to delete application");
    }
  };

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="app-header__eyebrow">Dashboard</p>
          <h1 className="app-header__title">Job Applications</h1>
        </div>
        <Link className="button button--primary" href="/applications/new">
          New application
        </Link>
      </header>

      {error ? <div className="notice notice--error">{error}</div> : null}

      <SummaryBar applications={applications} />

      <section className="dashboard-grid" aria-label="Dashboard queues">
        <div className="tracker-panel">
          <div className="tracker-panel__header">
            <h2 className="tracker-panel__title">Follow-up queue</h2>
            <span className="tracker-panel__meta">{followUpQueue.length} active</span>
          </div>
          <div className="queue-list">
            {followUpQueue.length === 0 ? (
              <p className="queue-list__empty">No follow-up notes are scheduled.</p>
            ) : (
              followUpQueue.map((followUp) => (
                <Link
                  className="queue-list__item"
                  href={`/applications/${followUp.applicationId}`}
                  key={followUp.id}
                >
                  <span>
                    <strong>{followUp.application.company}</strong>
                    <span>{followUp.body}</span>
                  </span>
                  <span className="queue-list__date">{formatDateOnly(followUp.followUpDate)}</span>
                </Link>
              ))
            )}
          </div>
        </div>

        <div className="tracker-panel">
          <div className="tracker-panel__header">
            <h2 className="tracker-panel__title">Recently updated</h2>
            <span className="tracker-panel__meta">{recentApplications.length} tracked</span>
          </div>
          <div className="queue-list">
            {recentApplications.length === 0 ? (
              <p className="queue-list__empty">No applications have been created yet.</p>
            ) : (
              recentApplications.map((application) => (
                <Link
                  className="queue-list__item"
                  href={`/applications/${application.id}`}
                  key={application.id}
                >
                  <span>
                    <strong>{application.company}</strong>
                    <span>{STATUS_LABELS[application.status]}</span>
                  </span>
                  <span className="queue-list__date">{formatDateTime(application.updatedAt)}</span>
                </Link>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="tracker-panel" aria-label="Applications">
        <div className="tracker-toolbar">
          <label className="search-field">
            <span className="search-field__label">Search</span>
            <input
              className="search-field__input"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Company, role, source, contact"
            />
          </label>
          <StatusFilter value={statusFilter} onChange={setStatusFilter} counts={statusCounts} />
        </div>

        <div className="tracker-panel__header tracker-panel__header--compact">
          <h2 className="tracker-panel__title">Application pipeline</h2>
          <span className="tracker-panel__meta">
            {loading ? "Loading" : `${filteredApplications.length} shown`}
            {pendingStatusId ? " - Saving status" : ""}
          </span>
        </div>

        <ApplicationTable
          applications={filteredApplications}
          detailsHref={(application) => `/applications/${application.id}`}
          onStatusChange={updateStatus}
          onDelete={deleteApplication}
          emptyMessage="No applications match the current filters."
        />
      </section>
    </main>
  );
}
