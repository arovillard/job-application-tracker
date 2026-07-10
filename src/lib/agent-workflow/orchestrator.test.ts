import { spawn as nodeSpawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AgentProvider } from "./providers";
import { JsonCommandError, runJsonCommand, type JsonCommandSpawn } from "./process";
import {
  approveAgentRun,
  claimNextPreview,
  createAgentRun,
  getAgentRun,
  getPublicAgentRun,
  requestAgentRunCancellation,
  resetAgentRunStorageForTests
} from "./storage";
import { processNextAgentRun, runAgentWorker } from "./orchestrator";

let root: string;
let dbPath: string;
let applicationsDir: string;

const preview = {
  company: "Acme",
  role: "Platform Engineer",
  location: "Remote",
  summary: "Build reliable infrastructure.",
  postingState: "open" as const
};

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "jobtracker-orchestrator-"));
  dbPath = path.join(root, "tracker.sqlite");
  applicationsDir = path.join(root, "applications");
  mkdirSync(applicationsDir, { recursive: true });
  process.env.JOBTRACKER_DB_PATH = dbPath;
});

afterEach(() => {
  resetAgentRunStorageForTests();
  delete process.env.JOBTRACKER_DB_PATH;
  rmSync(root, { recursive: true, force: true });
});

function provider(): AgentProvider {
  return {
    diagnose: async () => ({ available: true, version: "test" }),
    preview: async () => ({ preview, usage: { inputTokens: 10 } }),
    createMaterials: async () => {
      const filePath = path.join(applicationsDir, "Acme", "fit-analysis.md");
      mkdirSync(path.dirname(filePath), { recursive: true });
      writeFileSync(filePath, "# Fit analysis\n");
      return {
        manifest: [
          {
            type: "fit_analysis",
            title: "Fit analysis",
            filePath,
            contentType: "text/markdown"
          }
        ],
        usage: { outputTokens: 20 }
      };
    }
  };
}

function dependencies(fakeProvider = provider()) {
  return {
    workerId: "worker-test",
    projectRoot: process.cwd(),
    dbPath,
    applicationsDir,
    providers: { codex: fakeProvider, claude: fakeProvider },
    leaseDurationMs: 5_000,
    heartbeatIntervalMs: 25,
    commandTimeoutMs: 10_000
  };
}

