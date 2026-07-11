"use client";

import Link from "next/link";

import {
  APPLICATION_STATUSES,
  STATUS_LABELS,
  type Application,
  type ApplicationStatus
} from "../types";

type ApplicationTableProps = {
  applications: Application[];
  onEdit?: (application: Application) => void;
  onDelete?: (id: string) => void;
  onStatusChange?: (application: Application, status: ApplicationStatus) => void | Promise<void>;
  detailsHref?: (application: Application) => string;
  emptyMessage?: string;
  loading?: boolean;
  pendingStatusId?: string | null;
  emptyActions?: {
    onApplyWithAgent(): void;
    manualHref: string;
  };
};

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "UTC"
});

function formatDate(value: string | null) {
  if (!value) {
    return "No date set";
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? value : DATE_FORMAT.format(parsed);
}

function priorityLabel(priority: Application["priority"]) {
  return priority === "high" ? "High focus" : priority === "low" ? "Low focus" : "Standard";
}

function normalizeUrl(url: string) {
  const trimmed = url.trim();
  return /^[a-z][a-z\d+\-.]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function ApplicationTable({
  applications,
  detailsHref,
  onEdit,
  onDelete,
  onStatusChange,
  emptyMessage,
  loading = false,
  pendingStatusId = null,
  emptyActions
}: ApplicationTableProps) {
  if (loading) {
    return (
      <div className="application-table application-table--loading" aria-busy="true" aria-label="Loading opportunities">
        <div className="application-table__loading-row"><span /><span /><span /><span /></div>
        <div className="application-table__loading-row"><span /><span /><span /><span /></div>
        <div className="application-table__loading-row"><span /><span /><span /><span /></div>
      </div>
    );
  }

  if (applications.length === 0) {
    return (
      <div className="application-table application-table--empty">
        <div className="application-table__empty-state">
          <span className="empty-state__icon" aria-hidden="true">✦</span>
          <strong className="application-table__empty-title">{emptyActions ? "Start your next application" : "No opportunities match this view"}</strong>
          <p className="application-table__empty-message">
            {emptyActions
              ? "Give the agent a public job posting. Review the role before it creates tailored materials and adds the application to your tracker."
              : emptyMessage ?? "Try clearing a filter or search term."}
          </p>
          {emptyActions ? <div className="application-table__empty-actions">
            <button className="button button--primary" type="button" onClick={emptyActions.onApplyWithAgent}>Apply with Agent</button>
            <Link className="button application-table__manual-action" href={emptyActions.manualHref}>Already applied? Add it manually</Link>
          </div> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="application-table">
      <table className="application-table__table">
        <thead className="application-table__head">
          <tr className="application-table__row">
            <th className="application-table__header" scope="col">Opportunity</th>
            <th className="application-table__header" scope="col">Stage</th>
            <th className="application-table__header" scope="col">Next move</th>
            <th className="application-table__header" scope="col">Focus</th>
            <th className="application-table__header" scope="col">Updated</th>
            <th className="application-table__header application-table__header--actions" scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="application-table__body">
          {applications.map((application) => {
            const url = application.url?.trim();

            return (
              <tr className="application-table__row" key={application.id}>
                <td className="application-table__cell" data-label="Opportunity">
                  <div className="application-table__company">
                    <span className="application-table__primary">{application.company}</span>
                    <span className="application-table__secondary">{application.role}</span>
                    {application.location ? (
                      <span className="application-table__tertiary">{application.location}</span>
                    ) : null}
                    {url ? (
                      <a
                        className="application-table__link"
                        href={normalizeUrl(url)}
                        rel="noreferrer"
                        target="_blank"
                      >
                        View posting ↗
                      </a>
                    ) : null}
                  </div>
                </td>
                <td className="application-table__cell" data-label="Stage">
                  {onStatusChange ? (
                    <label className="stage-select" data-status={application.status}>
                      <span className="sr-only">Stage for {application.company}</span>
                      <select
                        aria-label={`Stage for ${application.company}`}
                        disabled={pendingStatusId !== null}
                        value={application.status}
                        onChange={(event) =>
                          void onStatusChange(application, event.target.value as ApplicationStatus)
                        }
                      >
                        {APPLICATION_STATUSES.map((status) => (
                          <option key={status} value={status}>{STATUS_LABELS[status]}</option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <span className={`status-badge status-badge--${application.status}`}>
                      {STATUS_LABELS[application.status]}
                    </span>
                  )}
                </td>
                <td className="application-table__cell" data-label="Next move">
                  <div className="next-move">
                    <span className={application.nextAction ? "next-move__label" : "next-move__label next-move__label--empty"}>
                      {application.nextAction ?? "Set a next action"}
                    </span>
                    <time
                      className={application.nextActionDate ? "next-move__date" : "next-move__date next-move__date--empty"}
                      dateTime={application.nextActionDate ?? undefined}
                    >
                      {formatDate(application.nextActionDate)}
                    </time>
                  </div>
                </td>
                <td className="application-table__cell" data-label="Focus">
                  <span className={`priority-chip priority-chip--${application.priority}`}>
                    {priorityLabel(application.priority)}
                  </span>
                </td>
                <td className="application-table__cell" data-label="Updated">
                  <time className="application-table__time" dateTime={application.updatedAt}>
                    {formatDate(application.updatedAt.slice(0, 10))}
                  </time>
                </td>
                <td className="application-table__cell application-table__cell--actions" data-label="Actions">
                  <div className="application-table__actions">
                    {detailsHref ? (
                      <Link className="application-table__open" href={detailsHref(application)}>
                        Open<span aria-hidden="true"> →</span>
                      </Link>
                    ) : null}
                    {onEdit ? (
                      <button className="application-table__button application-table__button--edit" type="button" onClick={() => onEdit(application)}>
                        Edit
                      </button>
                    ) : null}
                    {onDelete ? (
                      <button className="application-table__button application-table__button--delete" type="button" onClick={() => onDelete(application.id)}>
                        Delete
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
