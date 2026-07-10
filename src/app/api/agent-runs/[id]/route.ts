import { NextResponse } from "next/server";

import { getPublicAgentRun } from "../../../../lib/agent-workflow/storage";

export const runtime = "nodejs";

type AgentRunRouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: AgentRunRouteContext) {
  const { id } = await context.params;
  const run = getPublicAgentRun(id);
  if (!run) {
    return NextResponse.json({ error: "Agent run not found." }, { status: 404 });
  }
  return NextResponse.json(run);
}
