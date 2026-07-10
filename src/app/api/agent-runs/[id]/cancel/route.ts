import { NextResponse } from "next/server";

import {
  getPublicAgentRun,
  requestAgentRunCancellation
} from "../../../../../lib/agent-workflow/storage";

export const runtime = "nodejs";

type AgentRunRouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, context: AgentRunRouteContext) {
  const { id } = await context.params;
  const existing = getPublicAgentRun(id);
  if (!existing) {
    return NextResponse.json({ error: "Agent run not found." }, { status: 404 });
  }
  if (existing.cancellationRequested) {
    return NextResponse.json({ error: "Agent run cannot be cancelled." }, { status: 409 });
  }

  if (!requestAgentRunCancellation(id)) {
    return NextResponse.json({ error: "Agent run cannot be cancelled." }, { status: 409 });
  }
  const run = getPublicAgentRun(id);
  if (!run) {
    return NextResponse.json({ error: "Agent run not found." }, { status: 404 });
  }
  return NextResponse.json(run);
}
