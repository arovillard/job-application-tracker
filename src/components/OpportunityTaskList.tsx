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

function TaskRow({ task, pendingTaskId, onAction, today }: { task: OpportunityTask; pendingTaskId: string | null; onAction: (task: OpportunityTask, action: TaskAction, dueDate?: string | null) => void | Promise<void>; today: string }) {
  const [dueDate, setDueDate] = useState(task.dueDate ?? "");
  const pending = pendingTaskId === task.id;
  return <div className="task-item"><div><strong>{task.title}</strong><span>{dueState(task, today)}</span></div><div className="task-item__actions">{task.state === "open" ? <><button disabled={pending} type="button" onClick={() => void onAction(task, "complete")}>Complete</button><button disabled={pending} type="button" onClick={() => void onAction(task, "cancel")}>Cancel</button><label><span className="sr-only">Reschedule {task.title}</span><input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label><button disabled={pending} type="button" onClick={() => void onAction(task, "reschedule", dueDate || null)}>Reschedule</button></> : <button disabled={pending} type="button" onClick={() => void onAction(task, "reopen")}>Reopen</button>}</div></div>;
}

export function OpportunityTaskList({ tasks, pendingTaskId = null, onAction, onAddTask, today = getLocalCalendarDate() }: {
  tasks: OpportunityTask[]; pendingTaskId?: string | null;
  onAction: (task: OpportunityTask, action: TaskAction, dueDate?: string | null) => void | Promise<void>;
  onAddTask?: (trigger: HTMLButtonElement) => void;
  today?: string;
}) {
  const primary = selectPrimaryTask(tasks);
  const open = tasks.filter((task) => task.state === "open" && task.id !== primary?.id);
  const history = tasks.filter((task) => task.state !== "open");
  const row = (task: OpportunityTask) => <TaskRow key={task.id} task={task} pendingTaskId={pendingTaskId} onAction={onAction} today={today} />;
  return <><section className="next-action-card"><header className="tracker-panel__header"><h2 className="tracker-panel__title">Next action</h2></header><div className="task-list">{primary ? row(primary) : <button className="button button--primary" type="button" onClick={(event) => onAddTask?.(event.currentTarget)}>Set a next action</button>}</div></section><section className="tracker-panel"><header className="tracker-panel__header"><h2 className="tracker-panel__title">Tasks</h2><span className="tracker-panel__meta">{open.length}</span></header>{open.length ? open.map(row) : <p>No remaining open tasks.</p>}{history.length ? <details><summary>Task history ({history.length})</summary>{history.map(row)}</details> : null}</section></>;
}
