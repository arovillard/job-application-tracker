import Link from "next/link";

import type { DashboardAttentionItem } from "../lib/dashboard";
import { buildAttentionHref } from "../lib/opportunity-attention";

function dueCopy(item: DashboardAttentionItem) {
  if (item.kind === "missing_next_action") return "Plan next move";
  return item.isOverdue ? `Overdue · ${item.dueDate}` : `Due today · ${item.dueDate}`;
}

export function AttentionQueue({ items, maxItems = 3, loading = false, onViewAll }: {
  items: DashboardAttentionItem[]; maxItems?: number; loading?: boolean; onViewAll: () => void;
}) {
  const visibleItems = items.slice(0, maxItems);
  if (!loading && visibleItems.length === 0) return null;
  return <section className="attention-strip" aria-label="Opportunities needing attention">
    <div className="attention-strip__summary"><strong>Needs attention</strong><span>{loading ? "Checking your next moves" : `${items.length} to review`}</span></div>
    {loading ? <div className="attention-strip__skeleton" role="status" aria-live="polite" aria-busy="true"><span className="sr-only">Loading attention queue</span><span /><span /><span /></div> : <div className="attention-strip__items">
      {visibleItems.map((item) => <Link
        aria-label={`${item.actionLabel} for ${item.label}. ${dueCopy(item)}`}
        className="attention-strip__item"
        href={buildAttentionHref(item)}
        key={item.id}
      >
        <span className={`attention-list__marker attention-list__marker--${item.priority}`} aria-hidden="true" />
        <span className="attention-strip__content">
          <strong>{item.actionLabel}</strong>
          <span className="attention-strip__meta">
            <span>{item.label}</span>
            <span aria-hidden="true">·</span>
            <span className={item.isOverdue ? "attention-strip__due attention-strip__due--overdue" : "attention-strip__due"}>{dueCopy(item)}</span>
          </span>
        </span>
      </Link>)}
    </div>}
    {!loading ? <button className="text-button" type="button" onClick={onViewAll}>View all</button> : null}
  </section>;
}
