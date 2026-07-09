"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  APPLICATION_STATUSES,
  APPLICATION_NOTE_TYPES,
  NOTE_TYPE_LABELS,
  STATUS_LABELS,
  type ApplicationDetail,
  type Application,
  type ApplicationInput,
  type ApplicationNoteType,
  type ApplicationStatus
} from "../types";
import { ApplicationArtifactViewer } from "./ApplicationArtifactViewer";
import { ActivityTimeline } from "./ActivityTimeline";
import { ApplicationForm } from "./ApplicationForm";

type ApplicationDetailPageProps = {
  applicationId: string;
};

type DetailModal = "status" | "note" | "details" | null;

async function readError(response: Response) {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? `Request failed with ${response.status}`;
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

export function ApplicationDetailPage({ applicationId }: ApplicationDetailPageProps) {
  const router = useRouter();
  const [detail, setDetail] = useState<ApplicationDetail | null>(null);
  const [status, setStatus] = useState<ApplicationStatus>("wishlist");
  const [statusNote, setStatusNote] = useState("");
  const [noteType, setNoteType] = useState<ApplicationNoteType>("update");
  const [noteBody, setNoteBody] = useState("");
  const [noteFollowUpDate, setNoteFollowUpDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingStatus, setSavingStatus] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [savingDetails, setSavingDetails] = useState(false);
  const [activeModal, setActiveModal] = useState<DetailModal>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    fetch(`/api/applications/${applicationId}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(await readError(response));
        }

        return (await response.json()) as ApplicationDetail;
      })
      .then((loadedDetail) => {
        if (active) {
          setDetail(loadedDetail);
          setStatus(loadedDetail.status);
        }
      })
      .catch((caught) => {
        if (active) {
          setError(caught instanceof Error ? caught.message : "Unable to load application");
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
  }, [applicationId]);

  const saveStatus = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!detail || status === detail.status) {
      return;
    }

    setSavingStatus(true);
    setError(null);

    try {
      const response = await fetch(`/api/applications/${detail.id}/status`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          status,
          note: statusNote
        })
      });

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      const updated = (await response.json()) as ApplicationDetail;
      setDetail(updated);
      setStatus(updated.status);
      setStatusNote("");
      setActiveModal(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to update status");
    } finally {
      setSavingStatus(false);
    }
  };

  const addNote = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!detail) {
      return;
    }

    setSavingNote(true);
    setError(null);

    try {
      const response = await fetch(`/api/applications/${detail.id}/notes`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          type: noteType,
          body: noteBody,
          followUpDate: noteType === "follow_up" ? noteFollowUpDate : null
        })
      });

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      const updated = (await response.json()) as ApplicationDetail;
      setDetail(updated);
      setNoteBody("");
      setNoteType("update");
      setNoteFollowUpDate("");
      setActiveModal(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to add note");
    } finally {
      setSavingNote(false);
    }
  };

  const saveDetails = async (input: ApplicationInput) => {
    if (!detail) {
      return;
    }

    setSavingDetails(true);
    setError(null);

    try {
      const response = await fetch(`/api/applications/${detail.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          ...input,
          status: detail.status
        })
      });

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      const updated = (await response.json()) as ApplicationDetail;
      setDetail(updated);
      setStatus(updated.status);
      setActiveModal(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to update details");
    } finally {
      setSavingDetails(false);
    }
  };

  const deleteApplication = async () => {
    if (!detail || !window.confirm("Delete this application and its history?")) {
      return;
    }

    setError(null);

    try {
      const response = await fetch(`/api/applications/${detail.id}`, {
        method: "DELETE"
      });

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      router.push("/");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to delete application");
    }
  };

  if (loading) {
    return (
      <main className="app-shell">
        <div className="notice">Loading application...</div>
      </main>
    );
  }

  if (!detail) {
    return (
      <main className="app-shell">
        <header className="app-header">
          <div>
            <p className="app-header__eyebrow">Application</p>
            <h1 className="app-header__title">Not Found</h1>
          </div>
          <Link className="button" href="/">
            Back to dashboard
          </Link>
        </header>
        {error ? <div className="notice notice--error">{error}</div> : null}
      </main>
    );
  }

  return (
    <main className="app-shell">
      <nav className="detail-nav" aria-label="Application navigation">
        <Link className="detail-nav__back" href="/">
          <span aria-hidden="true">←</span>
          Dashboard
        </Link>
      </nav>
      <header className="app-header">
        <div>
          <p className="app-header__eyebrow">Application</p>
          <div className="app-header__title-row">
            <h1 className="app-header__title">
              {detail.company} - {detail.role}
            </h1>
            <span className={`status-badge status-badge--${detail.status}`}>
              {STATUS_LABELS[detail.status]}
            </span>
          </div>
        </div>
      </header>

      {error ? <div className="notice notice--error">{error}</div> : null}

      <section className="detail-grid" aria-label="Application workspace">
        <details className="floating-actions">
          <summary className="floating-actions__button" aria-label="Application actions">
            +
          </summary>
          <div className="floating-actions__menu">
            <button
              className="floating-actions__item"
              type="button"
              onClick={(event) => {
                event.currentTarget.closest("details")?.removeAttribute("open");
                setActiveModal("note");
              }}
            >
              Add note
            </button>
            <button
              className="floating-actions__item"
              type="button"
              onClick={(event) => {
                event.currentTarget.closest("details")?.removeAttribute("open");
                setStatus(detail.status);
                setActiveModal("status");
              }}
            >
              Update status
            </button>
            <button
              className="floating-actions__item"
              type="button"
              onClick={(event) => {
                event.currentTarget.closest("details")?.removeAttribute("open");
                setActiveModal("details");
              }}
            >
              Edit details
            </button>
            <button
              className="floating-actions__item floating-actions__item--danger"
              type="button"
              onClick={(event) => {
                event.currentTarget.closest("details")?.removeAttribute("open");
                deleteApplication();
              }}
            >
              Delete
            </button>
          </div>
        </details>
        <div className="detail-main">
          <section className="tracker-panel">
            <div className="tracker-panel__header">
              <h2 className="tracker-panel__title">Activity history</h2>
              <span className="tracker-panel__meta">{detail.activity.length} events</span>
            </div>
            <ActivityTimeline activity={detail.activity} />
          </section>

          <section className="tracker-panel">
            <div className="tracker-panel__header">
              <h2 className="tracker-panel__title">Application materials</h2>
              <span className="tracker-panel__meta">{detail.artifacts.length} files</span>
            </div>
            <ApplicationArtifactViewer applicationId={detail.id} artifacts={detail.artifacts} />
          </section>
        </div>

        <aside className="detail-side">
          <section className="tracker-panel">
            <div className="tracker-panel__header">
              <h2 className="tracker-panel__title">Snapshot</h2>
            </div>
            <dl className="detail-list">
              <div>
                <dt>Source</dt>
                <dd>{detail.source ?? "None"}</dd>
              </div>
              <div>
                <dt>Location</dt>
                <dd>{detail.location ?? "None"}</dd>
              </div>
              <div>
                <dt>Contact</dt>
                <dd>{detail.contact ?? "None"}</dd>
              </div>
              <div>
                <dt>Applied</dt>
                <dd>{formatDateOnly(detail.appliedDate)}</dd>
              </div>
              {detail.url ? (
                <div>
                  <dt>Posting</dt>
                  <dd>
                    <a href={detail.url} rel="noreferrer" target="_blank">
                      Open posting
                    </a>
                  </dd>
                </div>
              ) : null}
            </dl>
          </section>
        </aside>
      </section>

      {activeModal ? (
        <div className="modal-backdrop" role="presentation">
          <section
            aria-modal="true"
            className="modal"
            role="dialog"
            aria-labelledby="application-action-modal-title"
          >
            <header className="modal__header">
              <h2 className="modal__title" id="application-action-modal-title">
                {activeModal === "note"
                  ? "Add note"
                  : activeModal === "status"
                    ? "Update status"
                    : "Edit details"}
              </h2>
              <button className="modal__close" type="button" onClick={() => setActiveModal(null)}>
                Close
              </button>
            </header>

            {activeModal === "note" ? (
              <form className="note-form" onSubmit={addNote}>
                <label className="application-form__field">
                  <span className="application-form__label">Type</span>
                  <select
                    className="application-form__select"
                    value={noteType}
                    onChange={(event) => setNoteType(event.target.value as ApplicationNoteType)}
                  >
                    {APPLICATION_NOTE_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {NOTE_TYPE_LABELS[type]}
                      </option>
                    ))}
                  </select>
                </label>
                {noteType === "follow_up" ? (
                  <label className="application-form__field">
                    <span className="application-form__label">Follow-up date</span>
                    <input
                      className="application-form__input"
                      required
                      type="date"
                      value={noteFollowUpDate}
                      onChange={(event) => setNoteFollowUpDate(event.target.value)}
                    />
                  </label>
                ) : null}
                <label className="application-form__field">
                  <span className="application-form__label">Note</span>
                  <textarea
                    className="application-form__textarea"
                    required
                    value={noteBody}
                    onChange={(event) => setNoteBody(event.target.value)}
                    rows={4}
                  />
                </label>
                <div className="application-form__actions">
                  <button
                    className="application-form__button application-form__button--secondary"
                    type="button"
                    onClick={() => setActiveModal(null)}
                  >
                    Cancel
                  </button>
                  <button className="application-form__button application-form__button--primary" type="submit">
                    {savingNote ? "Adding..." : "Add note"}
                  </button>
                </div>
              </form>
            ) : null}

            {activeModal === "status" ? (
              <form className="status-form" onSubmit={saveStatus}>
                <label className="application-form__field">
                  <span className="application-form__label">Current status</span>
                  <select
                    className="application-form__select"
                    value={status}
                    onChange={(event) => setStatus(event.target.value as ApplicationStatus)}
                  >
                    {APPLICATION_STATUSES.map((option) => (
                      <option key={option} value={option}>
                        {STATUS_LABELS[option]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="application-form__field">
                  <span className="application-form__label">Status note</span>
                  <textarea
                    className="application-form__textarea"
                    value={statusNote}
                    onChange={(event) => setStatusNote(event.target.value)}
                    rows={3}
                  />
                </label>
                <div className="application-form__actions">
                  <button
                    className="application-form__button application-form__button--secondary"
                    type="button"
                    onClick={() => setActiveModal(null)}
                  >
                    Cancel
                  </button>
                  <button
                    className="application-form__button application-form__button--primary"
                    type="submit"
                    disabled={status === detail.status}
                  >
                    {savingStatus ? "Updating..." : "Update status"}
                  </button>
                </div>
              </form>
            ) : null}

            {activeModal === "details" ? (
              <ApplicationForm
                key={detail.updatedAt}
                initialValue={detailToApplication(detail)}
                onSubmit={saveDetails}
                showStatus={false}
                submitLabel={savingDetails ? "Saving..." : "Save details"}
              />
            ) : null}
          </section>
        </div>
      ) : null}
    </main>
  );
}
