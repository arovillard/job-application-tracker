# One-Command Local Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `npm run dev` start and supervise both the JobTracker web app and agent worker while the UI reports worker health and queued work honestly.

**Architecture:** Add a SQLite-backed worker heartbeat and a safe read-only health route, register that heartbeat from the existing separate worker process, and place both Next.js and the worker beneath a shell-free Node supervisor. The drawer polls health independently from run state so offline, queued, active, and reconnect conditions have distinct behavior without changing lease ownership or recovery semantics.

**Tech Stack:** Node.js 20.18.1+, Next.js 16 App Router, React 19, TypeScript, SQLite via `better-sqlite3`, Vitest, JSDOM.

## Global Constraints

- `npm run dev` is the single normal startup command; `npm run dev:web` and `npm run agent:worker` are advanced debugging commands.
- Keep the worker in a separate process from Next.js.
- Use `process.execPath`, fixed argument arrays, `shell: false`, and no shell interpolation.
- Worker heartbeat interval is exactly 5,000 ms; worker health is online through exactly 15,000 ms since the newest heartbeat and offline after that threshold.
- Never expose worker IDs, PIDs, hostnames, paths, provider configuration, raw errors, environment values, or database details through the health API or UI.
- `GET /api/agent-worker-health` always uses `Cache-Control: no-store` and returns only `{ status, lastSeenAt }`.
- Disable new preview creation when worker health is offline; retain cancellation and automatic continuation for runs already queued.
- Queued runs never display **Validating public job URL**; that stage begins only after the worker claims a run and enters `previewing`.
- Existing URL security, retrieval deadlines, complete structured posting evidence, approval, leases, cancellation, privacy, and artifact verification remain unchanged.
- Preserve pre-existing working-tree changes in `README.md`, `next-env.d.ts`, `.codex/`, and `docs/goals/`; stage only files named by the current task.
- Do not push or open a pull request.

---

## File Structure

- `src/lib/agent-workflow/types.ts`: public `AgentWorkerHealth` response type.
- `src/lib/agent-workflow/storage.ts`: worker-health table, constants, registration, heartbeat, unregister, and safe health read.
- `src/lib/agent-workflow/storage.test.ts`: deterministic threshold, cleanup, multi-worker, and isolation tests.
- `src/app/api/agent-worker-health/route.ts`: safe uncached worker-health endpoint.
- `src/app/api/agent-worker-health/route.test.ts`: public response and error-collapse tests.
- `src/lib/agent-workflow/orchestrator.ts`: worker lifecycle registration and periodic heartbeat.
- `src/lib/agent-workflow/orchestrator.test.ts`: readiness ordering, heartbeat, and cleanup tests.
- `scripts/agent-worker.ts`: fixed readiness output and safe top-level failure behavior.
- `scripts/agent-worker.test.ts`: real executable readiness/health/shutdown regression.
- `scripts/lib/local-supervisor.mjs`: testable child-process supervision logic.
- `scripts/run-local.mjs`: CLI entry point and signal wiring.
- `scripts/run-local.test.ts`: exact spawn, readiness, output, shutdown, and failure tests.
- `package.json`: one-command `dev` and advanced `dev:web` scripts.
- `src/components/ApplyWithAgentDrawer.tsx`: worker-health polling and truthful stage rendering.
- `src/components/ApplyWithAgentDrawer.test.tsx`: offline form, queue, active loss, and reconnect behavior.
- `src/app/globals.css`: static offline/waiting activity treatment.
- `README.md`, `AGENTS.md`, `docs/agent-setup.md`, `docs/agent-workflow.md`: identical installation and startup contract.
- `scripts/startup-contract.test.ts`: static documentation/package-script consistency checks.

---

### Task 1: Worker Health Storage and Safe API

**Files:**
- Modify: `src/lib/agent-workflow/types.ts`
- Modify: `src/lib/agent-workflow/storage.ts`
- Modify: `src/lib/agent-workflow/storage.test.ts`
- Create: `src/app/api/agent-worker-health/route.ts`
- Create: `src/app/api/agent-worker-health/route.test.ts`

**Interfaces:**
- Produces: `AgentWorkerHealth`, `WORKER_HEARTBEAT_INTERVAL_MS`, `WORKER_OFFLINE_AFTER_MS`, `registerAgentWorker`, `heartbeatAgentWorker`, `unregisterAgentWorker`, and `getAgentWorkerHealth`.
- `AgentWorkerHealth` is exactly `{ status: "online" | "offline"; lastSeenAt: string | null }`.
- `registerAgentWorker(workerId: string, at?: Date): void` creates or replaces the caller's start/heartbeat timestamps.
- `heartbeatAgentWorker(workerId: string, at?: Date): void` preserves an existing `started_at` and advances `heartbeat_at`; it registers a missing row safely.
- `unregisterAgentWorker(workerId: string): void` removes only that worker.
- `getAgentWorkerHealth(at?: Date): AgentWorkerHealth` deletes rows older than the 15-second cutoff and returns the newest valid heartbeat.

- [ ] **Step 1: Write worker-health storage RED tests**

Add these imports and cases to `src/lib/agent-workflow/storage.test.ts`:

