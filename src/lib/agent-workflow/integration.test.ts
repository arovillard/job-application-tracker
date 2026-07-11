import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createSafeSmokeOutput,
  installSmokeSignalHandlers,
  runBestEffortCleanup
} from "../../../scripts/smoke-agent-workflow";
import { POST as approveRun } from "../../app/api/agent-runs/[id]/approve/route";
import { createPostHandler } from "../../app/api/agent-runs/route";
import { getApplicationDetail, resetStorageForTests } from "../storage";
import { processNextAgentRun } from "./orchestrator";
import type { AgentProvider } from "./providers";
import { enqueueAgentRun, getPublicAgentRun, resetAgentRunStorageForTests } from "./storage";

const projectRoot = process.cwd();
const jobUrl = "https://jobs.example.com/platform-engineer";
const preview = {
  company: "Integration Company",
  role: "Platform Engineer",
  location: "Remote",
  summary: "Build reliable developer infrastructure.",
  postingState: "open" as const
};

let root: string;
let dbPath: string;
let applicationsDir: string;
let baseResumePath: string;
let previousEnvironment: Record<string, string | undefined>;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "jobtracker-agent-integration-"));
  dbPath = path.join(root, "data", "tracker.sqlite");
  applicationsDir = path.join(root, "applications");
  baseResumePath = path.join(applicationsDir, "private", "base-resume.md");
  mkdirSync(path.dirname(baseResumePath), { recursive: true });
  writeFileSync(baseResumePath, "# Synthetic Resume\n\nPrivate integration fixture.\n", { mode: 0o600 });
  previousEnvironment = {
    JOBTRACKER_DB_PATH: process.env.JOBTRACKER_DB_PATH,
    JOBTRACKER_APPLICATIONS_DIR: process.env.JOBTRACKER_APPLICATIONS_DIR,
    JOBTRACKER_BASE_RESUME_PATH: process.env.JOBTRACKER_BASE_RESUME_PATH
  };
  process.env.JOBTRACKER_DB_PATH = dbPath;
  process.env.JOBTRACKER_APPLICATIONS_DIR = applicationsDir;
  process.env.JOBTRACKER_BASE_RESUME_PATH = baseResumePath;
  resetAgentRunStorageForTests();
  resetStorageForTests();
});

