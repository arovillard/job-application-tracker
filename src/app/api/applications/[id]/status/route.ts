import { NextResponse } from "next/server";

import { type ApplicationStatus } from "../../../../../types";
import { changeApplicationStatus, getApplicationDetail } from "../../../../../lib/storage";

export const runtime = "nodejs";

type ApplicationRouteContext = {
  params: Promise<{
    id: string;
  }>;
};

function errorResponse(error: unknown, status = 400) {
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Request failed" },
    { status }
  );
}

export async function PATCH(request: Request, context: ApplicationRouteContext) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as {
      status?: unknown;
      note?: unknown;
    };

    changeApplicationStatus(id, body.status as ApplicationStatus, body.note as string | null);

    return NextResponse.json(getApplicationDetail(id));
  } catch (error) {
    return errorResponse(error, error instanceof Error && /not found/i.test(error.message) ? 404 : 400);
  }
}
