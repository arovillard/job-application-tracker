#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateApplicationReadiness } from "./lib/application-readiness.mjs";

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
let projectRoot = defaultRoot;
for (let index = 0; index < args.length; index += 1) {
  if (args[index] !== "--project-root") throw new Error(`Unknown argument: ${args[index]}`);
  if (!args[index + 1]) throw new Error("--project-root requires a value");
  projectRoot = path.resolve(args[++index]);
}
process.stdout.write(`${JSON.stringify(evaluateApplicationReadiness({ projectRoot }), null, 2)}\n`);
