import Link from "next/link";

import { type DashboardAttentionItem } from "../lib/dashboard";

type AttentionQueueProps = {
  items: DashboardAttentionItem[];
  maxItems?: number;
  loading?: boolean;
  onViewAll: () => void;
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

export function AttentionQueue({ items, maxItems = 3, loading = false, onViewAll }: AttentionQueueProps) {
  const visibleItems = items.slice(0, maxItems);

  if (!loading && visibleItems.length === 0) {
    return null;
  }

  return (
    <section className="attention-strip" aria-label="Opportunities needing attention">
      <div className="attention-strip__summary">
        <strong>Needs attention</strong>
        <span>{loading ? "Checking your next moves" : `${items.length} to review`}</span>
      </div>
      {loading ? (
        <div className="attention-strip__skeleton" aria-busy="true" aria-label="Loading attention queue">
          <span />
          <span />
          <span />
        </div>
      ) : (
        <div className="attention-strip__items">
          {visibleItems.map((item) => (
            <Link className="attention-strip__item" href={`/applications/${item.applicationId}`} key={item.id}>
              <span className={`attention-list__marker attention-list__marker--${item.priority}`} aria-hidden="true" />
              <span className="attention-strip__content">
                <strong>{item.company}</strong>
                <span className={item.isOverdue ? "attention-strip__due attention-strip__due--overdue" : "attention-strip__due"}>
                  {dueCopy(item)}
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}
      {!loading ? (
        <button className="text-button" type="button" onClick={onViewAll}>
          View all
        </button>
      ) : null}
    </section>
  );
}
