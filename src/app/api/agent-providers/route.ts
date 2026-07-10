import { NextResponse } from "next/server";

import {
  diagnoseProviderExecutable,
  getDefaultAgentModels,
  loadAgentConfig,
  type AgentConfig,
  type ProviderDiagnostic
} from "../../../lib/agent-workflow/config";
import type { AgentProviderName } from "../../../lib/agent-workflow/types";

export const runtime = "nodejs";

const PROVIDERS: AgentProviderName[] = ["codex", "claude"];
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

function json(body: unknown) {
  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store" }
  });
}

function publicDiagnostic(
  provider: AgentProviderName,
  diagnostic: ProviderDiagnostic,
  defaultModel: string
) {
  if (diagnostic.available) {
    return {
      provider,
      available: true,
      version: diagnostic.version,
      defaultModel
    };
  }
  return {
    provider,
    available: false,
    version: null,
    error: "Provider executable is unavailable." as const,
    defaultModel
  };
}

export function createDiagnosticsHandler(dependencies: ProviderDiagnosticsDependencies) {
  return async function get(_request: Request) {
    void _request;
    let config: AgentConfig;
    try {
      config = dependencies.loadConfig();
    } catch {
      const defaultModels = getDefaultAgentModels();
      return json({
        providers: PROVIDERS.map((provider) =>
          publicDiagnostic(provider, UNAVAILABLE, defaultModels[provider])
        )
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
        return publicDiagnostic(provider, diagnostic, config[provider].defaultModel);
      })
    );
    return json({ providers });
  };
}

export const GET = createDiagnosticsHandler(productionDependencies);
