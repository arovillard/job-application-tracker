import type { OpportunityTask } from "../types";

export function selectNextOpenTask(tasks: OpportunityTask[]): OpportunityTask | null {
  return tasks.filter((task) => task.state === "open").sort((left, right) => {
    const due = (left.dueDate ?? "9999-12-31").localeCompare(right.dueDate ?? "9999-12-31");
    return due || left.createdAt.localeCompare(right.createdAt);
  })[0] ?? null;
}
