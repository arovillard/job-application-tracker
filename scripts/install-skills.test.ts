import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const projectRoot = path.resolve(__dirname, "..");
const skillNames = [
  "job-application-resume",
  "job-application-workflow",
  "job-tracker-add-posting"
];

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "jobtracker-skills-"));
});

afterEach(() => {
  rmSync(tempDir, { force: true, recursive: true });
});

describe("agent skill packaging", () => {
  it("documents fresh-session readiness and Google Docs preference", () => {
    const readme = readFileSync(path.join(projectRoot, "README.md"), "utf8");
    const setup = readFileSync(path.join(projectRoot, "docs", "agent-setup.md"), "utf8");

    for (const content of [readme, setup]) {
      expect(content).toContain("JOBTRACKER_BASE_RESUME_URL");
      expect(content).toContain("JOBTRACKER_LINKEDIN_URL");
      expect(content).toContain("Google Doc");
      expect(content).toContain("Configure my reusable application profile");
      expect(content).toContain("cloud environment variables");
      expect(content.toLowerCase()).toContain("fresh session");
    }
  });

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
      const codexRoot = path.join(projectRoot, "skills", skillName);
      const claudeRoot = path.join(projectRoot, ".claude", "skills", skillName);
      const files = (root: string): string[] => readdirSync(root, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(path.join(root, entry.name)).map((name) => path.join(entry.name, name)) : [entry.name]).sort();
      expect(files(claudeRoot)).toEqual(files(codexRoot));
      for (const relative of files(codexRoot)) expect(readFileSync(path.join(claudeRoot, relative), "utf8")).toEqual(readFileSync(path.join(codexRoot, relative), "utf8"));
      if (skillName === "job-tracker-add-posting") {
        expect(codexSkill).toContain("Confirm opportunity.type is job.");
        expect(claudeSkill).toContain("Confirm opportunity.type is job.");
      }
      if (skillName === "job-application-workflow") {
        for (const required of [
          "check-application-readiness.mjs",
          "job-tracker-add-posting",
          "job-application-resume",
          "master resume"
        ]) {
          expect(codexSkill).toContain(required);
          expect(claudeSkill).toContain(required);
        }
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
