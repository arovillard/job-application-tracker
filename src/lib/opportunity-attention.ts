import type { Opportunity, OpportunityDetail, OpportunityTask } from "../types";

export type AttentionTarget =
  | { kind: "task"; taskId: string }
  | { kind: "missing_next_action" };

export type AttentionLinkTarget =
  | { kind: "task"; opportunityId: string; taskId: string }
  | { kind: "missing_next_action"; opportunityId: string; taskId: null };

export type AttentionSearchParams = Record<string, string | string[] | undefined>;

export type ResolvedAttentionContext =
  | { state: "active_task"; task: OpportunityTask; isOverdue: boolean }
  | { state: "missing_next_action" }
  | { state: "resolved" };

const JOB_FORWARD_STATUSES = new Set(["applied", "interviewing", "offer"]);
const CONNECTION_FORWARD_STATUSES = new Set(["new", "outreach_planned", "waiting", "in_conversation", "opportunity_identified"]);
const TERMINAL_STATUSES = new Set(["rejected", "archived", "dormant", "closed"]);

export function opportunityIsAttentionEligible(opportunity: Pick<Opportunity, "type" | "status">) {
  return !TERMINAL_STATUSES.has(opportunity.status);
}

export function opportunityRequiresForwardMotion(opportunity: Pick<Opportunity, "type" | "status">) {
  return opportunity.type === "job"
    ? JOB_FORWARD_STATUSES.has(opportunity.status)
    : CONNECTION_FORWARD_STATUSES.has(opportunity.status);
}

export function buildAttentionHref(item: AttentionLinkTarget) {
  if (item.kind === "task" && !item.taskId) throw new Error("Task attention requires a task ID");
  const search = new URLSearchParams({ attention: item.kind });
  if (item.kind === "task") search.set("taskId", item.taskId);
  return `/opportunities/${encodeURIComponent(item.opportunityId)}?${search.toString()}`;
}

export function parseAttentionTarget(searchParams: AttentionSearchParams): AttentionTarget | null {
  const attention = searchParams.attention;
  if (typeof attention !== "string") return null;
  if (attention === "missing_next_action") {
    return searchParams.taskId === undefined ? { kind: "missing_next_action" } : null;
  }
  if (attention !== "task" || typeof searchParams.taskId !== "string" || !searchParams.taskId) return null;
  return { kind: "task", taskId: searchParams.taskId };
}

export function resolveAttentionContext(
  detail: OpportunityDetail,
  target: AttentionTarget,
  today: string
): ResolvedAttentionContext {
  if (target.kind === "missing_next_action") {
    const hasOpenTask = detail.tasks.some((task) => task.state === "open");
    return opportunityIsAttentionEligible(detail) && !hasOpenTask && opportunityRequiresForwardMotion(detail)
      ? { state: "missing_next_action" }
      : { state: "resolved" };
  }

  if (!opportunityIsAttentionEligible(detail)) return { state: "resolved" };
  const task = detail.tasks.find((candidate) => candidate.id === target.taskId);
  if (!task || task.opportunityId !== detail.id || task.state !== "open" || !task.dueDate || task.dueDate > today) return { state: "resolved" };
  return { state: "active_task", task, isOverdue: task.dueDate < today };
}
