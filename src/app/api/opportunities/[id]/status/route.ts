import { NextResponse } from "next/server";

import { CONNECTION_STATUSES, JOB_STATUSES, type OpportunityStatus } from "../../../../../types";
import { changeOpportunityStatus, getOpportunityDetail } from "../../../../../lib/storage";
import { opportunityErrorResponse } from "../../route";
import type { OpportunityRouteContext } from "../route";

export const runtime = "nodejs";

export async function PATCH(request: Request, context: OpportunityRouteContext) {
  try {
    const { id } = await context.params;
    const opportunity = getOpportunityDetail(id);
    if (!opportunity) return opportunityErrorResponse(new Error("Opportunity not found"), 404);

    const body = (await request.json()) as { status?: unknown; note?: unknown };
    const allowed = opportunity.type === "job" ? JOB_STATUSES : CONNECTION_STATUSES;
    if (typeof body.status !== "string" || !(allowed as readonly string[]).includes(body.status)) {
      throw new Error(`Status is invalid for a ${opportunity.type} opportunity`);
    }
    if (body.note != null && typeof body.note !== "string") throw new Error("Status note must be text");

    return NextResponse.json(
      changeOpportunityStatus(id, body.status as OpportunityStatus, body.note as string | null | undefined)
    );
  } catch (error) {
    return opportunityErrorResponse(error);
  }
}
