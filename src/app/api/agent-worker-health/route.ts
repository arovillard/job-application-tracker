import { NextResponse } from "next/server";

import { getAgentWorkerHealth } from "../../../lib/agent-workflow/storage";
import type { AgentWorkerHealth } from "../../../lib/agent-workflow/types";

export const runtime = "nodejs";

export type WorkerHealthDependencies = {
  readHealth(): AgentWorkerHealth;
};

const productionDependencies: WorkerHealthDependencies = {
  readHealth: getAgentWorkerHealth
};

function json(body: AgentWorkerHealth) {
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}

export function createWorkerHealthHandler(dependencies: WorkerHealthDependencies) {
  return async function get(_request: Request) {
    void _request;
    try {
      return json(dependencies.readHealth());
    } catch {
      return json({ status: "offline", lastSeenAt: null });
    }
  };
}

export const GET = createWorkerHealthHandler(productionDependencies);
