#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";

import { evaluateDailyDiscoveryReadiness } from "./lib/daily-discovery-config.mjs";

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
let projectRoot = defaultRoot;
let includePrivateConfig = false;
for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  if (argument === "--include-private-config") {
    includePrivateConfig = true;
    continue;
  }
  if (argument === "--project-root") {
    if (!args[index + 1]) throw new Error("--project-root requires a value");
    projectRoot = path.resolve(args[++index]);
    continue;
  }
  throw new Error(`Unknown argument: ${argument}`);
}

process.stdout.write(`${JSON.stringify(evaluateDailyDiscoveryReadiness({
  projectRoot,
  includePrivateConfig
}), null, 2)}\n`);
