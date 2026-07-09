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
};

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
  year: "numeric"
});

function formatDateOnly(value: string | null) {
  if (!value) {
    return "—";
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    return DATE_FORMAT.format(new Date(Date.UTC(year, month - 1, day)));
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return DATE_FORMAT.format(parsed);
}

function formatUrlDisplay(url: string) {
  const trimmed = url.trim();

  try {
    const parsed = new URL(trimmed);
    return parsed.host.replace(/^www\./i, "");
  } catch {
    try {
      const parsed = new URL(`https://${trimmed}`);
      return parsed.host.replace(/^www\./i, "");
    } catch {
      return trimmed;
    }
  }
}

function normalizeUrl(url: string) {
  const trimmed = url.trim();

  if (/^[a-z][a-z\d+\-.]*:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

export function ApplicationTable({
  applications,
  detailsHref,
  onEdit,
  onDelete,
  onStatusChange,
  emptyMessage
}: ApplicationTableProps) {
  const hasActions = Boolean(detailsHref || onEdit || onDelete);

  if (applications.length === 0) {
    return (
      <div className="application-table">
        <table className="application-table__table">
          <thead className="application-table__head">
            <tr className="application-table__row">
              <th className="application-table__header" scope="col">
                Company
              </th>
              <th className="application-table__header" scope="col">
                Role
              </th>
              <th className="application-table__header" scope="col">
                Status
              </th>
              <th className="application-table__header" scope="col">
                Location
              </th>
              <th className="application-table__header" scope="col">
                Applied
              </th>
              <th className="application-table__header" scope="col">
                Follow-up
              </th>
              <th className="application-table__header" scope="col">
                Source
              </th>
              <th className="application-table__header" scope="col">
                Updated
              </th>
              <th className="application-table__header" scope="col">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="application-table__body">
            <tr className="application-table__empty-row">
              <td className="application-table__empty-cell" colSpan={9}>
                <div className="application-table__empty-state">
                  <strong className="application-table__empty-title">
                    No applications yet
                  </strong>
                  <p className="application-table__empty-message">
                    {emptyMessage ??
                      "Add your first application to track company, role, status, follow-up dates, and source details here."}
                  </p>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="application-table">
      <table className="application-table__table">
        <thead className="application-table__head">
          <tr className="application-table__row">
            <th className="application-table__header" scope="col">
              Company
            </th>
            <th className="application-table__header" scope="col">
              Role
            </th>
            <th className="application-table__header" scope="col">
              Status
            </th>
            <th className="application-table__header" scope="col">
              Location
            </th>
            <th className="application-table__header" scope="col">
              Applied
            </th>
            <th className="application-table__header" scope="col">
              Follow-up
            </th>
            <th className="application-table__header" scope="col">
              Source
            </th>
            <th className="application-table__header" scope="col">
              Updated
            </th>
            <th className="application-table__header" scope="col">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="application-table__body">
          {applications.map((application) => {
            const url = application.url?.trim();

            return (
              <tr className="application-table__row" key={application.id}>
                <td className="application-table__cell">
                  <div className="application-table__cell-stack">
                    <span className="application-table__primary">
                      {application.company}
                    </span>
                    {url ? (
                      <a
                        className="application-table__link"
                        href={normalizeUrl(url)}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {formatUrlDisplay(url)}
                      </a>
                    ) : null}
                  </div>
                </td>
                <td className="application-table__cell">{application.role}</td>
                <td className="application-table__cell">
                  {onStatusChange ? (
                    <select
                      className="application-table__status-select"
                      aria-label={`Status for ${application.company}`}
                      value={application.status}
                      onChange={(event) =>
                        void onStatusChange(
                          application,
                          event.target.value as ApplicationStatus
                        )
                      }
                    >
                      {APPLICATION_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {STATUS_LABELS[status]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    STATUS_LABELS[application.status]
                  )}
                </td>
                <td className="application-table__cell">
                  {application.location ?? "—"}
                </td>
                <td className="application-table__cell">
                  <time
                    className="application-table__time"
                    dateTime={application.appliedDate ?? undefined}
                  >
                    {formatDateOnly(application.appliedDate)}
                  </time>
                </td>
                <td className="application-table__cell">
                  <time
                    className="application-table__time"
                    dateTime={application.followUpDate ?? undefined}
                  >
                    {formatDateOnly(application.followUpDate)}
                  </time>
                </td>
                <td className="application-table__cell">
                  {application.source ?? "—"}
                </td>
                <td className="application-table__cell">
                  <time
                    className="application-table__time"
                    dateTime={application.updatedAt}
                    title={application.updatedAt}
                  >
                    {formatDateOnly(application.updatedAt)}
                  </time>
                </td>
                <td className="application-table__cell">
                  <div className="application-table__actions">
                    {detailsHref ? (
                      <Link
                        className="application-table__button application-table__button--edit"
                        href={detailsHref(application)}
                      >
                        Open
                      </Link>
                    ) : null}
                    {onEdit ? (
                      <button
                        className="application-table__button application-table__button--edit"
                        type="button"
                        onClick={() => onEdit(application)}
                      >
                        Edit
                      </button>
                    ) : null}
                    {onDelete ? (
                      <button
                        className="application-table__button application-table__button--delete"
                        type="button"
                        onClick={() => onDelete(application.id)}
                      >
                        Delete
                      </button>
                    ) : null}
                    {!hasActions ? <span className="application-table__muted">—</span> : null}
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
