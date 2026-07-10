import { spawn as nodeSpawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Readable, Writable } from "node:stream";

import type { AgentConfig, ProviderDiagnostic } from "./config";
import { diagnoseProviderExecutable, resolveProviderModel } from "./config";
import { buildMaterialsPrompt, buildPreviewPrompt } from "./prompts";
import {
  agentPreviewSchema,
  artifactManifestSchema,
  MATERIALS_JSON_SCHEMA,
  PREVIEW_JSON_SCHEMA
} from "./schemas";
import { sanitizeProviderEvent, type SanitizedProviderEvent } from "./security";
import type { AgentPreview, AgentUsage, ArtifactManifestEntry } from "./types";

const DEFAULT_TIMEOUT_MS = 10 * 60_000;
const MAX_OUTPUT_BYTES = 1024 * 1024;

export type ProviderOperation = "preview" | "materials";

export type ProviderInvocation = {
  command: string;
  args: string[];
  cwd: string;
  shell: false;
  stdin: string;
};

export type ProviderChildProcess = {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  kill(signal?: NodeJS.Signals): boolean;
  once(event: "error", listener: (error: Error) => void): unknown;
  once(
    event: "close",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void
  ): unknown;
};

export type SpawnDependency = (
  command: string,
  args: readonly string[],
  options: {
    cwd: string;
    shell: false;
    stdio: ["pipe", "pipe", "pipe"];
    windowsHide: true;
  }
) => ProviderChildProcess;

export type AgentProviderHooks = {
  onEvent?: (event: SanitizedProviderEvent) => void;
};

export type AgentProviderRequest = {
  jobUrl: string;
  model?: string;
  profileContext?: string;
  resumeContext?: string;
  signal?: AbortSignal;
};

export type AgentMaterialsRequest = AgentProviderRequest & {
  preview: AgentPreview;
};

export type AgentPreviewResult = {
  preview: AgentPreview;
  usage: AgentUsage | null;
};

export type MaterialsResult = {
  manifest: ArtifactManifestEntry[];
  usage: AgentUsage | null;
};

export type AgentProvider = {
  diagnose(): Promise<ProviderDiagnostic>;
  preview(request: AgentProviderRequest, hooks?: AgentProviderHooks): Promise<AgentPreviewResult>;
  createMaterials(
    request: AgentMaterialsRequest,
    hooks?: AgentProviderHooks
  ): Promise<MaterialsResult>;
};

export type ProviderFactoryOptions = {
  config: AgentConfig;
  projectRoot: string;
  applicationsDir: string;
  spawn?: SpawnDependency;
  timeoutMs?: number;
};

export type CodexInvocationInput = {
  executablePath: string;
  operation: ProviderOperation;
  model: string;
  projectRoot: string;
  applicationsDir: string;
  schemaPath: string;
  resultPath: string;
  prompt: string;
};

export type ClaudeInvocationInput = {
  executablePath: string;
  operation: ProviderOperation;
  model: string;
  projectRoot: string;
  prompt: string;
};

export type AgentProviderErrorCode =
  | "provider_unavailable"
  | "provider_nonzero_exit"
  | "provider_timeout"
  | "provider_cancelled"
  | "provider_malformed_output"
  | "provider_schema_rejected";

const ERROR_MESSAGES: Record<AgentProviderErrorCode, string> = {
  provider_unavailable: "Provider executable is unavailable.",
  provider_nonzero_exit: "Provider execution failed.",
  provider_timeout: "Provider execution timed out.",
  provider_cancelled: "Provider execution was cancelled.",
  provider_malformed_output: "Provider returned malformed output.",
  provider_schema_rejected: "Provider output did not match the required schema."
};

export class AgentProviderError extends Error {
  readonly code: AgentProviderErrorCode;

  constructor(code: AgentProviderErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "AgentProviderError";
    this.code = code;
  }
}

export function buildCodexInvocation(input: CodexInvocationInput): ProviderInvocation {
  const args = [
    "exec",
    "--ephemeral",
    "--json",
    "--sandbox",
    input.operation === "preview" ? "read-only" : "workspace-write",
    "--output-schema",
    input.schemaPath,
    "--output-last-message",
    input.resultPath,
    "--model",
    input.model,
    "--cd",
    input.projectRoot
  ];
  if (input.operation === "materials") {
    args.push("--add-dir", input.applicationsDir);
  }
  args.push("-");
  return {
    command: input.executablePath,
    args,
    cwd: input.projectRoot,
    shell: false,
    stdin: input.prompt
  };
}

