import { NextResponse } from "next/server";

import { listFollowUps } from "../../../lib/storage";

export const runtime = "nodejs";

function errorResponse(error: unknown, status = 400) {
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Request failed" },
    { status }
  );
}

export function GET() {
  try {
    return NextResponse.json(listFollowUps());
  } catch (error) {
    return errorResponse(error);
  }
}