```ts
import {
  WORKER_HEARTBEAT_INTERVAL_MS,
  WORKER_OFFLINE_AFTER_MS,
  getAgentWorkerHealth,
  heartbeatAgentWorker,
  registerAgentWorker,
  unregisterAgentWorker
} from "./storage";

describe("agent worker health", () => {
  it("uses the exact heartbeat and offline thresholds", () => {
    expect(WORKER_HEARTBEAT_INTERVAL_MS).toBe(5_000);
    expect(WORKER_OFFLINE_AFTER_MS).toBe(15_000);
  });

  it("is online through the threshold and offline immediately after it", () => {
    const started = new Date("2026-07-10T20:00:00.000Z");
    registerAgentWorker("worker-a", started);
    expect(getAgentWorkerHealth(new Date(started.getTime() + 15_000))).toEqual({
      status: "online",
      lastSeenAt: started.toISOString()
    });
    expect(getAgentWorkerHealth(new Date(started.getTime() + 15_001))).toEqual({
      status: "offline",
      lastSeenAt: null
    });
  });

  it("returns the newest worker and unregisters only its owner", () => {
    registerAgentWorker("worker-a", new Date("2026-07-10T20:00:00.000Z"));
    registerAgentWorker("worker-b", new Date("2026-07-10T20:00:04.000Z"));
    heartbeatAgentWorker("worker-a", new Date("2026-07-10T20:00:08.000Z"));
    expect(getAgentWorkerHealth(new Date("2026-07-10T20:00:10.000Z"))).toEqual({
      status: "online",
      lastSeenAt: "2026-07-10T20:00:08.000Z"
    });
    unregisterAgentWorker("worker-a");
    expect(getAgentWorkerHealth(new Date("2026-07-10T20:00:10.000Z"))).toEqual({
      status: "online",
      lastSeenAt: "2026-07-10T20:00:04.000Z"
    });
  });

  it("does not change run leases while cleaning stale health rows", () => {
    const run = createQueuedRun("health-isolation");
    expect(claimNextPreview("lease-owner", 60_000)?.id).toBe(run.id);
    registerAgentWorker("stale-health", new Date("2026-07-10T19:00:00.000Z"));
    expect(getAgentWorkerHealth(new Date("2026-07-10T20:00:00.000Z"))).toEqual({
      status: "offline",
      lastSeenAt: null
    });
    expect(getAgentRun(run.id)).toMatchObject({ state: "previewing", workerId: "lease-owner" });
  });
});
```

- [ ] **Step 2: Run the storage tests and confirm RED**

Run:

```bash
npx vitest run src/lib/agent-workflow/storage.test.ts
```

Expected: FAIL because the six health exports and `agent_worker_health` table do not exist.

- [ ] **Step 3: Implement the health type, schema, and storage functions**

Add to `src/lib/agent-workflow/types.ts`:

```ts
export type AgentWorkerHealth = {
  status: "online" | "offline";
  lastSeenAt: string | null;
};
```

Add the table to the existing `ensureSchema` SQL in `storage.ts`:

```sql
CREATE TABLE IF NOT EXISTS agent_worker_health (
  worker_id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  heartbeat_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS agent_worker_health_heartbeat_idx
  ON agent_worker_health(heartbeat_at);
```

Add these exact exports to `storage.ts`:

```ts
import type { AgentWorkerHealth } from "./types";

export const WORKER_HEARTBEAT_INTERVAL_MS = 5_000;
export const WORKER_OFFLINE_AFTER_MS = 15_000;

function workerTimestamp(at: Date): string {
  if (Number.isNaN(at.getTime())) throw new Error("Worker timestamp is invalid");
  return at.toISOString();
}

export function registerAgentWorker(workerId: string, at = new Date()): void {
  const owner = requireWorkerId(workerId);
  const timestamp = workerTimestamp(at);
  getDatabase().prepare(`
    INSERT INTO agent_worker_health (worker_id, started_at, heartbeat_at)
    VALUES (?, ?, ?)
    ON CONFLICT(worker_id) DO UPDATE SET
      started_at = excluded.started_at,
      heartbeat_at = excluded.heartbeat_at
  `).run(owner, timestamp, timestamp);
}

export function heartbeatAgentWorker(workerId: string, at = new Date()): void {
  const owner = requireWorkerId(workerId);
  const timestamp = workerTimestamp(at);
  getDatabase().prepare(`
    INSERT INTO agent_worker_health (worker_id, started_at, heartbeat_at)
    VALUES (?, ?, ?)
    ON CONFLICT(worker_id) DO UPDATE SET heartbeat_at = excluded.heartbeat_at
  `).run(owner, timestamp, timestamp);
}

export function unregisterAgentWorker(workerId: string): void {
  getDatabase().prepare("DELETE FROM agent_worker_health WHERE worker_id = ?")
    .run(requireWorkerId(workerId));
}

export function getAgentWorkerHealth(at = new Date()): AgentWorkerHealth {
  const db = getDatabase();
  const cutoff = new Date(at.getTime() - WORKER_OFFLINE_AFTER_MS).toISOString();
  return db.transaction(() => {
    db.prepare("DELETE FROM agent_worker_health WHERE heartbeat_at < ?").run(cutoff);
    const row = db.prepare(`
      SELECT heartbeat_at AS heartbeatAt
      FROM agent_worker_health
      WHERE heartbeat_at >= ?
      ORDER BY heartbeat_at DESC
      LIMIT 1
    `).get(cutoff) as { heartbeatAt: string } | undefined;
    return row
      ? { status: "online" as const, lastSeenAt: row.heartbeatAt }
      : { status: "offline" as const, lastSeenAt: null };
  }).immediate();
}
```

- [ ] **Step 4: Run storage tests and confirm GREEN**

Run:

```bash
npx vitest run src/lib/agent-workflow/storage.test.ts
```

Expected: the storage suite passes, including exact 15,000/15,001 ms boundaries and lease isolation.

