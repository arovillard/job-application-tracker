import { NextResponse } from "next/server";
import { z } from "zod";

import {
  diagnoseProviderExecutable,
  loadAgentConfig,
  resolveProviderModel,
  type AgentConfig,
  type ProviderDiagnostic
} from "../../../lib/agent-workflow/config";
import { validatePublicJobUrl } from "../../../lib/agent-workflow/security";
import {
  appendAgentRunEvent,
  createAgentRun,
  getPublicAgentRun,
  type AppendAgentRunEventInput,
  type CreateAgentRunInput
} from "../../../lib/agent-workflow/storage";
import type {
  AgentProviderName,
  AgentRun,
  PublicAgentRun
} from "../../../lib/agent-workflow/types";

export const runtime = "nodejs";

const requestSchema = z
  .object({
    jobUrl: z.string(),
    provider: z.enum(["codex", "claude"]),
    model: z.string().optional()
  })
  .strict();

const SAFE_URL_ERRORS = new Set([
  "Job URL must use a public host.",
  "Job URL hostname could not be resolved safely."
]);

export type AgentRunPostDependencies = {
  loadConfig(): AgentConfig;
  resolveModel(config: AgentConfig, provider: AgentProviderName, override?: string): string;
  validateJobUrl(input: string): Promise<string>;
  diagnoseProvider(config: AgentConfig, provider: AgentProviderName): Promise<ProviderDiagnostic>;
  createRun(input: CreateAgentRunInput): AgentRun;
  appendEvent(runId: string, input: AppendAgentRunEventInput): unknown;
  getPublicRun(id: string): PublicAgentRun | null;
};

const productionDependencies: AgentRunPostDependencies = {
  loadConfig: loadAgentConfig,
  resolveModel: resolveProviderModel,
  validateJobUrl: validatePublicJobUrl,
  diagnoseProvider: diagnoseProviderExecutable,
  createRun: createAgentRun,
  appendEvent: appendAgentRunEvent,
  getPublicRun: getPublicAgentRun
};

function errorResponse(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

export function createPostHandler(dependencies: AgentRunPostDependencies) {
  return async function post(request: Request) {
    let parsedJson: unknown;
    try {
      parsedJson = await request.json();
    } catch {
      return errorResponse("Invalid JSON body.", 400);
    }

    const parsed = requestSchema.safeParse(parsedJson);
    if (!parsed.success) {
      return errorResponse("Invalid agent run request.", 400);
    }

    const { jobUrl, provider, model: override } = parsed.data;
    let config: AgentConfig;
    try {
      config = dependencies.loadConfig();
    } catch {
      return errorResponse("Invalid agent provider configuration.", 400);
    }

    let model: string;
    try {
      model = dependencies.resolveModel(config, provider, override);
    } catch {
      return errorResponse("Invalid agent model identifier.", 400);
    }

    let canonicalJobUrl: string;
    try {
      canonicalJobUrl = await dependencies.validateJobUrl(jobUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      return errorResponse(
        SAFE_URL_ERRORS.has(message) ? message : "Job URL could not be validated safely.",
        400
      );
    }

    let diagnostic: ProviderDiagnostic;
    try {
      diagnostic = await dependencies.diagnoseProvider(config, provider);
    } catch {
      return errorResponse("Provider executable is unavailable.", 409);
    }
    if (!diagnostic.available) {
      return errorResponse("Provider executable is unavailable.", 409);
    }

    try {
      const run = dependencies.createRun({ provider, model, canonicalJobUrl });
      dependencies.appendEvent(run.id, {
        kind: "status",
        message: "Run queued for preview."
      });
      const publicRun = dependencies.getPublicRun(run.id);
      if (!publicRun) {
        return errorResponse("Unable to queue agent run.", 400);
      }
      return NextResponse.json(publicRun, { status: 202 });
    } catch {
      return errorResponse("Unable to queue agent run.", 400);
    }
  };
}

export const POST = createPostHandler(productionDependencies);
