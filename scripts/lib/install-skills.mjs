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

function defaultClaudeSkillsDir() {
  if (process.env.CLAUDE_HOME) {
    return path.join(process.env.CLAUDE_HOME, "skills");
  }

  if (!process.env.HOME) {
    throw new Error("HOME is not set. Set CLAUDE_HOME or run with a normal user environment.");
  }

  return path.join(process.env.HOME, ".claude", "skills");
}

function installSkillsFromSource(sourceRoot, targetRoot) {
  if (!existsSync(sourceRoot)) {
    throw new Error(`Skills directory not found: ${sourceRoot}`);
  }

  const skillNames = readdirSync(sourceRoot)
    .filter((name) => {
      const sourcePath = path.join(sourceRoot, name);
      return statSync(sourcePath).isDirectory() && existsSync(path.join(sourcePath, "SKILL.md"));
    })
    .sort();

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

export function installCodexSkills(projectRoot, targetRoot = defaultCodexSkillsDir()) {
  return installSkillsFromSource(path.join(projectRoot, "skills"), targetRoot);
}

export function installClaudeSkills(projectRoot, targetRoot = defaultClaudeSkillsDir()) {
  return installSkillsFromSource(path.join(projectRoot, ".claude", "skills"), targetRoot);
}

export function installAllSkills(projectRoot, options = {}) {
  const codexTargetRoot = options.codexHome
    ? path.join(options.codexHome, "skills")
    : options.codexTargetRoot;
  const claudeTargetRoot = options.claudeHome
    ? path.join(options.claudeHome, "skills")
    : options.claudeTargetRoot;

  return {
    codex: installCodexSkills(projectRoot, codexTargetRoot),
    claude: installClaudeSkills(projectRoot, claudeTargetRoot)
  };
}

export const installSkills = installCodexSkills;
