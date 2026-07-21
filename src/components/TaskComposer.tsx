"use client";

import type { FormEvent } from "react";

import type { Opportunity } from "../types";

export type TaskComposerProps = {
  opportunity: Opportunity;
  taskTitle: string;
  taskDueDate: string;
  error?: string | null;
  isSubmitting?: boolean;
  onTaskTitleChange: (value: string) => void;
  onTaskDueDateChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
};

function contextLabel(opportunity: Opportunity) {
  if (opportunity.organization) return opportunity.organization;
  if (opportunity.type === "connection") return opportunity.roleContext ?? "Independent connection";
  return "Organization not set";
}

export function TaskComposer({
  opportunity,
  taskTitle,
  taskDueDate,
  error,
  isSubmitting = false,
  onTaskTitleChange,
  onTaskDueDateChange,
  onSubmit,
  onCancel
}: TaskComposerProps) {
  return <form className="application-form task-composer-form" onSubmit={onSubmit}>
    <div className="application-form__body">
      {error ? <p role="alert">{error}</p> : null}
      <section className="task-composer-form__context" aria-label={`Creating task for ${opportunity.label}`}>
        <div className="task-composer-form__context-heading">
          <span className="panel-heading__eyebrow">Creating task for</span>
          <span className={`type-badge type-badge--${opportunity.type}`}>{opportunity.type === "job" ? "Job" : "Connection"}</span>
        </div>
        <strong>{opportunity.label}</strong>
        <p>{contextLabel(opportunity)}</p>
      </section>
      <div className="application-form__grid">
        <label className="application-form__field"><span className="application-form__label">What needs to happen?</span><input className="application-form__input" data-autofocus disabled={isSubmitting} required placeholder="e.g. Send a thoughtful follow-up" value={taskTitle} onChange={(event) => onTaskTitleChange(event.target.value)} /></label>
        <label className="application-form__field"><span className="application-form__label">Due date</span><input className="application-form__input" disabled={isSubmitting} type="date" value={taskDueDate} onChange={(event) => onTaskDueDateChange(event.target.value)} /></label>
      </div>
    </div>
    <div className="application-form__actions"><button className="button" disabled={isSubmitting} type="button" onClick={onCancel}>Cancel</button><button className="button button--primary" disabled={isSubmitting} type="submit">{isSubmitting ? "Saving…" : "Add task"}</button></div>
  </form>;
}
