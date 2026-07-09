import { NextResponse } from "next/server";

import {
  APPLICATION_STATUSES,
  type ApplicationInput,
  type ApplicationStatus
} from "../../../types";
import { createApplication, listApplications } from "../../../lib/storage";

export const runtime = "nodejs";

const STATUS_SET = new Set<ApplicationStatus>(APPLICATION_STATUSES);

function parseStatus(value: string | null) {
  if (!value || value === "all") {
    return "all";
  }

  if (!STATUS_SET.has(value as ApplicationStatus)) {
    throw new Error("Status filter is invalid");
  }

  return value as ApplicationStatus;
}

function errorResponse(error: unknown, status = 400) {
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Request failed" },
    { status }
  );
}

export function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const applications = listApplications({
      search: url.searchParams.get("search") ?? undefined,
      status: parseStatus(url.searchParams.get("status"))
    });

    return NextResponse.json(applications);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = (await request.json()) as ApplicationInput;
    return NextResponse.json(createApplication(input), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
