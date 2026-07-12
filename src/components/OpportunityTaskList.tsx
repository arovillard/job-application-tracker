import type { OpportunityTask } from "../types";
import { useState } from "react";

export type TaskAction = "complete" | "cancel" | "reopen" | "reschedule";

function TaskRow({ task, pendingTaskId, onAction }: { task: OpportunityTask; pendingTaskId: string | null; onAction: (task: OpportunityTask, action: TaskAction, dueDate?: string | null) => void | Promise<void> }) {
  const [dueDate, setDueDate] = useState(task.dueDate ?? "");
  const pending = pendingTaskId === task.id;
  return <div className="task-item"><div><strong>{task.title}</strong><span>{task.dueDate ? `Due ${task.dueDate}` : "No due date"}</span></div><div className="task-item__actions">{task.state === "open" ? <><button disabled={pending} type="button" onClick={() => void onAction(task, "complete")}>Complete</button><button disabled={pending} type="button" onClick={() => void onAction(task, "cancel")}>Cancel</button><label><span className="sr-only">Reschedule {task.title}</span><input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label><button disabled={pending} type="button" onClick={() => void onAction(task, "reschedule", dueDate || null)}>Reschedule</button></> : <button disabled={pending} type="button" onClick={() => void onAction(task, "reopen")}>Reopen</button>}</div></div>;
}

export function OpportunityTaskList({ tasks, pendingTaskId = null, onAction }: {
  tasks: OpportunityTask[]; pendingTaskId?: string | null;
  onAction: (task: OpportunityTask, action: TaskAction, dueDate?: string | null) => void | Promise<void>;
}) {
  const open = tasks.filter((task) => task.state === "open");
  const history = tasks.filter((task) => task.state !== "open");
  const row = (task: OpportunityTask) => <TaskRow key={task.id} task={task} pendingTaskId={pendingTaskId} onAction={onAction} />;
  return <div className="task-list">{open.length ? open.map(row) : <p>No open tasks.</p>}{history.length ? <details><summary>Task history ({history.length})</summary>{history.map(row)}</details> : null}</div>;
}
