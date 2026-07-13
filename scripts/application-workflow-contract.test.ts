import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const projectRoot = path.resolve(__dirname, "..");
const workflow = readFileSync(path.join(projectRoot, "skills/job-application-workflow/SKILL.md"), "utf8");
const resumeSkill = readFileSync(path.join(projectRoot, "skills/job-application-resume/SKILL.md"), "utf8");
const postingSkill = readFileSync(path.join(projectRoot, "skills/job-tracker-add-posting/SKILL.md"), "utf8");
const readySentence = "Your application workspace is ready. Your master resume is configured and will not be modified. Send me a job-posting link when you're ready.";
const nextLinkSentence = "I'm ready for another job-posting link whenever you are.";
const successfulCompletionInstruction = `End the final response with exactly: “${nextLinkSentence}” Use this sentence only after tracker intake, verification, and all requested application-material work complete successfully. Do not use this sentence when the workflow is blocked, failed, incomplete, or awaiting user input.`;

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "jobtracker-workflow-"));
});

afterEach(() => {
  rmSync(tempDir, { force: true, recursive: true });
});

describe("job application workflow contract", () => {
  it("orders readiness before intake before materials", () => {
    const readiness = workflow.indexOf("check-application-readiness.mjs");
    const intake = workflow.indexOf("job-tracker-add-posting");
    const materials = workflow.indexOf("job-application-resume");

    expect(readiness).toBeGreaterThan(-1);
    expect(intake).toBeGreaterThan(readiness);
    expect(materials).toBeGreaterThan(intake);
  });

  it("propagates resolved database and applications paths", () => {
    expect(workflow).toContain("database.path");
    expect(workflow).toContain("applicationsDirectory.path");
    expect(workflow).toContain("--db");
    expect(workflow).toContain("--applications-dir");
  });

  it("protects the master and registers only an existing local snapshot", () => {
    expect(workflow).toContain("read-only master");
    expect(workflow).toContain("role-specific copy");
    expect(workflow).toContain("snapshot exists before registration");
    expect(workflow).toContain("do not claim tracker resume registration succeeded");
  });

  it("routes fresh repository sessions through the source coordinator", () => {
    const agents = readFileSync(path.join(projectRoot, "AGENTS.md"), "utf8");
    const claude = readFileSync(path.join(projectRoot, "CLAUDE.md"), "utf8");

    expect(agents).toContain("skills/job-application-workflow/SKILL.md");
    expect(agents).toContain("$job-application-workflow");
    expect(claude).toContain(".claude/skills/job-application-workflow/SKILL.md");
    expect(claude).toContain("/job-application-workflow");
  });

  it("persists profile-only input for reuse by fresh tasks", () => {
    const agents = readFileSync(path.join(projectRoot, "AGENTS.md"), "utf8");
    const claude = readFileSync(path.join(projectRoot, "CLAUDE.md"), "utf8");

    for (const instructions of [agents, claude]) {
      expect(instructions).toContain("configure, save, remember, or update");
      expect(instructions).toContain("resume or public professional-profile references");
    }
    expect(workflow).toContain("configure, save, remember, or update");
    expect(workflow).toContain("persist every supplied allowlisted field together");
    expect(workflow).toContain("Omit fields the user did not supply");
    expect(workflow).toContain("Rerun readiness after the combined update");
  });

  it("makes direct resume invocation establish the same readiness contract", () => {
    expect(resumeSkill).toContain("When no coordinating readiness result is supplied");
    expect(resumeSkill).toContain("run and parse `node scripts/check-application-readiness.mjs`");
    expect(resumeSkill).toContain("verified opportunity ID");
    expect(resumeSkill).toContain("absolute `database.path`");
    expect(resumeSkill).toContain("absolute `applicationsDirectory.path`");
  });

  it("makes direct posting invocation discover the configured database through readiness", () => {
    expect(postingSkill).toContain("When no coordinating readiness result is supplied");
    expect(postingSkill).toContain("run and parse `node scripts/check-application-readiness.mjs`");
    expect(postingSkill).toContain("absolute `database.path`");
    expect(postingSkill).toContain("database.parentExists");
    expect(postingSkill).toContain("database.parentWritable");
  });

  it("stops direct posting intake when configuration or database readiness is blocked", () => {
    expect(postingSkill).toContain("`configuration_unreadable`");
    expect(postingSkill).toContain("`database_parent_unavailable`");
    expect(postingSkill).toContain("`database_parent_unwritable`");
    expect(postingSkill).toContain("`database_parent_permission_denied`");
    expect(postingSkill).toContain("`database_parent_inspection_failed`");
    expect(postingSkill).toContain("Ignore only application-material issues");
  });

  it("keeps new-user setup Google-first in both root instruction files", () => {
    const agents = readFileSync(path.join(projectRoot, "AGENTS.md"), "utf8");
    const claude = readFileSync(path.join(projectRoot, "CLAUDE.md"), "utf8");

    for (const instructions of [agents, claude]) {
      expect(instructions).toContain("private Google Docs URL first");
      expect(instructions).toContain("DOCX/PDF fallback");
      expect(instructions).toContain("optional public profile context");
    }
  });

  it("documents the repository-local default and existing-install migration", () => {
    const readme = readFileSync(path.join(projectRoot, "README.md"), "utf8");
    const setup = readFileSync(path.join(projectRoot, "docs", "agent-setup.md"), "utf8");

    for (const content of [readme, setup]) {
      for (const required of [
        "./applications",
        "relative to the repository",
        "npm run artifacts:backfill",
        "--applications-dir",
        "restart"
      ]) {
        expect(content.toLowerCase()).toContain(required.toLowerCase());
      }
    }
  });

  it("keeps agents from reinterpreting the default as a root path", () => {
    const agents = readFileSync(path.join(projectRoot, "AGENTS.md"), "utf8");
    const claude = readFileSync(path.join(projectRoot, "CLAUDE.md"), "utf8");

    for (const content of [agents, claude, workflow]) {
      expect(content).toContain("./applications");
      expect(content.toLowerCase()).toContain("do not ask");
      expect(content.toLowerCase()).toContain("remain relative");
      expect(content).toContain("/applications");
    }
  });

  it("uses the exact no-link ready sentence", () => {
    const agents = readFileSync(path.join(projectRoot, "AGENTS.md"), "utf8");
    const claude = readFileSync(path.join(projectRoot, "CLAUDE.md"), "utf8");

    expect(workflow).toContain(readySentence);
    expect(agents).toContain(readySentence);
    expect(claude).toContain(readySentence);
  });

  it("invites another link only after successful completion", () => {
    expect(workflow).toContain(successfulCompletionInstruction);
    expect(workflow.split(nextLinkSentence).length - 1).toBe(1);
  });

  it("real tracker commands stay on the supplied custom database", () => {
    const customDb = path.join(tempDir, "custom", "jobs.sqlite");
    const defaultDb = path.join(tempDir, "data", "jobtracker.sqlite");
    const created = JSON.parse(execFileSync(process.execPath, [
      path.join(projectRoot, "scripts/upsert-job-posting.mjs"),
      "--db", customDb,
      "--company", "Fixture Co",
      "--role", "Fixture Role",
      "--url", "https://example.com/jobs/fixture"
    ], { cwd: tempDir, encoding: "utf8" }));
    const snapshot = path.join(tempDir, "external-applications", "Fixture Co", "fixture-role-resume.pdf");
    mkdirSync(path.dirname(snapshot), { recursive: true });
    writeFileSync(snapshot, "fixture snapshot");

    execFileSync(process.execPath, [
      path.join(projectRoot, "scripts/register-application-artifact.mjs"),
      "--db", customDb,
      "--opportunity-id", created.opportunity.id,
      "--type", "resume",
      "--title", "Resume",
      "--file", snapshot
    ]);

    expect(existsSync(customDb)).toBe(true);
    expect(existsSync(defaultDb)).toBe(false);
  });
});
