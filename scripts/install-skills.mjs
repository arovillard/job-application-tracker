#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";

import { installAllSkills, installClaudeSkills, installCodexSkills } from "./lib/install-skills.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const installCodex = args.has("--codex") || (!args.has("--claude") && !args.has("--codex"));
const installClaude = args.has("--claude") || (!args.has("--claude") && !args.has("--codex"));

if (args.has("--help")) {
  console.log("Usage: node scripts/install-skills.mjs [--codex] [--claude]");
  process.exit(0);
}

const result =
  installCodex && installClaude
    ? installAllSkills(projectRoot)
    : {
        codex: installCodex ? installCodexSkills(projectRoot) : null,
        claude: installClaude ? installClaudeSkills(projectRoot) : null
      };

for (const [provider, installed] of Object.entries(result)) {
  if (!installed) {
    continue;
  }

  console.log(`Installed ${installed.skillNames.length} ${provider} skills to ${installed.targetRoot}:`);
  for (const skillName of installed.skillNames) {
    console.log(`- ${skillName}`);
  }
}
