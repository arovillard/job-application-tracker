import { NextResponse } from "next/server";

import {
  diagnoseProviderExecutable,
  loadAgentConfig,
  type AgentConfig,
  type ProviderDiagnostic
} from "../../../lib/agent-workflow/config";
import type { AgentProviderName } from "../../../lib/agent-workflow/types";

export const runtime = "nodejs";

const PROVIDERS: AgentProviderName[] = ["codex", "claude"];
const SAFE_DEFAULT_MODELS: Record<AgentProviderName, string> = {
  codex: "gpt-5.6-terra",
  claude: "sonnet"
};
const UNAVAILABLE: ProviderDiagnostic = {
  available: false,
  version: null,
  error: "Provider executable is unavailable."
};

export type ProviderDiagnosticsDependencies = {
  loadConfig(): AgentConfig;
  diagnoseProvider(config: AgentConfig, provider: AgentProviderName): Promise<ProviderDiagnostic>;
};

const productionDependencies: ProviderDiagnosticsDependencies = {
  loadConfig: loadAgentConfig,
  diagnoseProvider: diagnoseProviderExecutable
};

export function createDiagnosticsHandler(dependencies: ProviderDiagnosticsDependencies) {
  return async function get(_request: Request) {
    void _request;
    let config: AgentConfig;
    try {
      config = dependencies.loadConfig();
    } catch {
      return NextResponse.json({
        providers: PROVIDERS.map((provider) => ({
          provider,
          ...UNAVAILABLE,
          defaultModel: SAFE_DEFAULT_MODELS[provider]
        }))
      });
    }

    const providers = await Promise.all(
      PROVIDERS.map(async (provider) => {
        let diagnostic: ProviderDiagnostic;
        try {
          diagnostic = await dependencies.diagnoseProvider(config, provider);
        } catch {
          diagnostic = UNAVAILABLE;
        }
        return {
          provider,
          ...diagnostic,
          defaultModel: config[provider].defaultModel
        };
      })
    );
    return NextResponse.json({ providers });
  };
}

export const GET = createDiagnosticsHandler(productionDependencies);
