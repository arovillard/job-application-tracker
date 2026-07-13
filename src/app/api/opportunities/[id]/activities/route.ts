import { NextResponse } from "next/server";

import type { OpportunityActivityInput, OpportunityTaskInput } from "../../../../../types";
import { addOpportunityActivity } from "../../../../../lib/storage";
import { opportunityErrorResponse } from "../../route";
import type { OpportunityRouteContext } from "../route";

export const runtime = "nodejs";

type CreateActivityBody = OpportunityActivityInput & { task?: OpportunityTaskInput | null };

export async function POST(request: Request, context: OpportunityRouteContext) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as CreateActivityBody;
    const { task, ...activity } = body;
    return NextResponse.json(addOpportunityActivity(id, activity, task), { status: 201 });
  } catch (error) {
    return opportunityErrorResponse(error);
  }
}
