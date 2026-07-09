#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";

import { installSkills } from "./lib/install-skills.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const result = installSkills(projectRoot);

console.log(`Installed ${result.skillNames.length} skills to ${result.targetRoot}:`);
for (const skillName of result.skillNames) {
  console.log(`- ${skillName}`);
}
