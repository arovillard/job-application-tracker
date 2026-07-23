#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { writeDailyDiscoveryConfig } from "./lib/daily-discovery-config.mjs";

function parseArguments(argv) {
  const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const result = { projectRoot: defaultRoot, inputJson: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!["--project-root", "--input-json"].includes(argument)) throw new Error(`Unknown argument: ${argument}`);
    if (!argv[index + 1]) throw new Error(`${argument} requires a value`);
    const value = argv[++index];
    if (argument === "--project-root") result.projectRoot = path.resolve(value);
    if (argument === "--input-json") result.inputJson = value;
  }
  if (!result.inputJson) throw new Error("--input-json is required");
  return result;
}

try {
  const args = parseArguments(process.argv.slice(2));
  const contents = args.inputJson === "-" ? readFileSync(0, "utf8") : readFileSync(args.inputJson, "utf8");
  const result = writeDailyDiscoveryConfig(args.projectRoot, JSON.parse(contents));
  process.stdout.write(`${JSON.stringify({
    schemaVersion: result.schemaVersion,
    path: result.path,
    configured: true,
    schedulerOwner: result.config.schedule.schedulerOwner,
    agents: result.config.agents
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
