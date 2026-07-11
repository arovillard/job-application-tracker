import { spawn as nodeSpawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addApplicationNote, createApplication, resetStorageForTests } from "../storage";
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
import { isUsablePreview, processNextAgentRun, runAgentWorker } from "./orchestrator";
import { PostingRetrievalError } from "./retrieval";

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
const NORMAL_POSTING_CONTEXT = "Acme Platform Engineer Build reliable infrastructure for scalable services.";
const evaluatePreview = isUsablePreview as unknown as (
  candidate: typeof preview,
  postingContext: string
) => boolean;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "jobtracker-orchestrator-"));
  dbPath = path.join(root, "tracker.sqlite");
  applicationsDir = path.join(root, "applications");
  mkdirSync(applicationsDir, { recursive: true });
  process.env.JOBTRACKER_DB_PATH = dbPath;
});

afterEach(() => {
  resetAgentRunStorageForTests();
  resetStorageForTests();
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
    retrievePosting: async (url: string, options?: { onInitialValidated?(): void }) => {
      options?.onInitialValidated?.();
      return { requestedUrl: url, finalUrl: url, context: NORMAL_POSTING_CONTEXT };
    },
    leaseDurationMs: 5_000,
    heartbeatIntervalMs: 25,
    commandTimeoutMs: 10_000
  };
}

