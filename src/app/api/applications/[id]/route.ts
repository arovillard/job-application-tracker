import { NextResponse } from "next/server";

import { type ApplicationInput } from "../../../../types";
import {
  deleteApplication,
  getApplicationDetail,
  updateApplication
} from "../../../../lib/storage";

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

export async function GET(_request: Request, context: ApplicationRouteContext) {
  const { id } = await context.params;
  const application = getApplicationDetail(id);

  if (!application) {
    return errorResponse(new Error("Application not found"), 404);
  }

  return NextResponse.json(application);
}

export async function PUT(request: Request, context: ApplicationRouteContext) {
  try {
    const { id } = await context.params;
    const input = (await request.json()) as ApplicationInput;
    const application = updateApplication(id, input);

    if (!application) {
      return errorResponse(new Error("Application not found"), 404);
    }

    return NextResponse.json(getApplicationDetail(id));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, context: ApplicationRouteContext) {
  const { id } = await context.params;

  if (!deleteApplication(id)) {
    return errorResponse(new Error("Application not found"), 404);
  }

  return NextResponse.json({ ok: true });
}
