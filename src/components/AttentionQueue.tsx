import Link from "next/link";

import { type DashboardAttentionItem } from "../lib/dashboard";

type AttentionQueueProps = {
  items: DashboardAttentionItem[];
  maxItems?: number;
  loading?: boolean;
};

function dueCopy(item: DashboardAttentionItem) {
  if (item.kind === "missing_next_action") {
    return "Plan next move";
  }

  if (item.isOverdue) {
    return `Overdue · ${item.dueDate}`;
  }

  return `Due today · ${item.dueDate}`;
}

export function AttentionQueue({ items, maxItems = 5, loading = false }: AttentionQueueProps) {
  const visibleItems = items.slice(0, maxItems);

  return (
    <section className="attention-panel" aria-labelledby="attention-title">
      <div className="panel-heading">
        <div>
          <p className="panel-heading__eyebrow">Today</p>
          <h2 id="attention-title">Keep the search moving</h2>
        </div>
        <span className="panel-heading__count">{items.length} to focus on</span>
      </div>
      {loading ? (
        <div className="attention-panel__skeleton" aria-busy="true" aria-label="Loading attention queue">
          <span /><span /><span />
        </div>
      ) : visibleItems.length === 0 ? (
        <div className="attention-panel__empty">
          <span className="empty-state__icon" aria-hidden="true">✓</span>
          <p>You are clear for now. Add a next action when new opportunities appear.</p>
        </div>
      ) : (
        <div className="attention-list">
          {visibleItems.map((item) => (
            <Link className="attention-list__item" href={`/applications/${item.applicationId}`} key={item.id}>
              <span className={`attention-list__marker attention-list__marker--${item.priority}`} aria-hidden="true" />
              <span className="attention-list__content">
                <strong>{item.company}</strong>
                <span>{item.label}</span>
              </span>
              <span className={item.isOverdue ? "attention-list__due attention-list__due--overdue" : "attention-list__due"}>
                {dueCopy(item)}
              </span>
              <span className="attention-list__arrow" aria-hidden="true">→</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
