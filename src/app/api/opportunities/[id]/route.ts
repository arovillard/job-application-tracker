import { NextResponse } from "next/server";

import type { OpportunityInput } from "../../../../types";
import { deleteOpportunity, getOpportunityDetail, updateOpportunity } from "../../../../lib/storage";
import { opportunityErrorResponse } from "../route";

export const runtime = "nodejs";

export type OpportunityRouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: OpportunityRouteContext) {
  const { id } = await context.params;
  const opportunity = getOpportunityDetail(id);
  return opportunity
    ? NextResponse.json(opportunity)
    : opportunityErrorResponse(new Error("Opportunity not found"), 404);
}

export async function PUT(request: Request, context: OpportunityRouteContext) {
  try {
    const { id } = await context.params;
    const opportunity = updateOpportunity(id, (await request.json()) as OpportunityInput);
    return opportunity
      ? NextResponse.json(opportunity)
      : opportunityErrorResponse(new Error("Opportunity not found"), 404);
  } catch (error) {
    return opportunityErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: OpportunityRouteContext) {
  const { id } = await context.params;
  return deleteOpportunity(id)
    ? NextResponse.json({ ok: true })
    : opportunityErrorResponse(new Error("Opportunity not found"), 404);
}
