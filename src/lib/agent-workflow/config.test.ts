import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

import { spawn } from "node:child_process";

import {
  diagnoseProviderExecutable,
  loadAgentConfig,
  resolveProviderModel
} from "./config";

let tempDir: string;

beforeEach(() => {
  vi.clearAllMocks();
  tempDir = mkdtempSync(path.join(tmpdir(), "jobtracker-agent-config-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(tempDir, { force: true, recursive: true });
});

function writeConfig(value: unknown) {
  writeFileSync(
    path.join(tempDir, "jobtracker.agent.local.json"),
    `${JSON.stringify(value)}\n`,
    "utf8"
  );
}

const validConfig = {
  codex: { executablePath: "codex", defaultModel: "gpt-5.6-terra" },
  claude: { executablePath: "claude", defaultModel: "sonnet" }
};

describe("agent provider configuration", () => {
  it("falls back to safe project defaults when the local file is absent", () => {
    expect(loadAgentConfig(tempDir)).toEqual(validConfig);
  });

  it("loads the fixed project-root local file", () => {
    writeConfig({
      codex: { executablePath: "/opt/tools/codex", defaultModel: "openai/gpt_5:6" },
      claude: { executablePath: "/opt/claude-tools/claude", defaultModel: "sonnet-4.5" }
    });

    expect(loadAgentConfig(tempDir)).toEqual({
      codex: { executablePath: "/opt/tools/codex", defaultModel: "openai/gpt_5:6" },
      claude: { executablePath: "/opt/claude-tools/claude", defaultModel: "sonnet-4.5" }
    });
  });

  it.each([
    ["top-level unknown key", { ...validConfig, extra: true }],
    ["provider unknown key", { ...validConfig, codex: { ...validConfig.codex, apiKey: "secret" } }],
    ["credential-like key", { ...validConfig, token: "secret" }],
    ["environment map", { ...validConfig, claude: { ...validConfig.claude, env: { TOKEN: "secret" } } }],
    ["missing provider", { codex: validConfig.codex }],
    ["shell arguments", { ...validConfig, codex: { ...validConfig.codex, executablePath: "codex --danger" } }],
    ["path with arguments", { ...validConfig, codex: { ...validConfig.codex, executablePath: "/usr/bin/codex status" } }],
    ["shell fragment", { ...validConfig, codex: { ...validConfig.codex, executablePath: "codex; echo bad" } }],
    ["control character", { ...validConfig, codex: { ...validConfig.codex, executablePath: "codex\n--danger" } }],
    ["blank model", { ...validConfig, codex: { ...validConfig.codex, defaultModel: " " } }],
    ["leading dash model", { ...validConfig, codex: { ...validConfig.codex, defaultModel: "--help" } }],
    ["model arguments", { ...validConfig, codex: { ...validConfig.codex, defaultModel: "gpt-5 --help" } }],
    ["model control character", { ...validConfig, codex: { ...validConfig.codex, defaultModel: "gpt-5\u0000secret" } }]
  ])("rejects %s", (_label, value) => {
    writeConfig(value);
    expect(() => loadAgentConfig(tempDir)).toThrow("Invalid agent provider configuration.");
  });

  it("treats a safe run model override as one value", () => {
    expect(resolveProviderModel(validConfig, "codex", "openai/gpt_5:6-preview")).toBe(
      "openai/gpt_5:6-preview"
    );
    expect(resolveProviderModel(validConfig, "claude", undefined)).toBe("sonnet");
    expect(() => resolveProviderModel(validConfig, "codex", "--help")).toThrow(
      "Invalid agent model identifier."
    );
    expect(() => resolveProviderModel(validConfig, "codex", "gpt-5 --danger")).toThrow(
      "Invalid agent model identifier."
    );
  });
});

describe("provider executable diagnostics", () => {
  it("invokes only the resolved executable and --version without a shell", async () => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: PassThrough;
      stderr: PassThrough;
      kill: ReturnType<typeof vi.fn>;
    };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = vi.fn();
    vi.mocked(spawn).mockReturnValue(child as never);

    const diagnosticPromise = diagnoseProviderExecutable(
      {
        ...validConfig,
        codex: { ...validConfig.codex, executablePath: process.execPath }
      },
      "codex"
    );

    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
    child.stdout.end("codex 1.2.3\n");
    child.emit("close", 0, null);

    await expect(diagnosticPromise).resolves.toEqual({
      available: true,
      version: "codex 1.2.3"
    });
    expect(spawn).toHaveBeenCalledWith(
      process.execPath,
      ["--version"],
      expect.objectContaining({ shell: false })
    );
  });

  it("returns a stable safe failure without exposing raw errors or PATH", async () => {
    const config = {
      ...validConfig,
      codex: { ...validConfig.codex, executablePath: "definitely-missing-jobtracker-cli" }
    };

    await expect(diagnoseProviderExecutable(config, "codex")).resolves.toEqual({
      available: false,
      version: null,
      error: "Provider executable is unavailable."
    });
  });

  it("bounds and scrubs diagnostic output", async () => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: PassThrough;
      stderr: PassThrough;
      kill: ReturnType<typeof vi.fn>;
    };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = vi.fn();
    vi.mocked(spawn).mockReturnValue(child as never);

    const diagnosticPromise = diagnoseProviderExecutable(
      {
        ...validConfig,
        codex: { ...validConfig.codex, executablePath: process.execPath }
      },
      "codex"
    );
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
    child.stdout.end(`codex token=super-secret-value ${"v".repeat(2_000)}`);
    child.emit("close", 0, null);

    const diagnostic = await diagnosticPromise;
    expect(diagnostic.available).toBe(true);
    if (diagnostic.available) {
      expect(diagnostic.version).toContain("[REDACTED]");
      expect(diagnostic.version).not.toContain("super-secret-value");
      expect(diagnostic.version.length).toBeLessThanOrEqual(256);
    }
  });
});
