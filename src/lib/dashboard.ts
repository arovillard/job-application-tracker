import { type Application, type ApplicationPriority, type ApplicationStatus, type FollowUpItem } from "../types";

export type AttentionKind = "follow_up" | "next_action" | "missing_next_action";

export type DashboardAttentionItem = {
  id: string;
  applicationId: string;
  company: string;
  role: string;
  status: ApplicationStatus;
  priority: ApplicationPriority;
  kind: AttentionKind;
  label: string;
  dueDate: string | null;
  isOverdue: boolean;
};

export type DashboardInsights = {
  metrics: {
    active: number;
    interviewing: number;
    offers: number;
    dueFollowUps: number;
    attention: number;
  };
  attention: DashboardAttentionItem[];
};

const ACTIVE_STATUSES = new Set<ApplicationStatus>(["applied", "interviewing", "offer"]);
const CLOSED_STATUSES = new Set<ApplicationStatus>(["rejected", "archived"]);
const PRIORITY_WEIGHT: Record<ApplicationPriority, number> = {
  high: 0,
  medium: 1,
  low: 2
};

function dateKey(value: Date | string) {
  if (typeof value === "string") {
    return value.slice(0, 10);
  }

  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isDue(date: string | null, today: string) {
  return Boolean(date && date <= today);
}

function compareAttention(left: DashboardAttentionItem, right: DashboardAttentionItem) {
  if (left.dueDate && right.dueDate && left.dueDate !== right.dueDate) {
    return left.dueDate.localeCompare(right.dueDate);
  }

  if (left.dueDate && !right.dueDate) {
    return -1;
  }

  if (!left.dueDate && right.dueDate) {
    return 1;
  }

  if (PRIORITY_WEIGHT[left.priority] !== PRIORITY_WEIGHT[right.priority]) {
    return PRIORITY_WEIGHT[left.priority] - PRIORITY_WEIGHT[right.priority];
  }

  return left.company.localeCompare(right.company);
}

export function getDashboardInsights(
  applications: Application[],
  followUps: FollowUpItem[],
  currentDate: Date | string = new Date()
): DashboardInsights {
  const today = dateKey(currentDate);
  const applicationById = new Map(applications.map((application) => [application.id, application]));
  const scheduledFollowUpApplicationIds = new Set(followUps.map((followUp) => followUp.applicationId));
  const attention: DashboardAttentionItem[] = [];

  for (const followUp of followUps) {
    const application = applicationById.get(followUp.applicationId);
    const status = application?.status ?? followUp.application.status;

    if (CLOSED_STATUSES.has(status) || !isDue(followUp.followUpDate, today)) {
      continue;
    }

    attention.push({
      id: `follow-up-${followUp.id}`,
      applicationId: followUp.applicationId,
      company: application?.company ?? followUp.application.company,
      role: application?.role ?? followUp.application.role,
      status,
      priority: application?.priority ?? "medium",
      kind: "follow_up",
      label: followUp.body,
      dueDate: followUp.followUpDate,
      isOverdue: Boolean(followUp.followUpDate && followUp.followUpDate < today)
    });
  }

  for (const application of applications) {
    if (!ACTIVE_STATUSES.has(application.status)) {
      continue;
    }

    if (isDue(application.nextActionDate, today)) {
      attention.push({
        id: `next-action-${application.id}`,
        applicationId: application.id,
        company: application.company,
        role: application.role,
        status: application.status,
        priority: application.priority,
        kind: "next_action",
        label: application.nextAction ?? "Complete next action",
        dueDate: application.nextActionDate,
        isOverdue: Boolean(application.nextActionDate && application.nextActionDate < today)
      });
    }

    const hasScheduledWork = Boolean(
      application.nextAction || application.nextActionDate || application.followUpDate || scheduledFollowUpApplicationIds.has(application.id)
    );

    if (!hasScheduledWork) {
      attention.push({
        id: `missing-next-action-${application.id}`,
        applicationId: application.id,
        company: application.company,
        role: application.role,
        status: application.status,
        priority: application.priority,
        kind: "missing_next_action",
        label: "Set a next action",
        dueDate: null,
        isOverdue: false
      });
    }
  }

  const active = applications.filter((application) => ACTIVE_STATUSES.has(application.status));

  return {
    metrics: {
      active: active.length,
      interviewing: applications.filter((application) => application.status === "interviewing").length,
      offers: applications.filter((application) => application.status === "offer").length,
      dueFollowUps: attention.filter((item) => item.kind === "follow_up").length,
      attention: attention.length
    },
    attention: attention.sort(compareAttention)
  };
}
