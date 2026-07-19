import type { OpportunityTask } from "../types";
import { useState } from "react";

export type TaskAction = "complete" | "cancel" | "reopen" | "reschedule";

export function getLocalCalendarDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function selectPrimaryTask(tasks: OpportunityTask[]) {
  return tasks.filter((task) => task.state === "open").sort((left, right) => {
    if (left.dueDate && right.dueDate) return left.dueDate.localeCompare(right.dueDate) || left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
    if (left.dueDate) return -1;
    if (right.dueDate) return 1;
    return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
  })[0] ?? null;
}

type TaskDueTone = "none" | "upcoming" | "today" | "overdue";

function dueState(task: OpportunityTask, today: string): { copy: string; tone: TaskDueTone } {
  if (!task.dueDate) return { copy: "No due date", tone: "none" };
  if (task.dueDate < today) return { copy: `Overdue · ${task.dueDate}`, tone: "overdue" };
  if (task.dueDate === today) return { copy: `Due today · ${task.dueDate}`, tone: "today" };
  return { copy: `Due ${task.dueDate}`, tone: "upcoming" };
}

function TaskRow({ task, pendingTaskId, onAction, today, primary = false, attention = false }: {
  task: OpportunityTask;
  pendingTaskId: string | null;
  onAction: (task: OpportunityTask, action: TaskAction, dueDate?: string | null) => void | Promise<void>;
  today: string;
  primary?: boolean;
  attention?: boolean;
}) {
  const [dueDate, setDueDate] = useState(task.dueDate ?? "");
  const pending = pendingTaskId === task.id;
  const due = dueState(task, today);
  const history = task.state !== "open";
  const historyState = task.state === "completed" ? "Completed" : "Cancelled";
  const historyDate = (task.state === "completed" ? task.completedAt ?? task.updatedAt : task.updatedAt).slice(0, 10);
  const titleId = `opportunity-task-title-${task.id}`;
  const dueId = `opportunity-task-due-${task.id}`;
  const className = `task-item${primary ? " task-item--primary" : ""}${attention ? " task-item--attention" : ""}${history ? ` task-item--history task-item--${task.state}` : ""}`;
  const reschedule = <div className="task-item__reschedule">
    <label>
      <span>Move due date</span>
      <input
        aria-label={`Reschedule ${task.title}`}
        type="date"
        value={dueDate}
        onChange={(event) => setDueDate(event.target.value)}
      />
    </label>
    <button
      className="task-item__action"
      disabled={pending}
      type="button"
      onClick={() => void onAction(task, "reschedule", dueDate || null)}
    >Reschedule</button>
  </div>;

  return <div
    aria-describedby={attention ? dueId : undefined}
    aria-labelledby={attention ? titleId : undefined}
    className={className}
    id={`opportunity-task-${task.id}`}
    role={attention ? "group" : undefined}
    tabIndex={attention ? -1 : undefined}
  >
    <div className="task-item__content">
      {primary ? <span className="task-item__eyebrow">Up next</span> : null}
      <strong id={titleId}>{task.title}</strong>
      {history
        ? <span className={`task-item__state task-item__state--${task.state}`} id={dueId}><span className="sr-only">{historyState}: </span>{historyDate}</span>
        : <span className={`task-item__due task-item__due--${due.tone}`} id={dueId}>{due.copy}</span>}
    </div>
    <div className="task-item__actions">
      {task.state === "open" ? primary ? <>
        <button
          className="task-item__action task-item__action--complete"
          disabled={pending}
          type="button"
          onClick={() => void onAction(task, "complete")}
        >Complete</button>
        <details className="task-item__more">
          <summary>More options</summary>
          <div className="task-item__more-content">
            {reschedule}
            <button
              className="task-item__action task-item__action--cancel"
              disabled={pending}
              type="button"
              onClick={() => void onAction(task, "cancel")}
            >Cancel</button>
          </div>
        </details>
      </> : <>
        <button
          className="task-item__action task-item__action--complete"
          disabled={pending}
          type="button"
          onClick={() => void onAction(task, "complete")}
        >Complete</button>
        <button
          className="task-item__action"
          disabled={pending}
          type="button"
          onClick={() => void onAction(task, "cancel")}
        >Cancel</button>
        {reschedule}
      </> : <button
        aria-label={`Reopen ${task.title}`}
        className="task-item__action task-item__action--reopen"
        disabled={pending}
        type="button"
        onClick={() => void onAction(task, "reopen")}
      >Reopen</button>}
    </div>
  </div>;
}

export function OpportunityTaskList({ tasks, pendingTaskId = null, onAction, onAddTask, today = getLocalCalendarDate(), attentionTaskId = null }: {
  tasks: OpportunityTask[]; pendingTaskId?: string | null;
  onAction: (task: OpportunityTask, action: TaskAction, dueDate?: string | null) => void | Promise<void>;
  onAddTask?: (trigger: HTMLButtonElement) => void;
  today?: string;
  attentionTaskId?: string | null;
}) {
  const primary = selectPrimaryTask(tasks);
  const open = tasks.filter((task) => task.state === "open" && task.id !== primary?.id);
  const history = tasks.filter((task) => task.state !== "open");
  const row = (task: OpportunityTask) => <TaskRow
    attention={task.id === attentionTaskId}
    key={task.id}
    onAction={onAction}
    pendingTaskId={pendingTaskId}
    task={task}
    today={today}
  />;
  return <section
    aria-labelledby="opportunity-actions-title"
    className="next-action-card actions-card"
    id="opportunity-actions"
    tabIndex={-1}
  >
    <header className="tracker-panel__header">
      <div>
        <p className="panel-heading__eyebrow">Momentum</p>
        <h2 className="tracker-panel__title" id="opportunity-actions-title">Actions</h2>
      </div>
      <span className="tracker-panel__meta">{tasks.filter((task) => task.state === "open").length}</span>
    </header>
    <div className="actions-card__primary">
      {primary ? <TaskRow
        attention={primary.id === attentionTaskId}
        key={primary.id}
        onAction={onAction}
        pendingTaskId={pendingTaskId}
        primary
        task={primary}
        today={today}
      /> : <div className="actions-card__empty">
        <p>No next action planned.</p>
        <button
          className="button button--primary"
          type="button"
          onClick={(event) => onAddTask?.(event.currentTarget)}
        >Set a next action</button>
      </div>}
    </div>
    {open.length ? <section className="actions-card__other">
      <header><h3>Other tasks</h3><span>{open.length}</span></header>
      {open.map(row)}
    </section> : null}
    {history.length ? <details className="actions-card__history">
      <summary>Completed and cancelled ({history.length})</summary>
      {history.map(row)}
    </details> : null}
  </section>;
}