- [ ] **Step 5: Write the health route RED tests**

Create `src/app/api/agent-worker-health/route.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { createWorkerHealthHandler } from "./route";

describe("GET /api/agent-worker-health", () => {
  it("returns the exact online payload without caching", async () => {
    const readHealth = vi.fn(() => ({
      status: "online" as const,
      lastSeenAt: "2026-07-10T20:00:00.000Z"
    }));
    const response = await createWorkerHealthHandler({ readHealth })(new Request("http://localhost/api/agent-worker-health"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "online", lastSeenAt: "2026-07-10T20:00:00.000Z" });
  });

  it("collapses storage errors to the safe offline payload", async () => {
    const response = await createWorkerHealthHandler({
      readHealth: () => { throw new Error("private database path"); }
    })(new Request("http://localhost/api/agent-worker-health"));
    expect(await response.json()).toEqual({ status: "offline", lastSeenAt: null });
  });
});
```

- [ ] **Step 6: Run the route test and confirm RED**

Run:

```bash
npx vitest run src/app/api/agent-worker-health/route.test.ts
```

Expected: FAIL because the route and handler do not exist.

- [ ] **Step 7: Implement the safe health route**

Create `src/app/api/agent-worker-health/route.ts`:

```ts
import { NextResponse } from "next/server";

import { getAgentWorkerHealth } from "../../../lib/agent-workflow/storage";
import type { AgentWorkerHealth } from "../../../lib/agent-workflow/types";

export const runtime = "nodejs";

export type WorkerHealthDependencies = {
  readHealth(): AgentWorkerHealth;
};

const productionDependencies: WorkerHealthDependencies = {
  readHealth: getAgentWorkerHealth
};

function json(body: AgentWorkerHealth) {
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}

export function createWorkerHealthHandler(dependencies: WorkerHealthDependencies) {
  return async function get(_request: Request) {
    void _request;
    try {
      return json(dependencies.readHealth());
    } catch {
      return json({ status: "offline", lastSeenAt: null });
    }
  };
}

export const GET = createWorkerHealthHandler(productionDependencies);
```

- [ ] **Step 8: Run focused Task 1 verification**

Run:

```bash
npx vitest run src/lib/agent-workflow/storage.test.ts src/app/api/agent-worker-health/route.test.ts
npm run typecheck
```

Expected: both suites and TypeScript pass.

- [ ] **Step 9: Commit Task 1**

```bash
git add src/lib/agent-workflow/types.ts src/lib/agent-workflow/storage.ts src/lib/agent-workflow/storage.test.ts src/app/api/agent-worker-health/route.ts src/app/api/agent-worker-health/route.test.ts
git commit -m "feat: add agent worker health tracking"
```

---

### Task 2: Worker Lifecycle and Readiness

**Files:**
- Modify: `src/lib/agent-workflow/orchestrator.ts`
- Modify: `src/lib/agent-workflow/orchestrator.test.ts`
- Modify: `scripts/agent-worker.ts`
- Modify: `scripts/agent-worker.test.ts`

**Interfaces:**
- Consumes Task 1 health functions and constants.
- Extends `AgentWorkerOptions` with `workerHealthIntervalMs?: number` and `onReady?: () => void`.
- Emits the exact stdout line `Agent worker ready.` only after recovery and initial health registration.
- Removes the current health row in `finally` on normal abort or thrown worker-loop failure.

- [ ] **Step 1: Write worker lifecycle RED tests**

Add to `orchestrator.test.ts`:

```ts
it("registers health before readiness, heartbeats, and unregisters on abort", async () => {
  const controller = new AbortController();
  const readyStates: Array<ReturnType<typeof getAgentWorkerHealth>> = [];
  const worker = runAgentWorker({
    ...dependencies(),
    workerId: "health-worker",
    pollIntervalMs: 5,
    workerHealthIntervalMs: 10,
    signal: controller.signal,
    onReady: () => readyStates.push(getAgentWorkerHealth())
  });
  await waitFor(() => readyStates.length === 1);
  expect(readyStates[0].status).toBe("online");
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(getAgentWorkerHealth().status).toBe("online");
  controller.abort();
  await worker;
  expect(getAgentWorkerHealth()).toEqual({ status: "offline", lastSeenAt: null });
});

it("does not signal readiness when initial health registration fails", async () => {
  const onReady = vi.fn();
  await expect(runAgentWorker({
    ...dependencies(),
    workerId: "   ",
    onReady
  })).rejects.toThrow("Worker id is required");
  expect(onReady).not.toHaveBeenCalled();
});
```

Update the real executable call and assertion in `scripts/agent-worker.test.ts` so startup requires both the database and the fixed readiness line:

```ts
const startup = await waitForStartup(child, dbPath, () => Buffer.concat(output).toString("utf8"), 10_000);
const text = Buffer.concat(output).toString("utf8");
expect(startup, text).toBe("running");
expect(text).toContain("Agent worker ready.");

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
```

- [ ] **Step 2: Run the worker tests and confirm RED**

Run:

```bash
npx vitest run src/lib/agent-workflow/orchestrator.test.ts scripts/agent-worker.test.ts
```

Expected: FAIL because worker health lifecycle options and readiness output are absent.

- [ ] **Step 3: Implement worker registration, heartbeat, and cleanup**

Import Task 1 functions into `orchestrator.ts` and replace `runAgentWorker` with:

