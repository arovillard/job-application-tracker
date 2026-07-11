import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..");
const children = new Set<ChildProcess>();
const temporaryRoots: string[] = [];

afterEach(async () => {
  for (const child of children) {
    await stopProcessGroup(child);
  }
  children.clear();
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("agent worker executable", () => {
  test("starts the long-running worker through the actual npm command", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "jobtracker-agent-worker-test-"));
    temporaryRoots.push(root);
    const dbPath = path.join(root, "data", "tracker.sqlite");
    const applicationsDir = path.join(root, "applications");
    const baseResumePath = path.join(applicationsDir, "private", "resume.md");
    mkdirSync(path.dirname(baseResumePath), { recursive: true });
    writeFileSync(baseResumePath, "# Synthetic worker startup test resume\n");

    const child = spawn("npm", ["run", "agent:worker"], {
      cwd: projectRoot,
      detached: true,
      env: {
        ...process.env,
        JOBTRACKER_DB_PATH: dbPath,
        JOBTRACKER_APPLICATIONS_DIR: applicationsDir,
        JOBTRACKER_BASE_RESUME_PATH: baseResumePath
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    children.add(child);
    const output: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer) => output.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => output.push(chunk));

    const startup = await waitForStartup(child, dbPath, () => Buffer.concat(output).toString("utf8"), 10_000);
    const text = Buffer.concat(output).toString("utf8");

    expect(startup, text).toBe("running");
    expect(text).toContain("Agent worker ready.");
    expect(child.exitCode).toBeNull();
  }, 15_000);
});

async function waitForStartup(
  child: ChildProcess,
  dbPath: string,
  output: () => string,
  timeoutMs: number
): Promise<"running" | "exited" | "timed-out"> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) return "exited";
    if (existsSync(dbPath) && output().includes("Agent worker ready.")) return "running";
    await delay(50);
  }
  return "timed-out";
}

async function stopProcessGroup(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.pid === undefined) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  await Promise.race([
    new Promise<void>((resolve) => child.once("close", () => resolve())),
    delay(2_000)
  ]);
  if (child.exitCode === null) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
