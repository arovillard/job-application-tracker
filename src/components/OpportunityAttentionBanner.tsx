import { forwardRef } from "react";

import type { ResolvedAttentionContext } from "../lib/opportunity-attention";
import type { OpportunityTask } from "../types";

export type OpportunityAttentionBannerProps = {
  context: ResolvedAttentionContext;
  pendingTaskId: string | null;
  onComplete: (task: OpportunityTask) => void;
  onReview: () => void;
  onSetNextAction: (trigger: HTMLButtonElement) => void;
};

export const OpportunityAttentionBanner = forwardRef<HTMLElement, OpportunityAttentionBannerProps>(function OpportunityAttentionBanner({
  context,
  pendingTaskId,
  onComplete,
  onReview,
  onSetNextAction
}, ref) {
  if (context.state === "active_task") {
    const due = context.isOverdue ? `Overdue · ${context.task.dueDate}` : `Due today · ${context.task.dueDate}`;
    return <section className="attention-context attention-context--active" aria-labelledby="attention-context-title" ref={ref} tabIndex={-1}>
      <div className="attention-context__copy">
        <p className="panel-heading__eyebrow">{context.isOverdue ? "Needs attention · Overdue" : "Needs attention today"}</p>
        <h2 id="attention-context-title">{context.task.title}</h2>
        <p>{due}</p>
      </div>
      <div className="attention-context__actions">
        <button className="button button--primary" disabled={pendingTaskId === context.task.id} type="button" onClick={() => onComplete(context.task)}>Complete</button>
        <button className="button" type="button" onClick={onReview}>Review options</button>
      </div>
    </section>;
  }

  if (context.state === "missing_next_action") {
    return <section className="attention-context attention-context--active" aria-labelledby="attention-context-title" ref={ref} tabIndex={-1}>
      <div className="attention-context__copy">
        <p className="panel-heading__eyebrow">Needs attention</p>
        <h2 id="attention-context-title">No next action is planned</h2>
        <p>Decide what should happen next.</p>
      </div>
      <div className="attention-context__actions">
        <button className="button button--primary" type="button" onClick={(event) => onSetNextAction(event.currentTarget)}>Set next action</button>
      </div>
    </section>;
  }

  return <section className="attention-context attention-context--resolved" aria-labelledby="attention-context-title" ref={ref} tabIndex={-1}>
    <div className="attention-context__copy">
      <p className="panel-heading__eyebrow">Attention updated</p>
      <h2 id="attention-context-title">This attention item is no longer active</h2>
      <p>It may have been completed, cancelled, or rescheduled.</p>
    </div>
    <div className="attention-context__actions">
      <button className="button" type="button" onClick={onReview}>Review current actions</button>
    </div>
  </section>;
});