```ts
export type AgentWorkerOptions = AgentOrchestratorDependencies & {
  pollIntervalMs?: number;
  workerHealthIntervalMs?: number;
  onReady?: () => void;
};

export async function runAgentWorker(options: AgentWorkerOptions): Promise<void> {
  recoverAbandonedAgentRuns(options.workerId);
  registerAgentWorker(options.workerId);
  getAgentWorkerHealth(); // removes stale health rows before readiness
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_MS;
  const healthIntervalMs = options.workerHealthIntervalMs ?? WORKER_HEARTBEAT_INTERVAL_MS;
  const healthTimer = setInterval(() => {
    try {
      heartbeatAgentWorker(options.workerId);
    } catch {
      // A failed heartbeat makes health expire safely; run leases remain authoritative.
    }
  }, healthIntervalMs);
  healthTimer.unref?.();

  try {
    options.onReady?.();
    while (!options.signal?.aborted) {
      let worked = true;
      try {
        worked = await processNextAgentRun(options);
      } catch {
        worked = false;
      }
      if (!worked) await abortableDelay(pollIntervalMs, options.signal);
    }
  } finally {
    clearInterval(healthTimer);
    try { unregisterAgentWorker(options.workerId); } catch { /* health cleanup is best-effort */ }
  }
}
```

Add imports for `WORKER_HEARTBEAT_INTERVAL_MS`, `getAgentWorkerHealth`, `heartbeatAgentWorker`, `registerAgentWorker`, and `unregisterAgentWorker`.

- [ ] **Step 4: Emit readiness safely from the executable**

Pass this callback in `scripts/agent-worker.ts`:

```ts
onReady: () => console.log("Agent worker ready."),
```

Replace the final `void main();` with:

```ts
void main().catch(() => {
  console.error("Agent worker failed.");
  process.exitCode = 1;
});
```

- [ ] **Step 5: Run focused Task 2 verification**

Run:

```bash
npx vitest run src/lib/agent-workflow/orchestrator.test.ts scripts/agent-worker.test.ts src/lib/agent-workflow/storage.test.ts
npm run typecheck
```

Expected: health ordering, real readiness output, shutdown cleanup, existing orchestration tests, and TypeScript pass.

- [ ] **Step 6: Commit Task 2**

```bash
git add src/lib/agent-workflow/orchestrator.ts src/lib/agent-workflow/orchestrator.test.ts scripts/agent-worker.ts scripts/agent-worker.test.ts
git commit -m "feat: publish agent worker readiness"
```

---

### Task 3: Shell-Free Local Process Supervisor

**Files:**
- Create: `scripts/lib/local-supervisor.mjs`
- Create: `scripts/run-local.mjs`
- Create: `scripts/run-local.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes the exact worker stdout line `Agent worker ready.` from Task 2.
- Produces `startLocalSupervisor(options)` returning `{ ready, done, stop }`.
- `ready` resolves to `{ url: string }` only after both children are ready.
- `done` resolves to the supervisor exit code after both children close.
- `stop(signal?: "SIGINT" | "SIGTERM")` initiates bounded shutdown.

- [ ] **Step 1: Write supervisor RED tests with fake children**

Create `scripts/run-local.test.ts` with a fake child using `EventEmitter` and `PassThrough`. Cover exact process arguments, readiness, failure, and shutdown:

```ts
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

// @ts-expect-error The production supervisor is intentionally plain ESM.
import { startLocalSupervisor } from "./lib/local-supervisor.mjs";

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  kill = vi.fn((signal: NodeJS.Signals) => {
    this.signalCode = signal;
    queueMicrotask(() => this.emit("close", null, signal));
    return true;
  });
}

it("spawns exact shell-free children and waits for both readiness signals", async () => {
  const web = new FakeChild();
  const worker = new FakeChild();
  const spawnImpl = vi.fn()
    .mockReturnValueOnce(web)
    .mockReturnValueOnce(worker);
  const runtime = startLocalSupervisor({
    projectRoot: "/project",
    webArgs: ["--port", "3101"],
    spawnImpl,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    shutdownTimeoutMs: 20
  });
  expect(spawnImpl).toHaveBeenNthCalledWith(1, process.execPath, [
    path.join("/project", "node_modules", "next", "dist", "bin", "next"),
    "dev", "--port", "3101"
  ], expect.objectContaining({ cwd: "/project", shell: false }));
  expect(spawnImpl).toHaveBeenNthCalledWith(2, process.execPath, [
    path.join("/project", "node_modules", "tsx", "dist", "cli.mjs"),
    path.join("/project", "scripts", "agent-worker.ts")
  ], expect.objectContaining({ cwd: "/project", shell: false }));
  web.stdout.write("- Local: http://localhost:3101\n");
  worker.stdout.write("Agent worker ready.\n");
  await expect(runtime.ready).resolves.toEqual({ url: "http://localhost:3101" });
  await runtime.stop("SIGINT");
  expect(web.kill).toHaveBeenCalledWith("SIGINT");
  expect(worker.kill).toHaveBeenCalledWith("SIGINT");
});

