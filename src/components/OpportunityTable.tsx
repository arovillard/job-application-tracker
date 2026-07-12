"use client";

import Link from "next/link";

import {
  CONNECTION_STATUSES,
  JOB_STATUSES,
  type ConnectionStatus,
  type JobStatus,
  type OpportunityStatus,
  type OpportunitySummary
} from "../types";

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  wishlist: "Wishlist",
  applied: "Applied",
  interviewing: "Interviewing",
  offer: "Offer",
  rejected: "Rejected",
  archived: "Archived"
};
export const CONNECTION_STATUS_LABELS: Record<ConnectionStatus, string> = {
  new: "New",
  outreach_planned: "Outreach planned",
  waiting: "Waiting",
  in_conversation: "In conversation",
  opportunity_identified: "Opportunity identified",
  dormant: "Dormant",
  closed: "Closed",
  archived: "Archived"
};

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", timeZone: "UTC" });

function formatDate(value: string | null) {
  if (!value) return "No date set";
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? value : DATE_FORMAT.format(parsed);
}

export function statusLabel(opportunity: OpportunitySummary, status = opportunity.status) {
  return opportunity.type === "job"
    ? JOB_STATUS_LABELS[status as JobStatus]
    : CONNECTION_STATUS_LABELS[status as ConnectionStatus];
}

export function OpportunityTable({
  opportunities,
  loading = false,
  pendingStatusId = null,
  onStatusChange,
  emptyMessage
}: {
  opportunities: OpportunitySummary[];
  loading?: boolean;
  pendingStatusId?: string | null;
  onStatusChange?: (opportunity: OpportunitySummary, status: OpportunityStatus) => void | Promise<void>;
  emptyMessage?: string;
}) {
  if (loading) {
    return (
      <div className="application-table application-table--loading" aria-busy="true" aria-label="Loading opportunities">
        <div className="application-table__loading-row"><span /><span /><span /><span /></div>
        <div className="application-table__loading-row"><span /><span /><span /><span /></div>
        <div className="application-table__loading-row"><span /><span /><span /><span /></div>
      </div>
    );
  }
  if (opportunities.length === 0) {
    return (
      <div className="application-table application-table--empty">
        <div className="application-table__empty-state">
          <strong className="application-table__empty-title">Your opportunity pipeline is clear</strong>
          <p className="application-table__empty-message">{emptyMessage ?? "Create an opportunity to make your next move visible."}</p>
          <p className="application-table__empty-message">Use New opportunity above to create your next record.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="application-table">
      <table className="application-table__table">
        <thead className="application-table__head"><tr className="application-table__row">
          <th className="application-table__header">Opportunity</th><th className="application-table__header">Stage</th>
          <th className="application-table__header">Next move</th><th className="application-table__header">Focus</th>
          <th className="application-table__header">Updated</th>
          <th className="application-table__header application-table__header--actions"><span className="sr-only">Actions</span></th>
        </tr></thead>
        <tbody className="application-table__body">
          {opportunities.map((opportunity) => {
            const statuses = opportunity.type === "job" ? JOB_STATUSES : CONNECTION_STATUSES;
            return <tr className="application-table__row" key={opportunity.id}>
              <td className="application-table__cell" data-label="Opportunity"><div className="application-table__company">
                <div className="application-table__identity-row">
                  <span className="application-table__primary">{opportunity.label}</span>
                  <span className={`type-badge type-badge--${opportunity.type}`}>{opportunity.type === "job" ? "Job" : "Connection"}</span>
                </div>
                <span className="application-table__secondary">{opportunity.organization ?? (opportunity.type === "connection" ? opportunity.roleContext : "Organization not set")}</span>
                {opportunity.type === "job"
                  ? opportunity.location ? <span className="application-table__tertiary">{opportunity.location}</span> : null
                  : <span className="application-table__tertiary">{`${opportunity.relationshipStrength[0].toUpperCase()}${opportunity.relationshipStrength.slice(1)} relationship`}</span>}
              </div></td>
              <td className="application-table__cell" data-label="Stage">
                {onStatusChange ? <label className="stage-select" data-status={opportunity.status}>
                  <span className="sr-only">Stage for {opportunity.label}</span>
                  <select value={opportunity.status} disabled={pendingStatusId !== null} onChange={(event) => void onStatusChange(opportunity, event.target.value as OpportunityStatus)}>
                    {statuses.map((status) => <option key={status} value={status}>{statusLabel(opportunity, status)}</option>)}
                  </select>
                </label> : <span className={`status-badge status-badge--${opportunity.status}`}>{statusLabel(opportunity)}</span>}
              </td>
              <td className="application-table__cell" data-label="Next move"><div className="next-move">
                <span className="next-move__label">{opportunity.nextOpenTask?.title ?? "Set a next action"}</span>
                <time className="next-move__date" dateTime={opportunity.nextOpenTask?.dueDate ?? undefined}>{formatDate(opportunity.nextOpenTask?.dueDate ?? null)}</time>
              </div></td>
              <td className="application-table__cell" data-label="Focus"><span className={`priority-chip priority-chip--${opportunity.priority}`}>{opportunity.priority}</span></td>
              <td className="application-table__cell" data-label="Updated"><time className="application-table__time" dateTime={opportunity.updatedAt}>{formatDate(opportunity.updatedAt.slice(0, 10))}</time></td>
              <td className="application-table__cell application-table__cell--actions" data-label="Actions"><Link className="application-table__open" href={`/opportunities/${opportunity.id}`} aria-label={`Open ${opportunity.label}`}>Open <span aria-hidden="true">→</span></Link></td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>
  );
}