export function buildClaudeInvocation(input: ClaudeInvocationInput): ProviderInvocation {
  const preview = input.operation === "preview";
  return {
    command: input.executablePath,
    args: [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--json-schema",
      JSON.stringify(preview ? PREVIEW_JSON_SCHEMA : MATERIALS_JSON_SCHEMA),
      "--permission-mode",
      preview ? "plan" : "acceptEdits",
      "--tools",
      preview ? "WebFetch,WebSearch" : "Read,Write,Edit,Glob,Grep,WebFetch,WebSearch",
      "--model",
      input.model
    ],
    cwd: input.projectRoot,
    shell: false,
    stdin: input.prompt
  };
}

export function createCodexProvider(options: ProviderFactoryOptions): AgentProvider {
  const spawn = options.spawn ?? defaultSpawn;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    diagnose: () => diagnoseProviderExecutable(options.config, "codex"),
    preview: async (request, hooks = {}) => {
      const output = await runCodex("preview", request, hooks, options, spawn, timeoutMs);
      return { preview: parsePreview(output.value), usage: output.usage };
    },
    createMaterials: async (request, hooks = {}) => {
      const output = await runCodex("materials", request, hooks, options, spawn, timeoutMs);
      return { manifest: parseManifest(output.value), usage: output.usage };
    }
  };
}

export function createClaudeProvider(options: ProviderFactoryOptions): AgentProvider {
  const spawn = options.spawn ?? defaultSpawn;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    diagnose: () => diagnoseProviderExecutable(options.config, "claude"),
    preview: async (request, hooks = {}) => {
      const output = await runClaude("preview", request, hooks, options, spawn, timeoutMs);
      return { preview: parsePreview(output.value), usage: output.usage };
    },
    createMaterials: async (request, hooks = {}) => {
      const output = await runClaude("materials", request, hooks, options, spawn, timeoutMs);
      return { manifest: parseManifest(output.value), usage: output.usage };
    }
  };
}

async function runCodex(
  operation: ProviderOperation,
  request: AgentProviderRequest | AgentMaterialsRequest,
  hooks: AgentProviderHooks,
  options: ProviderFactoryOptions,
  spawn: SpawnDependency,
  timeoutMs: number
): Promise<{ value: unknown; usage: AgentUsage | null }> {
  const model = resolveProviderModel(options.config, "codex", request.model);
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "jobtracker-codex-"));
  const schemaPath = path.join(temporaryDirectory, "schema.json");
  const resultPath = path.join(temporaryDirectory, "result.json");
  const schema = operation === "preview" ? PREVIEW_JSON_SCHEMA : MATERIALS_JSON_SCHEMA;
  const prompt = operation === "preview"
    ? buildPreviewPrompt(request)
    : buildMaterialsPrompt({
        ...request,
        preview: (request as AgentMaterialsRequest).preview,
        applicationsDir: options.applicationsDir
      });

  try {
    await writeFile(schemaPath, JSON.stringify(schema), { mode: 0o600 });
    const invocation = buildCodexInvocation({
      executablePath: options.config.codex.executablePath,
      operation,
      model,
      projectRoot: options.projectRoot,
      applicationsDir: options.applicationsDir,
      schemaPath,
      resultPath,
      prompt
    });
    const processResult = await runSubprocess(invocation, spawn, request.signal, timeoutMs);
    if (processResult.code !== 0) throw new AgentProviderError("provider_nonzero_exit");
    const usage = inspectCodexEvents(processResult.stdout, hooks);
    let rawResult: string;
    try {
      rawResult = await readFile(resultPath, "utf8");
    } catch {
      throw new AgentProviderError("provider_malformed_output");
    }
    return { value: parseJson(cleanJsonText(rawResult)), usage };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function runClaude(
  operation: ProviderOperation,
  request: AgentProviderRequest | AgentMaterialsRequest,
  hooks: AgentProviderHooks,
  options: ProviderFactoryOptions,
  spawn: SpawnDependency,
  timeoutMs: number
): Promise<{ value: unknown; usage: AgentUsage | null }> {
  const model = resolveProviderModel(options.config, "claude", request.model);
  const prompt = operation === "preview"
    ? buildPreviewPrompt(request)
    : buildMaterialsPrompt({
        ...request,
        preview: (request as AgentMaterialsRequest).preview,
        applicationsDir: options.applicationsDir
      });
  const invocation = buildClaudeInvocation({
    executablePath: options.config.claude.executablePath,
    operation,
    model,
    projectRoot: options.projectRoot,
    prompt
  });
  const processResult = await runSubprocess(invocation, spawn, request.signal, timeoutMs);
  if (processResult.code !== 0) throw new AgentProviderError("provider_nonzero_exit");
  return inspectClaudeEvents(processResult.stdout, hooks);
}

type SubprocessResult = { code: number | null; stdout: string };

function runSubprocess(
  invocation: ProviderInvocation,
  spawn: SpawnDependency,
  signal: AbortSignal | undefined,
  timeoutMs: number
): Promise<SubprocessResult> {
  if (signal?.aborted) return Promise.reject(new AgentProviderError("provider_cancelled"));

  return new Promise((resolve, reject) => {
    let child: ProviderChildProcess;
    try {
      child = spawn(invocation.command, invocation.args, {
        cwd: invocation.cwd,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true
      });
    } catch {
      reject(new AgentProviderError("provider_unavailable"));
      return;
    }

    let stdout = "";
    let stderrBytes = 0;
    let settled = false;
    let killed = false;

    const finish = (error?: AgentProviderError, code: number | null = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve({ code, stdout });
    };
    const killOnce = () => {
      if (killed) return;
      killed = true;
      child.kill("SIGTERM");
    };
    const onAbort = () => {
      killOnce();
      finish(new AgentProviderError("provider_cancelled"));
    };
    const timeout = setTimeout(() => {
      killOnce();
      finish(new AgentProviderError("provider_timeout"));
    }, Math.max(1, timeoutMs));
    timeout.unref();

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout = appendBounded(stdout, chunk, MAX_OUTPUT_BYTES);
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderrBytes = Math.min(MAX_OUTPUT_BYTES, stderrBytes + Buffer.byteLength(chunk));
    });
    child.once("error", () => finish(new AgentProviderError("provider_unavailable")));
    child.once("close", (code) => finish(undefined, code));
    child.stdin.once("error", () => finish(new AgentProviderError("provider_unavailable")));
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
    if (settled) return;
    try {
      child.stdin.end(invocation.stdin);
    } catch {
      finish(new AgentProviderError("provider_unavailable"));
    }
    void stderrBytes;
  });
}

