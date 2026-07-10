import { spawn as nodeSpawn, type SpawnOptions } from "node:child_process";
import type { Readable, Writable } from "node:stream";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_MAX_INPUT_BYTES = 1024 * 1024;
const DEFAULT_KILL_GRACE_MS = 1_000;

export type JsonCommandChild = {
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

export type JsonCommandSpawn = (
  command: string,
  args: readonly string[],
  options: {
    cwd: string;
    shell: false;
    stdio: ["pipe", "pipe", "pipe"];
    windowsHide: true;
    env: Record<string, string>;
  }
) => JsonCommandChild;

export type RunJsonCommandOptions = {
  cwd: string;
  environment?: Record<string, string | undefined>;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxOutputBytes?: number;
  maxInputBytes?: number;
  killGraceMs?: number;
  spawn?: JsonCommandSpawn;
};

export type JsonCommandErrorCode =
  | "command_failed"
  | "command_timeout"
  | "command_cancelled"
  | "command_output_invalid";

export class JsonCommandError extends Error {
  readonly code: JsonCommandErrorCode;

  constructor(code: JsonCommandErrorCode) {
    const messages: Record<JsonCommandErrorCode, string> = {
      command_failed: "Local command failed.",
      command_timeout: "Local command timed out.",
      command_cancelled: "Local command was cancelled.",
      command_output_invalid: "Local command returned invalid output."
    };
    super(messages[code]);
    this.name = "JsonCommandError";
    this.code = code;
  }
}

export async function runJsonCommand(
  command: string,
  args: readonly string[],
  input: unknown,
  options: RunJsonCommandOptions
): Promise<unknown> {
  const stdin = JSON.stringify(input);
  const maxInputBytes = options.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES;
  if (Buffer.byteLength(stdin) > maxInputBytes) {
    throw new JsonCommandError("command_output_invalid");
  }
  if (options.signal?.aborted) {
    throw new JsonCommandError("command_cancelled");
  }

  const spawn = options.spawn ?? defaultSpawn;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const environment = boundedEnvironment(options.environment ?? {});

  return await new Promise<unknown>((resolve, reject) => {
    let child: JsonCommandChild;
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        env: environment
      });
    } catch {
      reject(new JsonCommandError("command_failed"));
      return;
    }

    let stdout = Buffer.alloc(0);
    let stderrBytes = 0;
    let reason: JsonCommandErrorCode | null = null;
    let forceKill: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const stop = (code: JsonCommandErrorCode) => {
      if (reason) return;
      reason = code;
      child.kill("SIGTERM");
      forceKill = setTimeout(
        () => child.kill("SIGKILL"),
        options.killGraceMs ?? DEFAULT_KILL_GRACE_MS
      );
      forceKill.unref();
    };
    const timeout = setTimeout(() => stop("command_timeout"), timeoutMs);
    timeout.unref();
    const onAbort = () => stop("command_cancelled");
    options.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (chunk: Buffer | string) => {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (stdout.length + data.length > maxOutputBytes) {
        stop("command_output_invalid");
        return;
      }
      stdout = Buffer.concat([stdout, data]);
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderrBytes += Buffer.byteLength(chunk);
      if (stderrBytes > maxOutputBytes) stop("command_output_invalid");
    });
    child.once("error", () => {
      reason ??= "command_failed";
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (forceKill) clearTimeout(forceKill);
      options.signal?.removeEventListener("abort", onAbort);
      if (reason) {
        reject(new JsonCommandError(reason));
        return;
      }
      if (code !== 0) {
        reject(new JsonCommandError("command_failed"));
        return;
      }
      try {
        resolve(JSON.parse(stdout.toString("utf8")) as unknown);
      } catch {
        reject(new JsonCommandError("command_output_invalid"));
      }
    });
    child.stdin.end(stdin);
  });
}

function boundedEnvironment(input: Record<string, string | undefined>): Record<string, string> {
  const entries = Object.entries(input);
  if (entries.length > 64) throw new JsonCommandError("command_failed");
  const output: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || value === undefined) continue;
    if (Buffer.byteLength(value) > 16_384) throw new JsonCommandError("command_failed");
    output[key] = value;
  }
  return output;
}

function defaultSpawn(
  command: string,
  args: readonly string[],
  options: Parameters<JsonCommandSpawn>[2]
): JsonCommandChild {
  return nodeSpawn(command, [...args], options as unknown as SpawnOptions) as JsonCommandChild;
}
