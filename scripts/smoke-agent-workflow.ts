#!/usr/bin/env tsx
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadEnvConfig } from "@next/env";
import Database from "better-sqlite3";

import {
  diagnoseProviderExecutable,
  loadAgentConfig,
  resolveProviderModel
} from "../src/lib/agent-workflow/config";
import { processNextAgentRun } from "../src/lib/agent-workflow/orchestrator";
import { createClaudeProvider, createCodexProvider } from "../src/lib/agent-workflow/providers";
import { validatePublicJobUrl } from "../src/lib/agent-workflow/security";
import {
  approveAgentRunAndGetPublic,
  enqueueAgentRun,
  getPublicAgentRun,
  resetAgentRunStorageForTests
} from "../src/lib/agent-workflow/storage";
import type { AgentProviderName, PublicAgentRun } from "../src/lib/agent-workflow/types";
import { getApplicationDetail, resetStorageForTests } from "../src/lib/storage";

type SmokeArguments = {
  provider: AgentProviderName;
  model: string;
  jobUrl: string;
  approve: boolean;
  keepTemp: boolean;
};

type ArtifactRow = {
  id: string;
  application_id: string;
  type: string;
  title: string;
  file_path: string;
  content_type: string;
};

class SafeSmokeError extends Error {}

const projectRoot = process.cwd();

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const previousEnvironment = captureEnvironment([
    "JOBTRACKER_DB_PATH",
    "JOBTRACKER_APPLICATIONS_DIR",
    "JOBTRACKER_BASE_RESUME_PATH"
  ]);

  try {
    loadEnvConfig(projectRoot);
  } catch {
    restoreEnvironment(previousEnvironment);
    throw new SafeSmokeError("Local environment configuration is invalid.");
  }

  let canonicalJobUrl: string;
  try {
    canonicalJobUrl = await validatePublicJobUrl(args.jobUrl);
  } catch {
    restoreEnvironment(previousEnvironment);
    throw new SafeSmokeError("Job URL could not be validated safely.");
  }

  let config: ReturnType<typeof loadAgentConfig>;
  let model: string;
  try {
    config = loadAgentConfig(projectRoot);
    model = resolveProviderModel(config, args.provider, args.model);
  } catch {
    restoreEnvironment(previousEnvironment);
    throw new SafeSmokeError("Agent provider configuration is invalid.");
  }

  const diagnostic = await diagnoseProviderExecutable(config, args.provider).catch(() => null);
  if (!diagnostic?.available) {
    restoreEnvironment(previousEnvironment);
    throw new SafeSmokeError("Provider executable is unavailable.");
  }

  let root: string;
  try {
    root = mkdtempSync(path.join(tmpdir(), "jobtracker-agent-smoke-"));
  } catch {
    restoreEnvironment(previousEnvironment);
    throw new SafeSmokeError("Temporary smoke state could not be created.");
  }
  const dbPath = path.join(root, "data", "tracker.sqlite");
  const applicationsDir = path.join(root, "applications");
  const baseResumePath = path.join(applicationsDir, "private", "synthetic-resume.md");

  try {
    mkdirSync(path.dirname(baseResumePath), { recursive: true });
    writeFileSync(
      baseResumePath,
      "# Synthetic smoke-test resume\n\nTemporary input for the local workflow smoke test.\n",
      { mode: 0o600 }
    );
    process.env.JOBTRACKER_DB_PATH = dbPath;
    process.env.JOBTRACKER_APPLICATIONS_DIR = applicationsDir;
    process.env.JOBTRACKER_BASE_RESUME_PATH = baseResumePath;
    resetAgentRunStorageForTests();
    resetStorageForTests();

    const providerOptions = { config, projectRoot, applicationsDir, baseResumePath };
    const providers = {
      codex: createCodexProvider(providerOptions),
      claude: createClaudeProvider(providerOptions)
    };
    const workerDependencies = {
      workerId: `smoke:${process.pid}:${randomUUID()}`,
      projectRoot,
      dbPath,
      applicationsDir,
      baseResumePath,
      resumeContext: `Base resume path: ${baseResumePath}`,
      providers
    };

    const queued = enqueueAgentRun({ provider: args.provider, model, canonicalJobUrl });
    if (!await processNextAgentRun(workerDependencies)) {
      throw new SafeSmokeError("Preview worker did not claim the queued run.");
    }
    const awaiting = requireState(queued.id, "awaiting_approval", "Preview did not reach approval.");
    if (!awaiting.preview) throw new SafeSmokeError("Preview result is unavailable.");
    printSafe("preview", {
      runId: awaiting.id,
      state: awaiting.state,
      provider: awaiting.provider,
      model: awaiting.model,
      company: awaiting.preview.company,
      role: awaiting.preview.role,
      location: awaiting.preview.location,
      postingState: awaiting.preview.postingState,
      summary: awaiting.preview.summary
    });

    if (!args.approve) {
      printSafe("result", { runId: awaiting.id, state: awaiting.state, execution: "not-approved" });
      return;
    }

    const approved = approveAgentRunAndGetPublic(awaiting.id);
    if (!approved || approved.state !== "queued_execution") {
      throw new SafeSmokeError("Run could not be approved atomically.");
    }
    if (!await processNextAgentRun(workerDependencies)) {
      throw new SafeSmokeError("Execution worker did not claim the approved run.");
    }
    const completed = requireState(awaiting.id, "succeeded", "Approved run did not succeed.");
    const verification = verifyCompletedRun(completed, dbPath, applicationsDir, canonicalJobUrl);
    printSafe("result", {
      runId: completed.id,
      state: completed.state,
      applicationId: completed.applicationId,
      artifactLinks: completed.artifactLinks
    });
    printSafe("verification", verification);
  } finally {
    resetAgentRunStorageForTests();
    resetStorageForTests();
    restoreEnvironment(previousEnvironment);
    if (args.keepTemp) printSafe("temporary-state", { root });
    else rmSync(root, { recursive: true, force: true });
  }
}

