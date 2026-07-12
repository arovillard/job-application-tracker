import type {
  OpportunityPriority,
  OpportunityStatus,
  OpportunitySummary,
  OpportunityType
} from "../types";

export type AttentionKind = "task" | "missing_next_action";

export type DashboardAttentionItem = {
  id: string;
  opportunityId: string;
  type: OpportunityType;
  label: string;
  organization: string | null;
  status: OpportunityStatus;
  priority: OpportunityPriority;
  kind: AttentionKind;
  actionLabel: string;
  dueDate: string | null;
  isOverdue: boolean;
};

export type DashboardInsights = { attention: DashboardAttentionItem[] };

const JOB_FORWARD_STATUSES = new Set(["applied", "interviewing", "offer"]);
const CONNECTION_FORWARD_STATUSES = new Set([
  "new",
  "outreach_planned",
  "waiting",
  "in_conversation",
  "opportunity_identified"
]);
const PRIORITY_WEIGHT: Record<OpportunityPriority, number> = { high: 0, medium: 1, low: 2 };
const TERMINAL_STATUSES = new Set(["rejected", "archived", "dormant", "closed"]);

function dateKey(value: Date | string) {
  if (typeof value === "string") return value.slice(0, 10);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function requiresForwardMotion(opportunity: OpportunitySummary) {
  return opportunity.type === "job"
    ? JOB_FORWARD_STATUSES.has(opportunity.status)
    : CONNECTION_FORWARD_STATUSES.has(opportunity.status);
}

function compareAttention(left: DashboardAttentionItem, right: DashboardAttentionItem) {
  if (left.dueDate && right.dueDate && left.dueDate !== right.dueDate) {
    return left.dueDate.localeCompare(right.dueDate);
  }
  if (left.dueDate && !right.dueDate) return -1;
  if (!left.dueDate && right.dueDate) return 1;
  const priority = PRIORITY_WEIGHT[left.priority] - PRIORITY_WEIGHT[right.priority];
  return priority || left.label.localeCompare(right.label);
}

export function getDashboardInsights(
  opportunities: OpportunitySummary[],
  currentDate: Date | string = new Date()
): DashboardInsights {
  const today = dateKey(currentDate);
  const attention: DashboardAttentionItem[] = [];

  for (const opportunity of opportunities) {
    if (TERMINAL_STATUSES.has(opportunity.status)) continue;
    const task = opportunity.nextOpenTask;
    if (task?.dueDate && task.dueDate <= today) {
      attention.push({
        id: `task-${task.id}`,
        opportunityId: opportunity.id,
        type: opportunity.type,
        label: opportunity.label,
        organization: opportunity.organization,
        status: opportunity.status,
        priority: opportunity.priority,
        kind: "task",
        actionLabel: task.title,
        dueDate: task.dueDate,
        isOverdue: task.dueDate < today
      });
    } else if (!task && requiresForwardMotion(opportunity)) {
      attention.push({
        id: `missing-next-action-${opportunity.id}`,
        opportunityId: opportunity.id,
        type: opportunity.type,
        label: opportunity.label,
        organization: opportunity.organization,
        status: opportunity.status,
        priority: opportunity.priority,
        kind: "missing_next_action",
        actionLabel: "Set a next action",
        dueDate: null,
        isOverdue: false
      });
    }
  }

  return { attention: attention.sort(compareAttention) };
}