afterEach(() => {
  resetAgentRunStorageForTests();
  resetStorageForTests();
  for (const [key, value] of Object.entries(previousEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(root, { recursive: true, force: true });
});

function fakeProvider(): AgentProvider {
  return {
    diagnose: async () => ({ available: true, version: "integration-fake 1" }),
    preview: async (request, hooks) => {
      expect(request).toMatchObject({
        jobUrl,
        postingContext: "Integration Company Platform Engineer Build reliable developer infrastructure.",
        postingFinalUrl: jobUrl,
        model: "integration-model",
        resumeContext: `Base resume path: ${baseResumePath}`
      });
      expect(request.signal).toBeInstanceOf(AbortSignal);
      expect(request.signal?.aborted).toBe(false);
      hooks?.onEvent?.({ kind: "progress", message: "Posting reviewed.", metadata: null, usage: null });
      return { preview, usage: { inputTokens: 13, outputTokens: 8 } };
    },
    createMaterials: async (request, hooks) => {
      expect(request).toMatchObject({
        jobUrl,
        model: "integration-model",
        preview,
        resumeContext: `Base resume path: ${baseResumePath}`
      });
      expect(request.signal).toBeInstanceOf(AbortSignal);
      expect(request.signal?.aborted).toBe(false);
      const resume = readFileSync(baseResumePath, "utf8");
      expect(resume).toContain("Private integration fixture.");
      const materialDir = path.join(applicationsDir, "Integration Company", "Platform Engineer");
      const fitPath = path.join(materialDir, "fit-analysis.md");
      const outreachPath = path.join(materialDir, "outreach-message.md");
      mkdirSync(materialDir, { recursive: true });
      writeFileSync(fitPath, `# Fit analysis\n\nStrong platform and reliability alignment.\n\n${resume}`);
      writeFileSync(outreachPath, "# Outreach message\n\nI build reliable developer infrastructure.\n");
      hooks?.onEvent?.({ kind: "progress", message: "Materials created.", metadata: null, usage: null });
      return {
        manifest: [
          { type: "fit_analysis", title: "Fit analysis", filePath: fitPath, contentType: "text/markdown" },
          { type: "outreach_message", title: "Outreach message", filePath: outreachPath, contentType: "text/markdown" }
        ],
        usage: { inputTokens: 21, outputTokens: 34 }
      };
    }
  };
}

function workerDependencies(provider: AgentProvider) {
  return {
    workerId: "integration-worker",
    projectRoot,
    dbPath,
    applicationsDir,
    baseResumePath,
    resumeContext: `Base resume path: ${baseResumePath}`,
    providers: { codex: provider, claude: provider },
    retrievePosting: async (url: string, options?: { onInitialValidated?(): void }) => {
      options?.onInitialValidated?.();
      return {
        requestedUrl: url,
        finalUrl: url,
        context: "Integration Company Platform Engineer Build reliable developer infrastructure."
      };
    },
    leaseDurationMs: 5_000,
    heartbeatIntervalMs: 25,
    commandTimeoutMs: 10_000
  };
}

function routeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("full agent workflow integration", () => {
  it("previews without mutation, then approves, executes real host scripts, and exposes verified safe artifacts", async () => {
    const provider = fakeProvider();
    const enqueue = createPostHandler({
      loadConfig: () => ({
        codex: { executablePath: "codex", defaultModel: "integration-model" },
        claude: { executablePath: "claude", defaultModel: "integration-model" }
      }),
      resolveModel: (_config, _provider, override) => override ?? "integration-model",
      validateJobUrl: async (input) => {
        expect(input).toBe(jobUrl);
        return jobUrl;
      },
      diagnoseProvider: async () => ({ available: true, version: "integration-fake 1" }),
      enqueueRun: enqueueAgentRun
    });

    const enqueueResponse = await enqueue(new Request("http://localhost/api/agent-runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobUrl, provider: "codex", model: "integration-model" })
    }));
    expect(enqueueResponse.status).toBe(202);
    const queued = await enqueueResponse.json() as { id: string; state: string };
    expect(queued.state).toBe("queued_preview");

    await expect(processNextAgentRun(workerDependencies(provider))).resolves.toBe(true);
    const awaiting = getPublicAgentRun(queued.id);
    expect(awaiting).toMatchObject({
      state: "awaiting_approval",
      canonicalJobUrl: jobUrl,
      model: "integration-model",
      preview,
      applicationId: null,
      artifactLinks: [],
      usage: { inputTokens: 13, outputTokens: 8 }
    });
    expect(existsSync(dbPath)).toBe(true);
    const beforeApproval = new Database(dbPath, { readonly: true });
    expect(beforeApproval.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'applications'").get()).toBeUndefined();
    beforeApproval.close();

    const approvalResponse = await approveRun(
      new Request(`http://localhost/api/agent-runs/${queued.id}/approve`, { method: "POST" }),
      routeContext(queued.id)
    );
    expect(approvalResponse.status).toBe(200);
    expect(await approvalResponse.json()).toMatchObject({ id: queued.id, state: "queued_execution" });

    await expect(processNextAgentRun(workerDependencies(provider))).resolves.toBe(true);
    const completed = getPublicAgentRun(queued.id);
    expect(completed).toMatchObject({
      state: "succeeded",
      preview,
      applicationId: expect.any(String),
      usage: { inputTokens: 21, outputTokens: 34 }
    });
    expect(completed?.artifactLinks).toHaveLength(2);
    expect(completed?.artifactLinks.map(({ type }) => type)).toEqual(["fit_analysis", "outreach_message"]);

    const applicationId = completed?.applicationId as string;
    const detail = getApplicationDetail(applicationId);
    expect(detail).toMatchObject({
      id: applicationId,
      company: preview.company,
      role: preview.role,
      location: preview.location,
      url: jobUrl,
      summary: preview.summary,
      status: "wishlist"
    });
    expect(detail?.notes).toHaveLength(1);
    expect(detail?.artifacts).toHaveLength(2);

    const canonicalRoot = `${realpathSync(applicationsDir)}${path.sep}`;
    for (const artifact of detail?.artifacts ?? []) {
      expect(statSync(artifact.filePath).isFile()).toBe(true);
      expect(`${realpathSync(artifact.filePath)}${path.sep}`.startsWith(canonicalRoot)).toBe(true);
      const content = readFileSync(artifact.filePath, "utf8");
      expect(content).toMatch(/^# (Fit analysis|Outreach message)/);
      if (artifact.type === "fit_analysis") expect(content).toContain("Private integration fixture.");
      const link = completed?.artifactLinks.find(({ id }) => id === artifact.id);
      expect(link?.href).toBe(`/api/applications/${applicationId}/artifacts/${artifact.id}/file`);
    }

    const db = new Database(dbPath, { readonly: true });
    expect(db.prepare("SELECT COUNT(*) AS count FROM application_artifacts WHERE application_id = ?").get(applicationId)).toEqual({ count: 2 });
    db.close();

    const publicText = JSON.stringify({ events: completed?.events, links: completed?.artifactLinks });
    expect(publicText).not.toContain(root);
    expect(publicText).not.toContain(applicationsDir);
    expect(publicText).not.toContain(baseResumePath);
    expect(completed?.events.map(({ message }) => message)).toEqual(expect.arrayContaining([
      "Run queued for preview.",
      "Preview ready for approval.",
      "Application materials completed."
    ]));

    expect(existsSync(path.join(projectRoot, "scripts", "smoke-agent-workflow.ts"))).toBe(true);
  });

  it("redacts provider preview secrets, controls, and every private temp fragment before stdout", () => {
    const writes: string[] = [];
    const output = createSafeSmokeOutput({
      write: (value) => writes.push(value),
      forbiddenFragments: [root, dbPath, applicationsDir, baseResumePath]
    });

    const emitted = output.emit("preview", {
      company: `Company ${root} OPENAI_API_KEY=sk-projectsecret123`,
      role: `Role Bearer bearer-secret-123`,
      location: `${applicationsDir}\u0000password: hunter2`,
      summary: `${baseResumePath}; GITHUB_TOKEN=ghp_1234567890; token: abcdefghijk`,
      nested: [{ title: `${dbPath}\nsecret=value123` }]
    });

    const serialized = JSON.stringify(emitted);
    expect(serialized).toContain("[REDACTED]");
    for (const fragment of [root, dbPath, applicationsDir, baseResumePath]) {
      expect(serialized).not.toContain(fragment);
      expect(writes.join("")).not.toContain(fragment);
    }
    expect(writes.join("")).not.toMatch(/projectsecret|bearer-secret|hunter2|ghp_1234567890|abcdefghijk|value123/);
    expect(writes.join("")).not.toContain("\\u0000");
  });

  it("attempts every cleanup step even when earlier steps throw", () => {
    const calls: string[] = [];
    const cleaned = runBestEffortCleanup([
      () => { calls.push("agent-cache"); throw new Error("private cache error"); },
      () => calls.push("application-cache"),
      () => { calls.push("environment"); throw new Error("private environment error"); },
      () => calls.push("temporary-root")
    ]);

    expect(cleaned).toBe(false);
    expect(calls).toEqual(["agent-cache", "application-cache", "environment", "temporary-root"]);
  });

  it.each([
    ["SIGINT", 130],
    ["SIGTERM", 143]
  ] as const)("aborts active work and records the conventional %s exit code", (signal, exitCode) => {
    const listeners = new Map<string, () => void>();
    const source = {
      once: vi.fn((name: NodeJS.Signals, handler: () => void) => { listeners.set(name, handler); }),
      off: vi.fn((name: NodeJS.Signals) => { listeners.delete(name); })
    };
    const controller = new AbortController();
    const installed = installSmokeSignalHandlers(controller, source);

    listeners.get(signal)?.();

    expect(controller.signal.aborted).toBe(true);
    expect(installed.exitCode()).toBe(exitCode);
    installed.dispose();
    expect(source.off).toHaveBeenCalledTimes(2);
  });
});
