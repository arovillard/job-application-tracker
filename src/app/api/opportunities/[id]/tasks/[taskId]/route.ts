import { NextResponse } from "next/server";

import type { OpportunityTaskUpdateInput } from "../../../../../../types";
import {
  getOpportunityDetail,
  listOpportunities,
  updateOpportunityTask
} from "../../../../../../lib/storage";
import { opportunityErrorResponse } from "../../../route";

export const runtime = "nodejs";

type TaskRouteContext = { params: Promise<{ id: string; taskId: string }> };

function taskExistsElsewhere(opportunityId: string, taskId: string) {
  return listOpportunities({ includeArchived: true }).some((opportunity) =>
    opportunity.id !== opportunityId &&
    getOpportunityDetail(opportunity.id)?.tasks.some((task) => task.id === taskId)
  );
}

export async function PATCH(request: Request, context: TaskRouteContext) {
  try {
    const { id, taskId } = await context.params;
    const opportunity = getOpportunityDetail(id);
    if (!opportunity) return opportunityErrorResponse(new Error("Opportunity not found"), 404);
    if (!opportunity.tasks.some((task) => task.id === taskId)) {
      return taskExistsElsewhere(id, taskId)
        ? opportunityErrorResponse(new Error("Task does not belong to this opportunity"), 400)
        : opportunityErrorResponse(new Error("Task not found"), 404);
    }

    const body = (await request.json()) as { action?: unknown; dueDate?: unknown; title?: unknown };
    let update: OpportunityTaskUpdateInput;
    switch (body.action) {
      case "complete":
        update = { state: "completed" };
        break;
      case "cancel":
        update = { state: "cancelled" };
        break;
      case "reopen":
        update = { state: "open" };
        break;
      case "reschedule":
        update = { dueDate: body.dueDate as string | null };
        break;
      default:
        throw new Error("Task action is invalid");
    }
    if (typeof body.title === "string") update.title = body.title;
    return NextResponse.json(updateOpportunityTask(id, taskId, update));
  } catch (error) {
    return opportunityErrorResponse(error);
  }
}
