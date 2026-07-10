import { NextResponse } from "next/server";

import {
  getPublicAgentRun,
  requestAgentRunCancellationAndGetPublic
} from "../../../../../lib/agent-workflow/storage";

export const runtime = "nodejs";

type AgentRunRouteContext = {
  params: Promise<{ id: string }>;
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

export async function POST(_request: Request, context: AgentRunRouteContext) {
  const { id } = await context.params;
  const existing = getPublicAgentRun(id);
  if (!existing) {
    return json({ error: "Agent run not found." }, 404);
  }
  if (existing.cancellationRequested) {
    return json({ error: "Agent run cannot be cancelled." }, 409);
  }

  const run = requestAgentRunCancellationAndGetPublic(id);
  if (!run) {
    return json({ error: "Agent run cannot be cancelled." }, 409);
  }
  return json(run);
}
