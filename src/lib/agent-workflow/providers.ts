import { spawn as nodeSpawn } from "node:child_process";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
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
const DEFAULT_KILL_GRACE_MS = 1_000;
const MAX_OUTPUT_BYTES = 1024 * 1024;

export type ProviderOperation = "preview" | "materials";
export type ProviderEnvironment = Record<string, string | undefined>;

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
    env: ProviderEnvironment;
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
  killGraceMs?: number;
  environment?: ProviderEnvironment;
  baseResumePath?: string;
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
  applicationsDir: string;
  mcpConfigPath: string;
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
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--no-session-persistence",
    "--json-schema",
    JSON.stringify(preview ? PREVIEW_JSON_SCHEMA : MATERIALS_JSON_SCHEMA),
    "--permission-mode",
    preview ? "plan" : "acceptEdits",
    "--tools",
    preview
      ? "WebFetch,WebSearch"
      : "Read,Write,Edit,Glob,Grep,WebFetch,WebSearch,Skill"
  ];
  if (!preview) {
    args.push(
      "--allowedTools",
      "Skill(job-application-resume)",
      "--add-dir",
      input.applicationsDir
    );
  }
  args.push(
    "--strict-mcp-config",
    "--mcp-config",
    input.mcpConfigPath,
    "--model",
    input.model
  );
  return {
    command: input.executablePath,
    args,
    cwd: input.projectRoot,
    shell: false,
    stdin: input.prompt
  };
}

export function createCodexProvider(options: ProviderFactoryOptions): AgentProvider {
  const spawn = options.spawn ?? defaultSpawn;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  return {
    diagnose: () => diagnoseProviderExecutable(options.config, "codex"),
    preview: async (request, hooks = {}) => {
      const output = await runCodex(
        "preview", request, hooks, options, spawn, timeoutMs, killGraceMs
      );
      return { preview: parsePreview(output.value), usage: output.usage };
    },
    createMaterials: async (request, hooks = {}) => {
      const output = await runCodex(
        "materials", request, hooks, options, spawn, timeoutMs, killGraceMs
      );
      return { manifest: parseManifest(output.value), usage: output.usage };
    }
  };
}