function deterministicUpsertSpawn(): JsonCommandSpawn {
  return (command, args, options) => {
    if (!args[0]?.endsWith("upsert-job-posting.mjs")) {
      return nodeSpawn(command, [...args], options as never) as never;
    }
    const child = new EventEmitter() as EventEmitter & {
      stdin: Writable;
      stdout: PassThrough;
      stderr: PassThrough;
      kill: (signal?: NodeJS.Signals) => boolean;
    };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    let input = "";
    child.stdin = new Writable({
      write(chunk, _encoding, callback) {
        input += chunk.toString();
        callback();
      },
      final(callback) {
        try {
          const payload = JSON.parse(input) as {
            company: string;
            role: string;
            url: string;
            location: string | null;
            summary: string;
            posting_state: string;
            note: string;
          };
          const source = new URL(payload.url).hostname.toLowerCase().replace(/^www\./, "");
          const application = createApplication({
            company: payload.company,
            role: payload.role,
            status: "wishlist",
            source,
            location: payload.location,
            url: payload.url,
            contact: null,
            notes: payload.summary,
            appliedDate: null,
            followUpDate: null
          });
          const noteBody = [
            "Added tracker record from public posting",
            `source: ${source}`,
            `url: ${payload.url}`,
            `posting state: ${payload.posting_state}`,
            "changes: created new application record",
            `note: ${payload.note}`
          ].join(". ") + ".";
          const note = addApplicationNote(application.id, { type: "update", body: noteBody });
          child.stdout.end(JSON.stringify({
            action: "created",
            application: {
              id: application.id,
              company: application.company,
              role: application.role,
              status: application.status,
              source: application.source,
              location: application.location,
              url: application.url
            },
            changes: ["created new application record"],
            noteIds: [note.id]
          }));
          callback();
          const freshnessDelayMs = Math.max(0, Date.parse(note.createdAt) - Date.now() + 1);
          setTimeout(() => child.emit("close", 0, null), freshnessDelayMs);
        } catch {
          callback();
          queueMicrotask(() => child.emit("close", 1, null));
        }
      }
    });
    child.kill = (signal) => {
      queueMicrotask(() => child.emit("close", null, signal ?? null));
      return true;
    };
    return child as never;
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
  it("emits retrieval only after mandatory initial validation resolves", async () => {
    let releaseValidation!: () => void;
    const validation = new Promise<void>((resolve) => { releaseValidation = resolve; });
    let retrievalStarted = false;
    const run = createAgentRun({ provider: "codex", model: "model", canonicalJobUrl: "https://jobs.example.com/delayed" });
    const retrievePosting = vi.fn(async (url: string, options?: { onInitialValidated?(): void }) => {
      retrievalStarted = true;
      await validation;
      options?.onInitialValidated?.();
      return { requestedUrl: url, finalUrl: url, context: NORMAL_POSTING_CONTEXT };
    });
    const processing = processNextAgentRun({ ...dependencies(), retrievePosting });
    await waitFor(() => retrievalStarted);

    expect(getPublicAgentRun(run.id)?.events.map(({ message }) => message)).toEqual([
      "Validating public job URL."
    ]);

    releaseValidation();
    await processing;
    expect(getPublicAgentRun(run.id)?.events.map(({ message }) => message)).toEqual([
      "Validating public job URL.",
      "Retrieving public job posting.",
      "Analyzing job posting.",
      "Preview ready for approval."
    ]);
  });

  it.each([
    "Failed to retrieve the job posting.",
    "Posting retrieval failed after several attempts.",
    "I couldn't access the posting, so fit is unclear.",
    "Unable to load the job page right now.",
    "Could not access this job listing.",
    "Failed retrieving the job posting.",
    "The job posting was unavailable.",
    "Unable to retrieve details from the provided URL.",
    "The link could not be accessed.",
    "No job information could be extracted.",
    "Unfortunately, I could not access the job posting.",
    "The provided URL did not contain usable job information.",
    "I was unable to find job details at this link.",
    "No role details were available from the link.",
    "Access to the careers page failed, and no role data was available.",
    "This URL is unavailable and job details could not be found.",
    "Job information could not be extracted from the listing.",
    "Unfortunately we cannot open the page to view role details.",
    "I was not able to access the posting.",
    "The page returned an empty response.",
    "The link contains no job details.",
    "The careers site blocked access to the listing.",
    "Investigate another URL because this posting is unavailable."
  ])("rejects retrieval fallback summary: %s", (summary) => {
    expect(evaluatePreview({ ...preview, summary }, NORMAL_POSTING_CONTEXT)).toBe(false);
  });

  it.each([
    "Build retrieval systems for public job postings.",
    "Improve page load performance for the careers site.",
    "Own accessible posting workflows and data quality.",
    "Design handling for unavailable job posting states.",
    "Investigate when job posting retrieval has failed for enterprise customers.",
    "Build alerts when job listing access has failed in production.",
    "Own job posting unavailable-state reporting.",
    "Job posting retrieval has failed for enterprise customers; lead reliability fixes.",
    "Monitor job listing access failures and lead remediation.",
    "Develop tooling for unavailable career pages and job data recovery.",
    "Diagnose why URLs fail to load and improve job data pipelines.",
    "Create dashboards for posting retrieval failures and implement alerting.",
    "The engineer will monitor job listing access failures and lead remediation.",
    "Responsible for diagnosing job page access failures."
  ])("keeps legitimate summary usable: %s", (summary) => {
    const context = `Acme Platform Engineer Responsibilities ${summary}`;
    expect(evaluatePreview({ ...preview, summary }, context)).toBe(true);
  });

  it.each(["Sign in", "Sign-In", "Login", "Log in", "Access denied", "Page not found"])(
    "rejects a fully grounded non-job page title: %s",
    (role) => {
      const candidate = {
        ...preview,
        company: "LinkedIn",
        role,
        summary: "Access LinkedIn account login securely."
      };
      const context = `LinkedIn ${role} Access LinkedIn account login securely.`;
      expect(evaluatePreview(candidate, context)).toBe(false);
    }
  );

  it.each([
    ["LinkedIn", "LinkedIn Login", "Sign in to access LinkedIn account."],
    ["LinkedIn", "Welcome to LinkedIn", "Access your LinkedIn account securely."],
    ["Indeed", "Authentication Required", "Access your Indeed account securely."]
  ])("rejects fully grounded branded non-job title: %s / %s", (company, role, summary) => {
    const candidate = { ...preview, company, role, summary };
    const context = `${company} ${role} ${summary}`;
    expect(evaluatePreview(candidate, context)).toBe(false);
  });

  it.each([
    ["Identity and Access Management Engineer", "Design identity access management systems."],
    ["Authentication Engineer", "Build secure authentication services."],
    ["Account Executive", "Lead strategic account growth."],
    ["Security Engineer", "Implement reliable security controls."]
  ])("keeps grounded real title usable: %s", (role, summary) => {
    const candidate = { ...preview, role, summary };
    const context = `Acme ${role} ${summary}`;
    expect(evaluatePreview(candidate, context)).toBe(true);
  });

  it.each([
    ["empty context", preview, ""],
    ["missing role description", preview, "Acme careers page with no useful role content."],
    ["hallucinated company", { ...preview, company: "Globex" }, NORMAL_POSTING_CONTEXT],
    ["hallucinated role", { ...preview, role: "Product Designer" }, NORMAL_POSTING_CONTEXT],
    [
      "insufficiently grounded paraphrase",
      { ...preview, role: "Engineer", summary: "Build reliable systems architect distributed platforms." },
      "Acme Engineer Build reliable systems."
    ],
    [
      "fewer than three meaningful summary terms",
      { ...preview, role: "Engineer", summary: "Build reliable." },
      "Acme Engineer Build reliable."
    ]
  ])("rejects %s", (_label, candidate, context) => {
    expect(evaluatePreview(candidate as typeof preview, context as string)).toBe(false);
  });

  it("accepts the exact three-token and sixty-percent grounding boundary", () => {
    const candidate = {
      ...preview,
      role: "Engineer",
      summary: "Build reliable systems with cloud delivery."
    };
    const context = "Acme Engineer Build reliable systems for customer operations.";
    expect(evaluatePreview(candidate, context)).toBe(true);
  });

  it("normalizes NFKC punctuation while requiring whole company and role phrases", () => {
    const candidate = {
      ...preview,
      company: "ＡＣＭＥ, Inc.",
      role: "Platform-Engineer",
      summary: "Build reliable infrastructure."
    };
    const context = "Acme Inc seeks a Platform Engineer to build reliable infrastructure.";
    expect(evaluatePreview(candidate, context)).toBe(true);
    expect(evaluatePreview({ ...candidate, company: "Acme Incorporated" }, context)).toBe(false);
  });

  it("promptly cancels retrieval without invoking the provider", async () => {
    const fake = provider();
    fake.preview = vi.fn(fake.preview);
    const run = createAgentRun({ provider: "codex", model: "model", canonicalJobUrl: "https://jobs.example.com/cancel-retrieval" });
    const retrievePosting = vi.fn(async (_url: string, options?: { signal?: AbortSignal }) =>
      new Promise<never>((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => reject(new PostingRetrievalError()), { once: true });
        setTimeout(() => reject(new Error("slow retrieval fallback")), 150);
      })
    );
    const processing = processNextAgentRun({ ...dependencies(fake), retrievePosting, heartbeatIntervalMs: 5 });
    await waitFor(() => retrievePosting.mock.calls.length === 1);
    requestAgentRunCancellation(run.id);
    const prompt = await Promise.race([
      processing.then(() => "completed"),
      new Promise<"slow">((resolve) => setTimeout(() => resolve("slow"), 75))
    ]);
    await processing;

    expect(prompt).toBe("completed");
    expect(getAgentRun(run.id)).toMatchObject({ state: "cancelled", cancellationRequested: true });
    expect(fake.preview).not.toHaveBeenCalled();
  });

  it("promptly interrupts retrieval after lease loss without invoking the provider", async () => {
    const fake = provider();
    fake.preview = vi.fn(fake.preview);
    const run = createAgentRun({ provider: "codex", model: "model", canonicalJobUrl: "https://jobs.example.com/lease-retrieval" });
    const retrievePosting = vi.fn(async (_url: string, options?: { signal?: AbortSignal }) =>
      new Promise<never>((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => reject(new PostingRetrievalError()), { once: true });
        setTimeout(() => reject(new Error("slow retrieval fallback")), 150);
      })
    );
    const processing = processNextAgentRun({ ...dependencies(fake), retrievePosting, heartbeatIntervalMs: 5 });
    await waitFor(() => retrievePosting.mock.calls.length === 1);
    const db = new Database(dbPath);
    db.prepare("UPDATE agent_runs SET lease_expires_at = ? WHERE id = ?").run("2000-01-01T00:00:00.000Z", run.id);
    db.close();
    const prompt = await Promise.race([
      processing.then(() => "completed"),
      new Promise<"slow">((resolve) => setTimeout(() => resolve("slow"), 75))
    ]);
    await processing;

    expect(prompt).toBe("completed");
    expect(getAgentRun(run.id)?.state).toBe("interrupted");
    expect(fake.preview).not.toHaveBeenCalled();
  });

  it("retrieves before provider preview and passes only bounded context", async () => {
    const order: string[] = [];
    const fake = provider();
    fake.preview = vi.fn(async (request) => {
      order.push("preview");
      expect(request).toMatchObject({
        postingContext: "Technical Director at Thrillworks Lead technical strategy and delivery.",
        postingFinalUrl: "https://public.example/final"
      });
      return {
        preview: {
          company: "Thrillworks",
          role: "Technical Director",
          location: "Remote",
          summary: "Lead technical strategy and delivery.",
          postingState: "open" as const
        },
        usage: null
      };
    });
    const run = createAgentRun({ provider: "codex", model: "model", canonicalJobUrl: "https://jobs.example.com/role" });
    const retrievePosting = vi.fn(async (_url: string, options?: { onInitialValidated?(): void }) => {
      order.push("retrieve");
      options?.onInitialValidated?.();
      return {
        requestedUrl: run.canonicalJobUrl,
        finalUrl: "https://public.example/final",
        context: "Technical Director at Thrillworks Lead technical strategy and delivery."
      };
    });

    await processNextAgentRun({ ...dependencies(fake), retrievePosting });

    expect(order).toEqual(["retrieve", "preview"]);
    expect(getAgentRun(run.id)?.state).toBe("awaiting_approval");
    expect(getPublicAgentRun(run.id)?.events.map(({ message }) => message)).toEqual([
      "Validating public job URL.",
      "Retrieving public job posting.",
      "Analyzing job posting.",
      "Preview ready for approval."
    ]);
  });

  it.each([
    { company: "Unknown", role: "Engineer", summary: "Valid" },
    { company: "Acme", role: "N/A", summary: "Valid" },
    { company: "Acme", role: "Engineer", summary: "The public posting could not be retrieved." }
  ])("fails an unusable preview without exposing approval", async (candidate) => {
    const fake = provider();
    fake.preview = async () => ({ preview: { ...preview, ...candidate }, usage: null });
    const run = createAgentRun({ provider: "codex", model: "model", canonicalJobUrl: "https://jobs.example.com/unusable" });

    await processNextAgentRun(dependencies(fake));

    expect(getAgentRun(run.id)).toMatchObject({
      state: "failed",
      failureCode: "preview_unusable",
      failureMessage: "The job posting could not be identified reliably. Try another public posting URL."
    });
    expect(getPublicAgentRun(run.id)?.events.map(({ message }) => message)).not.toContain("Preview ready for approval.");
  });

  it("fails retrieval safely without invoking the provider", async () => {
    const fake = provider();
    fake.preview = vi.fn(fake.preview);
    const run = createAgentRun({ provider: "codex", model: "model", canonicalJobUrl: "https://jobs.example.com/missing" });

    await processNextAgentRun({
      ...dependencies(fake),
      retrievePosting: async (_url, options) => {
        options?.onInitialValidated?.();
        throw new PostingRetrievalError();
      }
    });

    expect(fake.preview).not.toHaveBeenCalled();
    expect(getAgentRun(run.id)).toMatchObject({
      state: "failed",
      failureCode: "posting_retrieval_failed",
      failureMessage: "The public job posting could not be retrieved safely. Check the link or try another public posting URL."
    });
    expect(getPublicAgentRun(run.id)?.events.map(({ message }) => message)).toEqual([
      "Validating public job URL.",
      "Retrieving public job posting.",
      "The public job posting could not be retrieved safely. Check the link or try another public posting URL."
    ]);
  });

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

    await processNextAgentRun({ ...dependencies(fake), spawn: deterministicUpsertSpawn() });

    expect(getAgentRun(run.id)).toMatchObject({ state: "failed", failureCode: "artifact_reconciliation_failed" });
    const db = new Database(dbPath, { readonly: true });
    expect(db.prepare("SELECT COUNT(*) AS count FROM application_artifacts").get()).toEqual({ count: 0 });
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

      await processNextAgentRun({ ...dependencies(fake), spawn: deterministicUpsertSpawn() });

      expect(getAgentRun(run.id)).toMatchObject({ state: "failed", failureCode: "artifact_reconciliation_failed" });
    }
  );

  it("classifies an upsert host failure before materials as execution failure", async () => {
    const fake = provider();
    let materialsCalled = false;
    fake.createMaterials = async () => {
      materialsCalled = true;
      return { manifest: [], usage: null };
    };
    const run = await queueApprovedRun("https://jobs.example.com/upsert-host-failure", fake);

    await processNextAgentRun({
      ...dependencies(fake),
      spawn: () => { throw new Error("simulated host spawn failure"); }
    });

    expect(materialsCalled).toBe(false);
    expect(getAgentRun(run.id)).toMatchObject({ state: "failed", failureCode: "execution_failed" });
  });

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

  it.each(["extra", "missing"] as const)(
    "rejects a fresh run-specific audit note with %s text before materials",
    async (scenario) => {
      const fake = provider();
      let materialsCalled = false;
      fake.createMaterials = async () => {
        materialsCalled = true;
        return { manifest: [], usage: null };
      };
      const spawn: JsonCommandSpawn = (command, args, options) => {
        const child = nodeSpawn(command, [...args], options as never);
        if (args[0]?.endsWith("upsert-job-posting.mjs")) {
          child.once("close", () => {
            const db = new Database(dbPath);
            if (scenario === "extra") {
              db.prepare("UPDATE application_notes SET body = body || ' tampered'").run();
            } else {
              db.prepare("UPDATE application_notes SET body = replace(body, 'changes:', 'change:')").run();
            }
            db.close();
          });
        }
        return child as never;
      };
      const run = await queueApprovedRun(`https://jobs.example.com/audit-${scenario}`, fake);

      await processNextAgentRun({ ...dependencies(fake), spawn });

      expect(materialsCalled).toBe(false);
      expect(getAgentRun(run.id)).toMatchObject({ state: "failed", failureCode: "upsert_readback_invalid" });
    }
  );

  it("rejects an exact fresh audit note with a far-future timestamp before materials", async () => {
    const fake = provider();
    let materialsCalled = false;
    fake.createMaterials = async () => {
      materialsCalled = true;
      return { manifest: [], usage: null };
    };
    const spawn: JsonCommandSpawn = (command, args, options) => {
      const child = nodeSpawn(command, [...args], options as never);
      if (args[0]?.endsWith("upsert-job-posting.mjs")) {
        child.once("close", () => {
          const db = new Database(dbPath);
          db.prepare("UPDATE application_notes SET created_at = '2099-01-01T00:00:00.000Z'").run();
          db.close();
        });
      }
      return child as never;
    };
    const run = await queueApprovedRun("https://jobs.example.com/audit-future", fake);

    await processNextAgentRun({ ...dependencies(fake), spawn });

    expect(materialsCalled).toBe(false);
    expect(getAgentRun(run.id)).toMatchObject({ state: "failed", failureCode: "upsert_readback_invalid" });
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

  it("does not compensate a later manifest key that this invocation never attempted", async () => {
    const fake = provider();
    const first = path.join(applicationsDir, "never-first.md");
    const later = path.join(applicationsDir, "never-later.md");
    fake.createMaterials = async () => {
      writeFileSync(first, "first");
      writeFileSync(later, "later");
      return { manifest: [
        { type: "fit_analysis", title: "First", filePath: first, contentType: "text/markdown" },
        { type: "cover_letter", title: "Concurrent later", filePath: later, contentType: "text/markdown" }
      ], usage: null };
    };
    let applicationId = "";
    const concurrentTimestamp = "2099-01-01T00:00:00.000Z";
    const spawn: JsonCommandSpawn = (command, args, options) => {
      if (!args[0]?.endsWith("register-application-artifact.mjs")) return nodeSpawn(command, [...args], options as never) as never;
      applicationId = args[args.indexOf("--application-id") + 1];
      const db = new Database(dbPath);
      db.exec(`
        CREATE TABLE IF NOT EXISTS application_artifacts (
          id TEXT PRIMARY KEY, application_id TEXT NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL,
          file_path TEXT NOT NULL, content_type TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
          UNIQUE(application_id, type, file_path)
        )
      `);
      db.prepare(`
        INSERT INTO application_artifacts
          (id, application_id, type, title, file_path, content_type, created_at, updated_at)
        VALUES ('concurrent-later', ?, 'cover_letter', 'Concurrent later', ?, 'text/markdown', ?, ?)
      `).run(applicationId, realpathSync(later), concurrentTimestamp, concurrentTimestamp);
      db.prepare("UPDATE applications SET updated_at = ? WHERE id = ?").run(concurrentTimestamp, applicationId);
      db.close();
      return nodeSpawn(command, ["-e", "process.stdin.resume();process.stdin.on('end',()=>process.exit(1))"], options as never) as never;
    };
    const run = await queueApprovedRun("https://jobs.example.com/never-attempted", fake);

    await processNextAgentRun({ ...dependencies(fake), spawn });

    expect(getAgentRun(run.id)?.state).toBe("failed");
    const db = new Database(dbPath, { readonly: true });
    expect(db.prepare("SELECT id FROM application_artifacts WHERE id = 'concurrent-later'").get()).toEqual({ id: "concurrent-later" });
    expect((db.prepare("SELECT updated_at FROM applications WHERE id = ?").get(applicationId) as { updated_at: string }).updated_at).toBe(concurrentTimestamp);
    db.close();
  });

  it("preserves a replacement write made after lease loss", async () => {
    const fake = provider();
    const first = path.join(applicationsDir, "replacement-first.md");
    const second = path.join(applicationsDir, "replacement-second.md");
    fake.createMaterials = async () => {
      writeFileSync(first, "first");
      writeFileSync(second, "second");
      return { manifest: [
        { type: "fit_analysis", title: "First", filePath: first, contentType: "text/markdown" },
        { type: "cover_letter", title: "Second", filePath: second, contentType: "text/markdown" }
      ], usage: null };
    };
    let registrations = 0;
    let applicationId = "";
    const replacementTimestamp = "2099-02-01T00:00:00.000Z";
    const spawn: JsonCommandSpawn = (command, args, options) => {
      if (!args[0]?.endsWith("register-application-artifact.mjs")) return nodeSpawn(command, [...args], options as never) as never;
      registrations += 1;
      applicationId = args[args.indexOf("--application-id") + 1];
      if (registrations === 1) return nodeSpawn(command, [...args], options as never) as never;
      const db = new Database(dbPath);
      db.prepare("UPDATE agent_worker_leases SET worker_id = 'replacement'").run();
      db.prepare(`
        UPDATE application_artifacts SET title = 'Replacement', updated_at = ?
        WHERE application_id = ? AND type = 'fit_analysis' AND file_path = ?
      `).run(replacementTimestamp, applicationId, realpathSync(first));
      db.prepare("UPDATE applications SET updated_at = ? WHERE id = ?").run(replacementTimestamp, applicationId);
      db.close();
      return nodeSpawn(command, ["-e", "process.stdin.resume();process.stdin.on('end',()=>process.exit(1))"], options as never) as never;
    };
    const run = await queueApprovedRun("https://jobs.example.com/replacement", fake);

    await processNextAgentRun({ ...dependencies(fake), spawn });

    expect(getAgentRun(run.id)?.state).toBe("verifying");
    const db = new Database(dbPath, { readonly: true });
    expect(db.prepare("SELECT title, updated_at FROM application_artifacts WHERE type = 'fit_analysis'").get()).toEqual({
      title: "Replacement",
      updated_at: replacementTimestamp
    });
    expect((db.prepare("SELECT updated_at FROM applications WHERE id = ?").get(applicationId) as { updated_at: string }).updated_at).toBe(replacementTimestamp);
    db.close();
  });

  it("compensates a registration that committed before returning malformed output", async () => {
    const spawn: JsonCommandSpawn = (command, args, options) => {
      if (!args[0]?.endsWith("register-application-artifact.mjs")) return nodeSpawn(command, [...args], options as never) as never;
      const wrapper = `
        const { spawnSync } = require('node:child_process');
        spawnSync(${JSON.stringify(command)}, ${JSON.stringify([...args])}, {
          cwd: ${JSON.stringify(options.cwd)}, env: process.env, input: '{}', encoding: 'utf8'
        });
        process.stdout.write('{');
      `;
      return nodeSpawn(command, ["-e", wrapper], options as never) as never;
    };
    const run = await queueApprovedRun("https://jobs.example.com/commit-malformed");

    await processNextAgentRun({ ...dependencies(), spawn });

    expect(getAgentRun(run.id)?.state).toBe("failed");
    const db = new Database(dbPath, { readonly: true });
    expect(db.prepare("SELECT COUNT(*) AS count FROM application_artifacts").get()).toEqual({ count: 0 });
    db.close();
  });

  it("reverses every application timestamp in an uncontended multi-attempt rollback", async () => {
    const fake = provider();
    const files = ["chain-first.md", "chain-second.md", "chain-third.md"].map((name) => path.join(applicationsDir, name));
    fake.createMaterials = async () => {
      for (const file of files) writeFileSync(file, file);
      return { manifest: [
        { type: "fit_analysis", title: "First", filePath: files[0], contentType: "text/markdown" },
        { type: "cover_letter", title: "Second", filePath: files[1], contentType: "text/markdown" },
        { type: "outreach_message", title: "Third", filePath: files[2], contentType: "text/markdown" }
      ], usage: null };
    };
    let registrations = 0;
    let originalTimestamp = "";
    const spawn: JsonCommandSpawn = (command, args, options) => {
      if (!args[0]?.endsWith("register-application-artifact.mjs")) return nodeSpawn(command, [...args], options as never) as never;
      registrations += 1;
      if (registrations === 1) {
        const db = new Database(dbPath, { readonly: true });
        originalTimestamp = (db.prepare("SELECT updated_at FROM applications").get() as { updated_at: string }).updated_at;
        db.close();
      }
      if (registrations <= 2) return nodeSpawn(command, [...args], options as never) as never;
      return nodeSpawn(command, ["-e", "process.stdin.resume();process.stdin.on('end',()=>process.exit(1))"], options as never) as never;
    };
    const run = await queueApprovedRun("https://jobs.example.com/timestamp-chain", fake);

    await processNextAgentRun({ ...dependencies(fake), spawn });

    expect(getAgentRun(run.id)?.state).toBe("failed");
    const db = new Database(dbPath, { readonly: true });
    expect((db.prepare("SELECT updated_at FROM applications").get() as { updated_at: string }).updated_at).toBe(originalTimestamp);
    expect(db.prepare("SELECT COUNT(*) AS count FROM application_artifacts").get()).toEqual({ count: 0 });
    db.close();
  });

  it("preserves an unrelated application timestamp written between registration attempts", async () => {
    const fake = provider();
    const files = ["cas-first.md", "cas-second.md", "cas-third.md"].map((name) => path.join(applicationsDir, name));
    fake.createMaterials = async () => {
      for (const file of files) writeFileSync(file, file);
      return { manifest: [
        { type: "fit_analysis", title: "First", filePath: files[0], contentType: "text/markdown" },
        { type: "cover_letter", title: "Second", filePath: files[1], contentType: "text/markdown" },
        { type: "outreach_message", title: "Third", filePath: files[2], contentType: "text/markdown" }
      ], usage: null };
    };
    const concurrentTimestamp = "2099-03-01T00:00:00.000Z";
    let registrations = 0;
    const spawn: JsonCommandSpawn = (command, args, options) => {
      if (!args[0]?.endsWith("register-application-artifact.mjs")) return nodeSpawn(command, [...args], options as never) as never;
      registrations += 1;
      if (registrations === 1) {
        const child = nodeSpawn(command, [...args], options as never);
        child.once("close", () => {
          setImmediate(() => {
            const db = new Database(dbPath);
            db.prepare("UPDATE applications SET updated_at = ?").run(concurrentTimestamp);
            db.close();
          });
        });
        return child as never;
      }
      if (registrations === 2) return nodeSpawn(command, [...args], options as never) as never;
      return nodeSpawn(command, ["-e", "process.stdin.resume();process.stdin.on('end',()=>process.exit(1))"], options as never) as never;
    };
    const run = await queueApprovedRun("https://jobs.example.com/timestamp-cas", fake);

    await processNextAgentRun({ ...dependencies(fake), spawn });

    expect(getAgentRun(run.id)?.state).toBe("failed");
    const db = new Database(dbPath, { readonly: true });
    expect((db.prepare("SELECT updated_at FROM applications").get() as { updated_at: string }).updated_at).toBe(concurrentTimestamp);
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

  it("contains compensation errors and continues to a later queued run", async () => {
    const controller = new AbortController();
    const fake = provider();
    let previewCalls = 0;
    fake.preview = async () => {
      previewCalls += 1;
      if (previewCalls === 2) setTimeout(() => controller.abort(), 20);
      return { preview, usage: null };
    };
    fake.createMaterials = async () => {
      const first = path.join(applicationsDir, "throw-first.md");
      const second = path.join(applicationsDir, "throw-second.md");
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
      if (registrations === 1) {
        const child = nodeSpawn(command, [...args], options as never);
        child.once("close", () => {
          const db = new Database(dbPath);
          db.exec(`
            CREATE TRIGGER fail_compensation BEFORE DELETE ON application_artifacts
            BEGIN SELECT RAISE(FAIL, 'secret rollback failure'); END
          `);
          db.close();
        });
        return child as never;
      }
      return nodeSpawn(command, ["-e", "process.stdin.resume();process.stdin.on('end',()=>process.exit(1))"], options as never) as never;
    };
    const failed = await queueApprovedRun("https://jobs.example.com/compensation-throws", fake);
    const later = createAgentRun({ provider: "codex", model: "model", canonicalJobUrl: "https://jobs.example.com/later-run" });

    await expect(runAgentWorker({ ...dependencies(fake), spawn, signal: controller.signal, pollIntervalMs: 5 })).resolves.toBeUndefined();

    expect(getAgentRun(failed.id)).toMatchObject({ state: "failed", failureCode: "artifact_compensation_failed" });
    expect(getAgentRun(failed.id)?.failureMessage).not.toContain("secret rollback failure");
    expect(getAgentRun(later.id)?.state).toBe("awaiting_approval");
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
