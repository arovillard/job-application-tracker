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
