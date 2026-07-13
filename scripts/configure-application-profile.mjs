#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { updateApplicationConfig } from "./lib/application-readiness.mjs";

function parseArguments(argv) {
  const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const parsed = { projectRoot: defaultRoot, inputJson: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!["--project-root", "--input-json"].includes(argument)) throw new Error(`Unknown argument: ${argument}`);
    if (!argv[index + 1]) throw new Error(`${argument} requires a value`);
    const value = argv[++index];
    if (argument === "--project-root") parsed.projectRoot = path.resolve(value);
    if (argument === "--input-json") parsed.inputJson = value;
  }
  if (!parsed.inputJson) throw new Error("--input-json is required");
  return parsed;
}

try {
  const args = parseArguments(process.argv.slice(2));
  const contents = args.inputJson === "-" ? readFileSync(0, "utf8") : readFileSync(args.inputJson, "utf8");
  const summary = updateApplicationConfig(args.projectRoot, JSON.parse(contents));
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
