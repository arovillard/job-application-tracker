import { NextResponse } from "next/server";

import { getPublicAgentRun } from "../../../../lib/agent-workflow/storage";

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

export async function GET(_request: Request, context: AgentRunRouteContext) {
  const { id } = await context.params;
  const run = getPublicAgentRun(id);
  if (!run) {
    return json({ error: "Agent run not found." }, 404);
  }
  return json(run);
}
