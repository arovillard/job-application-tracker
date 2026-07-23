#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";

import { scanRepositoryPrivacy } from "./lib/privacy-check.mjs";

const args = process.argv.slice(2);
let projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let history = false;
for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  if (argument === "--history") {
    history = true;
    continue;
  }
  if (argument === "--project-root") {
    if (!args[index + 1]) throw new Error("--project-root requires a value");
    projectRoot = path.resolve(args[++index]);
    continue;
  }
  throw new Error(`Unknown argument: ${argument}`);
}

const result = scanRepositoryPrivacy(projectRoot, { history });
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.ok) process.exitCode = 1;