it("stops the sibling and exits nonzero after an unexpected child failure", async () => {
  const web = new FakeChild();
  const worker = new FakeChild();
  const runtime = startLocalSupervisor({
    projectRoot: "/project",
    webArgs: [],
    spawnImpl: vi.fn().mockReturnValueOnce(web).mockReturnValueOnce(worker),
    stdout: new PassThrough(), stderr: new PassThrough(), shutdownTimeoutMs: 20
  });
  void runtime.ready.catch(() => {});
  web.exitCode = 1;
  web.emit("close", 1, null);
  await expect(runtime.done).resolves.toBe(1);
  expect(worker.kill).toHaveBeenCalledWith("SIGTERM");
});
```

Add these concrete cases using the same `FakeChild`:

```ts
it("prefixes output and does not resolve readiness before both children", async () => {
  const web = new FakeChild();
  const worker = new FakeChild();
  const output = new PassThrough();
  let rendered = "";
  output.on("data", (chunk) => { rendered += chunk.toString(); });
  const runtime = startLocalSupervisor({
    projectRoot: "/project", webArgs: [],
    spawnImpl: vi.fn().mockReturnValueOnce(web).mockReturnValueOnce(worker),
    stdout: output, stderr: output, shutdownTimeoutMs: 20
  });
  let ready = false;
  void runtime.ready.then(() => { ready = true; });
  web.stdout.write("- Local: http://localhost:3000\n");
  await Promise.resolve();
  expect(ready).toBe(false);
  worker.stdout.write("Agent worker ready.\n");
  await runtime.ready;
  expect(rendered).toContain("[web] - Local: http://localhost:3000");
  expect(rendered).toContain("[worker] Agent worker ready.");
  await runtime.stop("SIGINT");
  await expect(runtime.done).resolves.toBe(0);
});

it("handles spawn errors and escalates children that ignore graceful shutdown", async () => {
  vi.useFakeTimers();
  const web = new FakeChild();
  const worker = new FakeChild();
  worker.kill.mockImplementation(() => true);
  const runtime = startLocalSupervisor({
    projectRoot: "/project", webArgs: [],
    spawnImpl: vi.fn().mockReturnValueOnce(web).mockReturnValueOnce(worker),
    stdout: new PassThrough(), stderr: new PassThrough(), shutdownTimeoutMs: 20
  });
  void runtime.ready.catch(() => {});
  web.emit("error", new Error("spawn failed"));
  await vi.advanceTimersByTimeAsync(21);
  expect(worker.kill).toHaveBeenNthCalledWith(1, "SIGTERM");
  expect(worker.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
  worker.emit("close", null, "SIGKILL");
  await expect(runtime.done).resolves.toBe(1);
  vi.useRealTimers();
});
```

- [ ] **Step 2: Run supervisor tests and confirm RED**

Run:

```bash
npx vitest run scripts/run-local.test.ts
```

Expected: FAIL because the supervisor module does not exist.

- [ ] **Step 3: Implement the testable supervisor core**

Create `scripts/lib/local-supervisor.mjs` exporting:

```js
import { spawn } from "node:child_process";
import path from "node:path";

export function startLocalSupervisor({
  projectRoot,
  webArgs,
  spawnImpl = spawn,
  stdout = process.stdout,
  stderr = process.stderr,
  env = process.env,
  shutdownTimeoutMs = 2_000
}) {
  const web = spawnImpl(process.execPath, [
    path.join(projectRoot, "node_modules", "next", "dist", "bin", "next"),
    "dev",
    ...webArgs
  ], { cwd: projectRoot, env, shell: false, stdio: ["inherit", "pipe", "pipe"] });
  const worker = spawnImpl(process.execPath, [
    path.join(projectRoot, "node_modules", "tsx", "dist", "cli.mjs"),
    path.join(projectRoot, "scripts", "agent-worker.ts")
  ], { cwd: projectRoot, env, shell: false, stdio: ["inherit", "pipe", "pipe"] });

  const readyDeferred = deferred();
  const doneDeferred = deferred();
  const children = [web, worker];
  const closed = new Set();
  let webUrl;
  let workerReady = false;
  let readySettled = false;
  let stopping = false;
  let expectedShutdown = false;
  let finalCode = 0;

  const checkReady = () => {
    if (webUrl && workerReady && !readySettled) {
      readySettled = true;
      readyDeferred.resolve({ url: webUrl });
    }
  };
  pipeLines(web.stdout, "web", stdout, (line) => {
    const match = stripAnsi(line).match(/Local:\s+(https?:\/\/\S+)/);
    if (match) { webUrl = match[1]; checkReady(); }
  });
  pipeLines(web.stderr, "web", stderr, () => {});
  pipeLines(worker.stdout, "worker", stdout, (line) => {
    if (stripAnsi(line).trim() === "Agent worker ready.") {
      workerReady = true;
      checkReady();
    }
  });
  pipeLines(worker.stderr, "worker", stderr, () => {});

  const closeChild = (child, code) => {
    closed.add(child);
    if (!stopping && !expectedShutdown) {
      finalCode = 1;
      if (!readySettled) {
        readySettled = true;
        readyDeferred.reject(new Error("Local runtime failed before readiness"));
      }
      void stop("SIGTERM", false);
    }
    if (closed.size === children.length) doneDeferred.resolve(finalCode || (code ?? 0));
  };
  for (const child of children) {
    child.once("error", () => {
      finalCode = 1;
      if (!closed.has(child)) closeChild(child, 1);
    });
    child.once("close", (code) => closeChild(child, code));
  }

  async function stop(signal = "SIGTERM", expected = true) {
    if (stopping) return doneDeferred.promise;
    stopping = true;
    expectedShutdown = expected;
    if (!expected) finalCode = 1;
    for (const child of children) if (!closed.has(child)) child.kill(signal);
    const timer = setTimeout(() => {
      for (const child of children) if (!closed.has(child)) child.kill("SIGKILL");
    }, shutdownTimeoutMs);
    timer.unref?.();
    await doneDeferred.promise;
    clearTimeout(timer);
    return finalCode;
  }

  return { ready: readyDeferred.promise, done: doneDeferred.promise, stop };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function stripAnsi(value) {
  return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
}

function pipeLines(stream, label, destination, onLine) {
  let buffer = "";
  const flush = (line) => {
    destination.write(`[${label}] ${line}\n`);
    onLine(line);
  };
  stream?.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) flush(line);
  });
  stream?.on("end", () => { if (buffer) flush(buffer); });
}
```

Keep `stop` idempotent in the production implementation by returning the existing `done` promise when shutdown is already in progress. Do not add a retry loop or inspect/print environment values.

- [ ] **Step 4: Implement the CLI entry point**

Create `scripts/run-local.mjs`:

```js
#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";

