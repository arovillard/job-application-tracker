import { spawn as nodeSpawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";

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
  interruptOwnedAgentRun,
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

async function queueApprovedRun(url: string, fakeProvider = provider()) {
  const run = createAgentRun({ provider: "codex", model: "model", canonicalJobUrl: url });
  await processNextAgentRun(dependencies(fakeProvider));
  approveAgentRun(run.id);
  return run;
}

async function waitFor(predicate: () => boolean) {
  for (let index = 0; index < 100; index += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for test condition");
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

  it("uses exact upsert and registration command boundaries", async () => {
    const calls: Array<{ command: string; args: readonly string[]; options: Parameters<JsonCommandSpawn>[2]; input: string }> = [];
    const spawn: JsonCommandSpawn = (command, args, options) => {
      const child = nodeSpawn(command, [...args], options as never);
      const originalEnd = child.stdin.end.bind(child.stdin);
      child.stdin.end = ((chunk?: unknown, ...rest: unknown[]) => {
        calls.push({ command, args: [...args], options, input: String(chunk ?? "") });
        return originalEnd(chunk as never, ...(rest as []));
      }) as typeof child.stdin.end;
      return child as never;
    };
    const run = await queueApprovedRun("https://jobs.example.com/exact-boundary");

    await processNextAgentRun({ ...dependencies(), spawn });

    expect(getAgentRun(run.id)?.state).toBe("succeeded");
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      command: process.execPath,
      args: [path.join(process.cwd(), "scripts", "upsert-job-posting.mjs"), "--input-json", "-", "--reactivate"],
      options: { cwd: process.cwd(), shell: false, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, env: { JOBTRACKER_DB_PATH: dbPath } }
    });
    expect(JSON.parse(calls[0].input)).toMatchObject({
      company: preview.company,
      role: preview.role,
      url: run.canonicalJobUrl,
      note: expect.stringContaining(run.id)
    });
    expect(calls[1].args).toEqual([
      path.join(process.cwd(), "scripts", "register-application-artifact.mjs"),
      "--db", dbPath,
      "--application-id", getAgentRun(run.id)?.applicationId,
      "--type", "fit_analysis",
      "--title", "Fit analysis",
      "--file", realpathSync(path.join(applicationsDir, "Acme", "fit-analysis.md")),
      "--content-type", "text/markdown"
    ]);
    expect(calls[1].input).toBe("{}");
  });

  it("rejects stale plausible audit evidence before materials", async () => {
    const first = await queueApprovedRun("https://jobs.example.com/stale-evidence");
    await processNextAgentRun(dependencies());
    const db = new Database(dbPath, { readonly: true });
    const application = db.prepare("SELECT id, company, role, url, status FROM applications").get() as Record<string, unknown>;
    const note = db.prepare("SELECT id FROM application_notes LIMIT 1").get() as { id: string };
    db.close();
    const fake = provider();
    let materialsCalled = false;
    fake.createMaterials = async () => {
      materialsCalled = true;
      return { manifest: [], usage: null };
    };
    const second = await queueApprovedRun(first.canonicalJobUrl, fake);
    const stale = { action: "updated", application, changes: [], noteIds: [note.id] };
    const spawn: JsonCommandSpawn = (command, _args, options) => nodeSpawn(
      command,
      ["-e", `process.stdin.resume();process.stdin.on('end',()=>process.stdout.write(${JSON.stringify(JSON.stringify(stale))}))`],
      options as never
    ) as never;

    await processNextAgentRun({ ...dependencies(fake), spawn });

    expect(materialsCalled).toBe(false);
    expect(getAgentRun(second.id)).toMatchObject({ state: "failed", failureCode: "upsert_readback_invalid" });
  });

  it("prevalidates the full manifest before making any registration call", async () => {
    const fake = provider();
    fake.createMaterials = async () => {
      const valid = path.join(applicationsDir, "valid.md");
      writeFileSync(valid, "valid");
      return { manifest: [
        { type: "fit_analysis", title: "Fit", filePath: valid, contentType: "text/markdown" },
        { type: "cover_letter", title: "Broken", filePath: path.join(applicationsDir, "missing.md"), contentType: "text/markdown" }
      ], usage: null };
    };
    let registrations = 0;
    const spawn: JsonCommandSpawn = (command, args, options) => {
      if (args[0]?.endsWith("register-application-artifact.mjs")) registrations += 1;
      return nodeSpawn(command, [...args], options as never) as never;
    };
    const run = await queueApprovedRun("https://jobs.example.com/prevalidate", fake);

    await processNextAgentRun({ ...dependencies(fake), spawn });

    expect(registrations).toBe(0);
    expect(getAgentRun(run.id)).toMatchObject({ state: "failed", failureCode: "artifact_reconciliation_failed" });
  });

  it("rejects tampered registration output", async () => {
    const spawn: JsonCommandSpawn = (command, args, options) => {
      if (!args[0]?.endsWith("register-application-artifact.mjs")) return nodeSpawn(command, [...args], options as never) as never;
      return nodeSpawn(command, ["-e", "process.stdin.resume();process.stdin.on('end',()=>process.stdout.write(JSON.stringify({action:'tampered'})))"], options as never) as never;
    };
    const run = await queueApprovedRun("https://jobs.example.com/registration-output");

    await processNextAgentRun({ ...dependencies(), spawn });

    expect(getAgentRun(run.id)).toMatchObject({ state: "failed", failureCode: "artifact_registration_invalid" });
  });

  it("rejects plausible registration output without exact SQLite readback", async () => {
    const spawn: JsonCommandSpawn = (command, args, options) => {
      if (!args[0]?.endsWith("register-application-artifact.mjs")) return nodeSpawn(command, [...args], options as never) as never;
      const applicationId = args[args.indexOf("--application-id") + 1];
      const filePath = args[args.indexOf("--file") + 1];
      const now = new Date().toISOString();
      const output = {
        action: "registered",
        artifact: {
          id: "missing-artifact",
          applicationId,
          type: "fit_analysis",
          title: "Fit analysis",
          filePath,
          contentType: "text/markdown",
          createdAt: now,
          updatedAt: now
        }
      };
      return nodeSpawn(command, ["-e", `process.stdin.resume();process.stdin.on('end',()=>process.stdout.write(${JSON.stringify(JSON.stringify(output))}))`], options as never) as never;
    };
    const run = await queueApprovedRun("https://jobs.example.com/registration-readback");

    await processNextAgentRun({ ...dependencies(), spawn });

    expect(getAgentRun(run.id)).toMatchObject({ state: "failed", failureCode: "artifact_registration_readback_invalid" });
  });

  it("compensates a successful first registration when a later registration fails", async () => {
    const fake = provider();
    fake.createMaterials = async () => {
      const first = path.join(applicationsDir, "first.md");
      const second = path.join(applicationsDir, "second.md");
      writeFileSync(first, "first");
      writeFileSync(second, "second");
      return { manifest: [
        { type: "fit_analysis", title: "First", filePath: first, contentType: "text/markdown" },
        { type: "cover_letter", title: "Second", filePath: second, contentType: "text/markdown" }
      ], usage: null };
    };
    let registrations = 0;
    let timestampBeforeRegistration = "";
    const spawn: JsonCommandSpawn = (command, args, options) => {
      if (!args[0]?.endsWith("register-application-artifact.mjs")) return nodeSpawn(command, [...args], options as never) as never;
      registrations += 1;
      if (registrations === 1) {
        const db = new Database(dbPath, { readonly: true });
        timestampBeforeRegistration = (db.prepare("SELECT updated_at FROM applications").get() as { updated_at: string }).updated_at;
        db.close();
        return nodeSpawn(command, [...args], options as never) as never;
      }
      return nodeSpawn(command, ["-e", "process.stdin.resume();process.stdin.on('end',()=>{process.stderr.write('no');process.exit(1)})"], options as never) as never;
    };
    const run = await queueApprovedRun("https://jobs.example.com/compensate", fake);

    await processNextAgentRun({ ...dependencies(fake), spawn });

    expect(getAgentRun(run.id)).toMatchObject({ state: "failed", failureCode: "artifact_reconciliation_failed" });
    const db = new Database(dbPath, { readonly: true });
    expect(db.prepare("SELECT COUNT(*) AS count FROM application_artifacts").get()).toEqual({ count: 0 });
    expect((db.prepare("SELECT updated_at FROM applications").get() as { updated_at: string }).updated_at).toBe(timestampBeforeRegistration);
    db.close();
  });

  it("cancels and compensates while a registration child is running", async () => {
    const fake = provider();
    fake.createMaterials = async () => {
      const first = path.join(applicationsDir, "cancel-first.md");
      const second = path.join(applicationsDir, "cancel-second.md");
      writeFileSync(first, "first");
      writeFileSync(second, "second");
      return { manifest: [
        { type: "fit_analysis", title: "First", filePath: first, contentType: "text/markdown" },
        { type: "cover_letter", title: "Second", filePath: second, contentType: "text/markdown" }
      ], usage: null };
    };
    let registrations = 0;
    let secondRunning = false;
    const spawn: JsonCommandSpawn = (command, args, options) => {
      if (!args[0]?.endsWith("register-application-artifact.mjs")) return nodeSpawn(command, [...args], options as never) as never;
      registrations += 1;
      if (registrations === 1) return nodeSpawn(command, [...args], options as never) as never;
      secondRunning = true;
      return nodeSpawn(command, ["-e", "process.stdin.resume();setInterval(()=>{},1000)"], options as never) as never;
    };
    const run = await queueApprovedRun("https://jobs.example.com/cancel-register", fake);
    const processing = processNextAgentRun({ ...dependencies(fake), spawn });
    await waitFor(() => secondRunning);
    requestAgentRunCancellation(run.id);

    await processing;

    expect(getAgentRun(run.id)?.state).toBe("cancelled");
    const db = new Database(dbPath, { readonly: true });
    expect(db.prepare("SELECT COUNT(*) AS count FROM application_artifacts").get()).toEqual({ count: 0 });
    db.close();
  });

  it("compensates registrations when the exact execution lease is lost later", async () => {
    const fake = provider();
    fake.createMaterials = async () => {
      const first = path.join(applicationsDir, "lease-first.md");
      const second = path.join(applicationsDir, "lease-second.md");
      writeFileSync(first, "first");
      writeFileSync(second, "second");
      return { manifest: [
        { type: "fit_analysis", title: "First", filePath: first, contentType: "text/markdown" },
        { type: "cover_letter", title: "Second", filePath: second, contentType: "text/markdown" }
      ], usage: null };
    };
    let registrations = 0;
    const spawn: JsonCommandSpawn = (command, args, options) => {
      if (!args[0]?.endsWith("register-application-artifact.mjs")) return nodeSpawn(command, [...args], options as never) as never;
      registrations += 1;
      if (registrations === 2) {
        const db = new Database(dbPath);
        db.prepare("UPDATE agent_worker_leases SET worker_id = 'replacement'").run();
        db.close();
      }
      return nodeSpawn(command, [...args], options as never) as never;
    };
    const run = await queueApprovedRun("https://jobs.example.com/lease-compensation", fake);

    await processNextAgentRun({ ...dependencies(fake), spawn });

    expect(getAgentRun(run.id)).toMatchObject({ state: "verifying", workerId: "worker-test" });
    const db = new Database(dbPath, { readonly: true });
    expect(db.prepare("SELECT COUNT(*) AS count FROM application_artifacts").get()).toEqual({ count: 0 });
    db.close();
  });

  it("restores preexisting affected artifacts and preserves unrelated rows", async () => {
    const initial = await queueApprovedRun("https://jobs.example.com/preserve");
    await processNextAgentRun(dependencies());
    const initialRun = getAgentRun(initial.id)!;
    const db = new Database(dbPath);
    const original = db.prepare("SELECT * FROM application_artifacts WHERE id = ?").get(initialRun.artifactLinks[0].id);
    db.prepare(`
      INSERT INTO application_artifacts (
        id, application_id, type, title, file_path, content_type, created_at, updated_at
      ) VALUES ('unrelated-id', ?, 'other', 'Unrelated', ?, 'text/markdown', ?, ?)
    `).run(initialRun.applicationId, path.join(applicationsDir, "unrelated.md"), "2020-01-01T00:00:00.000Z", "2020-01-01T00:00:00.000Z");
    db.close();

    const fake = provider();
    fake.createMaterials = async () => {
      const affected = path.join(applicationsDir, "Acme", "fit-analysis.md");
      const failing = path.join(applicationsDir, "later.md");
      writeFileSync(affected, "changed");
      writeFileSync(failing, "later");
      return { manifest: [
        { type: "fit_analysis", title: "Changed title", filePath: affected, contentType: "text/markdown" },
        { type: "cover_letter", title: "Later", filePath: failing, contentType: "text/markdown" }
      ], usage: null };
    };
    let registrations = 0;
    const spawn: JsonCommandSpawn = (command, args, options) => {
      if (!args[0]?.endsWith("register-application-artifact.mjs")) return nodeSpawn(command, [...args], options as never) as never;
      registrations += 1;
      if (registrations === 1) return nodeSpawn(command, [...args], options as never) as never;
      return nodeSpawn(command, ["-e", "process.stdin.resume();process.stdin.on('end',()=>process.exit(1))"], options as never) as never;
    };
    const retry = await queueApprovedRun(initial.canonicalJobUrl, fake);

    await processNextAgentRun({ ...dependencies(fake), spawn });

    expect(getAgentRun(retry.id)?.state).toBe("failed");
    const readback = new Database(dbPath, { readonly: true });
    expect(readback.prepare("SELECT * FROM application_artifacts WHERE id = ?").get(initialRun.artifactLinks[0].id)).toEqual(original);
    expect(readback.prepare("SELECT title FROM application_artifacts WHERE id = 'unrelated-id'").get()).toEqual({ title: "Unrelated" });
    readback.close();
  });

  it("cancels while the upsert child is running", async () => {
    let upsertRunning = false;
    const spawn: JsonCommandSpawn = (command, _args, options) => {
      upsertRunning = true;
      return nodeSpawn(command, ["-e", "process.stdin.resume();setInterval(()=>{},1000)"], options as never) as never;
    };
    const run = await queueApprovedRun("https://jobs.example.com/cancel-upsert");
    const processing = processNextAgentRun({ ...dependencies(), spawn });
    await waitFor(() => upsertRunning);
    requestAgentRunCancellation(run.id);

    await processing;

    expect(getAgentRun(run.id)?.state).toBe("cancelled");
  });

  it("does not publish execution completion after the exact global lease is lost", async () => {
    const fake = provider();
    fake.createMaterials = async () => {
      const filePath = path.join(applicationsDir, "lost.md");
      writeFileSync(filePath, "lost");
      const db = new Database(dbPath);
      db.prepare("UPDATE agent_worker_leases SET worker_id = 'replacement'").run();
      db.close();
      return { manifest: [{ type: "fit_analysis", title: "Lost", filePath, contentType: "text/markdown" }], usage: null };
    };
    const run = await queueApprovedRun("https://jobs.example.com/lost-completion", fake);

    await processNextAgentRun(dependencies(fake));

    expect(getAgentRun(run.id)).toMatchObject({ state: "executing", workerId: "worker-test" });
    expect(getPublicAgentRun(run.id)?.events.map((event) => event.message)).not.toContain("Application materials completed.");
    expect(interruptOwnedAgentRun(run.id, "worker-test")).toBe(false);
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

  it("does not falsely interrupt work after ownership is replaced", async () => {
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

    expect(getAgentRun(run.id)).toMatchObject({ state: "previewing", workerId: "stolen-worker" });
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
  it("bounds input, output, and runtime", async () => {
    await expect(runJsonCommand(process.execPath, ["-e", ""], { too: "large" }, { cwd: root, maxInputBytes: 1 })).rejects.toMatchObject({ code: "command_output_invalid" });
    await expect(runJsonCommand(process.execPath, ["-e", "process.stdout.write('oversized')"], {}, { cwd: root, maxOutputBytes: 2 })).rejects.toMatchObject({ code: "command_output_invalid" });
    await expect(runJsonCommand(process.execPath, ["-e", "setInterval(()=>{},1000)"], {}, { cwd: root, timeoutMs: 5, killGraceMs: 5 })).rejects.toMatchObject({ code: "command_timeout" });
  });

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

  it("terminates and reaps a child when stdin.end throws synchronously", async () => {
    const child = new EventEmitter() as EventEmitter & { stdin: Writable; stdout: PassThrough; stderr: PassThrough; kill: (signal?: NodeJS.Signals) => boolean };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
    child.stdin.end = (() => { throw new Error("broken pipe"); }) as typeof child.stdin.end;
    const kills: Array<NodeJS.Signals | undefined> = [];
    child.kill = (signal) => {
      kills.push(signal);
      queueMicrotask(() => child.emit("close", null, signal ?? null));
      return true;
    };

    await expect(runJsonCommand("command", [], {}, { cwd: root, spawn: () => child as never })).rejects.toMatchObject({ code: "command_failed" });
    expect(kills).toEqual(["SIGTERM"]);
  });

  it("handles an asynchronous late stdin error and uses bounded SIGKILL", async () => {
    const child = new EventEmitter() as EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; kill: (signal?: NodeJS.Signals) => boolean };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    const kills: Array<NodeJS.Signals | undefined> = [];
    child.kill = (signal) => {
      kills.push(signal);
      if (signal === "SIGKILL") queueMicrotask(() => child.emit("close", null, signal));
      return true;
    };
    const command = runJsonCommand("command", [], {}, { cwd: root, spawn: () => child as never, killGraceMs: 5 });
    queueMicrotask(() => child.stdin.emit("error", new Error("EPIPE")));

    await expect(command).rejects.toMatchObject({ code: "command_failed" });
    expect(kills).toEqual(["SIGTERM", "SIGKILL"]);
  });
});
