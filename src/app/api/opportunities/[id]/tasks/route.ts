import { NextResponse } from "next/server";

import type { OpportunityTaskInput } from "../../../../../types";
import { createOpportunityTask } from "../../../../../lib/storage";
import { opportunityErrorResponse } from "../../route";
import type { OpportunityRouteContext } from "../route";

export const runtime = "nodejs";

export async function POST(request: Request, context: OpportunityRouteContext) {
  try {
    const { id } = await context.params;
    return NextResponse.json(
      createOpportunityTask(id, (await request.json()) as OpportunityTaskInput),
      { status: 201 }
    );
  } catch (error) {
    return opportunityErrorResponse(error);
  }
}