import { startLocalSupervisor } from "./lib/local-supervisor.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtime = startLocalSupervisor({ projectRoot, webArgs: process.argv.slice(2) });

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => { void runtime.stop(signal); });
}

runtime.ready
  .then(({ url }) => console.log(`JobTracker ready: ${url} (web and agent worker online)`))
  .catch(() => {});

process.exitCode = await runtime.done;
```

- [ ] **Step 5: Update package scripts**

Change only the script entries in `package.json`:

```json
"dev": "node scripts/run-local.mjs",
"dev:web": "next dev",
"agent:worker": "tsx scripts/agent-worker.ts"
```

- [ ] **Step 6: Run focused Task 3 verification**

Run:

```bash
npx vitest run scripts/run-local.test.ts scripts/agent-worker.test.ts
npm run typecheck
```

Expected: all supervisor/worker tests and TypeScript pass; no dependency or lockfile change is needed.

- [ ] **Step 7: Commit Task 3**

```bash
git add scripts/lib/local-supervisor.mjs scripts/run-local.mjs scripts/run-local.test.ts package.json
git commit -m "feat: supervise local web and worker startup"
```

---

### Task 4: Truthful Worker and Run Status in the Drawer

**Files:**
- Modify: `src/components/ApplyWithAgentDrawer.tsx`
- Modify: `src/components/ApplyWithAgentDrawer.test.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes `GET /api/agent-worker-health` and `AgentWorkerHealth` from Task 1.
- Health polling interval is exactly 5,000 ms and remains independent of the existing 1,000 ms run polling.
- Queued states use worker health; active states use worker events unless health is offline, in which case they show **Agent worker connection lost** without mutating run state.

- [ ] **Step 1: Add drawer health and stage RED tests**

Add this fixture to `ApplyWithAgentDrawer.test.tsx`:

```ts
const onlineHealth = { status: "online" as const, lastSeenAt: "2026-07-10T20:00:00.000Z" };
const offlineHealth = { status: "offline" as const, lastSeenAt: null };
```

Update default fetch fixtures so `/api/agent-worker-health` returns `onlineHealth`, then add:

```ts
function installWorkerScenario({
  health = [onlineHealth],
  created = run("queued_preview"),
  polled = created
}: {
  health?: Array<typeof onlineHealth | typeof offlineHealth>;
  created?: ReturnType<typeof run>;
  polled?: ReturnType<typeof run>;
} = {}) {
  let healthIndex = 0;
  fetchMock.mockImplementation((url, options = {}) => {
    if (url === "/api/agent-providers") return jsonReply({ body: diagnostics });
    if (url === "/api/agent-worker-health") {
      const body = health[Math.min(healthIndex, health.length - 1)];
      healthIndex += 1;
      return jsonReply({ body });
    }
    if (url === "/api/agent-runs" && options.method === "POST") {
      return jsonReply({ body: created, status: 202 });
    }
    if (url === `/api/agent-runs/${created.id}`) return jsonReply({ body: polled });
    throw new Error(`Unexpected test URL: ${url}`);
  });
}

it("disables new previews and explains how to start an offline worker", async () => {
  installWorkerScenario({ health: [offlineHealth] });
  await render();
  await act(async () => {});
  expect(container.textContent).toContain("Agent worker is offline. Start JobTracker with npm run dev.");
  expect(button("Start preview").disabled).toBe(true);
});

it.each([
  ["queued_preview", "Waiting for agent worker", "Queue time"],
  ["queued_execution", "Waiting for agent worker", "Queue time"]
])("renders online %s as queued rather than active work", async (state, stage, timerLabel) => {
  installWorkerScenario({ created: run(state) });
  await render(); await act(async () => {}); await submitRun();
  expect(container.textContent).toContain(stage);
  expect(container.textContent).toContain(timerLabel);
  expect(container.textContent).not.toContain("Validating public job URL");
});

it("shows offline reconnect status for an existing queued run", async () => {
  installWorkerScenario({ health: [onlineHealth, offlineHealth] });
  await render(); await act(async () => {}); await submitRun();
  await act(async () => vi.advanceTimersByTimeAsync(5_000));
  expect(container.textContent).toContain("Agent worker is offline");
  expect(container.textContent).toContain("Waiting to reconnect");
  expect(button("Cancel")).toBeTruthy();
});

it("shows validation only after the worker owns previewing", async () => {
  const previewing = run("previewing", {
    events: [{
      id: "event-validation", runId: "run-1", sequence: 2, kind: "status",
      message: "Validating public job URL.", metadata: null,
      createdAt: "2026-07-10T20:00:01.000Z"
    }]
  });
  installWorkerScenario({ created: previewing });
  await render(); await act(async () => {}); await submitRun();
  expect(container.textContent).toContain("Validating public job URL.");
  expect(container.textContent).toContain("Working…");
});

it("shows connection loss without rewriting an active run", async () => {
  installWorkerScenario({ health: [onlineHealth, offlineHealth], created: run("previewing") });
  await render(); await act(async () => {}); await submitRun();
  await act(async () => vi.advanceTimersByTimeAsync(5_000));
  expect(container.textContent).toContain("Agent worker connection lost");
  expect(container.textContent).not.toContain("interrupted");
});
```

