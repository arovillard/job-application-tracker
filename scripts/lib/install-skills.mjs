import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";

function defaultCodexSkillsDir() {
  if (process.env.CODEX_HOME) {
    return path.join(process.env.CODEX_HOME, "skills");
  }

  if (!process.env.HOME) {
    throw new Error("HOME is not set. Set CODEX_HOME or run with a normal user environment.");
  }

  return path.join(process.env.HOME, ".codex", "skills");
}

export function installSkills(projectRoot, targetRoot = defaultCodexSkillsDir()) {
  const sourceRoot = path.join(projectRoot, "skills");

  if (!existsSync(sourceRoot)) {
    throw new Error(`Skills directory not found: ${sourceRoot}`);
  }

  const skillNames = readdirSync(sourceRoot).filter((name) => {
    const sourcePath = path.join(sourceRoot, name);
    return statSync(sourcePath).isDirectory() && existsSync(path.join(sourcePath, "SKILL.md"));
  });

  if (skillNames.length === 0) {
    throw new Error(`No skill folders found in ${sourceRoot}`);
  }

  mkdirSync(targetRoot, { recursive: true });

  for (const skillName of skillNames) {
    const sourcePath = path.join(sourceRoot, skillName);
    const targetPath = path.join(targetRoot, skillName);

    rmSync(targetPath, { force: true, recursive: true });
    cpSync(sourcePath, targetPath, { force: true, recursive: true });
  }

  return {
    targetRoot,
    skillNames
  };
}
