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
