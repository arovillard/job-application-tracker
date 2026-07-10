import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentConfig, ProviderDiagnostic } from "../../../lib/agent-workflow/config";
import {
  claimNextPreview,
  createAgentRun,
  getPublicAgentRun,
  resetAgentRunStorageForTests,
  transitionAgentRun,
  transitionOwnedAgentRun
} from "../../../lib/agent-workflow/storage";
import type { AgentProviderName, AgentRun } from "../../../lib/agent-workflow/types";
import { createPostHandler } from "./route";
import { GET as getRun } from "./[id]/route";
import { POST as approveRun } from "./[id]/approve/route";
import { POST as cancelRun } from "./[id]/cancel/route";
import { createDiagnosticsHandler } from "../agent-providers/route";

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
  const createRun = vi.fn((): AgentRun => ({
    ...publicRun,
    artifactManifest: null,
    workerId: null,
    leaseExpiresAt: null
  }));
  const appendEvent = vi.fn();
  const getPublicRun = vi.fn(() => ({
    ...publicRun,
    events: appendEvent.mock.calls.length
      ? [{ id: "event-1", runId: "run-1", sequence: 1, kind: "status" as const, message: "Run queued for preview.", metadata: null, createdAt: publicRun.createdAt }]
      : []
  }));
  return {
    loadConfig: vi.fn(() => config),
    resolveModel: vi.fn((loaded: AgentConfig, provider: AgentProviderName, model?: string) =>
      model ?? loaded[provider].defaultModel
    ),
    validateJobUrl: vi.fn(async () => "https://jobs.example.com/role"),
    diagnoseProvider: vi.fn(async () => diagnostic),
    createRun,
    appendEvent,
    getPublicRun
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
    expect(deps.diagnoseProvider).toHaveBeenCalledOnce();
    expect(deps.diagnoseProvider).toHaveBeenCalledWith(config, "codex");
    expect(deps.createRun).toHaveBeenCalledWith({
      provider: "codex",
      model: "gpt-5.6-terra",
      canonicalJobUrl: "https://jobs.example.com/role"
    });
    expect(deps.appendEvent).toHaveBeenCalledWith("run-1", {
      kind: "status",
      message: "Run queued for preview."
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
    expect(deps.createRun).not.toHaveBeenCalled();
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
    expect(deps.createRun).not.toHaveBeenCalled();
  });

  it("returns 409 and stores nothing when the selected executable is unavailable", async () => {
    const deps = postDependencies({ available: false, version: null, error: "Provider executable is unavailable." });
    const response = await createPostHandler(deps)(
      postRequest({ jobUrl: "https://jobs.example.com/role", provider: "claude" })
    );
    expect(response.status).toBe(409);
    expect(await body(response)).toEqual({ error: "Provider executable is unavailable." });
    expect(deps.createRun).not.toHaveBeenCalled();
  });

  it("never exposes arbitrary config, URL, diagnostic, or storage exceptions", async () => {
    for (const key of ["loadConfig", "validateJobUrl", "diagnoseProvider", "createRun"] as const) {
      const deps = postDependencies();
      (deps[key] as ReturnType<typeof vi.fn>).mockRejectedValue?.(new Error("secret=/tmp/token"));
      if (key === "loadConfig" || key === "createRun") {
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

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "jobtracker-route-"));
  process.env.JOBTRACKER_DB_PATH = path.join(tempDir, "test.sqlite");
});

afterEach(() => {
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

  it("cancels queued runs immediately and sets a request on active runs", async () => {
    const queued = queuedRun("queued-cancel");
    const immediate = await cancelRun(new Request("http://localhost"), context(queued.id));
    expect(await body(immediate)).toMatchObject({ state: "cancelled", cancellationRequested: true });

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
    expect(await body(response)).toEqual({ providers: [
      { provider: "codex", available: true, version: "codex 1.2", defaultModel: "gpt-5.6-terra" },
      { provider: "claude", available: false, version: null, error: "Provider executable is unavailable.", defaultModel: "sonnet" }
    ] });
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
    expect(source).not.toMatch(/spawn\s*\(|exec(File)?\s*\(|--model|runPreview|runMaterials/);
  });
});
