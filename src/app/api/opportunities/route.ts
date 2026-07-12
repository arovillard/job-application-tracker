import { NextResponse } from "next/server";

import {
  CONNECTION_STATUSES,
  JOB_STATUSES,
  OPPORTUNITY_TYPES,
  type OpportunityActivityInput,
  type OpportunityFilters,
  type OpportunityInput,
  type OpportunityStatus,
  type OpportunityTaskInput,
  type OpportunityType
} from "../../../types";
import { createOpportunity, listOpportunities } from "../../../lib/storage";

export const runtime = "nodejs";

const TYPE_SET = new Set<string>(OPPORTUNITY_TYPES);
const STATUS_SET = new Set<string>([...JOB_STATUSES, ...CONNECTION_STATUSES]);

function parseType(value: string | null): OpportunityType | "all" {
  if (!value || value === "all") return "all";
  if (!TYPE_SET.has(value)) throw new Error("Opportunity type is invalid");
  return value as OpportunityType;
}

function parseStatus(value: string | null): OpportunityStatus | "all" {
  if (!value || value === "all") return "all";
  if (!STATUS_SET.has(value)) throw new Error("Opportunity status is invalid");
  return value as OpportunityStatus;
}

function parseArchived(value: string | null) {
  if (!value || value === "exclude") return "exclude" as const;
  if (value === "include" || value === "only") return value;
  throw new Error("Archive filter is invalid");
}

export function opportunityErrorResponse(error: unknown, forcedStatus?: number) {
  const message = error instanceof Error ? error.message : "Request failed";
  const status = forcedStatus ?? (/not found/i.test(message) ? 404 : 400);
  return NextResponse.json({ error: message }, { status });
}

export function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const type = parseType(url.searchParams.get("type"));
    const status = parseStatus(url.searchParams.get("status"));
    const archived = parseArchived(url.searchParams.get("archived"));
    const filters: OpportunityFilters = {
      type,
      status,
      search: url.searchParams.get("search") ?? undefined,
      includeArchived: archived !== "exclude" || status === "archived"
    };
    const opportunities = listOpportunities(filters);
    return NextResponse.json(
      archived === "only"
        ? opportunities.filter((opportunity) => opportunity.status === "archived")
        : opportunities
    );
  } catch (error) {
    return opportunityErrorResponse(error);
  }
}

type CreateOpportunityBody = {
  opportunity: OpportunityInput;
  initialActivity?: OpportunityActivityInput | null;
  initialTask?: OpportunityTaskInput | null;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CreateOpportunityBody;
    const created = createOpportunity(body.opportunity, {
      activity: body.initialActivity,
      task: body.initialTask
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return opportunityErrorResponse(error);
  }
}
