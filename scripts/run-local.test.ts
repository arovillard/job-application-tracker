import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, createConnection } from "node:net";
import { tmpdir } from "node:os";
import { PassThrough } from "node:stream";
import path from "node:path";
import Database from "better-sqlite3";
import { expect, it, vi } from "vitest";

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

async function availablePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test port is unavailable");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

function portIsOpen(port: number) {
  return new Promise<boolean>((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const finish = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(250, () => finish(false));
  });
}

function processGroupIsAlive(pid: number) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

async function waitForCondition(check: () => boolean | Promise<boolean>, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for local runtime condition");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function waitForOutput(read: () => string, expected: string, timeoutMs: number) {
  return waitForCondition(() => read().includes(expected), timeoutMs);
}

function stopProcessGroup(pid: number) {
  try {
    process.kill(-pid, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
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

it("reports a silent web close once and stops the sibling with a nonzero exit", async () => {
  const web = new FakeChild();
  const worker = new FakeChild();
  const output = new PassThrough();
  let rendered = "";
  output.on("data", (chunk) => { rendered += chunk.toString(); });
  const runtime = startLocalSupervisor({
    projectRoot: "/project",
    webArgs: [],
    spawnImpl: vi.fn().mockReturnValueOnce(web).mockReturnValueOnce(worker),
    stdout: output, stderr: output, shutdownTimeoutMs: 20
  });
  void runtime.ready.catch(() => {});
  web.exitCode = 1;
  web.emit("close", 1, null);
  await expect(runtime.done).resolves.toBe(1);
  expect(worker.kill).toHaveBeenCalledWith("SIGTERM");
  expect(rendered.match(/\[web\] Web process failed before readiness\./g) ?? []).toHaveLength(1);
  expect(rendered).not.toContain("Local runtime failed before readiness");
});

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
  expect(rendered).not.toContain("failed before readiness");
});

it("reports a worker spawn error once without leaking it and escalates ignored shutdown", async () => {
  vi.useFakeTimers();
  try {
    const web = new FakeChild();
    const worker = new FakeChild();
    const output = new PassThrough();
    let rendered = "";
    output.on("data", (chunk) => { rendered += chunk.toString(); });
    web.kill.mockImplementation(() => true);
    const runtime = startLocalSupervisor({
      projectRoot: "/project", webArgs: [],
      spawnImpl: vi.fn().mockReturnValueOnce(web).mockReturnValueOnce(worker),
      stdout: output, stderr: output, shutdownTimeoutMs: 20
    });
    void runtime.ready.catch(() => {});
    worker.emit("error", new Error("spawn failed at /private/database with secret-token"));
    worker.emit("close", 1, null);
    await vi.advanceTimersByTimeAsync(21);
    expect(web.kill).toHaveBeenNthCalledWith(1, "SIGTERM");
    expect(web.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
    web.emit("close", null, "SIGKILL");
    await expect(runtime.done).resolves.toBe(1);
    expect(rendered.match(/\[worker\] Agent worker failed before readiness\./g) ?? []).toHaveLength(1);
    expect(rendered).not.toContain("spawn failed");
    expect(rendered).not.toContain("/private/database");
    expect(rendered).not.toContain("secret-token");
  } finally {
    vi.useRealTimers();
  }
});

it("runs through npm and shuts down both real children cleanly on SIGINT", async () => {
  const projectRoot = path.resolve(import.meta.dirname, "..");
  const tempRoot = mkdtempSync(path.join(tmpdir(), "jobtracker-local-supervisor-"));
  const databasePath = path.join(tempRoot, "jobtracker.sqlite");
  const port = await availablePort();
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const child = spawn(npm, ["run", "dev", "--", "--port", String(port)], {
    cwd: projectRoot,
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      JOBTRACKER_DB_PATH: databasePath,
      JOBTRACKER_APPLICATIONS_DIR: path.join(tempRoot, "applications")
    },
    shell: false,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once("close", (code, signal) => resolve({ code, signal }));
  });

  try {
    await waitForOutput(
      () => output,
      `JobTracker ready: http://localhost:${port} (web and agent worker online)`,
      15_000
    );
    expect(child.kill("SIGINT")).toBe(true);
    const result = await Promise.race([
      closed,
      new Promise<never>((_, reject) => setTimeout(
        () => reject(new Error("Timed out waiting for npm run dev to stop")),
        10_000
      ))
    ]);
    expect(result).toEqual({ code: 0, signal: null });
    await waitForCondition(
      async () => !(await portIsOpen(port)) && !processGroupIsAlive(child.pid!),
      5_000
    );
    expect(output).toContain("[worker] Agent worker ready.");
    expect(output).not.toContain("Local runtime failed before readiness");

    const database = new Database(databasePath, { readonly: true });
    const healthRows = database.prepare("SELECT COUNT(*) AS count FROM agent_worker_health").get() as { count: number };
    database.close();
    expect(healthRows.count).toBe(0);
  } finally {
    if (child.pid && process.platform !== "win32") stopProcessGroup(child.pid);
    else if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    rmSync(tempRoot, { force: true, recursive: true });
  }
}, 35_000);