Also assert health polling enables **Start preview** after an offline-to-online response and is aborted/cleared on close and unmount.

- [ ] **Step 2: Run drawer tests and confirm RED**

Run:

```bash
npx vitest run src/components/ApplyWithAgentDrawer.test.tsx
```

Expected: FAIL because health is not fetched and queued runs still map to validation/material-preparation labels.

- [ ] **Step 3: Implement independent health polling**

Import `AgentWorkerHealth`, then add:

```ts
const WORKER_HEALTH_POLL_MS = 5_000;
const QUEUED = new Set<AgentRunState>(["queued_preview", "queued_execution"]);
const ACTIVE = new Set<AgentRunState>(["previewing", "executing", "verifying"]);

const [workerHealth, setWorkerHealth] = useState<AgentWorkerHealth | null>(null);
const healthTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
const healthControllerRef = useRef<AbortController | null>(null);
```

Implement `loadWorkerHealth` with the dedicated controller rather than `localFetch`, so workflow invalidation cannot abort health polling:

```ts
const clearHealthPoll = useCallback(() => {
  if (healthTimerRef.current) clearTimeout(healthTimerRef.current);
  healthTimerRef.current = null;
  healthControllerRef.current?.abort();
  healthControllerRef.current = null;
}, []);

const loadWorkerHealth = useCallback(async function load() {
  if (!mountedRef.current || !openRef.current || healthControllerRef.current) return;
  const controller = new AbortController();
  healthControllerRef.current = controller;
  try {
    const response = await fetch("/api/agent-worker-health", {
      cache: "no-store",
      signal: controller.signal
    });
    const next = await readResponse<AgentWorkerHealth>(response);
    if (mountedRef.current && openRef.current && healthControllerRef.current === controller) {
      setWorkerHealth(next);
    }
  } catch (caught) {
    if (!(caught instanceof DOMException && caught.name === "AbortError") && mountedRef.current && openRef.current) {
      setWorkerHealth({ status: "offline", lastSeenAt: null });
    }
  } finally {
    if (healthControllerRef.current === controller) healthControllerRef.current = null;
    if (mountedRef.current && openRef.current) {
      healthTimerRef.current = setTimeout(() => { void load(); }, WORKER_HEALTH_POLL_MS);
    }
  }
}, []);
```

Call `loadWorkerHealth` when the drawer opens. Add `clearHealthPoll` to close and unmount cleanup. This polling must not cancel provider diagnostics or run polling, and `invalidateRequests` must not clear it.

Update the submit guard and button:

```ts
if (pending || workerHealth?.status !== "online" || !chosen?.available) return;

disabled={Boolean(pending) || workerHealth?.status !== "online" || !chosen?.available}
```

Render the exact offline notice on the fresh form.

- [ ] **Step 4: Separate queued, active, and lost-connection presentation**

Replace `stageFor` with:

```ts
function stageFor(run: PublicAgentRun, health: AgentWorkerHealth | null) {
  if (QUEUED.has(run.state)) {
    return health?.status === "online" ? "Waiting for agent worker" : "Agent worker is offline";
  }
  if (ACTIVE.has(run.state) && health?.status === "offline") return "Agent worker connection lost";
  if (run.state === "previewing") {
    return [...run.events]
      .sort((left, right) => left.sequence - right.sequence)
      .filter((event) => HOST_PREVIEW_STAGES.has(event.message))
      .at(-1)?.message ?? "Analyzing job posting.";
  }
  return ({
    executing: "Creating application materials.",
    verifying: "Verifying application artifacts."
  } satisfies Partial<Record<AgentRunState, string>>)[run.state] ?? run.state.replaceAll("_", " ");
}
```

Render queued online with the spinner and `Queue time · 0:00`; queued offline without the spinner, with `Waiting to reconnect · 0:00`; active online with `Working…`; and active offline without the spinner with `Waiting for recovery · 0:00`. Keep the existing Cancel button for both queued states.

Add `.agent-activity--offline` styling in `globals.css` using the existing notice/error palette and no animation. Preserve the reduced-motion rule for online spinners.

- [ ] **Step 5: Run focused Task 4 verification**

Run:

```bash
npx vitest run src/components/ApplyWithAgentDrawer.test.tsx src/app/api/agent-worker-health/route.test.ts
npm run typecheck
```

Expected: offline form, reconnect, queued labels, active labels, polling cleanup, API, and TypeScript all pass.

- [ ] **Step 6: Commit Task 4**

```bash
git add src/components/ApplyWithAgentDrawer.tsx src/components/ApplyWithAgentDrawer.test.tsx src/app/globals.css
git commit -m "feat: show truthful agent worker status"
```

---

### Task 5: Installation Contract, Integrated Verification, and Release Evidence

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `docs/agent-setup.md`
- Modify: `docs/agent-workflow.md`
- Create: `scripts/startup-contract.test.ts`

**Interfaces:**
- Consumes the one-command package scripts, fixed readiness output, and safe health endpoint.
- Produces one identical normal startup contract across all installer-facing documents.

- [ ] **Step 1: Write documentation contract RED tests**

Create `scripts/startup-contract.test.ts`:

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

