import { spawn } from "node:child_process";
import { constants, readFileSync } from "node:fs";
import { access, stat } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import type { AgentProviderName } from "./types";

const LOCAL_CONFIG_FILE = "jobtracker.agent.local.json";
const DIAGNOSTIC_TIMEOUT_MS = 3_000;
const MAX_DIAGNOSTIC_OUTPUT = 4_096;
const MAX_VERSION_LENGTH = 256;

const modelIdentifierSchema = z
  .string()
  .regex(/^[A-Za-z0-9._:/][A-Za-z0-9._:/-]*$/);

const executablePathSchema = z.string().refine((value) => {
  if (!value || value !== value.trim() || /\s|[\u0000-\u001f\u007f-\u009f]/.test(value)) {
    return false;
  }
  if (/[`$;&|<>"']/.test(value) || /(?:^|\s)--?\S/.test(value)) {
    return false;
  }
  return value.includes("/") || value.includes("\\")
    ? true
    : /^[A-Za-z0-9._+-]+$/.test(value);
});

const providerConfigSchema = z
  .object({
    executablePath: executablePathSchema,
    defaultModel: modelIdentifierSchema
  })
  .strict();

const agentConfigSchema = z
  .object({
    codex: providerConfigSchema,
    claude: providerConfigSchema
  })
  .strict();

export type AgentProviderConfig = z.infer<typeof providerConfigSchema>;
export type AgentConfig = z.infer<typeof agentConfigSchema>;

export type ProviderDiagnostic =
  | { available: true; version: string }
  | { available: false; version: null; error: "Provider executable is unavailable." };

const DEFAULT_AGENT_CONFIG: AgentConfig = {
  codex: { executablePath: "codex", defaultModel: "gpt-5.6-terra" },
  claude: { executablePath: "claude", defaultModel: "sonnet" }
};

export function loadAgentConfig(projectRoot = process.cwd()): AgentConfig {
  const configPath = path.join(projectRoot, LOCAL_CONFIG_FILE);
  let parsed: unknown;

  try {
    parsed = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return structuredClone(DEFAULT_AGENT_CONFIG);
    }
    throw new Error("Invalid agent provider configuration.");
  }

  const result = agentConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error("Invalid agent provider configuration.");
  }
  return result.data;
}

export function resolveProviderModel(
  config: AgentConfig,
  provider: AgentProviderName,
  override?: string
): string {
  const model = override ?? config[provider].defaultModel;
  const result = modelIdentifierSchema.safeParse(model);
  if (!result.success) {
    throw new Error("Invalid agent model identifier.");
  }
  return result.data;
}

export async function diagnoseProviderExecutable(
  config: AgentConfig,
  provider: AgentProviderName
): Promise<ProviderDiagnostic> {
  const executable = await resolveExecutable(config[provider].executablePath);
  if (!executable) {
    return unavailableDiagnostic();
  }

  return new Promise((resolve) => {
    let output = "";
    let settled = false;
    let child: ReturnType<typeof spawn>;

    const finish = (diagnostic: ProviderDiagnostic) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(diagnostic);
    };

    try {
      child = spawn(executable, ["--version"], {
        shell: false,
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true
      });
    } catch {
      resolve(unavailableDiagnostic());
      return;
    }

    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finish(unavailableDiagnostic());
    }, DIAGNOSTIC_TIMEOUT_MS);
    timeout.unref();

    if (!child.stdout) {
      finish(unavailableDiagnostic());
      return;
    }
    child.stdout.on("data", (chunk: Buffer | string) => {
      if (output.length < MAX_DIAGNOSTIC_OUTPUT) {
        output += String(chunk).slice(0, MAX_DIAGNOSTIC_OUTPUT - output.length);
      }
    });
    child.once("error", () => finish(unavailableDiagnostic()));
    child.once("close", (code) => {
      if (code !== 0) {
        finish(unavailableDiagnostic());
        return;
      }
      const version = sanitizeVersion(output);
      finish(version ? { available: true, version } : unavailableDiagnostic());
    });
  });
}

async function resolveExecutable(configured: string): Promise<string | null> {
  if (configured.includes("/") || configured.includes("\\")) {
    const candidate = path.resolve(configured);
    return (await isExecutableFile(candidate)) ? candidate : null;
  }

  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, configured);
    if (await isExecutableFile(candidate)) return candidate;
  }
  return null;
}

async function isExecutableFile(candidate: string): Promise<boolean> {
  try {
    await access(candidate, constants.X_OK);
    return (await stat(candidate)).isFile();
  } catch {
    return false;
  }
}

function sanitizeVersion(value: string): string {
  return value
    .replace(/\bBearer\s+[^\s,;]+/gi, "[REDACTED]")
    .replace(
      /\b(?:api[_-]?key|access[_-]?token|auth(?:orization)?|password|secret|token)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      "[REDACTED]"
    )
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "[REDACTED]")
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_VERSION_LENGTH);
}

function unavailableDiagnostic(): ProviderDiagnostic {
  return {
    available: false,
    version: null,
    error: "Provider executable is unavailable."
  };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
