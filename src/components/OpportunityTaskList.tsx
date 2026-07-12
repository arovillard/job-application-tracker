import type { OpportunityTask } from "../types";

export type TaskAction = "complete" | "cancel" | "reopen" | "reschedule";

export function OpportunityTaskList({ tasks, pendingTaskId = null, onAction }: {
  tasks: OpportunityTask[]; pendingTaskId?: string | null;
  onAction: (task: OpportunityTask, action: TaskAction, dueDate?: string | null) => void | Promise<void>;
}) {
  const open = tasks.filter((task) => task.state === "open");
  const history = tasks.filter((task) => task.state !== "open");
  const row = (task: OpportunityTask) => <div className="task-item" key={task.id}><div><strong>{task.title}</strong><span>{task.dueDate ? `Due ${task.dueDate}` : "No due date"}</span></div><div className="task-item__actions">{task.state === "open" ? <><button disabled={pendingTaskId === task.id} type="button" onClick={() => void onAction(task, "complete")}>Complete</button><button disabled={pendingTaskId === task.id} type="button" onClick={() => void onAction(task, "cancel")}>Cancel</button></> : <button disabled={pendingTaskId === task.id} type="button" onClick={() => void onAction(task, "reopen")}>Reopen</button>}</div></div>;
  return <div className="task-list">{open.length ? open.map(row) : <p>No open tasks.</p>}{history.length ? <details><summary>Task history ({history.length})</summary>{history.map(row)}</details> : null}</div>;
}