describe("one-command startup contract", () => {
  it("maps npm run dev to the local supervisor and retains advanced commands", () => {
    const scripts = JSON.parse(read("package.json")).scripts;
    expect(scripts.dev).toBe("node scripts/run-local.mjs");
    expect(scripts["dev:web"]).toBe("next dev");
    expect(scripts["agent:worker"]).toBe("tsx scripts/agent-worker.ts");
  });

  it.each(["README.md", "AGENTS.md", "docs/agent-setup.md", "docs/agent-workflow.md"])(
    "%s names npm run dev as the normal one-command startup",
    (file) => {
      const text = read(file);
      expect(text).toContain("npm run dev");
      expect(text).toMatch(/web.+worker|worker.+web/is);
    }
  );

  it("keeps two-process commands only in the advanced workflow section", () => {
    const workflow = read("docs/agent-workflow.md");
    const advanced = workflow.indexOf("## Advanced debugging");
    expect(advanced).toBeGreaterThan(0);
    expect(workflow.indexOf("npm run dev:web")).toBeGreaterThan(advanced);
    expect(workflow.indexOf("npm run agent:worker")).toBeGreaterThan(advanced);
  });
});
```

- [ ] **Step 2: Run the contract test and confirm RED**

Run:

```bash
npx vitest run scripts/startup-contract.test.ts
```

Expected: FAIL because package scripts and documents still describe conflicting startup paths.

- [ ] **Step 3: Update the normal installation documentation**

Make the normal command sequence identical in `README.md` and `docs/agent-setup.md`:

```bash
npm install
npm run setup
npm run skills:install
npm run verify
npm run build
npm run dev
```

State directly after it:

```text
`npm run dev` starts and supervises both the web app and the separate agent worker. Wait for the combined ready message, then open the printed local URL. One Ctrl+C stops both processes.
```

Update the agent-owned setup checklist in `AGENTS.md` and `docs/agent-setup.md` to require:

```text
- Wait for both Web ready and Agent worker ready.
- Confirm GET /api/agent-worker-health reports online.
- Confirm the selected provider is available.
- Do not report setup complete merely because the web URL responds.
```

In `docs/agent-workflow.md`, replace the normal two-terminal section with `npm run dev`, add the exact health/queued/active semantics, and place these commands only under `## Advanced debugging`:

```bash
npm run dev:web
npm run agent:worker
```

- [ ] **Step 4: Run all focused tests**

Run:

```bash
npx vitest run \
  src/lib/agent-workflow/storage.test.ts \
  src/lib/agent-workflow/orchestrator.test.ts \
  src/app/api/agent-worker-health/route.test.ts \
  src/components/ApplyWithAgentDrawer.test.tsx \
  scripts/agent-worker.test.ts \
  scripts/run-local.test.ts \
  scripts/startup-contract.test.ts
```

Expected: all focused suites pass.

- [ ] **Step 5: Run full static and production verification**

Run:

```bash
npm run verify
npm run build
git diff --check
git check-ignore -v jobtracker.agent.local.json .env.local data/jobtracker.sqlite applications/example/output.md .superpowers/sdd/progress.md
```

Expected: lint, typecheck, all Vitest suites, production build, whitespace check, and privacy ignore audit pass. The existing nonfatal Turbopack NFT warning may remain; no new warning is accepted.

- [ ] **Step 6: Run a real one-command lifecycle smoke**

Use an isolated database and applications root so no user data is changed:

```bash
TMP_ROOT="$(mktemp -d)"
JOBTRACKER_DB_PATH="$TMP_ROOT/jobtracker.sqlite" \
JOBTRACKER_APPLICATIONS_DIR="$TMP_ROOT/applications" \
npm run dev -- --port 3110
```

From a second terminal, after the combined readiness line appears:

```bash
curl -fsS http://localhost:3110/api/agent-worker-health
```

Validate the exact shape without assuming a timestamp value:

```bash
HEALTH_JSON="$(curl -fsS http://localhost:3110/api/agent-worker-health)"
node -e '
  const value = JSON.parse(process.argv[1]);
  if (Object.keys(value).sort().join(",") !== "lastSeenAt,status") process.exit(1);
  if (value.status !== "online" || typeof value.lastSeenAt !== "string") process.exit(1);
  if (Number.isNaN(Date.parse(value.lastSeenAt))) process.exit(1);
' "$HEALTH_JSON"
```

Expected: exit 0. Press `Ctrl+C` once in the supervisor terminal, then verify neither the port nor the isolated worker remains:

```bash
curl --max-time 1 http://localhost:3110/ 2>/dev/null && exit 1 || true
rm -rf "$TMP_ROOT"
```

- [ ] **Step 7: Run browser smoke checks**

Using an isolated runtime, verify:

1. healthy worker enables **Start preview**;
2. stopping the isolated worker changes the fresh drawer to **Agent worker is offline** within 15 seconds and disables submission;
3. a run queued during the health race says **Waiting to reconnect**, retains Cancel, and never says validation is active;
4. restarting the worker claims that same queued run without creating another run;
5. `previewing` shows **Validating public job URL** only after claim;
6. active heartbeat loss shows **Agent worker connection lost** until lease recovery updates state;
7. desktop and 320px layouts have no horizontal overflow;
8. browser console has no errors.

- [ ] **Step 8: Commit Task 5**

```bash
git add README.md AGENTS.md docs/agent-setup.md docs/agent-workflow.md scripts/startup-contract.test.ts
git commit -m "docs: standardize one-command JobTracker startup"
```

- [ ] **Step 9: Request independent final review**

Provide the reviewer the design spec, this plan, complete implementation range, focused/full verification output, lifecycle smoke evidence, browser evidence, privacy audit, and the protected-file list. Require findings by severity and do not mark the work complete while any Critical or Important finding remains.
