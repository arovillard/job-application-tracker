import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const projectRoot = path.resolve(__dirname, "..");
const skillNames = ["job-application-resume", "job-tracker-add-posting"];

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "jobtracker-skills-"));
});

afterEach(() => {
  rmSync(tempDir, { force: true, recursive: true });
});

describe("agent skill packaging", () => {
  it("ships Claude project skills alongside Codex skills", () => {
    for (const skillName of skillNames) {
      const codexSkillPath = path.join(projectRoot, "skills", skillName, "SKILL.md");
      const claudeSkillPath = path.join(projectRoot, ".claude", "skills", skillName, "SKILL.md");

      expect(existsSync(codexSkillPath)).toBe(true);
      expect(existsSync(claudeSkillPath)).toBe(true);

      const codexSkill = readFileSync(codexSkillPath, "utf8");
      const claudeSkill = readFileSync(claudeSkillPath, "utf8");

      expect(claudeSkill).toContain("description:");
      expect(claudeSkill).toContain(codexSkill.match(/^description: .+$/m)?.[0]);
      if (skillName === "job-tracker-add-posting") {
        expect(codexSkill).toContain("Confirm opportunity.type is job.");
        expect(claudeSkill).toContain("Confirm opportunity.type is job.");
      }
    }
  });

  it("installs both Codex and Claude personal skill copies", async () => {
    const installerUrl = pathToFileURL(path.join(projectRoot, "scripts", "lib", "install-skills.mjs")).href;
    const { installAllSkills } = (await import(installerUrl)) as {
      installAllSkills: (
        projectRoot: string,
        options: { codexHome: string; claudeHome: string }
      ) => {
        codex: { targetRoot: string; skillNames: string[] };
        claude: { targetRoot: string; skillNames: string[] };
      };
    };
    const codexHome = path.join(tempDir, "codex-home");
    const claudeHome = path.join(tempDir, "claude-home");

    const result = installAllSkills(projectRoot, { codexHome, claudeHome });

    expect(result.codex.targetRoot).toBe(path.join(codexHome, "skills"));
    expect(result.claude.targetRoot).toBe(path.join(claudeHome, "skills"));
    expect(result.codex.skillNames).toEqual(skillNames);
    expect(result.claude.skillNames).toEqual(skillNames);

    for (const skillName of skillNames) {
      expect(existsSync(path.join(codexHome, "skills", skillName, "SKILL.md"))).toBe(true);
      expect(existsSync(path.join(claudeHome, "skills", skillName, "SKILL.md"))).toBe(true);
    }
  });
});
