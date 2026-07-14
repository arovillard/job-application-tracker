import type {
  OpportunityPriority,
  OpportunityStatus,
  OpportunitySummary,
  OpportunityType
} from "../types";
import { opportunityIsAttentionEligible, opportunityRequiresForwardMotion } from "./opportunity-attention";

export type AttentionKind = "task" | "missing_next_action";

type DashboardAttentionBase = {
  id: string;
  opportunityId: string;
  type: OpportunityType;
  label: string;
  organization: string | null;
  status: OpportunityStatus;
  priority: OpportunityPriority;
};

export type DashboardAttentionItem = DashboardAttentionBase & ({
  kind: "task";
  taskId: string;
  actionLabel: string;
  dueDate: string;
  isOverdue: boolean;
} | {
  kind: "missing_next_action";
  taskId: null;
  reasonLabel: "No next action planned";
  dueDate: null;
  isOverdue: false;
});

export type DashboardInsights = { attention: DashboardAttentionItem[] };

const PRIORITY_WEIGHT: Record<OpportunityPriority, number> = { high: 0, medium: 1, low: 2 };

function dateKey(value: Date | string) {
  if (typeof value === "string") return value.slice(0, 10);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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
    if (!opportunityIsAttentionEligible(opportunity)) continue;
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
        taskId: task.id,
        actionLabel: task.title,
        dueDate: task.dueDate,
        isOverdue: task.dueDate < today
      });
    } else if (!task && opportunityRequiresForwardMotion(opportunity)) {
      attention.push({
        id: `missing-next-action-${opportunity.id}`,
        opportunityId: opportunity.id,
        type: opportunity.type,
        label: opportunity.label,
        organization: opportunity.organization,
        status: opportunity.status,
        priority: opportunity.priority,
        kind: "missing_next_action",
        taskId: null,
        reasonLabel: "No next action planned",
        dueDate: null,
        isOverdue: false
      });
    }
  }

  return { attention: attention.sort(compareAttention) };
}
