import { NextResponse } from "next/server";

import type { JobOpportunityInput } from "../../../../../types";
import { createLinkedJobOpportunity } from "../../../../../lib/storage";
import { opportunityErrorResponse } from "../../route";
import type { OpportunityRouteContext } from "../route";

export const runtime = "nodejs";

export async function POST(request: Request, context: OpportunityRouteContext) {
  try {
    const { id } = await context.params;
    return NextResponse.json(
      createLinkedJobOpportunity(id, (await request.json()) as JobOpportunityInput),
      { status: 201 }
    );
  } catch (error) {
    return opportunityErrorResponse(error);
  }
}
