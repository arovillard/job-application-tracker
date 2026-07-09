import { NextResponse } from "next/server";

import { type ApplicationNoteInput } from "../../../../../types";
import { addApplicationNote, getApplicationDetail } from "../../../../../lib/storage";

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

export async function POST(request: Request, context: ApplicationRouteContext) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as ApplicationNoteInput;

    addApplicationNote(id, body);

    return NextResponse.json(getApplicationDetail(id), { status: 201 });
  } catch (error) {
    return errorResponse(error, error instanceof Error && /not found/i.test(error.message) ? 404 : 400);
  }
}
