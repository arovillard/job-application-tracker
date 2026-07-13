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

function dueState(task: OpportunityTask, today: string) {
  if (!task.dueDate) return "No due date";
  if (task.dueDate < today) return `Overdue · ${task.dueDate}`;
  if (task.dueDate === today) return `Due today · ${task.dueDate}`;
  return `Due ${task.dueDate}`;
}

function TaskRow({ task, pendingTaskId, onAction, today, primary = false, attention = false }: { task: OpportunityTask; pendingTaskId: string | null; onAction: (task: OpportunityTask, action: TaskAction, dueDate?: string | null) => void | Promise<void>; today: string; primary?: boolean; attention?: boolean }) {
  const [dueDate, setDueDate] = useState(task.dueDate ?? "");
  const pending = pendingTaskId === task.id;
  return <div className={`task-item${primary ? " task-item--primary" : ""}${attention ? " task-item--attention" : ""}`} id={`opportunity-task-${task.id}`} tabIndex={attention ? -1 : undefined}><div className="task-item__content">{primary ? <span className="task-item__eyebrow">Up next</span> : null}<strong>{task.title}</strong><span className="task-item__due">{dueState(task, today)}</span></div><div className="task-item__actions">{task.state === "open" ? <><button className="task-item__action task-item__action--complete" disabled={pending} type="button" onClick={() => void onAction(task, "complete")}>Complete</button><button className="task-item__action" disabled={pending} type="button" onClick={() => void onAction(task, "cancel")}>Cancel</button><div className="task-item__reschedule"><label><span>Move due date</span><input aria-label={`Reschedule ${task.title}`} type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label><button className="task-item__action" disabled={pending} type="button" onClick={() => void onAction(task, "reschedule", dueDate || null)}>Reschedule</button></div></> : <button className="task-item__action" disabled={pending} type="button" onClick={() => void onAction(task, "reopen")}>Reopen</button>}</div></div>;
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
  const row = (task: OpportunityTask) => <TaskRow attention={task.id === attentionTaskId} key={task.id} task={task} pendingTaskId={pendingTaskId} onAction={onAction} today={today} />;
  return <section className="next-action-card actions-card" id="opportunity-actions" tabIndex={-1}><header className="tracker-panel__header"><div><p className="panel-heading__eyebrow">Momentum</p><h2 className="tracker-panel__title">Actions</h2></div><span className="tracker-panel__meta">{tasks.filter((task) => task.state === "open").length}</span></header><div className="actions-card__primary">{primary ? <TaskRow attention={primary.id === attentionTaskId} task={primary} primary pendingTaskId={pendingTaskId} onAction={onAction} today={today} /> : <div className="actions-card__empty"><p>No next action planned.</p><button className="button button--primary" type="button" onClick={(event) => onAddTask?.(event.currentTarget)}>Set a next action</button></div>}</div>{open.length ? <section className="actions-card__other"><header><h3>Other tasks</h3><span>{open.length}</span></header>{open.map(row)}</section> : null}{history.length ? <details className="actions-card__history"><summary>Completed and cancelled ({history.length})</summary>{history.map(row)}</details> : null}</section>;
}
