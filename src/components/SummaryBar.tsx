"use client";

import {
  APPLICATION_STATUSES,
  STATUS_LABELS,
  type Application,
  type ApplicationStatus
} from "../types";

type SummaryBarProps = {
  applications: Application[];
};

function countByStatus(applications: Application[]) {
  const counts = Object.fromEntries(
    APPLICATION_STATUSES.map((status) => [status, 0])
  ) as Record<ApplicationStatus, number>;

  for (const application of applications) {
    counts[application.status] += 1;
  }

  return counts;
}

export function SummaryBar({ applications }: SummaryBarProps) {
  const counts = countByStatus(applications);

  return (
    <dl className="summary-bar" aria-label="Application summary">
      <div className="summary-bar__item summary-bar__item--total">
        <dt className="summary-bar__label">Total</dt>
        <dd className="summary-bar__value">{applications.length}</dd>
      </div>
      {APPLICATION_STATUSES.map((status) => (
        <div className="summary-bar__item" key={status}>
          <dt className="summary-bar__label">{STATUS_LABELS[status]}</dt>
          <dd className="summary-bar__value">{counts[status]}</dd>
        </div>
      ))}
    </dl>
  );
}