export function createClaudeProvider(options: ProviderFactoryOptions): AgentProvider {
  const spawn = options.spawn ?? defaultSpawn;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  return {
    diagnose: () => diagnoseProviderExecutable(options.config, "claude"),
    preview: async (request, hooks = {}) => {
      const output = await runClaude(
        "preview", request, hooks, options, spawn, timeoutMs, killGraceMs
      );
      return { preview: parsePreview(output.value), usage: output.usage };
    },
    createMaterials: async (request, hooks = {}) => {
      const output = await runClaude(
        "materials", request, hooks, options, spawn, timeoutMs, killGraceMs
      );
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
  timeoutMs: number,
  killGraceMs: number
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
    const processResult = await runSubprocess(
      invocation,
      spawn,
      request.signal,
      timeoutMs,
      killGraceMs,
      buildProviderEnvironment("codex", options)
    );
    if (processResult.code !== 0) throw new AgentProviderError("provider_nonzero_exit");
    const usage = inspectCodexEvents(processResult.stdout, hooks);
    const rawResult = await readBoundedResult(resultPath);
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
  timeoutMs: number,
  killGraceMs: number
): Promise<{ value: unknown; usage: AgentUsage | null }> {
  const model = resolveProviderModel(options.config, "claude", request.model);
  const prompt = operation === "preview"
    ? buildPreviewPrompt(request)
    : buildMaterialsPrompt({
        ...request,
        preview: (request as AgentMaterialsRequest).preview,
        applicationsDir: options.applicationsDir
      });
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "jobtracker-claude-"));
  const mcpConfigPath = path.join(temporaryDirectory, "empty-mcp.json");
  try {
    await writeFile(mcpConfigPath, JSON.stringify({ mcpServers: {} }), { mode: 0o600 });
    const invocation = buildClaudeInvocation({
      executablePath: options.config.claude.executablePath,
      operation,
      model,
      projectRoot: options.projectRoot,
      applicationsDir: options.applicationsDir,
      mcpConfigPath,
      prompt
    });
    const processResult = await runSubprocess(
      invocation,
      spawn,
      request.signal,
      timeoutMs,
      killGraceMs,
      buildProviderEnvironment("claude", options)
    );
    if (processResult.code !== 0) throw new AgentProviderError("provider_nonzero_exit");
    return inspectClaudeEvents(processResult.stdout, hooks);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

type SubprocessResult = { code: number | null; stdout: string };

function runSubprocess(
  invocation: ProviderInvocation,
  spawn: SpawnDependency,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  killGraceMs: number,
  environment: ProviderEnvironment
): Promise<SubprocessResult> {
  if (signal?.aborted) return Promise.reject(new AgentProviderError("provider_cancelled"));

  return new Promise((resolve, reject) => {
    let child: ProviderChildProcess;
    try {
      child = spawn(invocation.command, invocation.args, {
        cwd: invocation.cwd,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        env: environment
      });
    } catch {
      reject(new AgentProviderError("provider_unavailable"));
      return;
    }

    let stdout = "";
    let stderrBytes = 0;
    let settled = false;
    let terminationError: AgentProviderError | null = null;
    let sentSigterm = false;
    let sentSigkill = false;
    let killGraceTimeout: NodeJS.Timeout | undefined;

    const finish = (error?: AgentProviderError, code: number | null = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(killGraceTimeout);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve({ code, stdout });
    };
    const beginTermination = (error: AgentProviderError) => {
      if (terminationError || settled) return;
      terminationError = error;
      clearTimeout(timeout);
      if (!sentSigterm) {
        sentSigterm = true;
        child.kill("SIGTERM");
      }
      if (settled) return;
      killGraceTimeout = setTimeout(() => {
        if (settled || sentSigkill) return;
        sentSigkill = true;
        child.kill("SIGKILL");
      }, Math.max(1, killGraceMs));
      killGraceTimeout.unref();
    };
    const onAbort = () => beginTermination(new AgentProviderError("provider_cancelled"));
    const timeout = setTimeout(() => {
      beginTermination(new AgentProviderError("provider_timeout"));
    }, Math.max(1, timeoutMs));
    timeout.unref();

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout = appendBounded(stdout, chunk, MAX_OUTPUT_BYTES);
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderrBytes = Math.min(MAX_OUTPUT_BYTES, stderrBytes + Buffer.byteLength(chunk));
    });
    child.once("error", () => {
      if (!terminationError) finish(new AgentProviderError("provider_unavailable"));
    });
    child.once("close", (code) => {
      if (terminationError) finish(terminationError);
      else finish(undefined, code);
    });
    child.stdin.once("error", () => {
      if (!terminationError) finish(new AgentProviderError("provider_unavailable"));
    });
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
    if (terminationError || settled) return;
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
  if (!finalEvent) {
    throw new AgentProviderError("provider_malformed_output");
  }
  if (finalEvent.subtype === "error_max_structured_output_retries") {
    throw new AgentProviderError("provider_schema_rejected");
  }
  if (finalEvent.subtype !== "success" || finalEvent.is_error !== false) {
    throw new AgentProviderError("provider_nonzero_exit");
  }
  if (!("structured_output" in finalEvent)) {
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
  return result.data.artifacts;
}

async function readBoundedResult(filePath: string): Promise<string> {
  let file: Awaited<ReturnType<typeof open>> | undefined;
  try {
    file = await open(filePath, "r");
    const stats = await file.stat();
    if (!stats.isFile() || stats.size > MAX_OUTPUT_BYTES) {
      throw new AgentProviderError("provider_malformed_output");
    }
    const buffer = Buffer.alloc(MAX_OUTPUT_BYTES + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_OUTPUT_BYTES) {
      throw new AgentProviderError("provider_malformed_output");
    }
    return buffer.subarray(0, bytesRead).toString("utf8");
  } catch (error) {
    if (error instanceof AgentProviderError) throw error;
    throw new AgentProviderError("provider_malformed_output");
  } finally {
    await file?.close();
  }
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

const COMMON_ENVIRONMENT_KEYS = [
  "PATH",
  "HOME",
  "NODE_ENV",
  "TMPDIR",
  "TMP",
  "TEMP",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "LANG",
  "LC_ALL",
  "SSL_CERT_FILE",
  "NODE_EXTRA_CA_CERTS",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "http_proxy",
  "https_proxy"
] as const;

const PROVIDER_ENVIRONMENT_KEYS = {
  codex: [
    "CODEX_HOME",
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "OPENAI_ORGANIZATION",
    "OPENAI_PROJECT"
  ],
  claude: [
    "CLAUDE_CONFIG_DIR",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL"
  ]
} as const;

function buildProviderEnvironment(
  provider: keyof typeof PROVIDER_ENVIRONMENT_KEYS,
  options: ProviderFactoryOptions
): ProviderEnvironment {
  const source = options.environment ?? process.env;
  const environment: ProviderEnvironment = {};
  for (const key of [...COMMON_ENVIRONMENT_KEYS, ...PROVIDER_ENVIRONMENT_KEYS[provider]]) {
    const value = source[key];
    if (typeof value === "string") environment[key] = value;
  }
  environment.JOBTRACKER_APPLICATIONS_DIR = options.applicationsDir;
  if (options.baseResumePath) {
    environment.JOBTRACKER_BASE_RESUME_PATH = options.baseResumePath;
  }
  return environment;
}

const defaultSpawn: SpawnDependency = (command, args, options) =>
  nodeSpawn(command, [...args], {
    ...options,
    env: options.env as NodeJS.ProcessEnv
  }) as ProviderChildProcess;
