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
