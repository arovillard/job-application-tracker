#!/usr/bin/env tsx
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";

import { loadEnvConfig } from "@next/env";

import { loadAgentConfig } from "../src/lib/agent-workflow/config";
import { runAgentWorker } from "../src/lib/agent-workflow/orchestrator";
import { createClaudeProvider, createCodexProvider } from "../src/lib/agent-workflow/providers";

const projectRoot = process.cwd();
loadEnvConfig(projectRoot);

const config = loadAgentConfig(projectRoot);
const dbPath = path.resolve(
  process.env.JOBTRACKER_DB_PATH?.trim() || path.join(projectRoot, "data", "jobtracker.sqlite")
);
const applicationsDir = path.resolve(
  process.env.JOBTRACKER_APPLICATIONS_DIR?.trim() || path.join(projectRoot, "applications")
);
const baseResumePath = process.env.JOBTRACKER_BASE_RESUME_PATH?.trim()
  ? path.resolve(process.env.JOBTRACKER_BASE_RESUME_PATH.trim())
  : undefined;
const profileUrl = process.env.JOBTRACKER_LINKEDIN_URL?.trim();
const profileContext = profileUrl ? `Public profile URL: ${profileUrl}` : undefined;
const resumeContext = baseResumePath ? `Base resume path: ${baseResumePath}` : undefined;
const workerId = `${os.hostname()}:${process.pid}:${randomUUID()}`;
const controller = new AbortController();
const shutdownSignals = ["SIGINT", "SIGTERM"] as const;
const abort = () => controller.abort();

for (const signal of shutdownSignals) {
  process.on(signal, abort);
}

const providerOptions = {
  config,
  projectRoot,
  applicationsDir,
  baseResumePath
};

async function main() {
  try {
    await runAgentWorker({
      workerId,
      projectRoot,
      dbPath,
      applicationsDir,
      providers: {
        codex: createCodexProvider(providerOptions),
        claude: createClaudeProvider(providerOptions)
      },
      profileContext,
      resumeContext,
      baseResumePath,
      signal: controller.signal,
      onReady: () => console.log("Agent worker ready."),
    });
  } finally {
    for (const signal of shutdownSignals) process.off(signal, abort);
  }
}

void main().catch(() => {
  console.error("Agent worker failed.");
  process.exitCode = 1;
});