describe("agent workflow orchestration", () => {
  it("previews without mutation, then upserts, verifies, registers, and exposes safe links", async () => {
    const run = createAgentRun({
      provider: "codex",
      model: "gpt-5.6-terra",
      canonicalJobUrl: "https://jobs.example.com/platform-engineer"
    });

    await expect(processNextAgentRun(dependencies())).resolves.toBe(true);
    expect(getAgentRun(run.id)).toMatchObject({
      state: "awaiting_approval",
      preview,
      usage: { inputTokens: 10 }
    });
    const beforeApproval = new Database(dbPath, { readonly: true });
    expect(
      beforeApproval.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'applications'").get()
    ).toBeUndefined();
    beforeApproval.close();

    expect(approveAgentRun(run.id)?.state).toBe("queued_execution");
    await expect(processNextAgentRun(dependencies())).resolves.toBe(true);

    const completed = getPublicAgentRun(run.id)!;
    expect(completed.state).toBe("succeeded");
    expect(completed.applicationId).toEqual(expect.any(String));
    expect(completed.artifactLinks).toEqual([
      expect.objectContaining({ id: expect.any(String), type: "fit_analysis", title: "Fit analysis" })
    ]);
    expect(completed.artifactLinks[0].href).toBe(
      `/api/applications/${completed.applicationId}/artifacts/${completed.artifactLinks[0].id}/file`
    );

    const db = new Database(dbPath, { readonly: true });
    expect(db.prepare("SELECT company, role, url, status FROM applications").get()).toEqual({
      company: preview.company,
      role: preview.role,
      url: run.canonicalJobUrl,
      status: "wishlist"
    });
    expect(db.prepare("SELECT COUNT(*) AS count FROM application_notes").get()).toEqual({ count: 1 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM application_artifacts").get()).toEqual({ count: 1 });
    db.close();
  });

  it("fails before registration when the manifest contains duplicate entries", async () => {
    const fake = provider();
    fake.createMaterials = async () => {
      const filePath = path.join(applicationsDir, "duplicate.md");
      writeFileSync(filePath, "duplicate");
      const entry = { type: "fit_analysis" as const, title: "Fit", filePath, contentType: "text/markdown" };
      return { manifest: [entry, entry], usage: null };
    };
    const run = createAgentRun({ provider: "codex", model: "model", canonicalJobUrl: "https://jobs.example.com/a" });
    await processNextAgentRun(dependencies(fake));
    approveAgentRun(run.id);

    await processNextAgentRun(dependencies(fake));

    expect(getAgentRun(run.id)).toMatchObject({ state: "failed", failureCode: "artifact_reconciliation_failed" });
    const db = new Database(dbPath, { readonly: true });
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'application_artifacts'").get()).toBeUndefined();
    db.close();
  });

  it.each(["missing", "wrong-extension", "wrong-type", "traversal", "symlink"] as const)(
    "fails reconciliation for a %s artifact before registration",
    async (scenario) => {
      const fake = provider();
      fake.createMaterials = async () => {
        const outside = path.join(root, "outside.md");
        writeFileSync(outside, "outside");
        let filePath = path.join(applicationsDir, "candidate.md");
        if (scenario === "wrong-extension") {
          filePath = path.join(applicationsDir, "candidate.pdf");
          writeFileSync(filePath, "wrong");
        } else if (scenario === "traversal") {
          filePath = "../outside.md";
        } else if (scenario === "symlink") {
          symlinkSync(outside, filePath);
        }
        if (scenario === "wrong-type") writeFileSync(filePath, "wrong type");
        return {
          manifest: [{
            type: scenario === "wrong-type" ? "resume" : "fit_analysis",
            title: "Fit",
            filePath,
            contentType: "text/markdown"
          }],
          usage: null
        };
      };
      const run = createAgentRun({ provider: "codex", model: "model", canonicalJobUrl: `https://jobs.example.com/${scenario}` });
      await processNextAgentRun(dependencies(fake));
      approveAgentRun(run.id);

      await processNextAgentRun(dependencies(fake));

      expect(getAgentRun(run.id)).toMatchObject({ state: "failed", failureCode: "artifact_reconciliation_failed" });
    }
  );

  it("rejects tampered upsert output before invoking the materials provider", async () => {
    const fake = provider();
    let materialsCalled = false;
    fake.createMaterials = async () => {
      materialsCalled = true;
      return { manifest: [], usage: null };
    };
    const spawn: JsonCommandSpawn = (command, args, options) => {
      if (args[0]?.endsWith("upsert-job-posting.mjs")) {
        return nodeSpawn(command, ["-e", "process.stdout.write(JSON.stringify({action:'created'}))"], options as never) as never;
      }
      return nodeSpawn(command, [...args], options as never) as never;
    };
    const run = createAgentRun({ provider: "codex", model: "model", canonicalJobUrl: "https://jobs.example.com/tampered" });
    await processNextAgentRun(dependencies(fake));
    approveAgentRun(run.id);

    await processNextAgentRun({ ...dependencies(fake), spawn });

    expect(materialsCalled).toBe(false);
    expect(getAgentRun(run.id)).toMatchObject({ state: "failed", failureCode: "upsert_output_invalid" });
  });

  it("rejects a plausible upsert result when independent SQLite readback is absent", async () => {
    const fake = provider();
    let materialsCalled = false;
    fake.createMaterials = async () => {
      materialsCalled = true;
      return { manifest: [], usage: null };
    };
    const run = createAgentRun({ provider: "codex", model: "model", canonicalJobUrl: "https://jobs.example.com/readback" });
    await processNextAgentRun(dependencies(fake));
    approveAgentRun(run.id);
    const output = {
      action: "created",
      application: { id: "fake-id", company: preview.company, role: preview.role, url: run.canonicalJobUrl, status: "wishlist" },
      changes: ["created new application record"],
      noteIds: ["fake-note"]
    };
    const spawn: JsonCommandSpawn = (command, args, options) => nodeSpawn(
      command,
      ["-e", `process.stdout.write(${JSON.stringify(JSON.stringify(output))})`],
      options as never
    ) as never;

    await processNextAgentRun({ ...dependencies(fake), spawn });

    expect(materialsCalled).toBe(false);
    expect(getAgentRun(run.id)).toMatchObject({ state: "failed", failureCode: "upsert_readback_invalid" });
  });

  it("cooperatively cancels an active provider phase", async () => {
    const fake = provider();
    fake.preview = ({ signal }) => new Promise((_, reject) => {
      signal!.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
    const run = createAgentRun({ provider: "codex", model: "model", canonicalJobUrl: "https://jobs.example.com/cancel" });
    const processing = processNextAgentRun(dependencies(fake));
    setTimeout(() => requestAgentRunCancellation(run.id), 5);

    await processing;

    expect(getAgentRun(run.id)).toMatchObject({ state: "cancelled", cancellationRequested: true });
  });

  it("creates no application when cancellation happens before execution is claimed", async () => {
    const run = createAgentRun({ provider: "codex", model: "model", canonicalJobUrl: "https://jobs.example.com/cancel-before" });
    await processNextAgentRun(dependencies());
    approveAgentRun(run.id);
    requestAgentRunCancellation(run.id);

    await expect(processNextAgentRun(dependencies())).resolves.toBe(false);

    expect(getAgentRun(run.id)?.state).toBe("cancelled");
    const db = new Database(dbPath, { readonly: true });
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'applications'").get()).toBeUndefined();
    db.close();
  });

  it("interrupts active work when heartbeat ownership is lost", async () => {
    const fake = provider();
    fake.preview = ({ signal }) => new Promise((_, reject) => {
      signal!.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
    const run = createAgentRun({ provider: "codex", model: "model", canonicalJobUrl: "https://jobs.example.com/lease" });
    const processing = processNextAgentRun(dependencies(fake));
    setTimeout(() => {
      const db = new Database(dbPath);
      db.prepare("UPDATE agent_runs SET worker_id = 'stolen-worker' WHERE id = ?").run(run.id);
      db.close();
    }, 5);

    await processing;

    expect(getAgentRun(run.id)?.state).toBe("interrupted");
  });

  it("recovers abandoned work once on worker startup and does not retry it", async () => {
    const run = createAgentRun({ provider: "codex", model: "model", canonicalJobUrl: "https://jobs.example.com/restart" });
    claimNextPreview("abandoned-worker", 60_000);
    const controller = new AbortController();
    controller.abort();

    await runAgentWorker({ ...dependencies(), signal: controller.signal, pollIntervalMs: 5 });

    expect(getAgentRun(run.id)?.state).toBe("interrupted");
    expect(getAgentRun(run.id)?.preview).toBeNull();
  });
});

describe("shell-free JSON command runner", () => {
  it("waits for child close when cancellation terminates a running command", async () => {
    const controller = new AbortController();
    const command = runJsonCommand(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      {},
      { cwd: process.cwd(), signal: controller.signal, timeoutMs: 5_000 }
    );
    setTimeout(() => controller.abort(), 20);

    await expect(command).rejects.toMatchObject({ code: "command_cancelled" } satisfies Partial<JsonCommandError>);
  });
});
