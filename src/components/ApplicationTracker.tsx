"use client";

import { useEffect, useMemo, useState } from "react";

import {
  APPLICATION_STATUSES,
  type Application,
  type ApplicationInput
} from "../types";
import { ApplicationForm } from "./ApplicationForm";
import { ApplicationTable } from "./ApplicationTable";
import { StatusFilter, type StatusFilterValue } from "./StatusFilter";
import { SummaryBar } from "./SummaryBar";

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

async function readError(response: Response) {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? `Request failed with ${response.status}`;
}

export function ApplicationTracker() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>("all");
  const [search, setSearch] = useState("");
  const [editingApplication, setEditingApplication] = useState<Application | null>(null);
  const [formVersion, setFormVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    fetch("/api/applications", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(await readError(response));
        }

        return (await response.json()) as Application[];
      })
      .then((loadedApplications) => {
        if (active) {
          setApplications(loadedApplications);
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

  const saveApplication = async (input: ApplicationInput) => {
    setSaving(true);
    setError(null);

    try {
      const isEditing = editingApplication !== null;
      const response = await fetch(
        isEditing ? `/api/applications/${editingApplication.id}` : "/api/applications",
        {
          method: isEditing ? "PUT" : "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(input)
        }
      );

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      const savedApplication = (await response.json()) as Application;

      setApplications((current) =>
        isEditing
          ? current.map((application) =>
              application.id === savedApplication.id ? savedApplication : application
            )
          : [savedApplication, ...current]
      );
      setEditingApplication(null);
      setFormVersion((current) => current + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save application");
    } finally {
      setSaving(false);
    }
  };

  const deleteApplication = async (id: string) => {
    if (!window.confirm("Delete this application?")) {
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
      setEditingApplication((current) => (current?.id === id ? null : current));
      setFormVersion((current) => current + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to delete application");
    }
  };

  const visibleStatus = statusFilter === "all" ? "all statuses" : statusFilter;

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="app-header__eyebrow">Local SQLite tracker</p>
          <h1 className="app-header__title">Job Applications</h1>
        </div>
        <button
          className="button button--primary"
          type="button"
          onClick={() => {
            setEditingApplication(null);
            setFormVersion((current) => current + 1);
          }}
        >
          New application
        </button>
      </header>

      {error ? <div className="notice notice--error">{error}</div> : null}

      <SummaryBar applications={applications} />

      <section className="tracker-layout" aria-label="Job application tracker">
        <div className="tracker-panel tracker-panel--form">
          <div className="tracker-panel__header">
            <h2 className="tracker-panel__title">
              {editingApplication ? "Edit application" : "Add application"}
            </h2>
            {saving ? <span className="tracker-panel__meta">Saving</span> : null}
          </div>
          <ApplicationForm
            key={`${editingApplication?.id ?? "new"}-${formVersion}`}
            initialValue={editingApplication}
            onSubmit={saveApplication}
            onCancel={
              editingApplication
                ? () => {
                    setEditingApplication(null);
                    setFormVersion((current) => current + 1);
                  }
                : undefined
            }
            submitLabel={editingApplication ? "Update application" : "Add application"}
          />
        </div>

        <div className="tracker-panel tracker-panel--table">
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
            <h2 className="tracker-panel__title">Applications</h2>
            <span className="tracker-panel__meta">
              {loading
                ? "Loading"
                : `${filteredApplications.length} shown across ${visibleStatus}`}
            </span>
          </div>

          <ApplicationTable
            applications={filteredApplications}
            onEdit={(application) => setEditingApplication(application)}
            onDelete={deleteApplication}
            emptyMessage="No applications match the current filters."
          />
        </div>
      </section>
    </main>
  );
}