function parseArguments(argv: string[]): SmokeArguments {
  const values = new Map<string, string>();
  let approve = false;
  let keepTemp = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--approve" || argument === "--keep-temp") {
      if ((argument === "--approve" && approve) || (argument === "--keep-temp" && keepTemp)) {
        throw new SafeSmokeError("Invalid smoke arguments.");
      }
      if (argument === "--approve") approve = true;
      else keepTemp = true;
      continue;
    }
    if (!["--provider", "--model", "--job-url"].includes(argument)) {
      throw new SafeSmokeError("Invalid smoke arguments.");
    }
    const key = argument.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--") || values.has(key)) {
      throw new SafeSmokeError("Invalid smoke arguments.");
    }
    values.set(key, value);
    index += 1;
  }
  const provider = values.get("provider");
  const model = values.get("model");
  const jobUrl = values.get("job-url");
  if ((provider !== "codex" && provider !== "claude") || !model || !jobUrl) {
    throw new SafeSmokeError("Invalid smoke arguments.");
  }
  return { provider, model, jobUrl, approve, keepTemp };
}

function requireState(runId: string, state: PublicAgentRun["state"], message: string) {
  const run = getPublicAgentRun(runId);
  if (!run || run.state !== state) throw new SafeSmokeError(message);
  return run;
}

function verifyCompletedRun(
  run: PublicAgentRun,
  dbPath: string,
  applicationsDir: string,
  canonicalJobUrl: string
) {
  if (!run.applicationId || !run.preview || run.artifactLinks.length === 0) {
    throw new SafeSmokeError("Completion verification failed.");
  }
  const detail = getApplicationDetail(run.applicationId);
  if (
    !detail || detail.company !== run.preview.company || detail.role !== run.preview.role ||
    detail.url !== canonicalJobUrl || detail.summary !== run.preview.summary
  ) {
    throw new SafeSmokeError("Application readback verification failed.");
  }

  const db = new Database(dbPath, { readonly: true });
  let rows: ArtifactRow[];
  try {
    rows = db.prepare(`
      SELECT id, application_id, type, title, file_path, content_type
      FROM application_artifacts WHERE application_id = ? ORDER BY id
    `).all(run.applicationId) as ArtifactRow[];
  } finally {
    db.close();
  }
  if (rows.length !== run.artifactLinks.length || !rows.some(({ type }) => type === "fit_analysis")) {
    throw new SafeSmokeError("Artifact registration verification failed.");
  }

  const canonicalRoot = `${realpathSync(applicationsDir)}${path.sep}`;
  for (const row of rows) {
    const link = run.artifactLinks.find(({ id }) => id === row.id);
    const expectedHref = `/api/applications/${run.applicationId}/artifacts/${row.id}/file`;
    if (
      row.application_id !== run.applicationId || !link || link.type !== row.type ||
      link.title !== row.title || link.href !== expectedHref || statSync(row.file_path).isFile() !== true
    ) {
      throw new SafeSmokeError("Artifact readback verification failed.");
    }
    const canonicalFile = realpathSync(row.file_path);
    if (!`${canonicalFile}${path.sep}`.startsWith(canonicalRoot)) {
      throw new SafeSmokeError("Artifact containment verification failed.");
    }
  }

  const publicText = JSON.stringify({ events: run.events, links: run.artifactLinks });
  if (publicText.includes(path.dirname(applicationsDir))) {
    throw new SafeSmokeError("Public output privacy verification failed.");
  }
  return {
    applicationReadback: "verified",
    registeredArtifacts: rows.length,
    fitAnalysis: "verified",
    canonicalContainment: "verified",
    publicOutputPrivacy: "verified"
  };
}

function captureEnvironment(keys: string[]) {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

function restoreEnvironment(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function printSafe(label: string, value: unknown) {
  process.stdout.write(`${label}: ${JSON.stringify(value)}\n`);
}

main().catch((error) => {
  const message = error instanceof SafeSmokeError ? error.message : "Smoke workflow failed safely.";
  process.stderr.write(`Smoke failed: ${message}\n`);
  process.exitCode = 1;
});
