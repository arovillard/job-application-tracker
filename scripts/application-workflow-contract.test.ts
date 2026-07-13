import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const projectRoot = path.resolve(__dirname, "..");
const workflow = readFileSync(path.join(projectRoot, "skills/job-application-workflow/SKILL.md"), "utf8");

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
