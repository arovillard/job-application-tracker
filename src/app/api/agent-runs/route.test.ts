import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const childProcessGuard = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: childProcessGuard.spawn }));

import type { AgentConfig, ProviderDiagnostic } from "../../../lib/agent-workflow/config";
import {
  claimNextPreview,
  createAgentRun,
  getPublicAgentRun,
  resetAgentRunStorageForTests,
  transitionAgentRun,
  transitionOwnedAgentRun
} from "../../../lib/agent-workflow/storage";
import type { AgentProviderName } from "../../../lib/agent-workflow/types";
import { createPostHandler, POST as productionPostRun } from "./route";
import { GET as getRun } from "./[id]/route";
import { POST as approveRun } from "./[id]/approve/route";
import { POST as cancelRun } from "./[id]/cancel/route";
import {
  createDiagnosticsHandler,
  GET as productionGetDiagnostics
} from "../agent-providers/route";

const config: AgentConfig = {
  codex: { executablePath: "codex", defaultModel: "gpt-5.6-terra" },
  claude: { executablePath: "claude", defaultModel: "sonnet" }
};

const publicRun = {
  id: "run-1",
  provider: "codex" as const,
  model: "gpt-5.6-terra",
  canonicalJobUrl: "https://jobs.example.com/role",
  state: "queued_preview" as const,
  preview: null,
  applicationId: null,
  artifactLinks: [],
  usage: null,
  cancellationRequested: false,
  failureCode: null,
  failureMessage: null,
  createdAt: "2026-07-10T00:00:00.000Z",
  updatedAt: "2026-07-10T00:00:00.000Z",
  events: []
};

