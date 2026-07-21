import Link from "next/link";

import type { DashboardAttentionItem } from "../lib/dashboard";
import { buildAttentionHref } from "../lib/opportunity-attention";

type AttentionPresentation = {
  title: string;
  status: string;
  ariaLabel: string;
  itemClassName: string;
  markerClassName: string;
  statusClassName: string;
};

function attentionPresentation(item: DashboardAttentionItem): AttentionPresentation {
  const status = item.isOverdue
    ? `Overdue · ${item.dueDate}`
    : `Due today · ${item.dueDate}`;
  return {
    title: item.actionLabel,
    status,
    ariaLabel: `${item.actionLabel} for ${item.label}. ${status}`,
    itemClassName: "attention-strip__item",
    markerClassName: `attention-list__marker attention-list__marker--${item.priority}`,
    statusClassName: item.isOverdue
      ? "attention-strip__due attention-strip__due--overdue"
      : "attention-strip__due"
  };
}

export function AttentionQueue({ items, maxItems = 3, loading = false, onViewAll }: {
  items: DashboardAttentionItem[]; maxItems?: number; loading?: boolean; onViewAll: () => void;
}) {
  const visibleItems = items.slice(0, maxItems);
  if (!loading && visibleItems.length === 0) return null;
  return <section className="attention-strip" aria-label="Opportunities needing attention">
    <div className="attention-strip__summary"><strong>Needs attention</strong><span>{loading ? "Checking your next moves" : `${items.length} to review`}</span></div>
    {loading ? <div className="attention-strip__skeleton" role="status" aria-live="polite" aria-busy="true"><span className="sr-only">Loading attention queue</span><span /><span /><span /></div> : <div className="attention-strip__items">
      {visibleItems.map((item) => {
        const presentation = attentionPresentation(item);
        return <Link
          aria-label={presentation.ariaLabel}
          className={presentation.itemClassName}
          href={buildAttentionHref({ kind: "task", opportunityId: item.opportunityId, taskId: item.taskId })}
          key={item.id}
        >
          <span className={presentation.markerClassName} aria-hidden="true" />
          <span className="attention-strip__content">
            <strong>{presentation.title}</strong>
            <span className="attention-strip__meta">
              <span>{item.label}</span>
              <span aria-hidden="true">·</span>
              <span className={presentation.statusClassName}>{presentation.status}</span>
            </span>
          </span>
        </Link>;
      })}
    </div>}
    {!loading ? <button className="text-button" type="button" onClick={onViewAll}>View all</button> : null}
  </section>;
}