function inspectCodexEvents(stdout: string, hooks: AgentProviderHooks): AgentUsage | null {
  let usage: AgentUsage | null = null;
  for (const line of nonemptyLines(stdout)) {
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(event) || !isRecord(event.usage)) continue;
    const safeEvent = sanitizeProviderEvent({
      kind: "usage",
      message: "Provider usage update.",
      usage: event.usage
    });
    if (safeEvent.usage) {
      usage = safeEvent.usage;
      hooks.onEvent?.(safeEvent);
    }
  }
  return usage;
}

function inspectClaudeEvents(
  stdout: string,
  hooks: AgentProviderHooks
): { value: unknown; usage: AgentUsage | null } {
  let finalEvent: Record<string, unknown> | null = null;
  let usage: AgentUsage | null = null;
  for (const line of nonemptyLines(stdout)) {
    const event = parseJson(line);
    if (!isRecord(event)) throw new AgentProviderError("provider_malformed_output");
    if (event.type === "result") finalEvent = event;
  }
  if (!finalEvent || !("structured_output" in finalEvent)) {
    throw new AgentProviderError("provider_malformed_output");
  }
  const safeEvent = sanitizeProviderEvent({
    kind: "usage",
    message: "Provider usage update.",
    usage: finalEvent.usage
  });
  if (safeEvent.usage) {
    usage = safeEvent.usage;
    hooks.onEvent?.(safeEvent);
  }
  return { value: finalEvent.structured_output, usage };
}

function parsePreview(value: unknown): AgentPreview {
  const result = agentPreviewSchema.safeParse(value);
  if (!result.success) throw new AgentProviderError("provider_schema_rejected");
  return result.data;
}

function parseManifest(value: unknown): ArtifactManifestEntry[] {
  const result = artifactManifestSchema.safeParse(value);
  if (!result.success) throw new AgentProviderError("provider_schema_rejected");
  return result.data;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new AgentProviderError("provider_malformed_output");
  }
}

function cleanJsonText(value: string): string {
  return value.replace(/^\uFEFF/, "").trim();
}

function nonemptyLines(value: string): string[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function appendBounded(current: string, chunk: Buffer | string, maximum: number): string {
  if (Buffer.byteLength(current) >= maximum) return current;
  const remaining = maximum - Buffer.byteLength(current);
  return current + Buffer.from(chunk).subarray(0, remaining).toString("utf8");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const defaultSpawn: SpawnDependency = (command, args, options) =>
  nodeSpawn(command, [...args], options) as ProviderChildProcess;