function postRequest(body: unknown) {
  return new Request("http://localhost/api/agent-runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}

function postDependencies(diagnostic: ProviderDiagnostic = { available: true, version: "codex 1" }) {
  const enqueueRun = vi.fn(() => ({
    ...publicRun,
    events: [{ id: "event-1", runId: "run-1", sequence: 1, kind: "status" as const, message: "Run queued for preview.", metadata: null, createdAt: publicRun.createdAt }]
  }));
  return {
    loadConfig: vi.fn(() => config),
    resolveModel: vi.fn((loaded: AgentConfig, provider: AgentProviderName, model?: string) =>
      model ?? loaded[provider].defaultModel
    ),
    validateJobUrl: vi.fn(async () => "https://jobs.example.com/role"),
    diagnoseProvider: vi.fn(async () => diagnostic),
    enqueueRun
  };
}

async function body(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

describe("POST /api/agent-runs", () => {
  it("validates, diagnoses only the selected executable, and queues a public preview", async () => {
    const deps = postDependencies();
    const response = await createPostHandler(deps)(
      postRequest({ jobUrl: "https://jobs.example.com/role", provider: "codex" })
    );

    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(deps.diagnoseProvider).toHaveBeenCalledOnce();
    expect(deps.diagnoseProvider).toHaveBeenCalledWith(config, "codex");
    expect(deps.enqueueRun).toHaveBeenCalledWith({
      provider: "codex",
      model: "gpt-5.6-terra",
      canonicalJobUrl: "https://jobs.example.com/role"
    });
    expect(await body(response)).not.toHaveProperty("workerId");
  });

  it.each([
    ["malformed JSON", "{", "Invalid JSON body."],
    ["array JSON", [], "Invalid agent run request."],
    ["extra URL field", { jobUrl: "https://jobs.example.com/role", provider: "codex", callbackUrl: "https://evil.test" }, "Invalid agent run request."],
    ["multiple URL field", { jobUrl: ["https://one.test", "https://two.test"], provider: "codex" }, "Invalid agent run request."],
    ["unknown provider", { jobUrl: "https://jobs.example.com/role", provider: "other" }, "Invalid agent run request."]
  ])("rejects %s with a stable safe error", async (_name, input, error) => {
    const deps = postDependencies();
    const response = await createPostHandler(deps)(postRequest(input));
    expect(response.status).toBe(400);
    expect(await body(response)).toEqual({ error });
    expect(deps.enqueueRun).not.toHaveBeenCalled();
  });

  it("maps private or forbidden URLs to an allowlisted safe error", async () => {
    const deps = postDependencies();
    deps.validateJobUrl.mockRejectedValue(new Error("Job URL must use a public host."));
    const response = await createPostHandler(deps)(
      postRequest({ jobUrl: "http://127.0.0.1/secret", provider: "codex" })
    );
    expect(response.status).toBe(400);
    expect(await body(response)).toEqual({ error: "Job URL must use a public host." });
  });

  it("rejects unsafe model overrides without diagnosing or storing", async () => {
    const deps = postDependencies();
    deps.resolveModel.mockImplementation(() => { throw new Error("Invalid agent model identifier."); });
    const response = await createPostHandler(deps)(
      postRequest({ jobUrl: "https://jobs.example.com/role", provider: "codex", model: "--danger" })
    );
    expect(response.status).toBe(400);
    expect(await body(response)).toEqual({ error: "Invalid agent model identifier." });
    expect(deps.diagnoseProvider).not.toHaveBeenCalled();
    expect(deps.enqueueRun).not.toHaveBeenCalled();
  });

  it("returns 409 and stores nothing when the selected executable is unavailable", async () => {
    const deps = postDependencies({ available: false, version: null, error: "Provider executable is unavailable." });
    const response = await createPostHandler(deps)(
      postRequest({ jobUrl: "https://jobs.example.com/role", provider: "claude" })
    );
    expect(response.status).toBe(409);
    expect(await body(response)).toEqual({ error: "Provider executable is unavailable." });
    expect(deps.enqueueRun).not.toHaveBeenCalled();
  });

  it("never exposes arbitrary config, URL, diagnostic, or storage exceptions", async () => {
    for (const key of ["loadConfig", "validateJobUrl", "diagnoseProvider", "enqueueRun"] as const) {
      const deps = postDependencies();
      (deps[key] as ReturnType<typeof vi.fn>).mockRejectedValue?.(new Error("secret=/tmp/token"));
      if (key === "loadConfig" || key === "enqueueRun") {
        (deps[key] as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error("secret=/tmp/token"); });
      }
      const response = await createPostHandler(deps)(
        postRequest({ jobUrl: "https://jobs.example.com/role", provider: "codex" })
      );
      expect(response.status).toBe(key === "diagnoseProvider" ? 409 : 400);
      expect(JSON.stringify(await body(response))).not.toContain("secret");
    }
  });
});

let tempDir: string;
const originalCwd = process.cwd();

beforeEach(() => {
  childProcessGuard.spawn.mockReset();
  tempDir = mkdtempSync(path.join(tmpdir(), "jobtracker-route-"));
  process.env.JOBTRACKER_DB_PATH = path.join(tempDir, "test.sqlite");
});

afterEach(() => {
  process.chdir(originalCwd);
  resetAgentRunStorageForTests();
  delete process.env.JOBTRACKER_DB_PATH;
  rmSync(tempDir, { force: true, recursive: true });
});

function queuedRun(suffix: string) {
  return createAgentRun({ provider: "codex", model: "gpt-5.6-terra", canonicalJobUrl: `https://example.com/${suffix}` });
}

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("run read and action routes", () => {
  it("returns 404 for a missing run from every id route", async () => {
    for (const handler of [getRun, approveRun, cancelRun]) {
      const response = await handler(new Request("http://localhost"), context("missing"));
      expect(response.status).toBe(404);
      expect(await body(response)).toEqual({ error: "Agent run not found." });
    }
  });

  it("GET returns public fields and never worker, lease, or manifest internals", async () => {
    const run = queuedRun("public");
    claimNextPreview("private-worker", 60_000);
    const response = await getRun(new Request("http://localhost"), context(run.id));
    const output = await body(response);
    expect(response.status).toBe(200);
    expect(output).not.toHaveProperty("workerId");
    expect(output).not.toHaveProperty("leaseExpiresAt");
    expect(output).not.toHaveProperty("artifactManifest");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("approves exactly awaiting_approval once under duplicate/concurrent requests", async () => {
    const run = queuedRun("approve");
    claimNextPreview("owner", 60_000);
    transitionOwnedAgentRun(run.id, "owner", "previewing", "awaiting_approval", {
      preview: { company: "Acme", role: "Engineer", location: null, summary: "Role", postingState: "open" }
    });
    const responses = await Promise.all([
      approveRun(new Request("http://localhost"), context(run.id)),
      approveRun(new Request("http://localhost"), context(run.id))
    ]);
    expect(responses.map((item) => item.status).sort()).toEqual([200, 409]);
    expect(getPublicAgentRun(run.id)?.state).toBe("queued_execution");
  });

  it("rejects approval outside awaiting_approval", async () => {
    const run = queuedRun("illegal-approve");
    const response = await approveRun(new Request("http://localhost"), context(run.id));
    expect(response.status).toBe(409);
    expect(await body(response)).toEqual({ error: "Agent run is not awaiting approval." });
  });

  it("returns each mixed approval/cancellation winner's transactional public snapshot", async () => {
    const approvalFirst = queuedRun("approval-first");
    claimNextPreview("approval-first-owner", 60_000);
    transitionOwnedAgentRun(approvalFirst.id, "approval-first-owner", "previewing", "awaiting_approval", {
      preview: { company: "Acme", role: "Engineer", location: null, summary: "Role", postingState: "open" }
    });
    const approvalResponsePromise = approveRun(new Request("http://localhost"), context(approvalFirst.id));
    const cancellationResponsePromise = cancelRun(new Request("http://localhost"), context(approvalFirst.id));
    const approvalResponse = await approvalResponsePromise;
    const cancellationResponse = await cancellationResponsePromise;
    expect(approvalResponse.status).toBe(200);
    expect(approvalResponse.headers.get("cache-control")).toBe("no-store");
    expect(await body(approvalResponse)).toMatchObject({ state: "queued_execution" });
    expect(cancellationResponse.status).toBe(200);
    expect(await body(cancellationResponse)).toMatchObject({ state: "cancelled" });

    const cancellationFirst = queuedRun("cancellation-first");
    claimNextPreview("cancellation-first-owner", 60_000);
    transitionOwnedAgentRun(cancellationFirst.id, "cancellation-first-owner", "previewing", "awaiting_approval", {
      preview: { company: "Acme", role: "Engineer", location: null, summary: "Role", postingState: "open" }
    });
    const cancellationFirstResponsePromise = cancelRun(new Request("http://localhost"), context(cancellationFirst.id));
    const losingApprovalPromise = approveRun(new Request("http://localhost"), context(cancellationFirst.id));
    expect((await cancellationFirstResponsePromise).status).toBe(200);
    expect((await losingApprovalPromise).status).toBe(409);
  });

  it("cancels queued runs immediately and sets a request on active runs", async () => {
    const queued = queuedRun("queued-cancel");
    const immediate = await cancelRun(new Request("http://localhost"), context(queued.id));
    expect(await body(immediate)).toMatchObject({ state: "cancelled", cancellationRequested: true });
    expect(immediate.headers.get("cache-control")).toBe("no-store");

    const active = queuedRun("active-cancel");
    claimNextPreview("active-owner", 60_000);
    const requested = await cancelRun(new Request("http://localhost"), context(active.id));
    expect(await body(requested)).toMatchObject({ state: "previewing", cancellationRequested: true });
  });

  it("rejects terminal and duplicate cancellation with CAS semantics", async () => {
    const run = queuedRun("duplicate-cancel");
    const responses = await Promise.all([
      cancelRun(new Request("http://localhost"), context(run.id)),
      cancelRun(new Request("http://localhost"), context(run.id))
    ]);
    expect(responses.map((item) => item.status).sort()).toEqual([200, 409]);

    const terminal = queuedRun("terminal");
    transitionAgentRun(terminal.id, "queued_preview", "cancelled");
    const response = await cancelRun(new Request("http://localhost"), context(terminal.id));
    expect(response.status).toBe(409);
    expect(await body(response)).toEqual({ error: "Agent run cannot be cancelled." });
  });
});

describe("GET /api/agent-providers", () => {
  it("returns stable codex/claude ordering, defaults, and safe diagnostic shapes", async () => {
    const diagnose = vi.fn(async (_loaded: AgentConfig, provider: AgentProviderName): Promise<ProviderDiagnostic> =>
      provider === "codex"
        ? { available: true, version: "codex 1.2" }
        : { available: false, version: null, error: "Provider executable is unavailable." }
    );
    const response = await createDiagnosticsHandler({ loadConfig: () => config, diagnoseProvider: diagnose })(
      new Request("http://localhost/api/agent-providers")
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await body(response)).toEqual({ providers: [
      { provider: "codex", available: true, version: "codex 1.2", defaultModel: "gpt-5.6-terra" },
      { provider: "claude", available: false, version: null, error: "Provider executable is unavailable.", defaultModel: "sonnet" }
    ] });
  });

  it("projects only allowlisted public diagnostic fields", async () => {
    const response = await createDiagnosticsHandler({
      loadConfig: () => config,
      diagnoseProvider: async () => ({
        available: true,
        version: "safe version",
        executablePath: "/private/bin/provider",
        credentials: "secret"
      } as ProviderDiagnostic)
    })(new Request("http://localhost"));

    const output = JSON.stringify(await body(response));
    expect(output).not.toMatch(/executablePath|credentials|private|secret/);
  });

  it("converts config and thrown diagnostic failures to safe unavailable entries", async () => {
    const failedConfig = await createDiagnosticsHandler({
      loadConfig: () => { throw new Error("credential at /tmp/private"); },
      diagnoseProvider: vi.fn()
    })(new Request("http://localhost"));
    expect(await body(failedConfig)).toEqual({ providers: [
      { provider: "codex", available: false, version: null, error: "Provider executable is unavailable.", defaultModel: "gpt-5.6-terra" },
      { provider: "claude", available: false, version: null, error: "Provider executable is unavailable.", defaultModel: "sonnet" }
    ] });

    const failedDiagnostic = await createDiagnosticsHandler({
      loadConfig: () => config,
      diagnoseProvider: async () => { throw new Error("env=secret stack"); }
    })(new Request("http://localhost"));
    expect(JSON.stringify(await body(failedDiagnostic))).not.toMatch(/secret|stack|executablePath/);
  });
});

describe("route source isolation", () => {
  it("imports no provider adapter, orchestrator, process helper, or worker and launches no model", () => {
    const routeFiles = [
      "src/app/api/agent-runs/route.ts",
      "src/app/api/agent-runs/[id]/route.ts",
      "src/app/api/agent-runs/[id]/approve/route.ts",
      "src/app/api/agent-runs/[id]/cancel/route.ts",
      "src/app/api/agent-providers/route.ts"
    ];
    const source = routeFiles.map((file) => readFileSync(path.resolve(file), "utf8")).join("\n");
    expect(source).not.toMatch(/from\s+["'][^"']*\/(?:providers|orchestrator|process)["']|agent-worker|agent:worker/);
  });

  it("exercises every production handler and permits only exact --version child processes", async () => {
    writeFileSync(path.join(tempDir, "jobtracker.agent.local.json"), JSON.stringify({
      codex: { executablePath: process.execPath, defaultModel: "gpt-5.6-terra" },
      claude: { executablePath: process.execPath, defaultModel: "sonnet" }
    }));
    process.chdir(tempDir);
    childProcessGuard.spawn.mockImplementation((executable, args) => {
      expect(executable).toBe(process.execPath);
      expect(args).toEqual(["--version"]);
      const child = new EventEmitter() as EventEmitter & {
        stdout: PassThrough;
        kill: ReturnType<typeof vi.fn>;
      };
      child.stdout = new PassThrough();
      child.kill = vi.fn();
      queueMicrotask(() => {
        child.stdout.write("provider 1.0\n");
        child.stdout.end();
        child.emit("close", 0);
      });
      return child;
    });

    const queued = await productionPostRun(postRequest({
      jobUrl: "https://93.184.216.34/jobs/production",
      provider: "codex"
    }));
    expect(queued.status).toBe(202);
    const queuedBody = await body(queued);
    const diagnostics = await productionGetDiagnostics(new Request("http://localhost/api/agent-providers"));
    expect(diagnostics.status).toBe(200);
    expect(childProcessGuard.spawn).toHaveBeenCalledTimes(3);
    for (const [, args] of childProcessGuard.spawn.mock.calls) {
      expect(args).toEqual(["--version"]);
      expect(args).not.toContain("--model");
    }

    childProcessGuard.spawn.mockClear();
    const id = String(queuedBody.id);
    await getRun(new Request("http://localhost"), context(id));
    await cancelRun(new Request("http://localhost"), context(id));
    await approveRun(new Request("http://localhost"), context("missing"));
    expect(childProcessGuard.spawn).not.toHaveBeenCalled();
  });
});
